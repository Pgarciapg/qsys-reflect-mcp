import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cardModel, fleetSchematic, systemSchematic } from "../view/model.ts";
import { call, connect } from "./helpers.ts";

test("fleet card: verdict, health dial, and a drill-in action on system issues", async () => {
  const client = await connect();
  const model = cardModel((await call(client, "get_fleet_health")).structuredContent);
  assert.equal(model.kind, "fleet");
  assert.equal(model.source, "Demo data");
  assert.equal(`${model.headlineStrong} ${model.headline}`, "5 issues need attention");
  assert.equal(model.subhead, "6 cores · 5 systems · 38 items");
  assert.deepEqual(model.gauge, { percent: 89, label: "34/38 items OK" });
  assert.equal(model.rows.length, 3);
  assert.deepEqual(model.rows[0]!.action, { label: "Open Arena Bowl Audio", name: "get_system", arguments: { systemId: 202 } });
  assert.equal(model.footnote, "Read-only · +2 more in the result");
});

test("fleet schematic: one core per row, systems beside their core, faults on broken wires", async () => {
  const client = await connect();
  const schem = cardModel((await call(client, "get_fleet_health")).structuredContent).schematic!;
  const cores = schem.nodes.filter((node) => node.kind === "core");
  const systems = schem.nodes.filter((node) => node.kind === "system");
  assert.equal(cores.length, 6);
  assert.equal(systems.length, 5);
  const arena = systems.find((node) => node.title === "Arena Bowl Audio")!;
  assert.equal(arena.level, "fault");
  assert.equal(arena.sub, "ATHLETICS ARENA");
  assert.equal(arena.right, "8/11");
  // Each system sits on the same row as its core.
  const arenaCore = cores.find((node) => node.title === "Arena-Core")!;
  assert.equal(arena.y + 2, arenaCore.y);
  // Redundant PAC pair is bracketed, and the standby core gets an idle link.
  assert.equal(schem.braces.length, 1);
  assert.equal(schem.wires.filter((wire) => wire.style === "idle").length, 1);
  assert.equal(cores.find((node) => node.title === "PAC-Core-B")!.right, "STBY");
  // 3 faulted entries (Arena core + system, Media Lab system) draw broken wires.
  assert.equal(schem.wires.filter((wire) => wire.style === "broken").length, 3);
  assert.equal(schem.more, null);
});

test("fleet schematic keeps the worst rows when a fleet is large", () => {
  const cores = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, name: `Core-${index + 1}`, site: "Site", level: index === 10 ? "fault" : "ok", redundancy: null }));
  const schem = fleetSchematic(cores, []);
  assert.equal(schem.nodes.filter((node) => node.kind === "core").length, 8);
  assert.ok(schem.nodes.some((node) => node.title === "Core-11"), "the faulted core survives the cut");
  assert.equal(schem.more, "4 more OK rows in the result");
});

test("system card: dial, items grouped by location, problems first, way back", async () => {
  const client = await connect();
  const model = cardModel((await call(client, "get_system", { systemId: 202 })).structuredContent);
  assert.equal(model.kind, "system");
  assert.equal(model.headline, "Arena Bowl Audio");
  assert.deepEqual(model.gauge, { percent: 73, label: "8/11 items OK" });
  assert.deepEqual(model.rows.map((row) => row.tag), ["Fault", "Missing", "Warn"]);
  assert.equal(model.rows[0]!.detail, "Output 3 short circuit protection");
  assert.equal(model.rows[1]!.detail, "Device missing from network");
  assert.equal(model.footnote, "Read-only · 8 other items OK");
  assert.equal(model.back?.name, "get_fleet_health");
  const locations = model.schematic!.nodes.filter((node) => node.kind === "location");
  assert.equal(locations.length, 7);
  const video = locations.find((node) => node.title === "Video Control")!;
  assert.deepEqual(video.leds, ["fault", "ok", "ok"]);
  assert.equal(video.level, "fault");
});

test("a system faulted only by its license still explains why", async () => {
  const client = await connect();
  const model = cardModel((await call(client, "get_system", { systemId: 205 })).structuredContent);
  assert.equal(model.level, "fault");
  assert.match(model.rows[0]!.detail, /license 'Multi-Track Player - 32' has expired/);
});

test("location lights cap at six with a count", () => {
  const items = Array.from({ length: 9 }, (_, index) => ({ name: `Amp ${index}`, location: "Rack Room", level: "ok", status: "OK" }));
  const node = systemSchematic("S", "C", "ok", items).nodes.find((entry) => entry.kind === "location")!;
  assert.equal(node.leds!.length, 6);
  assert.equal(node.right, "+3");
});

test("errors and unknown payloads render as an error card with a way back", async () => {
  const client = await connect();
  const missing = await call(client, "get_system", { systemId: 999 });
  const model = cardModel(missing.structuredContent);
  assert.equal(model.kind, "error");
  assert.equal(model.back?.name, "get_fleet_health");
  assert.equal(cardModel(null).kind, "error");
});

test("card uses the Q-SYS palette, follows the host theme, and never locks its width", async () => {
  const css = await readFile(new URL("../view/card.css", import.meta.url), "utf8");
  for (const hex of ["#0166ff", "#1c1c1c", "#1bd4db"]) assert.ok(css.toLowerCase().includes(hex), hex);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /prefers-reduced-motion: no-preference/);
  const cardRule = css.match(/#card \{[^}]*\}/)![0];
  assert.doesNotMatch(cardRule, /(^|[^-])width:/);
});

test("the renderer never writes markup from data", async () => {
  const source = await readFile(new URL("../view/app.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

// Diagnosis card (2026-11-17): mirrors diagnose_system, keeps honesty states non-green.
import { diagnose } from "../src/diagnose.ts";
import { DemoReflectClient } from "../src/reflect/demo.ts";
import { NOW } from "./helpers.ts";

test("diagnosis card: rows mirror the tool's findings in order, each with its first check", async () => {
  const client = await connect();
  const r = await call(client, "diagnose_system", { systemId: 202 });
  const model = cardModel(r.structuredContent);
  assert.equal(model.kind, "diagnosis");
  assert.equal(model.level, "fault");
  assert.equal(`${model.headlineStrong} ${model.headline}`, "3 findings, worst first");
  const findings = r.structuredContent.findings;
  assert.deepEqual(model.rows.map((row) => [row.level, row.title, row.detail, row.check]), findings.map((f: any) => [f.level, f.subject, f.title, f.check]));
  assert.deepEqual(model.next, { label: "Open system", name: "get_system", arguments: { systemId: 202 } });
});

test("diagnosis card: all clear is green; an unreadable event log is NOT green; an unknown system says could not check", async () => {
  const clear = cardModel({ ...(await diagnose(new DemoReflectClient(NOW), 201, 24, NOW)), source: "demo" });
  assert.equal(clear.level, "ok");
  assert.equal(clear.headline, "All clear");
  const base = new DemoReflectClient(NOW);
  const noEvents = new Proxy(base, { get: (t, k) => (k === "getCoreEvents" ? async () => { throw new Error("timed out"); } : (t as any)[k]?.bind?.(t) ?? (t as any)[k]) });
  const partial = cardModel(await diagnose(noEvents as any, 201, 24, NOW));
  assert.equal(partial.level, "unknown");
  assert.match(partial.headline, /^Not an all-clear/);
  assert.equal(partial.rows[0]?.tag, "Can't read");
  assert.notEqual(partial.rows[0]?.level, "ok");
  const gone = new Proxy(base, { get: (t, k) => (k === "getSystem" || k === "listSystemItems" ? async () => { throw new Error("Not found"); } : (t as any)[k]?.bind?.(t) ?? (t as any)[k]) });
  const unknown = cardModel(await diagnose(gone as any, 999, 24, NOW));
  assert.equal(unknown.level, "unknown");
  assert.equal(unknown.headline, "Could not check this system");
  assert.equal(unknown.next, undefined);
});

test("diagnosis card: cleared trouble shows as Cleared rows after the findings", () => {
  const model = cardModel({ view: "diagnosis", system: { id: 1, name: "S", level: "ok", core: { id: 1, name: "C" } }, windowHours: 24, findings: [], cleared: [{ dateTime: "2026-09-23 12:00:00", severity: "Fault", source: "Amp", message: "Amp: protect" }], couldNotCheck: [], allClear: true });
  assert.equal(model.level, "ok");
  assert.deepEqual(model.rows.map((r) => r.tag), ["Cleared"]);
});

test("system card offers Diagnose when the system is not OK; diagnose_system links the card", async () => {
  const client = await connect();
  const sys = cardModel((await call(client, "get_system", { systemId: 202 })).structuredContent);
  assert.deepEqual(sys.next, { label: "Diagnose", name: "diagnose_system", arguments: { systemId: 202 } });
  const ok = cardModel((await call(client, "get_system", { systemId: 201 })).structuredContent);
  assert.equal(ok.next, undefined);
  const tool = (await client.listTools()).tools.find((t) => t.name === "diagnose_system") as any;
  assert.ok(tool?._meta?.ui?.resourceUri);
  const plain = (await (await connect({ card: false })).listTools()).tools.find((t) => t.name === "diagnose_system") as any;
  assert.equal(plain?._meta?.ui, undefined);
});

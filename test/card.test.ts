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

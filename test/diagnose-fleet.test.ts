// diagnose_fleet (2026-11-17): the fleet roll-up over diagnose_system. The demo campus, plus patched variants for the
// same fault on several systems, a system gone dark, a system that cannot be read, and a genuinely all-clear fleet.
import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseFleet } from "../src/diagnose-fleet.ts";
import { DemoReflectClient } from "../src/reflect/demo.ts";
import type { Item, ReflectReader, System } from "../src/reflect/types.ts";
import { cardModel } from "../view/model.ts";
import { call, connect, NOW } from "./helpers.ts";

const demo = () => new DemoReflectClient(NOW);
const patched = (overrides: Partial<ReflectReader>): ReflectReader => {
  const base = demo();
  return new Proxy(base, { get: (target, key) => (key in overrides ? (overrides as any)[key] : (target as any)[key]?.bind?.(target) ?? (target as any)[key]) });
};
const faulted = (s: System, items: { fault: number; warning?: number }): System => ({ ...s, status: { ...s.status, code: 2, message: "Fault", details: { items: { normal: 5, warning: items.warning ?? 0, fault: items.fault, unknown: 0 } } } as System["status"] });
/** A copy of the demo's "Missing" device, placed on another system. */
const missingOn = async (systemId: number, name: string): Promise<Item> => {
  const arena = await demo().listSystemItems(202);
  const missing = arena.find((i) => i.status?.message === "Missing")!;
  return { ...missing, id: systemId * 100 + 99, name, system: { ...missing.system!, id: systemId } } as Item;
};

test("demo fleet: findings roll up worst first with system counts and a first check; OK systems are counted, not diagnosed", async () => {
  const d = await diagnoseFleet(demo(), 24, NOW);
  assert.equal(d.total, 5);
  assert.equal(d.ok, 2);
  assert.equal(d.allClear, false);
  assert.deepEqual(d.findings.map((f) => [f.level, f.category, f.systems.map((s) => s.name)]), [
    ["fault", "Device not on the network", ["Arena Bowl Audio"]],
    ["fault", "License expired or missing", ["Media Lab Playback"]],
    ["fault", "Output in protection", ["Arena Bowl Audio"]],
    ["warning", "Firmware does not match the design", ["Arena Bowl Audio"]],
    ["warning", "Input clipping", ["Library Commons Paging"]],
  ]);
  assert.ok(d.findings.every((f) => f.check.length > 20), "every finding keeps its concrete first check");
  assert.deepEqual(d.systems.map((s) => [s.name, s.level, s.findings]), [["Arena Bowl Audio", "fault", 3], ["Media Lab Playback", "fault", 1], ["Library Commons Paging", "warning", 1]]);
  assert.match(d.summary, /^3 systems of 5 need attention: 5 kinds of problem \(3 fault, 2 warning\)\./);
  assert.match(d.summary, /2 systems report OK and were not diagnosed\./);
});

test("the same fault on several systems is one row with the system count, counted once per system", async () => {
  const extra203 = await missingOn(203, "Lobby Paging Amp");
  const extra203b = await missingOn(203, "Stack Mic");
  const base = demo();
  const client = patched({
    listSystems: async () => (await base.listSystems()).map((s) => (s.id === 203 ? faulted(s, { fault: 2, warning: 1 }) : s)),
    listSystemItems: async (id: number) => [...(await base.listSystemItems(id)), ...(id === 203 ? [extra203, extra203b] : [])],
  });
  const d = await diagnoseFleet(client, 24, NOW);
  const net = d.findings.find((f) => f.category === "Device not on the network")!;
  assert.deepEqual(net.systems.map((s) => s.name).sort(), ["Arena Bowl Audio", "Library Commons Paging"]);
  assert.equal(d.findings[0]!.category, "Device not on the network", "2 systems ranks ahead of other faults on 1");
  assert.match(d.summary, /1\. \[fault\] Device not on the network \(2 systems: (Arena Bowl Audio|Library Commons Paging), (Arena Bowl Audio|Library Commons Paging)\)/);
  assert.equal(d.systems.find((s) => s.name === "Library Commons Paging")!.findings, 3, "both missing devices still show on the system row");
});

test("a dark system (its core offline) is a fault; a system that cannot be read is named apart and blocks the all-clear", async () => {
  const base = demo();
  const client = patched({
    listSystems: async () => (await base.listSystems()).map((s) => (s.id === 204 ? faulted(s, { fault: 10 }) : s.id === 201 ? { ...s, status: { ...s.status, code: 3, message: "Unknown" } as System["status"] } : s)),
    getCore: async (id: number) => {
      const core = await base.getCore(id);
      return id === 105 ? { ...core, status: { code: 4, message: "Offline", details: "Core is not reachable from Reflect" } } : core;
    },
    getSystem: async (id: number) => {
      if (id === 201) throw new Error("Reflect did not answer in time.");
      const system = await base.getSystem(id);
      return id === 204 ? faulted(system, { fault: 10 }) : system;
    },
  });
  const d = await diagnoseFleet(client, 24, NOW);
  const dark = d.systems.find((s) => s.name === "Business School Divisible Rooms")!;
  assert.equal(dark.level, "fault");
  assert.ok(d.findings.some((f) => f.category === "Core reports a problem" && f.systems.some((s) => s.name === dark.name)), JSON.stringify(d.findings.map((f) => f.category)));
  assert.deepEqual(d.couldNotRead.map((c) => c.name), ["PAC Main Stage"]);
  assert.match(d.couldNotRead[0]!.reason, /did not answer/);
  assert.equal(d.allClear, false);
  assert.match(d.summary, /1 system could not be read, so this is not an all-clear\./);
  assert.match(d.summary, /- PAC Main Stage \(id 201\): could not be read/);
});

test("all-clear fleet reads as a genuine all-clear; an unreadable system list never does", async () => {
  const base = demo();
  const healthy = patched({ listSystems: async () => (await base.listSystems()).filter((s) => s.id === 201 || s.id === 204) });
  const ok = await diagnoseFleet(healthy, 24, NOW);
  assert.equal(ok.allClear, true);
  assert.equal(ok.summary, "All clear: all 2 systems report OK.");
  assert.deepEqual(ok.findings, []);

  const down = patched({ listSystems: async () => { throw new Error("401 Unauthorized"); } });
  const no = await diagnoseFleet(down, 24, NOW);
  assert.equal(no.allClear, false);
  assert.match(no.summary, /^Could not read the system list.*This is not an all-clear\.$/);
});

test("tool and card: diagnose_fleet is listed, rows mirror the roll-up, and each system row opens its diagnosis", async () => {
  const client = await connect();
  const r = await call(client, "diagnose_fleet");
  const sc = r.structuredContent as any;
  assert.equal(sc.view, "fleet-diagnosis");
  const model = cardModel(sc);
  assert.equal(model.kind, "fleet-diagnosis");
  assert.deepEqual(model.rows.slice(0, sc.findings.length).map((row) => row.title), sc.findings.map((f: any) => f.category));
  const systemRows = model.rows.filter((row) => row.tag === "System");
  assert.deepEqual(systemRows.map((row) => row.action), sc.systems.map((s: any) => ({ label: `Diagnose ${s.name}`, name: "diagnose_system", arguments: { systemId: s.id } })));
  assert.notEqual(model.level, "ok");
});

test("the fleet card offers Diagnose fleet when something is not OK", async () => {
  const client = await connect();
  const model = cardModel((await call(client, "get_fleet_health")).structuredContent);
  assert.deepEqual(model.next, { label: "Diagnose fleet", name: "diagnose_fleet", arguments: {} });
});

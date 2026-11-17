import assert from "node:assert/strict";
import test from "node:test";
import { diagnose, diagnosisText, firstCheck } from "../src/diagnose.ts";
import { DemoReflectClient } from "../src/reflect/demo.ts";
import type { ReflectReader } from "../src/reflect/types.ts";
import { call, connect, NOW } from "./helpers.ts";

const demo = () => new DemoReflectClient(NOW);
/** A demo client with some methods replaced (unreachable parts, crafted events). */
const patched = (overrides: Partial<ReflectReader>): ReflectReader => {
  const base = demo();
  return new Proxy(base, { get: (target, key) => (key in overrides ? (overrides as any)[key] : (target as any)[key]?.bind?.(target) ?? (target as any)[key]) });
};

test("multi-fault system: faults first (earliest logged first), then warnings; a core that only tallies its items is not a separate finding", async () => {
  const d = await diagnose(demo(), 202, 24, NOW);
  assert.deepEqual(d.findings.map((f) => [f.level, f.subject]), [["fault", "Scoreboard Tie-In"], ["fault", "Bowl Zone 3"], ["warning", "Announcer Panel"]]);
  assert.match(d.findings[0]!.check, /not on the network/);
  assert.match(d.findings[1]!.check, /protection/);
  assert.match(d.findings[2]!.check, /Firmware/);
  assert.ok(d.findings.every((f) => f.since), "each item finding carries when it was first logged");
  assert.equal(d.allClear, false);
  assert.match(d.summary, /^Arena Bowl Audio on Arena-Core: 2 fault, 1 warning\. Start with Scoreboard Tie-In:/);
});

test("all healthy reads as a real all-clear, not an empty result", async () => {
  const d = await diagnose(demo(), 201, 24, NOW);
  assert.equal(d.allClear, true);
  assert.deepEqual(d.findings, []);
  assert.match(d.summary, /all clear\. 11 items report OK and the core logged no warnings or faults in the last 24 h\./);
});

test("an expired license stops the system and is matched to its event", async () => {
  const d = await diagnose(demo(), 205, 24, NOW);
  assert.equal(d.findings[0]?.subject, "Design");
  assert.match(d.findings[0]!.check, /renew it/);
  assert.ok(d.findings[0]!.since, "first logged time from the core event");
  assert.equal(d.findings.length, 1, "the license event is not listed twice");
});

test("partially unreachable: a healthy system whose event log cannot be read is NOT all clear", async () => {
  const client = patched({ getCoreEvents: async () => { throw new Error("Reflect did not answer in time."); } });
  const d = await diagnose(client, 201, 24, NOW);
  assert.equal(d.allClear, false);
  assert.equal(d.couldNotCheck.length, 1);
  assert.match(d.couldNotCheck[0]!, /^Event log for PAC-Core-A: Reflect did not answer in time\./);
  assert.match(d.summary, /This is not an all-clear\./);
  assert.doesNotMatch(d.summary, /all clear\./);
});

test("unreachable system: could not check, nothing invented", async () => {
  const client = patched({ getSystem: async () => { throw new Error("Not found in this Reflect organization (/systems/999)."); }, listSystemItems: async () => { throw new Error("Not found"); } });
  const d = await diagnose(client, 999, 24, NOW);
  assert.equal(d.system.level, "could_not_check");
  assert.equal(d.allClear, false);
  assert.deepEqual(d.findings, []);
  assert.match(d.summary, /^Could not check System 999: System status: Not found/);
});

test("trouble that cleared is listed apart, not as a finding; events outside the window are ignored", async () => {
  const base = demo();
  const events = await base.getCoreEvents(101, { pageSize: 500 });
  const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString().replace("T", " ").slice(0, 19);
  const extra = [
    { id: 1, dateTime: at(3), severity: "Fault", status: "Fault", category: "Status", source: "Stage Left Amp", message: "Stage Left Amp: Output 1 short circuit protection", filename: null, core: { id: 101, name: "PAC-Core-A" } },
    { id: 2, dateTime: at(40), severity: "Fault", status: "Fault", category: "Status", source: "Old Thing", message: "Old Thing: long ago", filename: null, core: { id: 101, name: "PAC-Core-A" } },
  ];
  const items = await base.listSystemItems(201);
  const named = items.map((i, n) => (n === 0 ? { ...i, name: "Stage Left Amp" } : i));
  const client = patched({ getCoreEvents: async () => ({ events: [...extra, ...events.events], total: events.total + 2 }), listSystemItems: async () => named });
  const d = await diagnose(client, 201, 24, NOW);
  assert.deepEqual(d.findings, []);
  assert.deepEqual(d.cleared.map((c) => c.source), ["Stage Left Amp"]);
  assert.equal(d.allClear, true);
  assert.match(d.summary, /apart from 1 event that has since cleared/);
});

test("a core with a problem of its own is raised first", async () => {
  const base = demo();
  const core = await base.getCore(101);
  const client = patched({ getCore: async () => ({ ...core, status: { code: 2, message: "Fault", details: "Fan failure, temperature high" } }) });
  const d = await diagnose(client, 201, 24, NOW);
  assert.equal(d.findings[0]?.subject, "Core PAC-Core-A");
  assert.match(d.findings[0]!.check, /^Check the core first; .*Heat warning/);
});

test("first-check rules: offline beats everything; unknown text gets a plain fallback", () => {
  assert.match(firstCheck("Fault: Output short", false), /not on the network/);
  assert.match(firstCheck("Something odd", null), /read its full status/);
});

test("diagnose_system over MCP: read-only, summary is the plain-English report", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === "diagnose_system");
  assert.equal(tool?.annotations?.readOnlyHint, true);
  const r = await call(client, "diagnose_system", { systemId: 202 });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0]!.text, /^Arena Bowl Audio on Arena-Core: 2 fault, 1 warning\./);
  assert.equal(r.structuredContent.findings.length, 3);
  assert.equal(r.structuredContent.view, "diagnosis");
  assert.equal(diagnosisText(await diagnose(demo(), 202, 24, NOW)), r.structuredContent.summary);
});

test("event times without a zone are read as UTC: 23 h old is in a 24 h window, 25 h old is out, on any machine", async () => {
  const { eventMs } = await import("../src/diagnose.ts");
  assert.equal(eventMs("2026-09-23 02:00:00"), Date.UTC(2026, 8, 23, 2));
  assert.equal(eventMs("2026-09-23T02:00:00+02:00"), Date.UTC(2026, 8, 23, 0));
  const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString().replace("T", " ").slice(0, 19);
  const ev = (id: number, h: number) => ({ id, dateTime: at(h), severity: "Fault", status: "Fault", category: "License", source: "Design", message: `Thing ${id}`, filename: null, core: { id: 101, name: "PAC-Core-A" } });
  const client = patched({ getCoreEvents: async () => ({ events: [ev(1, 23), ev(2, 25), ev(3, -2)], total: 3 }) });
  const d = await diagnose(client, 201, 24, NOW);
  assert.deepEqual(d.timeline.map((t) => t.message), ["Thing 1"], "25 h old and future-dated events are outside the window");
});

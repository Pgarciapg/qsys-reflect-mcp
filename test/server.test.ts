import assert from "node:assert/strict";
import test from "node:test";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { CARD_URI } from "../src/version.ts";
import { call, connect } from "./helpers.ts";

test("every tool is annotated read-only and none write", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.equal(tools.length, 12);
  for (const tool of tools) {
    assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations?.destructiveHint, false, tool.name);
    assert.doesNotMatch(tool.name, /update|set|put|delete|create|control/);
  }
});

test("the two card tools point at the card resource, served as an MCP App", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const withCard = tools.filter((tool) => (tool._meta as any)?.ui?.resourceUri).map((tool) => tool.name).sort();
  assert.deepEqual(withCard, ["get_fleet_health", "get_system"]);
  const { contents } = await client.readResource({ uri: CARD_URI });
  const card = contents[0] as { mimeType: string; text: string };
  assert.equal(card.mimeType, RESOURCE_MIME_TYPE);
  assert.match(card.text, /<main id="card"/);
  // Self-contained: no external scripts, styles, or fonts.
  assert.doesNotMatch(card.text, /<script[^>]+src=|<link[^>]+href=|@import/);
});

test("--no-card serves the same tools without UI metadata", async () => {
  const client = await connect({ card: false });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 12);
  assert.ok(tools.every((tool) => !(tool._meta as any)?.ui));
});

test("fleet health leads structuredContent with a summary a model can repeat", async () => {
  const client = await connect();
  const result = await call(client, "get_fleet_health");
  const data = result.structuredContent;
  assert.equal(Object.keys(data)[0], "summary");
  assert.equal(data.source, "demo");
  assert.equal(data.summary, "3 faults and 2 warnings across 6 cores and 5 systems. Most severe: Arena Bowl Audio (system), 2 items faulted, 1 warning.");
  assert.deepEqual(data.issues.map((issue: any) => [issue.level, issue.name]), [
    ["fault", "Arena Bowl Audio"],
    ["fault", "Arena-Core"],
    ["fault", "Media Lab Playback"],
    ["warning", "Library Commons Paging"],
    ["warning", "Library-Core"],
  ]);
  assert.deepEqual(data.totals.items, { normal: 34, warning: 2, fault: 2, unknown: 0 });
  assert.ok(result.content[0]!.text.startsWith(data.summary));
});

test("get_system sorts inventory worst first", async () => {
  const client = await connect();
  const { structuredContent: data } = await call(client, "get_system", { systemId: 202 });
  assert.equal(data.view, "system");
  assert.equal(data.system.level, "fault");
  assert.deepEqual(data.items.slice(0, 3).map((item: any) => item.level), ["fault", "fault", "warning"]);
  assert.match(data.summary, /^Arena Bowl Audio on Arena-Core: fault\. 3 items need attention/);
});

test("filters narrow list results without changing the totals in the summary", async () => {
  const client = await connect();
  const cores = await call(client, "list_cores", { level: "fault" });
  assert.deepEqual(cores.structuredContent.cores.map((core: any) => core.name), ["Arena-Core"]);
  assert.match(cores.structuredContent.summary, /^6 cores: 1 fault, 1 warning, 4 OK\. Showing 1 at fault\.$/);
  const amps = await call(client, "list_system_items", { systemId: 202, type: "amplifier" });
  assert.equal(amps.structuredContent.items.length, 5);
});

test("event log pages and filters by date the way Reflect documents", async () => {
  const client = await connect();
  const first = await call(client, "get_core_events", { coreId: 103, page: 1, pageSize: 5 });
  assert.equal(first.structuredContent.events.length, 5);
  const total = first.structuredContent.total;
  const second = await call(client, "get_core_events", { coreId: 103, page: 2, pageSize: 5 });
  assert.notDeepEqual(second.structuredContent.events[0], first.structuredContent.events[0]);
  const today = await call(client, "get_core_events", { coreId: 103, dates: "2026-09-23,2026-09-23" });
  assert.ok(today.structuredContent.total < total);
  const faults = await call(client, "get_core_events", { coreId: 103, severity: "fault" });
  assert.ok(faults.structuredContent.events.every((event: any) => event.severity === "Fault"));
});

test("invalid date ranges are rejected before any request", async () => {
  const client = await connect();
  const result = await call(client, "get_core_events", { coreId: 103, dates: "last week" });
  assert.equal(result.isError, true);
});

test("unknown IDs come back as a clear 404, not a crash", async () => {
  const client = await connect();
  const result = await call(client, "get_core", { coreId: 999 });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.status, 404);
  assert.match(result.structuredContent.summary, /^Not found/);
});

test("softphone proxy passwords never reach the model", async () => {
  const client = await connect();
  const result = await call(client, "list_softphones", { systemId: 204 });
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /demo-password-not-real/);
  assert.equal(result.structuredContent.softphones[0].proxyPassword, "[redacted]");
});

test("media browsing lists folders and describes files", async () => {
  const client = await connect();
  const root = await call(client, "browse_core_media", { coreId: 101 });
  assert.deepEqual(root.structuredContent.entries.map((entry: any) => entry.path), ["/Audio"]);
  const folder = await call(client, "browse_core_media", { coreId: 101, path: "/Audio" });
  assert.equal(folder.structuredContent.entries.length, 3);
  const file = await call(client, "browse_core_media", { coreId: 101, path: "/Audio/Intermission Chime.wav" });
  assert.equal(file.structuredContent.entry.type, "file");
});

test("the media tool refuses traversal before any request", async () => {
  const client = await connect();
  const result = await call(client, "browse_core_media", { coreId: 101, path: "../../users/audit-events" });
  assert.equal(result.isError, true);
});

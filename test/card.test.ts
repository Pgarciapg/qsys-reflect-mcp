import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cardModel } from "../view/model.ts";
import { call, connect } from "./helpers.ts";

test("fleet card: headline, tiles, and a drill-in action on system issues", async () => {
  const client = await connect();
  const model = cardModel((await call(client, "get_fleet_health")).structuredContent);
  assert.equal(model.kind, "fleet");
  assert.equal(model.source, "Demo data");
  assert.equal(model.headline, "5 issues need attention");
  assert.deepEqual(model.tiles.map((tile) => [tile.label, tile.value]), [["Cores", "6"], ["Systems", "5"], ["Items", "38"]]);
  assert.deepEqual(model.rows[0]!.action, { label: "Open Arena Bowl Audio", name: "get_system", arguments: { systemId: 202 } });
  assert.equal(model.rows[1]!.action, undefined);
});

test("system card: problems first, a count of the rest, and a way back", async () => {
  const client = await connect();
  const model = cardModel((await call(client, "get_system", { systemId: 202 })).structuredContent);
  assert.equal(model.kind, "system");
  assert.equal(model.rows.length, 3);
  assert.equal(model.more, "8 other items OK");
  assert.equal(model.back?.name, "get_fleet_health");
});

test("errors and unknown payloads render as an error card, not raw JSON", async () => {
  const client = await connect();
  const missing = await call(client, "get_system", { systemId: 999 });
  assert.equal(cardModel(missing.structuredContent).kind, "error");
  assert.equal(cardModel(null).kind, "error");
});

test("card never locks a fixed width and uses host theme tokens", async () => {
  const css = await readFile(new URL("../view/card.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /(^|[^-])width:\s*\d{3,}px/m);
  assert.match(css, /var\(--color-background-primary/);
  assert.match(css, /prefers-color-scheme: dark/);
});

test("an error card still offers a way back to the fleet", () => {
  assert.equal(cardModel({ summary: "Not found", error: { status: 404 } }).back?.name, "get_fleet_health");
});

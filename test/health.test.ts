import assert from "node:assert/strict";
import test from "node:test";
import { levelForCode, systemLevel } from "../src/health.ts";
import type { System } from "../src/reflect/types.ts";

const system = (code: number, items: { normal: number; warning: number; fault: number; unknown: number }): System => ({
  id: 1,
  code: "x",
  name: "S",
  design: { id: 1, code: "d", name: "d", platform: "Core 110f", isRedundant: 0, isEmulated: 0, uptime: 0 },
  status: { code, message: "OK", details: { items } },
  core: { id: 1, name: "C" },
});

test("status codes map to levels", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 99].map(levelForCode), ["ok", "warning", "fault", "fault", "fault", "warning", "unknown"]);
});

test("a system whose items stopped reporting is not 'OK'", () => {
  assert.equal(systemLevel(system(0, { normal: 0, warning: 0, fault: 0, unknown: 4 })), "unknown");
  assert.equal(systemLevel(system(0, { normal: 4, warning: 0, fault: 1, unknown: 0 })), "fault");
});

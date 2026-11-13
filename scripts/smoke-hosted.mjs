// End-to-end smoke test of a running qsys-reflect-mcp over Streamable HTTP.
// Defaults to the hosted demo. Read-only: it only lists, reads and calls read-only tools.
// Usage: node scripts/smoke-hosted.mjs [mcp-url]
//   npm run smoke                                    (hosted demo)
//   npm run smoke -- http://localhost:3333/mcp       (local: node dist/cli.js --demo --http)
// Prints one PASS/FAIL line per check and exits 1 on any FAIL.

const url = process.argv[2] || "https://qsys-reflect-mcp-demo.vercel.app/mcp";
const EXPECTED_TOOLS = [
  "get_fleet_health", "get_system", "list_cores", "get_core", "list_systems", "list_system_items",
  "get_system_item", "get_core_events", "browse_core_media", "list_media_playlists", "list_softphones", "get_audit_events",
];

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

let n = 0;
let session;
async function rpc(method, params) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (session) headers["mcp-session-id"] = session;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, ...(params ? { params } : {}) }) });
  session = res.headers.get("mcp-session-id") || session;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
  // Streamable HTTP may answer as JSON or as an SSE stream; take the last data line in the SSE case.
  const body = (res.headers.get("content-type") || "").includes("text/event-stream")
    ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).pop()
    : text;
  const msg = JSON.parse(body);
  if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
  return msg.result;
}

async function call(name, args = {}) {
  const r = await rpc("tools/call", { name, arguments: args });
  return { ok: !r.isError && r.structuredContent !== undefined, sc: r.structuredContent, r };
}

const firstNumber = (rows, ...keys) => {
  for (const row of rows || []) for (const k of keys) if (Number.isInteger(row?.[k])) return row[k];
  return undefined;
};

try {
  console.log(`Smoke test: ${url}`);
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke-hosted", version: "1" } });
  check("initialize", init?.serverInfo?.name, `${init?.serverInfo?.name} ${init?.serverInfo?.version}`);
  if (session) await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": session }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });

  const list = await rpc("tools/list");
  const names = (list.tools || []).map((t) => t.name);
  const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t));
  check("tools/list has all 12 tools", missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : `${names.length} tools`);
  const readOnly = (list.tools || []).filter((t) => EXPECTED_TOOLS.includes(t.name) && t.annotations?.readOnlyHint === true).length;
  check("every tool is marked read-only", readOnly === EXPECTED_TOOLS.length, `${readOnly}/${EXPECTED_TOOLS.length}`);

  const cardUri = (list.tools || []).map((t) => t._meta?.ui?.resourceUri || t._meta?.["openai/outputTemplate"]).find(Boolean);
  if (cardUri) {
    const res = await rpc("resources/read", { uri: cardUri });
    const card = res?.contents?.[0];
    check("status card resource serves HTML", card && /html/.test(card.mimeType) && (card.text || "").length > 5000, `${cardUri}, ${(card?.text || "").length} chars`);
  } else {
    check("status card resource serves HTML", false, "no tool advertises a card URI");
  }

  // Every tool, in the order an assistant would use them. IDs come from the list tools, not hard-coded.
  const passed = [];
  const tool = async (name, args) => {
    const { ok, sc } = await call(name, args);
    check(`tool ${name}`, ok && sc?.summary, ok ? String(sc?.summary).slice(0, 90) : "error or no structured content");
    if (ok) passed.push(name);
    return sc;
  };

  await tool("get_fleet_health");
  const systems = await tool("list_systems");
  const systemId = firstNumber(systems?.systems || systems?.rows, "id", "systemId");
  const cores = await tool("list_cores");
  const coreId = firstNumber(cores?.cores || cores?.rows, "id", "coreId");
  await tool("get_system", { systemId });
  await tool("get_core", { coreId });
  const items = await tool("list_system_items", { systemId });
  const itemId = firstNumber(items?.items, "id", "itemId");
  await tool("get_system_item", { systemId, itemId });
  await tool("get_core_events", { coreId });
  await tool("browse_core_media", { coreId });
  await tool("list_media_playlists", { coreId });
  await tool("list_softphones", { systemId });
  await tool("get_audit_events");
  check("all 12 tools answered", passed.length === EXPECTED_TOOLS.length, `${passed.length}/${EXPECTED_TOOLS.length}, system ${systemId}, core ${coreId}, item ${itemId}`);

  // Negative control: an unknown ID should come back as a clean tool error, not a crash.
  const bad = await rpc("tools/call", { name: "get_core", arguments: { coreId: 999999999 } });
  check("unknown core returns a clean error", bad.isError === true && /not found|404|no core/i.test(JSON.stringify(bad.content)), JSON.stringify(bad.content?.[0]?.text || "").slice(0, 90));
} catch (err) {
  check("smoke run completed", false, err.message);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

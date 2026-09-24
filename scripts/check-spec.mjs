// Drift check against QSC's published spec. No token needed; the spec is public.
// Exits 1 if Reflect adds, removes, or changes an operation this server was built against.
const SPEC_URL = "https://reflect.qsc.com/static/qrem-public-api.yaml";

const EXPECTED = {
  version: "0.1.1",
  operations: [
    "GET /cores",
    "GET /cores/{coreId}",
    "GET /cores/{coreId}/events",
    "GET /cores/{coreId}/media/{mediaPath}",
    "GET /cores/{coreId}/media_playlists",
    "GET /cores/{coreId}/media_playlists/{mediaPlaylistId}",
    "GET /systems",
    "GET /systems/{systemId}",
    "GET /systems/{systemId}/items",
    "GET /systems/{systemId}/items/{itemId}",
    "GET /systems/{systemId}/events", // deprecated upstream; not exposed as a tool
    "GET /systems/{systemId}/telephony/softphones",
    "PUT /systems/{systemId}/telephony/softphones", // the only write; not exposed as a tool
    "GET /users/audit-events",
  ],
};

const response = await fetch(SPEC_URL);
if (!response.ok) {
  console.error(`Could not fetch ${SPEC_URL}: HTTP ${response.status}`);
  process.exit(2);
}
const yaml = await response.text();
const version = yaml.match(/^\s{2}version:\s*([\w.]+)/m)?.[1];

// The spec's layout is stable: paths at two-space indent, methods at four.
const operations = [];
let path = null;
let inPaths = false;
for (const line of yaml.split("\n")) {
  if (/^paths:/.test(line)) inPaths = true;
  else if (/^\S/.test(line)) inPaths = false;
  if (!inPaths) continue;
  const pathMatch = line.match(/^ {2}(\/\S*):\s*$/);
  if (pathMatch) path = pathMatch[1];
  const methodMatch = line.match(/^ {4}(get|put|post|patch|delete):\s*$/);
  if (methodMatch && path) operations.push(`${methodMatch[1].toUpperCase()} ${path}`);
}

const added = operations.filter((op) => !EXPECTED.operations.includes(op));
const removed = EXPECTED.operations.filter((op) => !operations.includes(op));
console.log(`Spec version ${version} (built against ${EXPECTED.version}), ${operations.length} operations.`);
for (const op of added) console.log(`  + ${op}`);
for (const op of removed) console.log(`  - ${op}`);
if (added.length || removed.length || version !== EXPECTED.version) process.exit(1);
console.log("No drift.");

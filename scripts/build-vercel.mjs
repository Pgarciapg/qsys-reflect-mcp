// Packages the demo server as a standalone Vercel project in .vercel-demo/.
// One stateless function at /mcp, serving the fictional demo campus. No Reflect token is involved.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as esbuild from "esbuild";

const root = join(import.meta.dirname, "..");
const out = join(root, ".vercel-demo");

// Keep .vercel (the project link) and replace only the built files.
await rm(join(out, "api"), { recursive: true, force: true });
await mkdir(join(out, "api"), { recursive: true });

const entry = `
import { createHttpHandler } from "./src/http.ts";
import { DemoReflectClient } from "./src/reflect/demo.ts";
import { CARD_HTML } from "./src/generated/card.ts";

// A fresh demo campus per request, so timestamps stay current.
const handle = (request, response) =>
  createHttpHandler({ client: new DemoReflectClient(), source: "demo", cardHtml: CARD_HTML })(request, response);
export default handle;
`;
await esbuild.build({
  stdin: { contents: entry, resolveDir: root, loader: "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node22"],
  outfile: join(out, "api/mcp.mjs"),
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  legalComments: "none",
});

await writeFile(join(out, "package.json"), JSON.stringify({ name: "qsys-reflect-mcp-demo", private: true, type: "module" }, null, 2) + "\n");
await writeFile(
  join(out, "vercel.json"),
  JSON.stringify({ functions: { "api/mcp.mjs": { maxDuration: 10 } }, rewrites: [{ source: "/mcp", destination: "/api/mcp" }] }, null, 2) + "\n",
);
await writeFile(
  join(out, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>qsys-reflect-mcp demo</title>
<p>Q-SYS Reflect MCP server, demo mode (fictional data, read-only).</p>
<p>MCP endpoint: <code>/mcp</code> (Streamable HTTP, stateless, POST).</p>
<p>Source: <a href="https://github.com/Pgarciapg/qsys-reflect-mcp">github.com/Pgarciapg/qsys-reflect-mcp</a></p>
`,
);
console.log(`Built ${out}`);

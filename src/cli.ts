#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createServer as createNodeServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CARD_HTML } from "./generated/card.ts";
import { createHttpHandler, LOCAL_HOSTS } from "./http.ts";
import { DemoReflectClient } from "./reflect/demo.ts";
import { DEFAULT_BASE_URL, HttpReflectClient } from "./reflect/client.ts";
import { createServer, type ServerOptions } from "./server.ts";
import { SERVER_VERSION } from "./version.ts";

const HELP = `qsys-reflect-mcp ${SERVER_VERSION}

Usage: qsys-reflect-mcp [--demo] [--http] [--host 127.0.0.1] [--port 3333] [--no-card]

  --demo      Serve a fictional campus instead of calling Reflect (no token needed)
  --http      Stateless Streamable HTTP on /mcp instead of stdio
  --host H    HTTP bind address (default 127.0.0.1). Any non-local address requires MCP_HTTP_TOKEN.
  --port N    HTTP port (default $PORT or 3333)
  --no-card   Do not register the MCP Apps status card

Environment:
  QSYS_REFLECT_API_TOKEN       Reflect API token (Organization > API Tokens)
  QSYS_REFLECT_API_TOKEN_FILE  File holding the token, as a bare value or NAME=value
  QSYS_REFLECT_BASE_URL        Override the API base (default ${DEFAULT_BASE_URL})
  MCP_HTTP_TOKEN               Bearer secret HTTP callers must send (required off localhost)
  MCP_ALLOWED_HOSTS            Comma-separated Host names to accept when bound off localhost
`;

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

if (flag("--help") || flag("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}

// Accepts a file holding just the token, or dotenv-style lines where one is QSYS_REFLECT_API_TOKEN=...
const readToken = (): string | undefined => {
  if (process.env.QSYS_REFLECT_API_TOKEN) return process.env.QSYS_REFLECT_API_TOKEN.trim();
  const file = process.env.QSYS_REFLECT_API_TOKEN_FILE;
  if (!file) return undefined;
  const lines = readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, "");
  if (lines.length === 1 && !lines[0]!.includes("=")) return unquote(lines[0]!);
  const named = lines.find((line) => line.startsWith("QSYS_REFLECT_API_TOKEN="));
  if (!named) throw new Error(`${file} has no bare token and no QSYS_REFLECT_API_TOKEN= line.`);
  return unquote(named.slice(named.indexOf("=") + 1));
};

const token = readToken();
const demo = flag("--demo") || !token;
if (!flag("--demo") && !token) console.error("No QSYS_REFLECT_API_TOKEN set; serving demo data. Pass --demo to silence this.");

const options: ServerOptions = {
  client: demo ? new DemoReflectClient() : new HttpReflectClient({ token: token!, baseUrl: process.env.QSYS_REFLECT_BASE_URL }),
  source: demo ? "demo" : "live",
  cardHtml: flag("--no-card") ? undefined : CARD_HTML,
};

if (flag("--http")) {
  const port = Number(option("--port") ?? process.env.PORT ?? 3333);
  const host = option("--host") ?? "127.0.0.1";
  const local = ["127.0.0.1", "localhost", "::1"].includes(host);
  const authToken = process.env.MCP_HTTP_TOKEN || undefined;
  if (!local && !authToken) {
    console.error(`Refusing to bind ${host} without MCP_HTTP_TOKEN: anyone who can reach the port could read your Reflect organization.`);
    process.exit(1);
  }
  // Extra hosts (for example a tunnel's hostname in front of a local bind) are added to, never replace, localhost.
  const extraHosts = process.env.MCP_ALLOWED_HOSTS?.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean) ?? [];
  const allowedHosts = local ? [...LOCAL_HOSTS, ...extraHosts] : extraHosts.length ? extraHosts : undefined;
  const handle = createHttpHandler({ ...options, allowedHosts, authToken });
  createNodeServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname === "/mcp") return void handle(request, response);
    if (pathname === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      return void response.end(JSON.stringify({ ok: true, source: options.source, version: SERVER_VERSION }));
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found. MCP endpoint is POST /mcp.");
  }).listen(port, host, () => console.error(`qsys-reflect-mcp (${options.source}) on http://${host.includes(":") ? `[${host}]` : host}:${port}/mcp`));
} else {
  await createServer(options).connect(new StdioServerTransport());
  console.error(`qsys-reflect-mcp (${options.source}) on stdio`);
}

// Local preview: `npm run preview`, then open the printed URL.
// Tool calls go through a real MCP client connected to the real server (demo data).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as esbuild from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CARD_HTML, CARD_URI, DemoReflectClient, createServer as createMcpServer } from "../dist/index.js";

const here = import.meta.dirname;
const port = Number(process.env.PORT ?? 4747);

const mcp = createMcpServer({ client: new DemoReflectClient(), source: "demo", cardHtml: CARD_HTML });
const client = new Client({ name: "preview-host", version: "0.1.0" });
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await Promise.all([client.connect(clientSide), mcp.connect(serverSide)]);

// Serve the card exactly as the server publishes it.
const { contents } = await client.readResource({ uri: CARD_URI });
const cardHtml = contents[0].text;
const page = await readFile(join(here, "index.html"), "utf8");
const hostJs = (await esbuild.build({ entryPoints: [join(here, "host.ts")], bundle: true, format: "iife", platform: "browser", target: ["es2022"], minify: true, write: false })).outputFiles[0].text;

const send = (response, status, body, type) => {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
};

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && pathname === "/") return send(response, 200, page, "text/html; charset=utf-8");
  if (request.method === "GET" && pathname === "/host.js") return send(response, 200, hostJs, "text/javascript; charset=utf-8");
  if (request.method === "GET" && pathname === "/card.html") return send(response, 200, cardHtml, "text/html; charset=utf-8");
  if (request.method === "POST" && pathname === "/call") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const { name, arguments: args } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const result = await client.callTool({ name, arguments: args ?? {} });
    return send(response, 200, JSON.stringify(result), "application/json");
  }
  send(response, 404, "Not found", "text/plain");
}).listen(port, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${port}/`));

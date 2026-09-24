import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { timingSafeEqual } from "node:crypto";
import { createServer, type ServerOptions } from "./server.ts";

export interface HttpOptions extends ServerOptions {
  /**
   * Accepted Host header names (no port). Requests for any other host get 403, which blocks
   * DNS rebinding. Omit only when a proxy in front already enforces this.
   */
  allowedHosts?: string[];
  /** Accepted browser Origins. Requests with no Origin (non-browser clients) pass. */
  allowedOrigins?: string[];
  /** When set, callers must send `Authorization: Bearer <authToken>`. */
  authToken?: string;
}

export const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

const hostName = (host: string | undefined) => (host ?? "").replace(/:\d+$/, "").toLowerCase();

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { ...HEADERS, "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

const MAX_BODY = 1_000_000;

const readBody = async (request: IncomingMessage & { body?: unknown }): Promise<unknown> => {
  if (request.body !== undefined) return typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new RangeError("Body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
};

/**
 * Stateless Streamable HTTP: a fresh server and transport per POST, built from the
 * same factory as stdio. Works on any Node HTTP host, including serverless functions.
 */
export const createHttpHandler = (options: HttpOptions) => async (request: IncomingMessage, response: ServerResponse) => {
  for (const [name, value] of Object.entries(HEADERS)) response.setHeader(name, value);
  if (options.allowedHosts && !options.allowedHosts.includes(hostName(request.headers.host))) {
    return sendJson(response, 403, rpcError(-32000, "Host not allowed."));
  }
  const origin = request.headers.origin;
  if (origin && options.allowedOrigins && !options.allowedOrigins.includes(origin)) {
    return sendJson(response, 403, rpcError(-32000, "Origin not allowed."));
  }
  if (options.authToken) {
    const header = request.headers.authorization ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!sameSecret(given, options.authToken)) {
      response.setHeader("www-authenticate", "Bearer");
      return sendJson(response, 401, rpcError(-32001, "Unauthorized."));
    }
  }
  if (request.method !== "POST") return sendJson(response, 405, rpcError(-32000, "Method not allowed. This endpoint is stateless; POST JSON-RPC to it."));
  let body: unknown;
  try {
    body = await readBody(request);
  } catch (error) {
    return error instanceof RangeError ? sendJson(response, 413, rpcError(-32600, "Request too large.")) : sendJson(response, 400, rpcError(-32700, "Parse error."));
  }
  const { allowedHosts: _hosts, allowedOrigins: _origins, authToken: _auth, ...serverOptions } = options;
  const server = createServer(serverOptions);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  } catch {
    if (!response.headersSent) sendJson(response, 500, rpcError(-32603, "Internal error."));
  }
};

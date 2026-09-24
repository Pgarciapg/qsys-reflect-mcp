import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createHttpHandler, LOCAL_HOSTS, type HttpOptions } from "../src/http.ts";
import { DemoReflectClient } from "../src/reflect/demo.ts";
import { NOW } from "./helpers.ts";

const listen = async (extra: Partial<HttpOptions> = {}) => {
  const handle = createHttpHandler({ client: new DemoReflectClient(NOW), source: "demo", allowedHosts: LOCAL_HOSTS, ...extra });
  const server: Server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp` };
};

const rpc = (url: string, method: string, params: unknown, id: number) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

test("stateless Streamable HTTP answers each POST on its own", async () => {
  const { server, url } = await listen();
  try {
    const init = await rpc(url, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }, 1);
    assert.equal(init.status, 200);
    assert.equal(init.headers.get("mcp-session-id"), null);
    assert.equal((await init.json()).result.serverInfo.name, "qsys-reflect");

    // No session carried over: a fresh request can call a tool directly.
    const called = await rpc(url, "tools/call", { name: "list_systems", arguments: {} }, 2);
    const body = await called.json();
    assert.match(body.result.structuredContent.summary, /^5 systems:/);
  } finally {
    server.close();
  }
});

test("non-POST and bad JSON get JSON-RPC errors", async () => {
  const { server, url } = await listen();
  try {
    assert.equal((await fetch(url)).status, 405);
    const bad = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, -32700);
  } finally {
    server.close();
  }
});

test("DNS rebinding: a foreign Host or Origin is refused", async () => {
  const { server, url } = await listen({ allowedOrigins: ["http://127.0.0.1:4747"] });
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    const foreignHost = await fetch(url.replace("127.0.0.1", "localhost.evil.test"), { method: "POST", headers, body }).catch(() => null);
    // fetch cannot spoof Host, so check the handler directly with a raw request below.
    void foreignHost;
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve) => {
      const req = request(url, { method: "POST", headers: { ...headers, host: "attacker.example" } }, (res) => resolve(res.statusCode ?? 0));
      req.end(body);
    });
    assert.equal(status, 403);
    const badOrigin = await fetch(url, { method: "POST", headers: { ...headers, origin: "https://attacker.example" }, body });
    assert.equal(badOrigin.status, 403);
    const goodOrigin = await fetch(url, { method: "POST", headers: { ...headers, origin: "http://127.0.0.1:4747" }, body });
    assert.equal(goodOrigin.status, 200);
  } finally {
    server.close();
  }
});

test("a configured bearer secret is required", async () => {
  const { server, url } = await listen({ authToken: "s3cret" });
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    assert.equal((await fetch(url, { method: "POST", headers, body })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, authorization: "Bearer wrong!" }, body })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, authorization: "Bearer s3cret" }, body })).status, 200);
  } finally {
    server.close();
  }
});

test("oversize bodies get 413", async () => {
  const { server, url } = await listen();
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(1_100_000) });
    assert.equal(response.status, 413);
  } finally {
    server.close();
  }
});

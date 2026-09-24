import assert from "node:assert/strict";
import test from "node:test";
import { HttpReflectClient, isSafeMediaPath, ReflectApiError } from "../src/reflect/client.ts";

const TOKEN = "t".repeat(64);

const fakeFetch = (status: number, body: unknown) => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};

test("sends the documented Bearer header to the v0 base", async () => {
  const { fetch, calls } = fakeFetch(200, []);
  await new HttpReflectClient({ token: TOKEN, fetch }).listCores();
  assert.equal(calls[0]!.url, "https://reflect.qsc.com/api/public/v0/cores");
  assert.equal(calls[0]!.headers.Authorization, `Bearer ${TOKEN}`);
});

test("builds paging queries and keeps slashes in media paths", async () => {
  const { fetch, calls } = fakeFetch(200, { events: [], total: 0 });
  const client = new HttpReflectClient({ token: TOKEN, fetch, baseUrl: "https://example.test/v0/" });
  await client.getCoreEvents(7, { page: 2, pageSize: 50, dates: "2026-09-01,2026-09-02" });
  await client.getCoreMedia(7, "/Audio/Show Files/cue 1.wav");
  assert.equal(calls[0]!.url, "https://example.test/v0/cores/7/events?page=2&pageSize=50&dates=2026-09-01%2C2026-09-02");
  assert.equal(calls[1]!.url, "https://example.test/v0/cores/7/media/Audio/Show%20Files/cue%201.wav");
});

test("errors are typed and never include the token", async () => {
  const { fetch } = fakeFetch(401, { code: 401, message: "Unauthorized" });
  const error = await new HttpReflectClient({ token: TOKEN, fetch }).getSystem(1).catch((caught) => caught);
  assert.ok(error instanceof ReflectApiError);
  assert.equal(error.status, 401);
  assert.equal(error.message, "Reflect API 401 on /systems/1: Unauthorized");
  assert.doesNotMatch(error.message + error.stack, new RegExp(TOKEN));
});

test("refuses to start without a token", () => {
  assert.throws(() => new HttpReflectClient({ token: "" }), /token is required/);
});

test("media paths cannot climb out of Media Root", async () => {
  const { fetch, calls } = fakeFetch(200, []);
  const client = new HttpReflectClient({ token: TOKEN, fetch });
  for (const bad of ["../../../users/audit-events", "/Audio/../../x", "%2e%2e/x", "Audio\\..\\x", "./x"]) {
    assert.equal(isSafeMediaPath(bad), false, bad);
    await assert.rejects(client.getCoreMedia(1, bad), /Media Root/);
  }
  assert.equal(calls.length, 0);
});

test("the media root requests /media/ (unverified against a live org)", async () => {
  const { fetch, calls } = fakeFetch(200, []);
  await new HttpReflectClient({ token: TOKEN, fetch }).getCoreMedia(1, "/");
  assert.equal(calls[0]!.url, "https://reflect.qsc.com/api/public/v0/cores/1/media/");
});

test("non-JSON error bodies are not passed through", async () => {
  const fetch = (async () => new Response("<html>stack trace at line 42</html>", { status: 502 })) as unknown as typeof globalThis.fetch;
  const error = await new HttpReflectClient({ token: TOKEN, fetch }).listCores().catch((caught) => caught);
  assert.equal(error.message, "Reflect API 502 on /cores");
});

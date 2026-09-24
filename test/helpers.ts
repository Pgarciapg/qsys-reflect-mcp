import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CARD_HTML } from "../src/generated/card.ts";
import { DemoReflectClient } from "../src/reflect/demo.ts";
import { createServer } from "../src/server.ts";

// A fixed clock keeps demo timestamps and date-range tests stable.
export const NOW = Date.UTC(2026, 8, 23, 15, 0, 0);

export const connect = async ({ card = true } = {}) => {
  const server = createServer({ client: new DemoReflectClient(NOW), source: "demo", cardHtml: card ? CARD_HTML : undefined });
  const client = new Client({ name: "qsys-reflect-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
};

export const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ name, arguments: args });
  return result as { content: { type: string; text: string }[]; structuredContent: any; isError?: boolean };
};

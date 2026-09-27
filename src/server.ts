import { createUIResource } from "@mcp-ui/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTool, toolDefinitions, type ToolContext } from "./tools.ts";
import { CARD_URI, SERVER_VERSION } from "./version.ts";

export interface ServerOptions extends ToolContext {
  /** Built card HTML. Omit it to serve the same tools without the MCP Apps card. */
  cardHtml?: string;
}

const cardResource = (html: string) => {
  const { resource } = createUIResource({
    uri: CARD_URI,
    content: { type: "rawHtml", htmlString: html },
    encoding: "text",
    // The card talks only to the host bridge; it loads nothing from the network.
    metadata: { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } } },
  });
  if (resource.mimeType !== RESOURCE_MIME_TYPE) throw new Error(`Card resource must be ${RESOURCE_MIME_TYPE}, got ${resource.mimeType}.`);
  return resource;
};

/** One factory for every transport: stdio, stateless Streamable HTTP, and in-memory tests. */
export const createServer = (options: ServerOptions): McpServer => {
  const server = new McpServer(
    { name: "qsys-reflect", title: "Q-SYS Reflect", version: SERVER_VERSION },
    {
      instructions:
        "Read-only access to a Q-SYS Reflect Enterprise Manager organization. Call get_fleet_health first to see what needs attention, then drill into get_system, list_system_items, or get_core_events. Every tool reads; none change a Core or System.",
    },
  );
  const context: ToolContext = { client: options.client, source: options.source };

  if (options.cardHtml) {
    const resource = cardResource(options.cardHtml);
    registerAppResource(server, "Q-SYS Reflect status card", CARD_URI, { description: "Fleet and system health card." }, async () => ({
      contents: [resource],
    }));
  }

  for (const tool of toolDefinitions) {
    const config = { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations };
    const run = async (args: Record<string, unknown>) => callTool(tool, context, args ?? {});
    // visibility "app" lets the card itself call these tools (Open / Back to fleet); ChatGPT blocks card calls without it.
    if (tool.card && options.cardHtml) registerAppTool(server, tool.name, { ...config, _meta: { ui: { resourceUri: CARD_URI, visibility: ["model", "app"] } } }, run);
    else server.registerTool(tool.name, config, run);
  }
  return server;
};

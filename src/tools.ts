import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { isSafeMediaPath, ReflectApiError } from "./reflect/client.ts";
import type { Core, Item, PageQuery, ReflectReader, System } from "./reflect/types.ts";
import { fleetHealth, fleetSummary, itemLevel, systemItemCounts, systemLevel, systemReason, coreLevel, type Level } from "./health.ts";

export type Source = "live" | "demo";

export interface ToolContext {
  client: ReflectReader;
  source: Source;
}

/** Everything a tool returns. `summary` leads structuredContent because some hosts pass only that to the model. */
export interface ToolPayload {
  summary: string;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
  /** Tools that draw the status card. */
  card?: boolean;
  run(context: ToolContext, args: Record<string, unknown>): Promise<ToolPayload>;
}

// Every tool here only reads. openWorldHint is true because they reach a third-party cloud API.
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const id = (what: string) => z.number().int().positive().describe(`${what} ID (integer, from a list tool)`);
const levelFilter = z.enum(["ok", "warning", "fault", "unknown"]).optional().describe("Only return rows at this health level");
const paging = {
  page: z.number().int().min(1).optional().describe("Page number, default 1"),
  // Reflect documents a default of 100 and no maximum; 500 is this server's cap to keep responses readable.
  pageSize: z.number().int().min(1).max(500).optional().describe("Rows per page, default 100, max 500"),
  dates: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2},\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD,YYYY-MM-DD")
    .optional()
    .describe("Inclusive date range as 'YYYY-MM-DD,YYYY-MM-DD'"),
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const coreRow = (core: Core) => ({
  id: core.id,
  name: core.name,
  model: core.model,
  firmware: core.firmware,
  site: core.site?.name ?? null,
  level: coreLevel(core),
  status: core.status,
  redundancy: core.redundancy,
});

const systemRow = (system: System) => ({
  id: system.id,
  name: system.name,
  core: system.core,
  design: system.design?.name ?? null,
  platform: system.design?.platform ?? null,
  level: systemLevel(system),
  status: system.status.message,
  reason: systemReason(system),
  items: systemItemCounts(system),
});

const itemRow = (item: Item) => ({
  id: item.id,
  name: item.name,
  type: item.type,
  model: item.model,
  location: item.location,
  level: itemLevel(item),
  status: item.status ? item.status.details && item.status.details !== item.status.message ? `${item.status.message}: ${item.status.details}` : item.status.message : "No status",
  isOnline: item.isOnline ?? null,
  ipAddress: item.networkConfig?.interfaces[0]?.ipAddress ?? null,
});

const levelWord: Record<Level, string> = { ok: "OK", warning: "warning", fault: "fault", unknown: "unknown" };

const describeLevels = (levels: Level[]) => {
  const counts = new Map<Level, number>();
  for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1);
  return (["fault", "warning", "unknown", "ok"] as Level[])
    .filter((level) => counts.get(level))
    .map((level) => `${counts.get(level)} ${levelWord[level]}`)
    .join(", ");
};

const byLevel = <T extends { level: Level }>(rows: T[], level?: Level) => (level ? rows.filter((row) => row.level === level) : rows);

const pageQuery = (args: Record<string, unknown>): PageQuery => ({
  page: args.page as number | undefined,
  pageSize: args.pageSize as number | undefined,
  dates: args.dates as string | undefined,
});

export const systemView = async (client: ReflectReader, systemId: number) => {
  const [system, items] = await Promise.all([client.getSystem(systemId), client.listSystemItems(systemId)]);
  const rows = items.map(itemRow).sort((a, b) => {
    const rank = { fault: 3, warning: 2, unknown: 1, ok: 0 } as const;
    return rank[b.level] - rank[a.level] || a.name.localeCompare(b.name);
  });
  const level = systemLevel(system);
  const reason = systemReason(system);
  const problems = rows.filter((row) => row.level !== "ok");
  const head = `${system.name} on ${system.core.name}: ${levelWord[level]}.`;
  const detail = reason
    ? ` ${reason}`
    : problems.length
      ? ` ${plural(problems.length, "item")} need attention: ${problems.slice(0, 3).map((row) => `${row.name} (${row.status})`).join("; ")}.`
      : ` All ${plural(rows.length, "item")} report OK.`;
  return {
    summary: head + detail,
    view: "system" as const,
    system: systemRow(system),
    items: rows,
  };
};

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "get_fleet_health",
    title: "Fleet health",
    description:
      "Start here. Rolls up every Q-SYS Core and System in the Reflect organization into one health view: counts by level, the issues that need attention (worst first), and a row per core and system. Reflect has no alarms endpoint, so this is how to answer 'is anything down?'.",
    inputSchema: {},
    annotations: READ_ONLY,
    card: true,
    async run({ client }) {
      const [cores, systems] = await Promise.all([client.listCores(), client.listSystems()]);
      const health = fleetHealth(cores, systems);
      return { summary: fleetSummary(health), view: "fleet", ...health };
    },
  },
  {
    name: "get_system",
    title: "System status",
    description:
      "One Q-SYS System (a running design) with its status, the core it runs on, and every inventory item sorted worst first. Use after get_fleet_health points at a system.",
    inputSchema: { systemId: id("System") },
    annotations: READ_ONLY,
    card: true,
    async run({ client }, args) {
      return systemView(client, args.systemId as number);
    },
  },
  {
    name: "list_cores",
    title: "List cores",
    description: "Every Q-SYS Core in the organization with model, firmware, site, redundancy role, and health level.",
    inputSchema: { level: levelFilter },
    annotations: READ_ONLY,
    async run({ client }, args) {
      const all = (await client.listCores()).map(coreRow);
      const cores = byLevel(all, args.level as Level | undefined);
      return { summary: `${plural(all.length, "core")}: ${describeLevels(all.map((row) => row.level))}.${args.level ? ` Showing ${cores.length} at ${args.level}.` : ""}`, cores };
    },
  },
  {
    name: "get_core",
    title: "Core details",
    description: "Full record for one Q-SYS Core: serial, model, firmware, access mode, status, redundancy, site, and when it came up.",
    inputSchema: { coreId: id("Core") },
    annotations: READ_ONLY,
    async run({ client }, args) {
      const core = await client.getCore(args.coreId as number);
      const since = Number.isFinite(core.uptime) && core.uptime > 0 ? new Date(core.uptime).toISOString() : null;
      return {
        summary: `${core.name} (${core.model}, firmware ${core.firmware}) at ${core.site?.name ?? "no site"}: ${core.status.message}${core.status.details && core.status.details !== core.status.message ? `, ${core.status.details}` : ""}.`,
        level: coreLevel(core),
        upSince: since,
        core,
      };
    },
  },
  {
    name: "list_systems",
    title: "List systems",
    description: "Every Q-SYS System (running design) with its core, platform, health level, and item tallies (normal, warning, fault, unknown).",
    inputSchema: { level: levelFilter },
    annotations: READ_ONLY,
    async run({ client }, args) {
      const all = (await client.listSystems()).map(systemRow);
      const systems = byLevel(all, args.level as Level | undefined);
      return { summary: `${plural(all.length, "system")}: ${describeLevels(all.map((row) => row.level))}.${args.level ? ` Showing ${systems.length} at ${args.level}.` : ""}`, systems };
    },
  },
  {
    name: "list_system_items",
    title: "System inventory",
    description: "Inventory for one System: amplifiers, I/O, cameras, touch panels, and other items with type, model, location, IP, and health. Filter by level or by type text.",
    inputSchema: {
      systemId: id("System"),
      level: levelFilter,
      type: z.string().min(1).optional().describe("Case-insensitive match on item type, e.g. 'amplifier'"),
    },
    annotations: READ_ONLY,
    async run({ client }, args) {
      const all = (await client.listSystemItems(args.systemId as number)).map(itemRow);
      const type = (args.type as string | undefined)?.toLowerCase();
      const items = byLevel(all, args.level as Level | undefined).filter((row) => !type || row.type.toLowerCase().includes(type));
      return {
        summary: `System ${args.systemId}: ${plural(all.length, "item")} (${describeLevels(all.map((row) => row.level))}). Showing ${items.length}.`,
        items,
      };
    },
  },
  {
    name: "get_system_item",
    title: "Item details",
    description: "Full record for one inventory item, including network interfaces, DNS, NTP, 802.1X, pairing, and redundancy.",
    inputSchema: { systemId: id("System"), itemId: id("Item") },
    annotations: READ_ONLY,
    async run({ client }, args) {
      const item = await client.getSystemItem(args.systemId as number, args.itemId as number);
      const row = itemRow(item);
      return { summary: `${item.name} (${item.model}, ${item.type}) at ${item.location}: ${row.status}.`, level: row.level, item };
    },
  },
  {
    name: "get_core_events",
    title: "Core event log",
    description:
      "Event log for one Core, newest first, paginated. Optional date range. `severity` filters the returned page only; Reflect does not filter server-side.",
    inputSchema: {
      coreId: id("Core"),
      ...paging,
      severity: z.string().min(1).optional().describe("Keep only events whose severity matches, e.g. 'Fault'"),
    },
    annotations: READ_ONLY,
    async run({ client }, args) {
      const page = await client.getCoreEvents(args.coreId as number, pageQuery(args));
      const severity = (args.severity as string | undefined)?.toLowerCase();
      const events = severity ? page.events.filter((event) => event.severity.toLowerCase() === severity) : page.events;
      const notable = page.events.filter((event) => event.severity.toLowerCase() !== "normal").length;
      return {
        summary: `Core ${args.coreId}: ${plural(page.total, "event")} match; this page has ${page.events.length}, ${notable} not Normal.${severity ? ` Showing ${events.length} at ${args.severity}.` : ""}`,
        total: page.total,
        events,
      };
    },
  },
  {
    name: "browse_core_media",
    title: "Browse core media",
    description: "List a folder (or describe a file) on a Core's media drive. Path is relative to the Media Root, e.g. '/Audio'. Returns metadata only, never file contents.",
    inputSchema: { coreId: id("Core"), path: z
        .string()
        .default("/")
        .refine(isSafeMediaPath, "Path must stay under Media Root (no '.' or '..' segments)")
        .describe("Folder or file path under Media Root, default '/'") },
    annotations: READ_ONLY,
    async run({ client }, args) {
      const result = await client.getCoreMedia(args.coreId as number, (args.path as string | undefined) ?? "/");
      if (Array.isArray(result)) {
        const folders = result.filter((media) => media.type === "folder").length;
        return { summary: `${args.path}: ${plural(folders, "folder")}, ${plural(result.length - folders, "file")}.`, entries: result };
      }
      return { summary: `${result.path}: ${result.type}${result.size != null ? `, ${result.size} bytes` : ""}.`, entry: result };
    },
  },
  {
    name: "list_media_playlists",
    title: "Media playlists",
    description: "Media playlists stored on a Core, with track counts.",
    inputSchema: { coreId: id("Core") },
    annotations: READ_ONLY,
    async run({ client }, args) {
      const playlists = await client.listMediaPlaylists(args.coreId as number);
      return { summary: `Core ${args.coreId}: ${plural(playlists.length, "playlist")}${playlists.length ? ` (${playlists.map((list) => list.name).join(", ")})` : ""}.`, playlists };
    },
  },
  {
    name: "list_softphones",
    title: "Softphone settings",
    description: "SIP softphone settings for one System: registration user, proxy, transport, domain. Proxy passwords are always redacted.",
    inputSchema: { systemId: id("System") },
    annotations: READ_ONLY,
    async run({ client }, args) {
      const softphones = (await client.listSoftphones(args.systemId as number)).map(({ proxyPassword, ...rest }) => ({
        ...rest,
        ...(proxyPassword !== undefined ? { proxyPassword: proxyPassword ? "[redacted]" : null } : {}),
      }));
      return { summary: `System ${args.systemId}: ${plural(softphones.length, "softphone")}${softphones.length ? ` (${softphones.map((phone) => `${phone.name} over ${phone.transport}`).join(", ")})` : ""}.`, softphones };
    },
  },
  {
    name: "get_audit_events",
    title: "Sign-in audit log",
    description: "Organization audit records of user sign-ins, newest first, paginated, with optional date range.",
    inputSchema: paging,
    annotations: READ_ONLY,
    async run({ client }, args) {
      const page = await client.getAuditEvents(pageQuery(args));
      const people = new Set(page.items.map((event) => event.userName).filter(Boolean)).size;
      return { summary: `${plural(page.total, "audit event")} match; this page has ${page.items.length} from ${plural(people, "user")}.`, total: page.total, items: page.items };
    },
  },
];

const errorSummary = (error: unknown): { summary: string; status: number | null } => {
  if (error instanceof ReflectApiError) {
    if (error.status === 401) return { summary: "Reflect rejected the API token (401). Check QSYS_REFLECT_API_TOKEN, or run the server with --demo.", status: 401 };
    if (error.status === 403) return { summary: "The token does not have access to that resource (403).", status: 403 };
    if (error.status === 404) return { summary: `Not found in this Reflect organization (${error.path}).`, status: 404 };
    return { summary: error.message, status: error.status };
  }
  if (error instanceof Error && error.name === "TimeoutError") return { summary: "Reflect did not answer in time.", status: null };
  return { summary: error instanceof Error ? error.message : "The request failed.", status: null };
};

/** Runs a tool and shapes the MCP result. Text carries the summary plus JSON; structuredContent leads with the summary. */
export const callTool = async (tool: ToolDefinition, context: ToolContext, args: Record<string, unknown>) => {
  try {
    const payload = await tool.run(context, args);
    const structuredContent = { ...payload, source: context.source };
    const { summary, ...data } = structuredContent;
    return {
      content: [{ type: "text" as const, text: `${summary}\n\n${JSON.stringify(data)}` }],
      structuredContent,
    };
  } catch (error) {
    const { summary, status } = errorSummary(error);
    return {
      content: [{ type: "text" as const, text: summary }],
      structuredContent: { summary, source: context.source, error: { status } },
      isError: true,
    };
  }
};

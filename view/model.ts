// Turns a tool's structuredContent into what the card draws. Pure, so it runs under node --test.

export type Level = "ok" | "warning" | "fault" | "unknown";

export interface Segment {
  level: Level;
  count: number;
}

export interface Tile {
  label: string;
  value: string;
  note: string;
  segments: Segment[];
}

export interface Row {
  level: Level;
  title: string;
  detail: string;
  meta: string;
  action?: { label: string; name: string; arguments: Record<string, unknown> };
}

export interface CardModel {
  kind: "fleet" | "system" | "error";
  eyebrow: string;
  source: string | null;
  level: Level;
  headline: string;
  subhead: string;
  tiles: Tile[];
  sectionTitle: string;
  rows: Row[];
  more: string | null;
  back?: { label: string; name: string; arguments: Record<string, unknown> };
}

type Tally = { ok?: number; normal?: number; warning?: number; fault?: number; unknown?: number };

export const LEVEL_LABEL: Record<Level, string> = { ok: "OK", warning: "Warning", fault: "Fault", unknown: "Unknown" };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const segments = (tally: Tally | null | undefined): Segment[] => {
  if (!tally) return [];
  return ([
    ["fault", tally.fault],
    ["warning", tally.warning],
    ["unknown", tally.unknown],
    ["ok", tally.ok ?? tally.normal],
  ] as [Level, number | undefined][])
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([level, count]) => ({ level, count: count ?? 0 }));
};

const tallyNote = (tally: Tally | null | undefined) => {
  if (!tally) return "";
  const parts: string[] = [];
  if (tally.fault) parts.push(`${tally.fault} fault`);
  if (tally.warning) parts.push(`${tally.warning} warn`);
  if (tally.unknown) parts.push(`${tally.unknown} unknown`);
  return parts.length ? parts.join(" · ") : "all OK";
};

const sourceLabel = (source: unknown) => (source === "demo" ? "Demo data" : source === "live" ? "Live" : null);

const asLevel = (value: unknown): Level => (value === "ok" || value === "warning" || value === "fault" ? value : "unknown");

const MAX_ROWS = 6;

const fleet = (data: any): CardModel => {
  const issues: any[] = Array.isArray(data.issues) ? data.issues : [];
  const level = asLevel(data.level);
  const items: Tally = data.totals?.items ?? {};
  const itemTotal = (items.normal ?? 0) + (items.warning ?? 0) + (items.fault ?? 0) + (items.unknown ?? 0);
  const rows: Row[] = issues.slice(0, MAX_ROWS).map((issue) => ({
    level: asLevel(issue.level),
    title: issue.name,
    detail: issue.message,
    meta: [issue.kind === "core" ? "Core" : issue.kind === "system" ? "System" : "Item", issue.site].filter(Boolean).join(" · "),
    action: issue.kind === "system" && issue.systemId ? { label: `Open ${issue.name}`, name: "get_system", arguments: { systemId: issue.systemId } } : undefined,
  }));
  return {
    kind: "fleet",
    eyebrow: "Q-SYS Reflect · Fleet health",
    source: sourceLabel(data.source),
    level,
    headline: issues.length ? `${plural(issues.length, "issue")} need${issues.length === 1 ? "s" : ""} attention` : "All systems OK",
    subhead: `${plural(data.totals?.cores ?? 0, "core")} · ${plural(data.totals?.systems ?? 0, "system")} · ${plural(itemTotal, "item")}`,
    tiles: [
      { label: "Cores", value: String(data.totals?.cores ?? 0), note: tallyNote(data.cores), segments: segments(data.cores) },
      { label: "Systems", value: String(data.totals?.systems ?? 0), note: tallyNote(data.systems), segments: segments(data.systems) },
      { label: "Items", value: String(itemTotal), note: tallyNote(items), segments: segments(items) },
    ],
    sectionTitle: issues.length ? "Needs attention" : "Nothing needs attention",
    rows,
    more: issues.length > MAX_ROWS ? `${issues.length - MAX_ROWS} more in the tool result` : null,
  };
};

const system = (data: any): CardModel => {
  const info = data.system ?? {};
  const items: any[] = Array.isArray(data.items) ? data.items : [];
  const problems = items.filter((item) => item.level !== "ok");
  const shown = (problems.length ? problems : items).slice(0, MAX_ROWS);
  const okCount = items.length - problems.length;
  const tally: Tally = info.items ?? {
    normal: okCount,
    warning: problems.filter((item) => item.level === "warning").length,
    fault: problems.filter((item) => item.level === "fault").length,
  };
  return {
    kind: "system",
    eyebrow: "Q-SYS Reflect · System",
    source: sourceLabel(data.source),
    level: asLevel(info.level),
    headline: info.name ?? "System",
    subhead: [info.core?.name, info.platform, info.design].filter(Boolean).join(" · "),
    tiles: [
      // The status message often just repeats the level ("Fault"); only show it when it adds something.
      { label: "Status", value: LEVEL_LABEL[asLevel(info.level)], note: info.reason ?? (info.status && info.status !== LEVEL_LABEL[asLevel(info.level)] ? info.status : ""), segments: [] },
      { label: "Items", value: String(items.length), note: tallyNote(tally), segments: segments(tally) },
    ],
    sectionTitle: problems.length ? "Items needing attention" : "Inventory",
    rows: shown.map((item) => ({
      level: asLevel(item.level),
      title: item.name,
      detail: item.status,
      meta: [item.model, item.location, item.ipAddress].filter(Boolean).join(" · "),
    })),
    more: problems.length ? (okCount ? `${plural(okCount, "other item")} OK` : null) : items.length > MAX_ROWS ? `${items.length - MAX_ROWS} more OK` : null,
    back: { label: "Back to fleet", name: "get_fleet_health", arguments: {} },
  };
};

export const errorModel = (message: string): CardModel => ({
  kind: "error",
  eyebrow: "Q-SYS Reflect",
  source: null,
  level: "unknown",
  headline: "Could not load status",
  subhead: message,
  tiles: [],
  sectionTitle: "",
  rows: [],
  more: null,
  back: { label: "Back to fleet", name: "get_fleet_health", arguments: {} },
});

export const cardModel = (data: any): CardModel => {
  if (!data || typeof data !== "object") return errorModel("The tool returned nothing to show.");
  if (data.error) return errorModel(data.summary ?? "The request failed.");
  if (data.view === "fleet") return fleet(data);
  if (data.view === "system") return system(data);
  return errorModel(data.summary ?? "This result has no card view.");
};

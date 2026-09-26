import type { Core, Item, System, SystemItemsStatusDetails } from "./reflect/types.ts";

export type Level = "ok" | "warning" | "fault" | "unknown";

const RANK: Record<Level, number> = { ok: 0, unknown: 1, warning: 2, fault: 3 };

export const worst = (levels: Level[]): Level =>
  levels.reduce<Level>((acc, level) => (RANK[level] > RANK[acc] ? level : acc), "ok");

/**
 * Reflect's public spec only documents code 0 as "OK". The other codes follow the
 * Q-SYS Designer status convention (1 Compromised, 2 Fault, 3 Not Present, 4 Missing,
 * 5 Initializing). That mapping is an assumption, not something the spec states.
 */
export const levelForCode = (code: number | null | undefined): Level => {
  if (code === 0) return "ok";
  if (code === 1 || code === 5) return "warning";
  if (code === 2 || code === 3 || code === 4) return "fault";
  return "unknown";
};

export const coreLevel = (core: Core): Level => levelForCode(core.status?.code);

export const itemLevel = (item: Item): Level => levelForCode(item.status?.code);

export const systemItemCounts = (system: System): SystemItemsStatusDetails | null => {
  const details = system.status?.details;
  return details && "items" in details ? details.items : null;
};

export const systemReason = (system: System): string | null => {
  const details = system.status?.details;
  return details && "reason" in details ? details.reason : null;
};

/** The worse of the system's own code and the item tallies it reports. */
export const systemLevel = (system: System): Level => {
  const levels: Level[] = [levelForCode(system.status?.code)];
  const counts = systemItemCounts(system);
  if (counts?.fault) levels.push("fault");
  if (counts?.warning) levels.push("warning");
  if (counts?.unknown) levels.push("unknown");
  if (systemReason(system)) levels.push("fault");
  return worst(levels);
};

export interface Tally {
  ok: number;
  warning: number;
  fault: number;
  unknown: number;
}

const emptyTally = (): Tally => ({ ok: 0, warning: 0, fault: 0, unknown: 0 });

const tally = (levels: Level[]): Tally => {
  const counts = emptyTally();
  for (const level of levels) counts[level] += 1;
  return counts;
};

export interface Issue {
  kind: "core" | "system" | "item";
  id: number;
  name: string;
  level: Exclude<Level, "ok">;
  message: string;
  site: string | null;
  systemId: number | null;
}

export interface CoreRow {
  id: number;
  name: string;
  model: string;
  firmware: string;
  site: string;
  level: Level;
  status: string;
  redundancy: string | null;
}

export interface SystemRow {
  id: number;
  name: string;
  core: string;
  coreId: number | null;
  site: string | null;
  platform: string;
  level: Level;
  status: string;
  items: SystemItemsStatusDetails | null;
}

export interface FleetHealth {
  level: Level;
  totals: { cores: number; systems: number; items: SystemItemsStatusDetails };
  cores: Tally;
  systems: Tally;
  issues: Issue[];
  coreRows: CoreRow[];
  systemRows: SystemRow[];
}

const statusText = (message: string, details: string | null | undefined) =>
  details && details !== message ? `${message}: ${details}` : message;

const byLevelThenName = <T extends { level: Level; name: string }>(a: T, b: T) =>
  RANK[b.level] - RANK[a.level] || a.name.localeCompare(b.name);

export const fleetHealth = (cores: Core[], systems: System[]): FleetHealth => {
  const siteForCore = new Map(cores.map((core) => [core.id, core.site?.name ?? null]));

  const coreRows: CoreRow[] = cores
    .map((core) => ({
      id: core.id,
      name: core.name,
      model: core.model,
      firmware: core.firmware,
      site: core.site?.name ?? "",
      level: coreLevel(core),
      status: statusText(core.status.message, core.status.details),
      redundancy: core.redundancy ? `${core.redundancy.role} · ${core.redundancy.state}` : null,
    }))
    .sort(byLevelThenName);

  const systemRows: SystemRow[] = systems
    .map((system) => ({
      id: system.id,
      name: system.name,
      core: system.core?.name ?? "",
      coreId: system.core?.id ?? null,
      site: system.core ? siteForCore.get(system.core.id) ?? null : null,
      platform: system.design?.platform ?? "",
      level: systemLevel(system),
      status: systemReason(system) ?? system.status.message,
      items: systemItemCounts(system),
    }))
    .sort(byLevelThenName);

  const items: SystemItemsStatusDetails = { normal: 0, warning: 0, fault: 0, unknown: 0 };
  for (const row of systemRows) {
    if (!row.items) continue;
    items.normal += row.items.normal;
    items.warning += row.items.warning;
    items.fault += row.items.fault;
    items.unknown += row.items.unknown;
  }

  const issues: Issue[] = [];
  for (const row of coreRows) {
    if (row.level === "ok") continue;
    issues.push({ kind: "core", id: row.id, name: row.name, level: row.level, message: row.status, site: row.site || null, systemId: null });
  }
  for (const row of systemRows) {
    if (row.level === "ok") continue;
    const system = systems.find((candidate) => candidate.id === row.id);
    const counts = row.items;
    const parts: string[] = [];
    if (counts?.fault) parts.push(`${counts.fault} item${counts.fault === 1 ? "" : "s"} faulted`);
    if (counts?.warning) parts.push(`${counts.warning} warning`);
    const message = systemReason(system!) ?? (parts.length ? parts.join(", ") : row.status);
    issues.push({
      kind: "system",
      id: row.id,
      name: row.name,
      level: row.level,
      message,
      site: system?.core ? siteForCore.get(system.core.id) ?? null : null,
      systemId: row.id,
    });
  }
  issues.sort((a, b) => RANK[b.level] - RANK[a.level] || a.name.localeCompare(b.name));

  return {
    level: worst([...coreRows, ...systemRows].map((row) => row.level)),
    totals: { cores: cores.length, systems: systems.length, items },
    cores: tally(coreRows.map((row) => row.level)),
    systems: tally(systemRows.map((row) => row.level)),
    issues,
    coreRows,
    systemRows,
  };
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One sentence a model can repeat verbatim. It leads structuredContent. */
export const fleetSummary = (health: FleetHealth): string => {
  const scope = `${plural(health.totals.cores, "core")} and ${plural(health.totals.systems, "system")}`;
  if (!health.issues.length) return `All clear: ${scope} report OK.`;
  const faults = health.issues.filter((issue) => issue.level === "fault").length;
  const warnings = health.issues.filter((issue) => issue.level === "warning").length;
  const counts = [faults && plural(faults, "fault"), warnings && plural(warnings, "warning")].filter(Boolean).join(" and ");
  const top = health.issues[0]!;
  return `${counts || plural(health.issues.length, "issue")} across ${scope}. Most severe: ${top.name} (${top.kind}), ${top.message}.`;
};

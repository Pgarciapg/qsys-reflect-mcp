// Turns a tool's structuredContent into what the card draws, including the schematic
// geometry. Pure (no DOM), so every layout decision runs under node --test.

export type Level = "ok" | "warning" | "fault" | "unknown";

export const LEVEL_LABEL: Record<Level, string> = { ok: "OK", warning: "Warning", fault: "Fault", unknown: "Unknown" };

const RANK: Record<Level, number> = { ok: 0, unknown: 1, warning: 2, fault: 3 };

export interface SchemNode {
  kind: "source" | "core" | "system" | "hub" | "location";
  x: number;
  y: number;
  w: number;
  h: number;
  level: Level | "source";
  title: string;
  /** Second line under the title (site, core, item count). */
  sub?: string;
  /** Right-aligned readout (redundancy role, items OK). */
  right?: string;
  /** Inline note after the title, for problem locations. */
  note?: string;
  /** One light per item, for locations. */
  leds?: Level[];
}

export interface SchemWire {
  d: string;
  /** flow = healthy signal, slow = warning, broken = fault, idle = standby path. */
  style: "flow" | "slow" | "broken" | "idle";
}

export interface Schematic {
  width: number;
  height: number;
  nodes: SchemNode[];
  wires: SchemWire[];
  braces: { x: number; y1: number; y2: number }[];
  label: string;
  more: string | null;
}

export interface Row {
  level: Level;
  tag: string;
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
  /** Bold lead-in of the headline, e.g. the issue count. */
  headlineStrong: string;
  headline: string;
  subhead: string;
  gauge: { percent: number; label: string } | null;
  schematic: Schematic | null;
  rows: Row[];
  footnote: string;
  back?: { label: string; name: string; arguments: Record<string, unknown> };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const asLevel = (value: unknown): Level => (value === "ok" || value === "warning" || value === "fault" ? value : "unknown");

const worst = (levels: Level[]): Level => levels.reduce<Level>((acc, level) => (RANK[level] > RANK[acc] ? level : acc), "ok");

/** Mono labels have a fixed width budget; cut with an ellipsis rather than overflow the node. */
export const fit = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);

const wireStyle = (level: Level): SchemWire["style"] => (level === "fault" ? "broken" : level === "warning" ? "slow" : "flow");

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mid = Math.round((x1 + x2) / 2);
  return `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
};

const FOOT = "Read-only";

/** "Fault: 2 Fault, 8 OK" under a FAULT tag reads twice; drop the prefix the tag already says. */
const withoutTag = (text: string, ...labels: string[]) => {
  for (const label of labels) if (text.toLowerCase().startsWith(`${label.toLowerCase()}: `)) return text.slice(label.length + 2);
  return text;
};
const MAX_SCHEM_ROWS = 8;
const MAX_FLEET_ROWS = 3;
const MAX_SYSTEM_ROWS = 3;
const MAX_LEDS = 6;

/** Pick at most `max` entries, keeping the worst ones, then restore original order. */
const keepWorst = <T>(list: T[], max: number, level: (entry: T) => Level) => {
  if (list.length <= max) return { kept: list, dropped: 0 };
  const ranked = list.map((entry, index) => ({ entry, index })).sort((a, b) => RANK[level(b.entry)] - RANK[level(a.entry)] || a.index - b.index);
  const kept = ranked.slice(0, max).sort((a, b) => a.index - b.index).map(({ entry }) => entry);
  return { kept, dropped: list.length - max };
};

const redundancyTag = (redundancy: string | null | undefined) => {
  if (!redundancy) return undefined;
  const [role = "", state = ""] = redundancy.split("·").map((part) => part.trim());
  if (/standby/i.test(state)) return "STBY";
  if (/primary/i.test(role)) return "PRI";
  return role.slice(0, 4).toUpperCase() || undefined;
};

// ---------- fleet ----------

interface CoreIn { id: number; name: string; site: string; level: Level; redundancy: string | null }
interface SystemIn { id: number; name: string; coreId: number | null; site: string | null; level: Level; items: { normal: number; warning: number; fault: number; unknown: number } | null }

export const fleetSchematic = (coresIn: any[], systemsIn: any[]): Schematic => {
  const cores: CoreIn[] = coresIn.map((core) => ({ id: core.id, name: String(core.name ?? ""), site: String(core.site ?? ""), level: asLevel(core.level), redundancy: core.redundancy ?? null }));
  const systems: SystemIn[] = systemsIn.map((system) => ({ id: system.id, name: String(system.name ?? ""), coreId: system.coreId ?? null, site: system.site ?? null, level: asLevel(system.level), items: system.items ?? null }));
  cores.sort((a, b) => a.site.localeCompare(b.site) || a.name.localeCompare(b.name));

  // One row per core/system pairing: a core's first system shares its row, extra systems get their own.
  type SchemRow = { core: CoreIn | null; coreOwner: CoreIn; system: SystemIn | null };
  const rows: SchemRow[] = [];
  for (const core of cores) {
    const own = systems.filter((system) => system.coreId === core.id);
    if (!own.length) rows.push({ core, coreOwner: core, system: null });
    own.forEach((system, index) => rows.push({ core: index === 0 ? core : null, coreOwner: core, system }));
  }
  const orphans = systems.filter((system) => !cores.some((core) => core.id === system.coreId));
  const rowLevel = (row: SchemRow) => worst([row.core?.level ?? "ok", row.system?.level ?? "ok"]);
  const { kept, dropped } = keepWorst(rows, MAX_SCHEM_ROWS, rowLevel);

  const ROW = 28;
  const TOP = 6;
  const height = Math.max(64, TOP * 2 + kept.length * ROW - 8);
  const srcCy = Math.round(height / 2);
  const nodes: SchemNode[] = [{ kind: "source", x: 8, y: srcCy - 18, w: 78, h: 36, level: "source", title: "REFLECT", sub: "cloud · v0" }];
  const wires: SchemWire[] = [];
  const braces: Schematic["braces"] = [];
  const coreRowY = new Map<number, number>();
  const drawnCores: { core: CoreIn; y: number }[] = [];
  const systemRowY = new Map<number, number>();

  kept.forEach((row, index) => {
    const y = TOP + index * ROW;
    const cy = y + 10;
    if (row.core) {
      coreRowY.set(row.core.id, cy);
      drawnCores.push({ core: row.core, y });
      nodes.push({ kind: "core", x: 156, y, w: 112, h: 20, level: row.core.level, title: fit(row.core.name, 15), right: redundancyTag(row.core.redundancy) });
      wires.push({ d: curve(86, srcCy, 156, cy), style: wireStyle(row.core.level) });
    }
    if (row.system) {
      systemRowY.set(row.system.id, cy);
      const counts = row.system.items;
      const total = counts ? counts.normal + counts.warning + counts.fault + counts.unknown : 0;
      nodes.push({
        kind: "system",
        x: 334,
        y: y - 2,
        w: 178,
        h: 24,
        level: row.system.level,
        title: fit(row.system.name, 22),
        sub: row.system.site ? fit(row.system.site.toUpperCase(), 30) : undefined,
        right: total ? `${counts!.normal}/${total}` : LEVEL_LABEL[row.system.level].toUpperCase(),
      });
      const from = coreRowY.get(row.coreOwner.id);
      if (from != null) wires.push({ d: from === cy ? `M268 ${cy} L334 ${cy}` : curve(268, from, 334, cy), style: wireStyle(row.system.level) });
    }
  });

  // A standby core with no system of its own is drawn idle-linked to its same-site partner's system.
  for (const row of kept) {
    if (!row.core || row.system) continue;
    const partner = kept.find((other) => other.system && other.coreOwner.site === row.coreOwner.site && other.coreOwner.id !== row.coreOwner.id);
    const from = coreRowY.get(row.core.id);
    const to = partner?.system ? systemRowY.get(partner.system.id) : undefined;
    if (from != null && to != null) wires.push({ d: curve(268, from, 334, to), style: "idle" });
  }

  // Bracket redundant pairs: consecutive cores at the same site that both report redundancy.
  for (let index = 0; index + 1 < drawnCores.length; index += 1) {
    const a = drawnCores[index]!;
    const b = drawnCores[index + 1]!;
    if (a.core.redundancy && b.core.redundancy && a.core.site === b.core.site) braces.push({ x: 152, y1: a.y + 6, y2: b.y + 14 });
  }

  const faults = [...cores, ...systems].filter((entry) => entry.level === "fault").length;
  const hidden = dropped + orphans.length;
  return {
    width: 520,
    height,
    nodes,
    wires,
    braces,
    label: `Signal flow from Reflect to ${plural(cores.length, "core")} and ${plural(systems.length, "system")}; ${faults} faulted.`,
    more: hidden ? `${hidden} more OK ${hidden === 1 ? "row" : "rows"} in the result` : null,
  };
};

const fleet = (data: any): CardModel => {
  const issues: any[] = Array.isArray(data.issues) ? data.issues : [];
  const items = data.totals?.items ?? { normal: 0, warning: 0, fault: 0, unknown: 0 };
  const itemTotal = (items.normal ?? 0) + (items.warning ?? 0) + (items.fault ?? 0) + (items.unknown ?? 0);
  const rows: Row[] = issues.slice(0, MAX_FLEET_ROWS).map((issue) => ({
    level: asLevel(issue.level),
    tag: LEVEL_LABEL[asLevel(issue.level)] === "Warning" ? "Warn" : LEVEL_LABEL[asLevel(issue.level)],
    title: issue.name,
    detail: withoutTag(String(issue.message ?? ""), LEVEL_LABEL[asLevel(issue.level)]),
    meta: [issue.kind === "core" ? "Core" : issue.kind === "system" ? "System" : "Item", issue.site].filter(Boolean).join(" · "),
    action: issue.kind === "system" && issue.systemId ? { label: `Open ${issue.name}`, name: "get_system", arguments: { systemId: issue.systemId } } : undefined,
  }));
  const extra = issues.length - rows.length;
  return {
    kind: "fleet",
    eyebrow: "Q-SYS Reflect · Fleet",
    source: data.source === "demo" ? "Demo data" : data.source === "live" ? "Live" : null,
    level: asLevel(data.level),
    headlineStrong: issues.length ? String(issues.length) : "",
    headline: issues.length ? `${issues.length === 1 ? "issue needs" : "issues need"} attention` : "All systems OK",
    subhead: `${plural(data.totals?.cores ?? 0, "core")} · ${plural(data.totals?.systems ?? 0, "system")} · ${plural(itemTotal, "item")}`,
    gauge: itemTotal ? { percent: Math.round((items.normal / itemTotal) * 100), label: `${items.normal}/${itemTotal} items OK` } : null,
    schematic: fleetSchematic(data.coreRows ?? [], data.systemRows ?? []),
    rows,
    footnote: extra > 0 ? `${FOOT} · +${extra} more in the result` : FOOT,
  };
};

// ---------- system ----------

export const systemSchematic = (systemName: string, coreName: string, level: Level, items: any[]): Schematic => {
  type Loc = { name: string; levels: Level[]; problem: any | null };
  const byName = new Map<string, Loc>();
  for (const item of items) {
    const name = String(item.location || "Unassigned");
    const loc = byName.get(name) ?? { name, levels: [], problem: null };
    const itemLevel = asLevel(item.level);
    loc.levels.push(itemLevel);
    if (itemLevel !== "ok" && (!loc.problem || RANK[itemLevel] > RANK[asLevel(loc.problem.level)])) loc.problem = item;
    byName.set(name, loc);
  }
  const { kept, dropped } = keepWorst([...byName.values()], MAX_SCHEM_ROWS, (loc) => worst(loc.levels));

  const ROW = 24;
  const TOP = 6;
  const height = Math.max(72, TOP * 2 + kept.length * ROW - 4);
  const hubCy = Math.round(height / 2);
  const nodes: SchemNode[] = [
    { kind: "hub", x: 10, y: hubCy - 24, w: 140, h: 48, level, title: fit(systemName, 18), sub: fit(`${coreName} · ${plural(items.length, "item")}`.toUpperCase(), 26) },
  ];
  const wires: SchemWire[] = [];
  kept.forEach((loc, index) => {
    const y = TOP + index * ROW;
    const cy = y + 10;
    const locLevel = worst(loc.levels);
    const shown = loc.levels.slice(0, MAX_LEDS);
    const problem = loc.problem;
    const detail = problem ? String(problem.status ?? "").replace(/^[A-Za-z ]+:\s*/, "") : "";
    nodes.push({
      kind: "location",
      x: 290,
      y,
      w: 222,
      h: 20,
      level: locLevel,
      title: fit(loc.name, 13),
      note: problem ? fit(detail || problem.name, 20) : undefined,
      leds: shown,
      right: loc.levels.length > MAX_LEDS ? `+${loc.levels.length - MAX_LEDS}` : undefined,
    });
    wires.push({ d: curve(150, hubCy, 290, cy), style: wireStyle(locLevel) });
  });
  return {
    width: 520,
    height,
    nodes,
    wires,
    braces: [],
    label: `${systemName} wired to ${plural(byName.size, "location")}; one light per item.`,
    more: dropped ? `${dropped} more OK ${dropped === 1 ? "location" : "locations"} in the result` : null,
  };
};

const system = (data: any): CardModel => {
  const info = data.system ?? {};
  const items: any[] = Array.isArray(data.items) ? data.items : [];
  const problems = items.filter((item) => asLevel(item.level) !== "ok");
  const okCount = items.length - problems.length;
  const level = asLevel(info.level);
  const rows: Row[] = problems.slice(0, MAX_SYSTEM_ROWS).map((item) => {
    const itemLevel = asLevel(item.level);
    const status = String(item.status ?? "");
    const tag = /^(Missing|Not Present)\b/.test(status) ? status.split(":")[0]! : itemLevel === "warning" ? "Warn" : LEVEL_LABEL[itemLevel];
    return {
      level: itemLevel,
      tag,
      title: item.name,
      detail: withoutTag(status, tag, LEVEL_LABEL[itemLevel]),
      meta: [item.model, item.location, item.ipAddress].filter(Boolean).join(" · "),
    };
  });
  const extraProblems = problems.length - rows.length;
  const tail = [extraProblems > 0 ? `+${extraProblems} more issues` : "", okCount ? `${plural(okCount, "other item")} OK` : ""].filter(Boolean).join(" · ");
  return {
    kind: "system",
    eyebrow: ["System", info.core?.name, info.platform].filter(Boolean).join(" · "),
    source: data.source === "demo" ? "Demo data" : data.source === "live" ? "Live" : null,
    level,
    headlineStrong: "",
    headline: info.name ?? "System",
    subhead: [info.design, info.reason ? `status ${LEVEL_LABEL[level]}` : `status ${info.status ?? LEVEL_LABEL[level]}`].filter(Boolean).join(" · "),
    gauge: items.length ? { percent: Math.round((okCount / items.length) * 100), label: `${okCount}/${items.length} items OK` } : null,
    schematic: items.length ? systemSchematic(info.name ?? "System", info.core?.name ?? "", level, items) : null,
    rows: info.reason && !rows.length ? [{ level, tag: LEVEL_LABEL[level], title: info.name ?? "System", detail: info.reason, meta: "System status" }] : rows,
    footnote: tail ? `${FOOT} · ${tail}` : FOOT,
    back: { label: "Back to fleet", name: "get_fleet_health", arguments: {} },
  };
};

export const errorModel = (message: string): CardModel => ({
  kind: "error",
  eyebrow: "Q-SYS Reflect",
  source: null,
  level: "unknown",
  headlineStrong: "",
  headline: "Could not load status",
  subhead: message,
  gauge: null,
  schematic: null,
  rows: [],
  footnote: FOOT,
  back: { label: "Back to fleet", name: "get_fleet_health", arguments: {} },
});

export const cardModel = (data: any): CardModel => {
  if (!data || typeof data !== "object") return errorModel("The tool returned nothing to show.");
  if (data.error) return errorModel(data.summary ?? "The request failed.");
  if (data.view === "fleet") return fleet(data);
  if (data.view === "system") return system(data);
  return errorModel(data.summary ?? "This result has no card view.");
};

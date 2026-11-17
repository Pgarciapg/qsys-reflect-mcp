// diagnose_fleet (2026-11-17): "what is wrong across the fleet, and what do I check first?" diagnose_system answers it
// for one system; this runs that same diagnosis on every system that is not OK and rolls the findings up by kind of
// problem, worst first, with how many systems each is on and the same concrete first check. Per-system rows underneath
// point back to diagnose_system, so the roll-up is a triage view, not a replacement. Read-only. Systems that could not
// be read are counted and named apart, and the answer is never all clear while any system could not be read.
import { diagnose, type Diagnosis } from "./diagnose.ts";
import { systemLevel, type Level } from "./health.ts";
import type { ReflectReader, System } from "./reflect/types.ts";

/** Systems diagnosed in detail per call; the rest are counted and named. */
export const FLEET_DETAIL_LIMIT = 15;
const PARALLEL = 4;
const RANK: Record<Level, number> = { fault: 0, warning: 1, unknown: 2, ok: 3 };

export interface FleetFinding {
  level: Level;
  category: string;
  /** The first check from the first system that has this finding. */
  check: string;
  systems: { id: number; name: string }[];
  /** One example, "<system>: <finding title>". */
  example: string;
}

export interface FleetSystem {
  id: number;
  name: string;
  core: string | null;
  level: Level | "could_not_check";
  findings: number;
  top: string | null;
  couldNotCheck: string[];
}

export interface FleetDiagnosis {
  summary: string;
  view: "fleet-diagnosis";
  windowHours: number;
  total: number;
  ok: number;
  findings: FleetFinding[];
  systems: FleetSystem[];
  /** Not-OK systems past the detail limit: counted and named, not diagnosed. */
  notDiagnosed: { id: number; name: string }[];
  couldNotRead: { id: number | null; name: string; reason: string }[];
  allClear: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const names = (list: { name: string }[], max = 4) => `${list.slice(0, max).map((s) => s.name).join(", ")}${list.length > max ? `, and ${list.length - max} more` : ""}`;

export const diagnoseFleet = async (client: ReflectReader, windowHours: number, now: number, limit = FLEET_DETAIL_LIMIT): Promise<FleetDiagnosis> => {
  let systems: System[];
  try {
    systems = await client.listSystems();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const summary = `Could not read the system list, so the fleet could not be diagnosed: ${reason}. This is not an all-clear.`;
    return { summary, view: "fleet-diagnosis", windowHours, total: 0, ok: 0, findings: [], systems: [], notDiagnosed: [], couldNotRead: [{ id: null, name: "System list", reason }], allClear: false };
  }

  const notOk = systems.filter((s) => systemLevel(s) !== "ok").sort((a, b) => RANK[systemLevel(a)] - RANK[systemLevel(b)] || a.name.localeCompare(b.name));
  const ok = systems.length - notOk.length;
  const chosen = notOk.slice(0, limit);
  const notDiagnosed = notOk.slice(limit).map((s) => ({ id: s.id, name: s.name }));

  const results: { system: System; d: Diagnosis }[] = [];
  for (let i = 0; i < chosen.length; i += PARALLEL) {
    const batch = chosen.slice(i, i + PARALLEL);
    results.push(...(await Promise.all(batch.map(async (system) => ({ system, d: await diagnose(client, system.id, windowHours, now) })))));
  }

  const groups = new Map<string, FleetFinding>();
  const rows: FleetSystem[] = [];
  const couldNotRead: FleetDiagnosis["couldNotRead"] = [];
  for (const { system, d } of results) {
    if (d.system.level === "could_not_check") couldNotRead.push({ id: system.id, name: system.name, reason: d.couldNotCheck[0] ?? "It did not answer." });
    // One count per system and kind of problem, even when a system has several devices with it.
    const seen = new Set<string>();
    for (const f of d.findings) {
      const key = `${f.level}\u0000${f.category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const g = groups.get(key) ?? { level: f.level, category: f.category, check: f.check, systems: [], example: `${system.name}: ${f.title}` };
      g.systems.push({ id: system.id, name: system.name });
      groups.set(key, g);
    }
    rows.push({ id: system.id, name: system.name, core: system.core?.name ?? null, level: d.system.level, findings: d.findings.length, top: d.findings[0]?.title ?? null, couldNotCheck: d.couldNotCheck });
  }
  const findings = [...groups.values()].sort((a, b) => RANK[a.level] - RANK[b.level] || b.systems.length - a.systems.length || a.category.localeCompare(b.category));
  rows.sort((a, b) => (a.level === "could_not_check" ? 2.5 : RANK[a.level]) - (b.level === "could_not_check" ? 2.5 : RANK[b.level]) || a.name.localeCompare(b.name));

  const partly = rows.filter((r) => r.level !== "could_not_check" && r.couldNotCheck.length);
  const allClear = systems.length > 0 && notOk.length === 0;
  const lines: string[] = [];
  if (systems.length === 0) lines.push("The organization has no systems to diagnose. This is not an all-clear: there is nothing to check.");
  else if (allClear) lines.push(`All clear: all ${plural(systems.length, "system")} report OK.`);
  else {
    const counts = (["fault", "warning", "unknown"] as Level[]).map((l) => [l, findings.filter((f) => f.level === l).length] as const).filter(([, n]) => n > 0);
    lines.push(
      `${plural(notOk.length, "system")} of ${systems.length} need attention${findings.length ? `: ${plural(findings.length, "kind")} of problem (${counts.map(([l, n]) => `${n} ${l}`).join(", ")})` : ""}.${couldNotRead.length ? ` ${plural(couldNotRead.length, "system")} could not be read, so this is not an all-clear.` : ""}`,
    );
    if (findings.length) {
      lines.push("", "Across the fleet, worst first:");
      findings.forEach((f, i) => {
        lines.push(`${i + 1}. [${f.level}] ${f.category} (${plural(f.systems.length, "system")}: ${names(f.systems)})`, `   Check: ${f.check}`, `   Example: ${f.example}`);
      });
    }
    lines.push("", "Per system (diagnose_system with its id for the full answer):");
    for (const r of rows) lines.push(`- ${r.name} (id ${r.id}): ${r.level === "could_not_check" ? "could not be read" : `${r.level}, ${plural(r.findings, "finding")}${r.top ? `; first: ${r.top}` : ""}`}${r.level !== "could_not_check" && r.couldNotCheck.length ? `; ${r.couldNotCheck.length} part${r.couldNotCheck.length === 1 ? "" : "s"} could not be read` : ""}`);
    if (notDiagnosed.length) lines.push(`${plural(notDiagnosed.length, "more system")} not diagnosed in this call: ${names(notDiagnosed, 10)}.`);
    lines.push(`${plural(ok, "system")} report OK and were not diagnosed.`);
  }
  if (couldNotRead.length) lines.push("", "Could not read:", ...couldNotRead.map((c) => `- ${c.name}: ${c.reason}`));
  if (partly.length) lines.push("", `Partly read (not an all-clear for these): ${names(partly, 10)}.`);

  return { summary: lines.join("\n"), view: "fleet-diagnosis", windowHours, total: systems.length, ok, findings, systems: rows, notDiagnosed, couldNotRead, allClear };
};

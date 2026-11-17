// diagnose_system (2026-11-17): answers "why is this system unhappy, and what do I check first?" in one call.
// get_fleet_health says WHAT is down; this pulls the system, its items, the core it runs on and that core's recent
// non-Normal events, lines them up, and gives a ranked list of findings with a suggested first check for each.
// Read-only: it only calls existing ReflectReader methods. Anything it could not read is reported as could not
// check, and the answer is never an all-clear while something could not be checked.
import { coreLevel, itemLevel, systemLevel, systemReason, type Level } from "./health.ts";
import type { Core, Event, Item, ReflectReader, System } from "./reflect/types.ts";

export const DEFAULT_WINDOW_HOURS = 24;
const EVENT_PAGE = 500;
const RANK: Record<Level, number> = { fault: 0, warning: 1, unknown: 2, ok: 3 };

export interface Finding {
  level: Level;
  /** What it is about: an item, the core, the design, or an event with no matching item. */
  subject: string;
  title: string;
  detail: string;
  /** Plain-English first thing to check. Rule-based, so phrased as a suggestion. */
  check: string;
  /** Oldest matching non-Normal event in the window, when there is one. */
  since: string | null;
}

export interface TimelineEntry {
  dateTime: string;
  severity: string;
  source: string;
  message: string;
}

export interface Diagnosis {
  summary: string;
  view: "diagnosis";
  system: { id: number; name: string; level: Level | "could_not_check"; core: { id: number; name: string } | null };
  windowHours: number;
  findings: Finding[];
  /** Notable events in the window that no longer match a current problem (trouble that cleared). */
  cleared: TimelineEntry[];
  timeline: TimelineEntry[];
  couldNotCheck: string[];
  allClear: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const notable = (e: Event) => e.severity.toLowerCase() !== "normal";
const levelOfSeverity = (s: string): Level => (/fault|error|critical/i.test(s) ? "fault" : /warn|compromised/i.test(s) ? "warning" : "unknown");

/** Suggested first check, from the status text. Ordered: the most specific rule wins. */
export const firstCheck = (text: string, online: boolean | null | undefined): string => {
  const t = text.toLowerCase();
  if (online === false || /missing|not present|offline|unreachable|no response/.test(t))
    return "The device is not on the network: check its power (or PoE), its network cable and switch port, and that its IP is in the core's subnet.";
  if (/licen[cs]e/.test(t)) return "A license has expired or is not installed: renew it in Q-SYS Designer or Enterprise Manager, then restart the system.";
  if (/short|overcurrent|protect/.test(t)) return "An output went into protection: check the speaker wiring and load on that channel before resetting it.";
  if (/clip/.test(t)) return "An input is clipping: lower the gain at the source or the input stage.";
  if (/firmware|version mismatch|mismatch/.test(t)) return "Firmware does not match the design: update the device from Q-SYS Designer (or Reflect) to the design's version.";
  if (/temperature|thermal|overheat|fan/.test(t)) return "Heat warning: check ventilation and fans around the device.";
  if (/redundan|standby|backup/.test(t)) return "Redundancy is degraded: check the backup core or device is powered, networked and in standby.";
  if (/clock|ptp|sync/.test(t)) return "Clock sync problem: check the PTP master and the network path between devices.";
  return "Open the item in Q-SYS Designer or Reflect and read its full status.";
};

/**
 * Reflect event times look like "2026-09-23 02:00:00" with no zone. They are read as UTC (the demo writes UTC, and the
 * spec gives no zone); Date.parse alone would read them as the machine's local time and shift the window.
 */
export const eventMs = (dateTime: string): number => {
  const iso = dateTime.trim().replace(" ", "T");
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
};

const mentions = (event: Event, item: Item) => event.source === item.name || event.message.includes(item.name);

export const diagnose = async (client: ReflectReader, systemId: number, windowHours = DEFAULT_WINDOW_HOURS, now = Date.now()): Promise<Diagnosis> => {
  const couldNotCheck: string[] = [];
  const attempt = async <T>(what: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      couldNotCheck.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const system: System | null = await attempt("System status", () => client.getSystem(systemId));
  const [items, core, events] = await Promise.all([
    attempt("System items", () => client.listSystemItems(systemId)),
    system ? attempt(`Core ${system.core.name}`, () => client.getCore(system.core.id)) : Promise.resolve(null as Core | null),
    system ? attempt(`Event log for ${system.core.name}`, () => client.getCoreEvents(system.core.id, { pageSize: EVENT_PAGE })) : Promise.resolve(null),
  ]);

  const since = now - windowHours * 3_600_000;
  const inWindow = (events?.events ?? []).filter((e) => eventMs(e.dateTime) >= since && eventMs(e.dateTime) <= now);
  const recent = inWindow.filter(notable).sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  const findings: Finding[] = [];
  const used = new Set<number>();

  // 1. The core itself: everything on the system depends on it.
  // A core whose status details are only a tally of its items ("2 Fault, 1 Compromised, 8 OK") is reporting those items,
  // not a problem of its own: the items below cover it, so it is not raised as a separate, first finding.
  const tallyOnly = (details: string) => /^\s*(\d+\s+[A-Za-z ]+?)(,\s*\d+\s+[A-Za-z ]+?)*\.?\s*$/.test(details);
  if (core && coreLevel(core) !== "ok" && !(tallyOnly(core.status.details ?? "") && (items ?? []).some((i) => itemLevel(i) !== "ok"))) {
    const text = `${core.status.message}${core.status.details ? `: ${core.status.details}` : ""}`;
    findings.push({ level: coreLevel(core), subject: `Core ${core.name}`, title: `The core reports ${core.status.message}`, detail: `${core.name} (${core.model}, firmware ${core.firmware}): ${text}.`, check: `Check the core first; every item on this system runs through it. ${firstCheck(text, null)}`, since: null });
  }
  if (core?.redundancy && !/active|standby/i.test(core.redundancy.state)) {
    findings.push({ level: "warning", subject: `Core ${core.name}`, title: `Core redundancy is ${core.redundancy.state}`, detail: `Role ${core.redundancy.role}, state ${core.redundancy.state}.`, check: firstCheck("redundancy", null), since: null });
  }

  // 2. A design-level reason (for example an expired license) stops the whole system.
  const reason = system ? systemReason(system) : null;
  if (reason) {
    const match = recent.find((e) => reason.includes(e.message.replace(/\.$/, "")) || e.message.includes(reason.split(".")[0]!));
    if (match) used.add(match.id);
    findings.push({ level: "fault", subject: "Design", title: "The system is stopped by its design", detail: reason, check: firstCheck(reason, null), since: match?.dateTime ?? null });
  }

  // 3. Each item that is not OK, with the first event that mentions it.
  for (const item of items ?? []) {
    const level = itemLevel(item);
    if (level === "ok") continue;
    const status = item.status ? `${item.status.message}${item.status.details ? `: ${item.status.details}` : ""}` : "No status";
    const first = recent.find((e) => mentions(e, item));
    for (const e of recent) if (mentions(e, item)) used.add(e.id);
    findings.push({
      level,
      subject: item.name,
      title: `${item.name} (${item.model || item.type}) reports ${item.status?.message ?? "no status"}`,
      detail: `${status}${item.location ? `. Location: ${item.location}` : ""}${item.isOnline === false ? ". Offline" : ""}.`,
      check: firstCheck(status, item.isOnline),
      since: first?.dateTime ?? null,
    });
  }

  // 4. Notable events that match nothing current: either an unmatched live problem or trouble that cleared.
  const unmatched = recent.filter((e) => !used.has(e.id));
  const cleared: TimelineEntry[] = [];
  for (const e of unmatched) {
    const isItem = (items ?? []).some((i) => i.name === e.source);
    if (isItem) cleared.push({ dateTime: e.dateTime, severity: e.severity, source: e.source, message: e.message });
    else findings.push({ level: levelOfSeverity(e.severity), subject: e.source, title: `${e.category} event: ${e.message}`, detail: `${e.severity} from ${e.source} at ${e.dateTime}.`, check: firstCheck(e.message, null), since: e.dateTime });
  }

  findings.sort((a, b) => RANK[a.level] - RANK[b.level] || (a.since ?? "~").localeCompare(b.since ?? "~") || a.subject.localeCompare(b.subject));
  const timeline = recent.map((e) => ({ dateTime: e.dateTime, severity: e.severity, source: e.source, message: e.message }));
  const level = system ? systemLevel(system) : "could_not_check";
  const name = system?.name ?? `System ${systemId}`;
  const allClear = couldNotCheck.length === 0 && findings.length === 0;

  const counts = (["fault", "warning", "unknown"] as Level[]).map((l) => [l, findings.filter((f) => f.level === l).length] as const).filter(([, n]) => n > 0);
  let summary: string;
  if (!system) summary = `Could not check ${name}: ${couldNotCheck[0] ?? "it did not answer"}.`;
  else if (allClear)
    summary = `${name} on ${system.core.name}: all clear. ${plural(items?.length ?? 0, "item")} report OK and the core logged no warnings or faults in the last ${windowHours} h${cleared.length ? `, apart from ${plural(cleared.length, "event")} that has since cleared` : ""}.`;
  else if (findings.length === 0) summary = `${name} on ${system.core.name}: no problems found in what could be read, but not everything could be checked (${couldNotCheck.join("; ")}). This is not an all-clear.`;
  else {
    const top = findings[0]!;
    summary = `${name} on ${system.core.name}: ${counts.map(([l, n]) => `${n} ${l === "unknown" ? "unknown" : l}`).join(", ")}. Start with ${top.subject}: ${top.check}${couldNotCheck.length ? ` Not everything could be checked (${couldNotCheck.length}).` : ""}`;
  }

  return {
    summary,
    view: "diagnosis",
    system: { id: systemId, name, level, core: system ? { ...system.core } : null },
    windowHours,
    findings,
    cleared,
    timeline,
    couldNotCheck,
    allClear,
  };
};

/** Plain-text body for hosts that only read content. */
export const diagnosisText = (d: Diagnosis): string => {
  const lines = [d.summary];
  if (d.findings.length) {
    lines.push("", "Findings, worst first:");
    d.findings.forEach((f, i) => {
      lines.push(`${i + 1}. [${f.level}] ${f.title}${f.since ? ` (first logged ${f.since})` : ""}`, `   ${f.detail}`, `   Check: ${f.check}`);
    });
  }
  if (d.timeline.length) lines.push("", `Core events in the last ${d.windowHours} h that were not Normal (oldest first):`, ...d.timeline.map((t) => `- ${t.dateTime} ${t.severity} ${t.source}: ${t.message}`));
  if (d.cleared.length) lines.push("", "Cleared since (logged, but the item is OK now):", ...d.cleared.map((t) => `- ${t.dateTime} ${t.source}: ${t.message}`));
  if (d.couldNotCheck.length) lines.push("", "Could not check:", ...d.couldNotCheck.map((c) => `- ${c}`));
  return lines.join("\n");
};


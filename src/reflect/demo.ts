import { ReflectApiError } from "./client.ts";
import type {
  AuditEvent,
  Core,
  CoreStatus,
  Event,
  Item,
  Media,
  MediaPlaylist,
  PageQuery,
  ReflectReader,
  Softphone,
  System,
  SystemItemsStatusDetails,
} from "./types.ts";

// A fictional campus built from the spec's shapes so the server runs without a key.
// Nothing here came from a real Reflect organization.

const ORG = { id: 9001, name: "Northgate Campus (demo)" };

const SITES = {
  pac: { id: 11, name: "Performing Arts Center" },
  arena: { id: 12, name: "Athletics Arena" },
  library: { id: 13, name: "Library & Learning Commons" },
  business: { id: 14, name: "School of Business" },
  media: { id: 15, name: "Media Production Lab" },
} as const;

type SiteKey = keyof typeof SITES;

const STATUS: Record<number, string> = { 0: "OK", 1: "Compromised", 2: "Fault", 3: "Not Present", 4: "Missing", 5: "Initializing" };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface CoreSeed {
  id: number;
  name: string;
  model: string;
  modelNumber: string;
  firmware: string;
  site: SiteKey;
  bootedDaysAgo: number;
  redundancy?: { role: string; state: string };
  status?: CoreStatus;
}

const CORE_SEEDS: CoreSeed[] = [
  { id: 101, name: "PAC-Core-A", model: "Core 610", modelNumber: "610", firmware: "10.0.1", site: "pac", bootedDaysAgo: 41, redundancy: { role: "Primary", state: "Active" } },
  { id: 102, name: "PAC-Core-B", model: "Core 610", modelNumber: "610", firmware: "10.0.1", site: "pac", bootedDaysAgo: 41, redundancy: { role: "Backup", state: "Standby" } },
  { id: 103, name: "Arena-Core", model: "Core 8 Flex", modelNumber: "8 Flex", firmware: "9.13.0", site: "arena", bootedDaysAgo: 3, status: { code: 2, message: "Fault", details: "2 Fault, 1 Compromised, 8 OK" } },
  { id: 104, name: "Library-Core", model: "Core Nano", modelNumber: "Nano", firmware: "10.0.1", site: "library", bootedDaysAgo: 88, status: { code: 1, message: "Compromised", details: "1 Compromised, 5 OK" } },
  { id: 105, name: "Business-Core", model: "Core 110f", modelNumber: "110f", firmware: "10.0.1", site: "business", bootedDaysAgo: 120 },
  { id: 106, name: "MediaLab-Core", model: "Core 510i", modelNumber: "510i", firmware: "9.12.1", site: "media", bootedDaysAgo: 14 },
];

type ItemSeed = [type: string, model: string, name: string, location: string, code?: number, detail?: string];

interface SystemSeed {
  id: number;
  name: string;
  design: string;
  core: number;
  items: ItemSeed[];
  reason?: string;
}

const amp = (name: string, location: string, code = 0, detail?: string): ItemSeed => ["Amplifier", "CXD4.3Q", name, location, code, detail];
const cam = (name: string, location: string, code = 0, detail?: string): ItemSeed => ["Camera", "NC-12x80", name, location, code, detail];
const tsc = (name: string, location: string, code = 0, detail?: string): ItemSeed => ["Touch Screen Controller", "TSC-70-G3", name, location, code, detail];
const io = (name: string, location: string, code = 0, detail?: string): ItemSeed => ["I/O Frame", "QIO-ML4i", name, location, code, detail];
const video = (name: string, location: string, code = 0, detail?: string): ItemSeed => ["Video Endpoint", "NV-32-H", name, location, code, detail];
const mic = (name: string, location: string, code = 0, detail?: string): ItemSeed => ["Peripheral", "Ceiling Mic", name, location, code, detail];

const SYSTEM_SEEDS: SystemSeed[] = [
  {
    id: 201,
    name: "PAC Main Stage",
    design: "pac-main-stage-v14",
    core: 101,
    items: [
      amp("Mains L", "Stage"), amp("Mains R", "Stage"), amp("Subs", "Stage"), amp("Delays", "Balcony"),
      io("FOH I/O", "Front of House"), io("Stage Box A", "Stage"), io("Stage Box B", "Stage"),
      tsc("Stage Manager Panel", "Wings"), tsc("FOH Panel", "Front of House"),
      video("Program Feed", "Control Room"), cam("House Cam", "Balcony"),
    ],
  },
  {
    id: 202,
    name: "Arena Bowl Audio",
    design: "arena-bowl-2026",
    core: 103,
    items: [
      amp("Bowl Zone 1", "North Bowl"), amp("Bowl Zone 2", "East Bowl"), amp("Bowl Zone 3", "South Bowl", 2, "Output 3 short circuit protection"),
      amp("Bowl Zone 4", "West Bowl"), amp("Concourse", "Concourse"),
      io("Announcer I/O", "Press Box"), io("Scoreboard Tie-In", "Video Control", 4, "Device missing from network"),
      tsc("Announcer Panel", "Press Box", 1, "Firmware mismatch"), tsc("Ops Panel", "Video Control"),
      cam("Press Box Cam", "Press Box"), video("Scoreboard Feed", "Video Control"),
    ],
  },
  {
    id: 203,
    name: "Library Commons Paging",
    design: "library-paging-v3",
    core: 104,
    items: [
      amp("Floor 1 Paging", "Floor 1"), amp("Floor 2 Paging", "Floor 2"), amp("Floor 3 Paging", "Floor 3"),
      mic("Help Desk Mic", "Floor 1", 1, "Clipping on input"), tsc("Circulation Panel", "Floor 1"),
      io("Emergency Paging I/O", "IDF 1"),
    ],
  },
  {
    id: 204,
    name: "Business School Divisible Rooms",
    design: "bus-divisible-110-112",
    core: 105,
    items: [
      mic("Room 110 Mic A", "Room 110"), mic("Room 110 Mic B", "Room 110"), mic("Room 112 Mic A", "Room 112"),
      cam("Room 110 Cam", "Room 110"), cam("Room 112 Cam", "Room 112"),
      tsc("Room 110 Panel", "Room 110"), tsc("Room 112 Panel", "Room 112"),
      video("Room 110 Display", "Room 110"), video("Room 112 Display", "Room 112"),
      ["Streaming I/O", "Softphone", "Softphone-1", "Room 110"],
    ],
  },
  {
    id: 205,
    name: "Media Lab Playback",
    design: "media-lab-playback",
    core: 106,
    reason: "Software license 'Multi-Track Player - 32' has expired. Please install a license and restart the system.",
    items: [
      amp("Monitor Wall", "Studio A"), io("Studio I/O", "Studio A"), tsc("Studio Panel", "Studio A"), video("Program Out", "Studio A"),
    ],
  },
];

const pad = (value: number) => String(value).padStart(2, "0");

/** The spec's event format: 'YYYY-MM-DD HH:mm:ss' with no zone. The demo writes UTC. */
const eventTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

const serialFor = (prefix: string, id: number) =>
  `3-${prefix}${id.toString(16).toUpperCase().padStart(6, "0")}${"A1B2C3D4E5F60718293A4B5C".slice(0, 32 - prefix.length - 6)}`;

export interface DemoData {
  cores: Core[];
  systems: System[];
  items: Map<number, Item[]>;
  events: Map<number, Event[]>;
  audit: AuditEvent[];
  media: Map<number, Media[]>;
  playlists: Map<number, MediaPlaylist[]>;
  softphones: Map<number, Softphone[]>;
}

export const buildDemoData = (now: number = Date.now()): DemoData => {
  const cores: Core[] = CORE_SEEDS.map((seed) => ({
    id: seed.id,
    serial: serialFor("C0", seed.id),
    name: seed.name,
    model: seed.model,
    modelNumber: seed.modelNumber,
    firmware: seed.firmware,
    accessMode: "open",
    accessLevel: 200,
    uptime: now - seed.bootedDaysAgo * DAY,
    status: seed.status ?? { code: 0, message: "OK", details: "OK" },
    redundancy: seed.redundancy ?? null,
    serialNumber: `DEMO-${seed.id}`,
    rmsVersion: null,
    isRmMode: false,
    site: SITES[seed.site],
  }));
  const coreById = new Map(cores.map((core) => [core.id, core]));

  const items = new Map<number, Item[]>();
  const systems: System[] = SYSTEM_SEEDS.map((seed) => {
    const core = coreById.get(seed.core)!;
    const counts: SystemItemsStatusDetails = { normal: 0, warning: 0, fault: 0, unknown: 0 };
    const systemItems: Item[] = seed.items.map(([type, model, name, location, code = 0, detail], index) => {
      if (code === 0) counts.normal += 1;
      else if (code === 1 || code === 5) counts.warning += 1;
      else if (code >= 2 && code <= 4) counts.fault += 1;
      else counts.unknown += 1;
      const id = seed.id * 100 + index + 1;
      const octet = 20 + index;
      return {
        id,
        name,
        type,
        model,
        manufacturer: "QSC",
        location,
        exempt: false,
        design: { id: seed.id, name: seed.design },
        system: null,
        core: { id: core.id, name: core.name, serial: core.serial, redundancy: core.redundancy },
        site: core.site,
        organization: ORG,
        isOnline: code !== 3 && code !== 4,
        pairing: { accessLevel: 100, created: now - 400 * DAY },
        startedAt: code === 4 ? null : now - ((index % 5) + 1) * DAY,
        serialNumber: `DEMO-${id}`,
        redundancy: { isRedundant: false, primaryActive: true, backupActive: false },
        status: { code, message: STATUS[code] ?? "Unknown", details: detail ?? STATUS[code] ?? "Unknown" },
        networkConfig: {
          interfaces: [{
            id: "LAN A",
            name: "LAN A",
            mode: "auto",
            ipAddress: `10.${seed.id % 256}.10.${octet}`,
            netMask: "255.255.255.0",
            gateway: `10.${seed.id % 256}.10.1`,
            macAddress: `00:60:74:${pad(seed.id % 100)}:${pad(index)}:${pad(octet)}`,
            chassis: "00:1b:54:aa:10:01",
            port: `gi1/0/${index + 1}`,
            linkSpeed: code === 4 ? "0" : "1000",
            staticRoutes: [],
            hasLink: code !== 4,
          }],
          dnsServers: ["10.0.0.53"],
          dnsSearchDomains: ["av.northgate.example"],
          autoDns: null,
        },
        timezone: "America/Chicago",
        ntp: { enabled: "yes", servers: ["0.north-america.pool.ntp.org"] },
        auth8021x: [{ rawName: "eth0", name: "LAN A", is8021xEnabled: false }],
      };
    });
    const status = seed.reason
      ? { code: 2, message: "Fault", details: { reason: seed.reason } }
      : { code: counts.fault ? 2 : counts.warning ? 1 : 0, message: counts.fault ? "Fault" : counts.warning ? "Compromised" : "OK", details: { items: counts } };
    const system: System = {
      id: seed.id,
      code: serialFor("5", seed.id),
      name: seed.name,
      design: {
        id: seed.id,
        code: `dsg${seed.id}`,
        name: seed.design,
        platform: core.model,
        isRedundant: core.redundancy ? 1 : 0,
        isEmulated: 0,
        uptime: core.uptime,
      },
      status,
      core: { id: core.id, name: core.name },
    };
    const nested = { id: system.id, name: system.name, status: { code: status.code, name: status.message, message: "Running", details: { items: counts } } };
    items.set(seed.id, systemItems.map((item) => ({ ...item, system: nested })));
    return system;
  });

  const events = new Map<number, Event[]>();
  let eventId = 50_000;
  for (const core of cores) {
    const list: Event[] = [];
    const push = (hoursAgo: number, severity: string, status: string, category: string, source: string, message: string) => {
      list.push({ id: eventId++, dateTime: eventTime(now - hoursAgo * HOUR), severity, status, category, source, message, filename: "events.log", core: { id: core.id, name: core.name } });
    };
    const system = systems.find((candidate) => candidate.core.id === core.id);
    const systemItems = system ? items.get(system.id) ?? [] : [];
    for (const [index, item] of systemItems.entries()) {
      if (!item.status || item.status.code === 0) continue;
      const severity = item.status.code === 1 ? "Warning" : "Fault";
      push(1 + index * 2, severity, item.status.message, "Status", item.name, `${item.name}: ${item.status.details}`);
    }
    if (core.id === 106) push(6, "Fault", "Fault", "License", "Design", "Software license 'Multi-Track Player - 32' has expired.");
    push(20, "Normal", "OK", "Design", "Q-SYS Designer", `Design '${system?.design.name ?? "untitled"}' started`);
    push(26, "Normal", "OK", "User", "Reflect User", "Core registration with Q-SYS Reflect has been completed successfully");
    push(30 + (core.id % 12), "Normal", "OK", "System", core.name, `Firmware ${core.firmware} running`);
    for (let day = 2; day <= 9; day += 1) push(day * 24 + (core.id % 7), "Normal", "OK", "System", core.name, "Scheduled health check passed");
    list.sort((a, b) => b.dateTime.localeCompare(a.dateTime));
    events.set(core.id, list);
  }

  const audit: AuditEvent[] = [
    ["admin has signed in", "School of Business", null, "admin", "ops-admin@northgate.example", 2],
    ["av.tech has signed in", "Athletics Arena", "Arena Bowl Audio", "av.tech", "av-tech@northgate.example", 5],
    ["av.tech has signed in", "Performing Arts Center", "PAC Main Stage", "av.tech", "av-tech@northgate.example", 30],
    ["student.worker has signed in", "Library & Learning Commons", null, "student.worker", "student-worker@northgate.example", 52],
  ].map(([message, siteName, systemName, userName, userEmail, hoursAgo], index) => ({
    id: 70_000 + index,
    dateTime: new Date(now - (hoursAgo as number) * HOUR).toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    message: message as string,
    organizationName: ORG.name,
    siteName: siteName as string | null,
    systemName: systemName as string | null,
    userEmail: userEmail as string,
    userName: userName as string,
    userSystemRole: systemName ? "Operator" : null,
    userSiteRole: "Technician",
    userOrganizationRole: userName === "admin" ? "Administrator" : "Member",
  }));

  const media = new Map<number, Media[]>([
    [101, [
      { id: "Audio", path: "/Audio", name: "Audio", ext: null, type: "folder", size: null, created: now - 300 * DAY, updated: now - 2 * DAY, readOnly: false },
      { id: "Audio/Preshow Loop.wav", path: "/Audio/Preshow Loop.wav", name: "Preshow Loop", ext: "wav", type: "file", size: 52_428_800, created: now - 90 * DAY, updated: now - 2 * DAY, readOnly: false },
      { id: "Audio/Intermission Chime.wav", path: "/Audio/Intermission Chime.wav", name: "Intermission Chime", ext: "wav", type: "file", size: 1_048_576, created: now - 200 * DAY, updated: now - 200 * DAY, readOnly: false },
      { id: "Audio/Evacuation Message.wav", path: "/Audio/Evacuation Message.wav", name: "Evacuation Message", ext: "wav", type: "file", size: 3_145_728, created: now - 300 * DAY, updated: now - 300 * DAY, readOnly: true },
    ]],
  ]);

  const playlists = new Map<number, MediaPlaylist[]>([
    [101, [
      { id: "6f3c1a52-2c1e-4b8a-9d51-0f5a7b3e8c01", count: 4, name: "Preshow" },
      { id: "0835b3f6-c9ed-4e32-9fcd-70b7b42d7be0", count: 2, name: "Intermission" },
    ]],
  ]);

  const softphones = new Map<number, Softphone[]>([
    [204, [
      { guid: "demo-softphone-110", name: "Room 110 Softphone", userName: "rm110", cidName: "Business 110", proxy: "sip.northgate.example", backupProxy: null, transport: "TLS", isAuthWithProxy: true, proxyAuthId: "rm110", proxyPassword: "demo-password-not-real", domain: "northgate.example", regTimeout: 3600 },
      { guid: "demo-softphone-112", name: "Room 112 Softphone", userName: "rm112", cidName: "Business 112", proxy: "sip.northgate.example", backupProxy: null, transport: "TLS", isAuthWithProxy: false, domain: "northgate.example" },
    ]],
  ]);

  return { cores, systems, items, events, audit, media, playlists, softphones };
};

const notFound = (path: string) => new ReflectApiError(404, path, "Not Found");

const inRange = (dateTime: string, dates?: string) => {
  if (!dates) return true;
  const [start, end] = dates.split(",").map((part) => part.trim());
  const day = dateTime.slice(0, 10);
  return (!start || day >= start) && (!end || day <= end);
};

const paginate = <T>(list: T[], query?: PageQuery) => {
  const page = Math.max(1, query?.page ?? 1);
  const pageSize = Math.max(1, query?.pageSize ?? 100);
  return list.slice((page - 1) * pageSize, page * pageSize);
};

/** An in-memory ReflectReader that answers like the live API, including 404s. */
export class DemoReflectClient implements ReflectReader {
  readonly data: DemoData;

  constructor(now?: number) {
    this.data = buildDemoData(now);
  }

  async listCores() {
    return structuredClone(this.data.cores);
  }

  async getCore(coreId: number) {
    const core = this.data.cores.find((candidate) => candidate.id === coreId);
    if (!core) throw notFound(`/cores/${coreId}`);
    return structuredClone(core);
  }

  async getCoreEvents(coreId: number, query?: PageQuery) {
    await this.getCore(coreId);
    const matching = (this.data.events.get(coreId) ?? []).filter((event) => inRange(event.dateTime, query?.dates));
    return { events: structuredClone(paginate(matching, query)), total: matching.length };
  }

  async getCoreMedia(coreId: number, mediaPath: string) {
    await this.getCore(coreId);
    const all = this.data.media.get(coreId) ?? [];
    const path = `/${mediaPath.split("/").filter(Boolean).join("/")}`;
    const exact = all.find((media) => media.path === path);
    if (exact?.type === "file") return structuredClone(exact);
    if (path !== "/" && !exact) throw notFound(`/cores/${coreId}/media${path}`);
    const prefix = path === "/" ? "/" : `${path}/`;
    return structuredClone(all.filter((media) => media.path.startsWith(prefix) && !media.path.slice(prefix.length).includes("/")));
  }

  async listMediaPlaylists(coreId: number) {
    await this.getCore(coreId);
    return structuredClone(this.data.playlists.get(coreId) ?? []);
  }

  async getMediaPlaylist(coreId: number, playlistId: string) {
    const playlist = (await this.listMediaPlaylists(coreId)).find((candidate) => candidate.id === playlistId);
    if (!playlist) throw notFound(`/cores/${coreId}/media_playlists/${playlistId}`);
    return playlist;
  }

  async listSystems() {
    return structuredClone(this.data.systems);
  }

  async getSystem(systemId: number) {
    const system = this.data.systems.find((candidate) => candidate.id === systemId);
    if (!system) throw notFound(`/systems/${systemId}`);
    return structuredClone(system);
  }

  async listSystemItems(systemId: number) {
    await this.getSystem(systemId);
    return structuredClone(this.data.items.get(systemId) ?? []);
  }

  async getSystemItem(systemId: number, itemId: number) {
    const item = (await this.listSystemItems(systemId)).find((candidate) => candidate.id === itemId);
    if (!item) throw notFound(`/systems/${systemId}/items/${itemId}`);
    return item;
  }

  async listSoftphones(systemId: number) {
    await this.getSystem(systemId);
    return structuredClone(this.data.softphones.get(systemId) ?? []);
  }

  async getAuditEvents(query?: PageQuery) {
    const matching = this.data.audit.filter((event) => inRange(event.dateTime, query?.dates));
    return { items: structuredClone(paginate(matching, query)), total: matching.length };
  }
}

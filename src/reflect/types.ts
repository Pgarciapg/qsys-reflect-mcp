// Types for the QREM Public API v0.1.1, transcribed from QSC's published spec:
// https://reflect.qsc.com/static/qrem-public-api.yaml
// Field names and nullability follow the spec exactly. Where the spec is silent
// about meaning (for example what `uptime` measures), the comment says so.

export interface SiteProperty {
  id: number;
  name: string;
}

export interface CoreProperty {
  id: number;
  name: string;
}

/** Status block shared by cores and items. `code` 0 is OK; see health.ts for the mapping. */
export interface CoreStatus {
  code: number;
  message: string;
  details: string;
}

export interface CoreRedundancy {
  role: string;
  state: string;
}

export interface Core {
  id: number;
  serial: string;
  name: string;
  model: string;
  modelNumber: string;
  firmware: string;
  accessMode: string;
  accessLevel: number;
  /** Epoch milliseconds per the spec example (1557911728481). The spec does not say whether this is boot time. */
  uptime: number;
  status: CoreStatus;
  redundancy: CoreRedundancy | null;
  serialNumber?: string | null;
  rmsVersion?: string | null;
  isRmMode?: boolean | null;
  site: SiteProperty;
}

export interface Design {
  id: number;
  code: string;
  name: string;
  platform: string;
  isRedundant: 0 | 1;
  isEmulated: 0 | 1;
  uptime: number;
}

export interface SystemItemsStatusDetails {
  normal: number;
  fault: number;
  warning: number;
  unknown: number;
}

export interface SystemStatus {
  code: number;
  message: string;
  details: { items: SystemItemsStatusDetails } | { reason: string } | null;
}

export interface System {
  id: number;
  code: string;
  name: string;
  design: Design;
  status: SystemStatus;
  core: CoreProperty;
}

export interface NetworkInterface {
  id: string;
  name: string;
  mode: string;
  ipAddress: string;
  netMask: string;
  gateway: string;
  macAddress: string;
  chassis: string;
  port: string;
  linkSpeed: string;
  staticRoutes: string[];
  hasLink: boolean;
}

export interface ItemRedundancy {
  isRedundant: boolean;
  primaryActive: boolean;
  backupActive: boolean;
}

export interface Item {
  id: number;
  name: string;
  type: string;
  model: string;
  manufacturer: string;
  location: string;
  exempt: boolean | null;
  design: { id: number; name: string } | null;
  system: {
    id: number;
    name: string;
    status: { code: number; name: string; message: string; details: { items: SystemItemsStatusDetails } };
  } | null;
  core: { id: number; name: string; serial: string; redundancy?: CoreRedundancy | null } | null;
  site: SiteProperty | null;
  organization: { id: number; name: string } | null;
  isOnline?: boolean | null;
  pairing: { accessLevel: number; created: number } | null;
  startedAt: number | null;
  serialNumber: string | null;
  redundancy: ItemRedundancy;
  status: { code: number; message: string; details?: string } | null;
  networkConfig?: {
    interfaces: NetworkInterface[];
    dnsServers: string[];
    dnsSearchDomains: string[];
    autoDns?: { dnsServers: string[]; dnsSearchDomains: string[] } | null;
  } | null;
  timezone?: string | null;
  ntp?: { enabled: string; servers: string[] } | null;
  auth8021x?: { rawName: string; name: string; is8021xEnabled: boolean }[] | null;
}

export interface Event {
  id: number;
  /** Spec example: '2019-07-22 12:59:31' (no zone given). */
  dateTime: string;
  severity: string;
  status: string;
  category: string;
  source: string;
  message: string;
  filename: string | null;
  core: CoreProperty;
}

export interface EventPage {
  events: Event[];
  total: number;
}

export interface AuditEvent {
  id: number;
  dateTime: string;
  message: string;
  organizationName: string;
  siteName: string | null;
  systemName: string | null;
  userEmail: string | null;
  userName: string | null;
  userSystemRole: string | null;
  userSiteRole: string | null;
  userOrganizationRole: string | null;
}

export interface AuditEventPage {
  items: AuditEvent[];
  total: number;
}

export interface Media {
  id?: string;
  path: string;
  name: string;
  ext?: string | null;
  type: "folder" | "file";
  size?: number | null;
  created: number;
  updated: number;
  readOnly?: boolean;
}

export interface MediaPlaylist {
  id: string;
  count: number;
  name: string;
}

export interface Softphone {
  guid: string;
  name: string;
  userName: string;
  cidName?: string | null;
  proxy?: string | null;
  backupProxy?: string | null;
  transport: "UDP" | "TCP" | "TLS";
  isAuthWithProxy: boolean;
  domain?: string | null;
  proxyAuthId?: string;
  proxyPassword?: string | null;
  regTimeout?: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  /** Comma-separated start and end dates, e.g. "2025-07-16,2025-07-21". */
  dates?: string;
}

/** Every read operation in the spec. The one write (PUT softphones) is deliberately absent. */
export interface ReflectReader {
  listCores(): Promise<Core[]>;
  getCore(coreId: number): Promise<Core>;
  getCoreEvents(coreId: number, query?: PageQuery): Promise<EventPage>;
  getCoreMedia(coreId: number, mediaPath: string): Promise<Media | Media[]>;
  listMediaPlaylists(coreId: number): Promise<MediaPlaylist[]>;
  getMediaPlaylist(coreId: number, playlistId: string): Promise<MediaPlaylist>;
  listSystems(): Promise<System[]>;
  getSystem(systemId: number): Promise<System>;
  listSystemItems(systemId: number): Promise<Item[]>;
  getSystemItem(systemId: number, itemId: number): Promise<Item>;
  listSoftphones(systemId: number): Promise<Softphone[]>;
  getAuditEvents(query?: PageQuery): Promise<AuditEventPage>;
}

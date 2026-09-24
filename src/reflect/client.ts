import type {
  AuditEventPage,
  Core,
  EventPage,
  Item,
  Media,
  MediaPlaylist,
  PageQuery,
  ReflectReader,
  Softphone,
  System,
} from "./types.ts";

export const DEFAULT_BASE_URL = "https://reflect.qsc.com/api/public/v0";

/** A non-2xx answer from Reflect. The token never appears in `message`. */
export class ReflectApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, detail: string) {
    super(`Reflect API ${status} on ${path}${detail ? `: ${detail}` : ""}`);
    this.name = "ReflectApiError";
    this.status = status;
    this.path = path;
  }
}

export interface HttpClientOptions {
  token: string;
  baseUrl?: string;
  /** Per-request timeout. Reflect does not document one; 15 s is a guess that keeps tools responsive. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const pageQuery = (query?: PageQuery): string => {
  if (!query) return "";
  const params = new URLSearchParams();
  if (query.page != null) params.set("page", String(query.page));
  if (query.pageSize != null) params.set("pageSize", String(query.pageSize));
  if (query.dates) params.set("dates", query.dates);
  const text = params.toString();
  return text ? `?${text}` : "";
};

/** True when a media path stays under Media Root: no `.`/`..` segments (plain or percent-encoded) and no backslashes. */
export const isSafeMediaPath = (mediaPath: string): boolean => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(mediaPath);
  } catch {
    return false;
  }
  if (decoded.includes("\\")) return false;
  return decoded.split("/").every((segment) => segment !== "." && segment !== "..");
};

// The spec's mediaPath is a directory path, so keep the slashes and encode each segment.
// Refusing dot segments keeps a crafted path from resolving to another endpoint with the token attached.
const mediaSegments = (mediaPath: string): string => {
  if (!isSafeMediaPath(mediaPath)) throw new Error("Media path must stay under Media Root.");
  return mediaPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
};

// Only a JSON `message` is passed on; raw bodies (HTML error pages, stack traces) never reach the model.
const shortDetail = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body.message === "string") return body.message.slice(0, 200);
  } catch {
    // Not JSON.
  }
  return "";
};

export class HttpReflectClient implements ReflectReader {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: HttpClientOptions) {
    if (!options.token) throw new Error("A Reflect API token is required. Set QSYS_REFLECT_API_TOKEN or run with --demo.");
    this.#token = options.token;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#fetch = options.fetch ?? fetch;
  }

  async #get<T>(path: string): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.#token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) throw new ReflectApiError(response.status, path, await shortDetail(response));
    return (await response.json()) as T;
  }

  listCores() {
    return this.#get<Core[]>("/cores");
  }

  getCore(coreId: number) {
    return this.#get<Core>(`/cores/${coreId}`);
  }

  getCoreEvents(coreId: number, query?: PageQuery) {
    return this.#get<EventPage>(`/cores/${coreId}/events${pageQuery(query)}`);
  }

  async getCoreMedia(coreId: number, mediaPath: string) {
    return this.#get<Media | Media[]>(`/cores/${coreId}/media/${mediaSegments(mediaPath)}`);
  }

  listMediaPlaylists(coreId: number) {
    return this.#get<MediaPlaylist[]>(`/cores/${coreId}/media_playlists`);
  }

  getMediaPlaylist(coreId: number, playlistId: string) {
    return this.#get<MediaPlaylist>(`/cores/${coreId}/media_playlists/${encodeURIComponent(playlistId)}`);
  }

  listSystems() {
    return this.#get<System[]>("/systems");
  }

  getSystem(systemId: number) {
    return this.#get<System>(`/systems/${systemId}`);
  }

  listSystemItems(systemId: number) {
    return this.#get<Item[]>(`/systems/${systemId}/items`);
  }

  getSystemItem(systemId: number, itemId: number) {
    return this.#get<Item>(`/systems/${systemId}/items/${itemId}`);
  }

  listSoftphones(systemId: number) {
    return this.#get<Softphone[]>(`/systems/${systemId}/telephony/softphones`);
  }

  getAuditEvents(query?: PageQuery) {
    return this.#get<AuditEventPage>(`/users/audit-events${pageQuery(query)}`);
  }
}

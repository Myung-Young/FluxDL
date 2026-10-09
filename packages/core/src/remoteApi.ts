import type { DownloadJob } from "./types.js";
import { normalizeUrl } from "./url.js";

/**
 * Loopback Remote API protocol (Phase 6A, pure).
 *
 * The HTTP server itself lives main-side (`apps/desktop/src/main/localApi.ts`,
 * `node:http`, no new dependency). Everything here is transport-free so it
 * is unit-testable in core: auth parsing, Host/Origin gates (DNS-rebinding
 * defense), request validation, rate limiting, audit redaction, pairing
 * links, and the queue-view sanitizer that keeps filesystem paths out of
 * every API response.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default loopback port (uncommon, avoids dev-tool collisions). */
export const REMOTE_API_DEFAULT_PORT = 48127;
/** Unprivileged ports only — never 80/443, never privileged. */
export const REMOTE_API_MIN_PORT = 1024;
export const REMOTE_API_MAX_PORT = 65535;
/** Largest accepted request body (add payloads are tiny URL lists). */
export const REMOTE_API_MAX_BODY_BYTES = 32 * 1024;
/** Cap on URLs per add call (matches the batch-panel spirit, not the disk). */
export const REMOTE_API_MAX_URLS = 50;
/** Per-URL length cap (same trust boundary as the IPC validator). */
export const REMOTE_API_MAX_URL_CHARS = 2048;
/** Rate limit: requests per IP per window (brute-force backstop). */
export const REMOTE_API_RATE_LIMIT = 120;
export const REMOTE_API_RATE_WINDOW_MS = 60_000;
/** Redacted audit ring capacity. */
export const REMOTE_API_AUDIT_CAP = 100;

/** Job control actions the API (and the renderer drain) understand. */
export type RemoteJobAction = "pause" | "resume" | "cancel";

export const REMOTE_JOB_ACTIONS: readonly RemoteJobAction[] = ["pause", "resume", "cancel"];

/**
 * Mutations the API server queues for the renderer drain. The renderer owns
 * the queue — main never edits it directly, so there is exactly one writer.
 */
export type RemoteApiAction =
  | { readonly kind: "add-urls"; readonly urls: readonly string[] }
  | { readonly kind: "job-action"; readonly id: string; readonly action: RemoteJobAction };

/**
 * Queue row as exposed over HTTP. Deliberately path-free: no `outputDir`,
 * no `destination`, no `proxyOverride` — the spec forbids endpoints that
 * expose arbitrary filesystem paths (or execute commands, of which there
 * are none).
 */
export interface ApiJobView {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly status: string;
  readonly progress: number | null;
  readonly speed: string | null;
  readonly eta: string | null;
}

/** Port sanitizer for settings + pairing links: clamped, never privileged. */
export function clampApiPort(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < REMOTE_API_MIN_PORT || n > REMOTE_API_MAX_PORT) return fallback;
  return n;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Extract the Bearer token from an Authorization header. Returns null for
 * anything else (missing, non-string, wrong scheme, empty). The token
 * itself is never logged — callers compare, then drop.
 */
export function parseBearer(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const m = /^Bearer ([A-Za-z0-9\-_~+/=]+)$/.exec(header.trim());
  if (m === null) return null;
  const token = (m[1] ?? "").trim();
  return token.length > 0 ? token : null;
}

/**
 * Timing-safe string equality. Always walks the full length so an attacker
 * learns nothing from response timing; differing lengths still compare
 * without an early exit.
 */
export function tokensEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i += 1) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    if (ca !== cb) diff = 1;
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Host / Origin gates (DNS-rebinding defense)
// ---------------------------------------------------------------------------

/**
 * The Host header must name this server: `127.0.0.1:port` or
 * `localhost:port`, exactly. A rebinding attack resolves a foreign name to
 * 127.0.0.1 — the Host header still carries the foreign name, so this
 * check drops it. Case-insensitive host, exact port. LAN mode passes its
 * own interface addresses as `extraHosts`.
 */
export function isLoopbackHost(host: unknown, port: number, extraHosts?: readonly string[]): boolean {
  if (typeof host !== "string") return false;
  const t = host.trim().toLowerCase();
  if (t === `127.0.0.1:${String(port)}` || t === `localhost:${String(port)}`) return true;
  if (extraHosts !== undefined) {
    for (const h of extraHosts) {
      if (t === `${h.toLowerCase()}:${String(port)}`) return true;
    }
  }
  return false;
}

/**
 * Browsers send Origin; curl/PWA-same-origin navigations and native clients
 * send none. Absent is allowed (the Bearer token is the boundary); a
 * present Origin must be exactly our loopback origin — never echoed
 * blindly, never a wildcard.
 */
export function originAllowed(origin: unknown, port: number, extraHosts?: readonly string[]): boolean {
  if (origin === undefined || origin === null) return true;
  if (typeof origin !== "string") return false;
  const t = origin.trim();
  if (t.length === 0) return true;
  const low = t.toLowerCase();
  if (low === `http://127.0.0.1:${String(port)}` || low === `http://localhost:${String(port)}`) {
    return true;
  }
  if (extraHosts !== undefined) {
    for (const h of extraHosts) {
      if (low === `http://${h.toLowerCase()}:${String(port)}`) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

export type AddBodyError = "empty" | "too-many" | "too-long" | "bad-url";

export type AddBodyResult =
  | { readonly ok: true; readonly urls: readonly string[] }
  | { readonly ok: false; readonly error: AddBodyError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a POST /api/add body: `{url}` or `{urls: [...]}`. Every URL is
 * trimmed, length-capped, and normalized (http/https only — enforced by
 * `normalizeUrl`). Returns a typed error, never throws, never echoes input.
 */
export function parseAddBody(raw: unknown): AddBodyResult {
  if (!isRecord(raw)) return { ok: false, error: "empty" };
  const collected: string[] = [];
  const single = raw["url"];
  const multi = raw["urls"];
  if (typeof single === "string") collected.push(single);
  if (Array.isArray(multi)) {
    for (const item of multi) {
      if (typeof item === "string") collected.push(item);
    }
  }
  const trimmed = collected.map((u) => u.trim()).filter((u) => u.length > 0);
  if (trimmed.length === 0) return { ok: false, error: "empty" };
  if (trimmed.length > REMOTE_API_MAX_URLS) return { ok: false, error: "too-many" };
  const out: string[] = [];
  for (const candidate of trimmed) {
    if (candidate.length > REMOTE_API_MAX_URL_CHARS) return { ok: false, error: "too-long" };
    try {
      out.push(normalizeUrl(candidate));
    } catch {
      return { ok: false, error: "bad-url" };
    }
  }
  return { ok: true, urls: out };
}

export type JobBodyError = "bad-id" | "bad-action";

export type JobBodyResult =
  | { readonly ok: true; readonly id: string; readonly action: RemoteJobAction }
  | { readonly ok: false; readonly error: JobBodyError };

/** Validate a POST /api/job body: `{id, action}`. */
export function parseJobBody(raw: unknown): JobBodyResult {
  if (!isRecord(raw)) return { ok: false, error: "bad-id" };
  const id = raw["id"];
  const action = raw["action"];
  if (typeof id !== "string" || id.trim().length === 0 || id.length > 256) {
    return { ok: false, error: "bad-id" };
  }
  if (typeof action !== "string" || !(REMOTE_JOB_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, error: "bad-action" };
  }
  return { ok: true, id: id.trim(), action: action as RemoteJobAction };
}

// ---------------------------------------------------------------------------
// Rate limiter (pure, injected clock)
// ---------------------------------------------------------------------------

export interface RateLimiter {
  /** True when the request may proceed (and records it). */
  check(ip: string): boolean;
}

export function createRateLimiter(opts: {
  readonly limit?: number;
  readonly windowMs?: number;
  readonly now?: () => number;
}): RateLimiter {
  const limit = opts.limit ?? REMOTE_API_RATE_LIMIT;
  const windowMs = opts.windowMs ?? REMOTE_API_RATE_WINDOW_MS;
  const now = opts.now ?? ((): number => Date.now());
  const hits = new Map<string, number[]>();
  return {
    check(ip: string): boolean {
      const at = now();
      const key = ip.trim().slice(0, 64);
      const prev = hits.get(key) ?? [];
      const live = prev.filter((t) => at - t < windowMs);
      if (live.length >= limit) {
        hits.set(key, live);
        return false;
      }
      live.push(at);
      hits.set(key, live);
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Audit (redacted by construction)
// ---------------------------------------------------------------------------

export interface AuditEntry {
  readonly t: number;
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

/**
 * Append one audit line. Only method/path/status are ever stored — headers
 * (Authorization), bodies (URLs), and tokens cannot reach this function by
 * shape, so a future caller cannot leak them by accident.
 */
export function pushAudit(log: readonly AuditEntry[], entry: AuditEntry): AuditEntry[] {
  const next = [
    ...log,
    {
      t: entry.t,
      method: entry.method.slice(0, 8),
      path: entry.path.slice(0, 128),
      status: entry.status,
    },
  ];
  return next.length > REMOTE_API_AUDIT_CAP
    ? next.slice(next.length - REMOTE_API_AUDIT_CAP)
    : next;
}

// ---------------------------------------------------------------------------
// Pairing link (token travels in the fragment — never sent to the server)
// ---------------------------------------------------------------------------

/** Build the "copy pairing link" payload for the loopback server. */
export function buildPairingLink(port: number, token: string, host = "127.0.0.1"): string {
  const safeHost = host === "localhost" ? "localhost" : "127.0.0.1";
  return `http://${safeHost}:${String(port)}/#token=${encodeURIComponent(token)}`;
}

/** Build a LAN pairing link for an explicit local address (opt-in LAN). */
export function buildLanPairingLink(address: string, port: number, token: string): string {
  const host = address.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return `http://${host}:${String(port)}/#token=${encodeURIComponent(token)}`;
  }
  throw new Error("Invalid LAN address.");
}

export interface PairingInfo {
  readonly port: number;
  readonly token: string;
}

/** Parse a pairing link back (PWA boot, extension import). Null on garbage. */
export function parsePairingLink(text: unknown): PairingInfo | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  const m = /^http:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/#token=(.+)$/.exec(t);
  if (m === null) return null;
  const port = clampApiPort(Number(m[1]), -1);
  let token = "";
  try {
    token = decodeURIComponent(m[2] ?? "");
  } catch {
    return null;
  }
  if (port === -1 || token.length === 0 || token.length > 256) return null;
  return { port, token };
}

// ---------------------------------------------------------------------------
// Queue view sanitizer (no filesystem paths cross the HTTP boundary)
// ---------------------------------------------------------------------------

/**
 * Project a stored job onto its API view. `outputDir`/`destination`/
 * `proxyOverride` are dropped — the API reports WHAT is downloading, never
 * WHERE on disk. Progress overlays (live engine numbers) win over stored
 * snapshots when present.
 */
export function toApiJobView(
  job: DownloadJob,
  overlay?: { readonly progress?: number | null; readonly speed?: string | null; readonly eta?: string | null },
): ApiJobView {
  return {
    id: job.id,
    url: job.url,
    title: job.title,
    status: job.status,
    progress: overlay?.progress ?? job.progress,
    speed: overlay?.speed ?? job.speed,
    eta: overlay?.eta ?? job.eta,
  };
}

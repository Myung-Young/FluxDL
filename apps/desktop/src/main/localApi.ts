import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { APP_NAME } from "@grabber/core/branding.js";
import {
  REMOTE_API_MAX_BODY_BYTES,
  createRateLimiter,
  isLoopbackHost,
  originAllowed,
  parseAddBody,
  parseBearer,
  parseJobBody,
  pushAudit,
  toApiJobView,
  tokensEqual,
} from "@grabber/core/remoteApi.js";
import type {
  ApiJobView,
  AuditEntry,
  RateLimiter,
  RemoteApiAction,
  RemoteJobAction,
} from "@grabber/core/remoteApi.js";
import type { DownloadJob } from "@grabber/core/types.js";
import { loadQueueFromDisk, saveSettingsToDisk } from "./persist.js";
import { PWA_HTML, PWA_MANIFEST_JSON } from "./localApiPwa.js";

/**
 * Loopback Remote API server (Phase 6A, main process only).
 *
 * Loopback-only by construction: the socket binds `127.0.0.1` explicitly
 * and every request must carry a Host header naming this server (the
 * DNS-rebinding gate) plus a Bearer token (≥256-bit, safeStorage-encrypted
 * at rest). LAN mode is deliberately NOT here — see PHASE_6_PLAN.md §6.
 *
 * `node:http` only, no new dependency. All policy (auth parsing, gates,
 * validation, rate limiting, audit shape) lives in core `remoteApi.ts`;
 * this file owns the socket, the token file, and the wiring to the engine.
 */

// ---------------------------------------------------------------------------
// Token store (safeStorage adapter is injected — this file never imports
// Electron, so headless tests can use a fake).
// ---------------------------------------------------------------------------

export interface TokenStore {
  readonly available: boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

const TOKEN_FILE = "api-token.dat";
const TOKEN_TMP = "api-token.dat.tmp";

/** 32 random bytes as base64url (43 chars, ≥256-bit). */
export function generateApiToken(): string {
  return randomBytes(32).toString("base64url");
}

function tokenPathFor(userDataDir: string): string {
  return join(userDataDir, TOKEN_FILE);
}

/** Existing token, or null when missing/unreadable (never throws). */
export function readApiToken(userDataDir: string, store: TokenStore): string | null {
  if (!store.available) return null;
  try {
    const data = readFileSync(join(userDataDir, TOKEN_FILE));
    const token = store.decrypt(data);
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function writeApiToken(userDataDir: string, store: TokenStore, token: string): void {
  const encrypted = store.encrypt(token);
  const file = tokenPathFor(userDataDir);
  const tmp = join(userDataDir, TOKEN_TMP);
  writeFileSync(tmp, encrypted);
  renameSync(tmp, file);
}

/**
 * Load the persisted token, creating + persisting one on first use.
 * Throws `encryption-unavailable` when safeStorage cannot encrypt — the
 * server fails closed rather than writing a plaintext token.
 */
export function loadOrCreateApiToken(userDataDir: string, store: TokenStore): string {
  if (!store.available) throw new Error("encryption-unavailable");
  const existing = readApiToken(userDataDir, store);
  if (existing !== null) return existing;
  const token = generateApiToken();
  writeApiToken(userDataDir, store, token);
  return token;
}

export function rotateApiToken(userDataDir: string, store: TokenStore): string {
  if (!store.available) throw new Error("encryption-unavailable");
  const token = generateApiToken();
  writeApiToken(userDataDir, store, token);
  return token;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface LocalApiSettings {
  readonly apiEnabled: boolean;
  readonly apiPort: number;
  /** Opt-in LAN (Phase 6B): binds 0.0.0.0 with gates + auto-disable. */
  readonly lan: {
    readonly enabled: boolean;
    readonly allowlist: readonly string[];
    readonly autoDisableHours: number | null;
  };
}

export interface QueueProgress {
  readonly id: string;
  readonly progress: number | null;
  readonly speed: string | null;
  readonly eta: string | null;
}

export interface LocalApiDeps {
  readonly userDataDir: string;
  readonly appVersion: string;
  readonly tokenStore: TokenStore;
  readSettings(): LocalApiSettings;
  readQueue(): Promise<DownloadJob[]>;
  readProgress(): readonly QueueProgress[];
  engineActiveCount(): number;
  /** True when an ACTIVE engine job handled the action (else drain it). */
  controlActive(id: string, action: RemoteJobAction): Promise<boolean>;
  /** Single URL → deep link, several → batch text (existing renderer paths). */
  announceUrls(urls: readonly string[]): void;
  createLimiter?(): RateLimiter;
}

export interface LocalApiState {
  readonly running: boolean;
  readonly port: number | null;
  readonly error: string | null;
}

interface RouteResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly audit: boolean;
}

function json(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

/** This machine's LAN IPv4 addresses (for the Host gate + pairing links). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  try {
    for (const addrs of Object.values(networkInterfaces())) {
      if (addrs === undefined) continue;
      for (const a of addrs) {
        if (a.family === "IPv4" && !a.internal) out.push(a.address);
      }
    }
  } catch {
    // No interfaces readable — loopback still serves.
  }
  return [...new Set(out)];
}

/** Normalize a socket address for the allowlist (IPv4-mapped + ::1). */
export function normalizeClientIp(raw: string): string {
  const t = raw.trim();
  if (t === "::1") return "127.0.0.1";
  if (t.toLowerCase().startsWith("::ffff:")) return t.slice("::ffff:".length);
  return t;
}

function isLoopbackIp(ip: string): boolean {
  return ip === "localhost" || ip.startsWith("127.");
}

/**
 * LAN client gate (pure): loopback always passes; an empty allowlist
 * admits any LAN client; otherwise one prefix must match.
 */
export function clientAllowed(rawIp: string, allowlist: readonly string[]): boolean {
  const ip = normalizeClientIp(rawIp);
  if (isLoopbackIp(ip)) return true;
  if (allowlist.length === 0) return true;
  return allowlist.some((prefix) => prefix.length > 0 && ip.startsWith(prefix));
}

export class LocalApiServer {
  private server: Server | null = null;
  private actualPort: number | null = null;
  private lastError: string | null = null;
  private token: string | null = null;
  private readonly pending: RemoteApiAction[] = [];
  private auditLog: readonly AuditEntry[] = [];
  private readonly limiter: RateLimiter;
  /** LAN interface snapshot for the Host gate (refreshed per sync). */
  private lanHosts: readonly string[] = [];
  /** LAN IP allowlist prefixes (empty = any LAN client). */
  private lanAllow: readonly string[] = [];
  /** LAN mode (bind 0.0.0.0) — explicit opt-in only, never the default. */
  private lanOn = false;
  private lanTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: LocalApiDeps) {
    this.limiter = deps.createLimiter?.() ?? createRateLimiter({});
  }

  state(): LocalApiState {
    return { running: this.server !== null, port: this.actualPort, error: this.lastError };
  }

  /** LAN interface addresses when LAN mode is on (pairing links). */
  lanAddresses(): readonly string[] {
    return this.lanOn ? this.lanHosts : [];
  }

  /** True while the socket listens on all interfaces (opt-in LAN). */
  isLan(): boolean {
    return this.lanOn && this.server !== null;
  }

  /** Renderer drain: pending API actions, cleared atomically. */
  drainActions(): RemoteApiAction[] {
    return this.pending.splice(0, this.pending.length);
  }

  auditEntries(): readonly AuditEntry[] {
    return this.auditLog;
  }

  /** Token for the pairing-link copy (explicit user action only). */
  tokenForPairing(): string {
    const token = loadOrCreateApiToken(this.deps.userDataDir, this.deps.tokenStore);
    this.token = token;
    return token;
  }

  rotateToken(): string {
    const token = rotateApiToken(this.deps.userDataDir, this.deps.tokenStore);
    this.token = token;
    return token;
  }

  /**
   * Reconcile the socket with settings: start when enabled, stop when
   * disabled, restart when the port changed. Never throws — failures are
   * reported through `state().error` so boot can never break on this.
   */
  async sync(): Promise<LocalApiState> {
    let settings: LocalApiSettings;
    try {
      settings = this.deps.readSettings();
    } catch {
      return this.state();
    }
    if (!settings.apiEnabled) {
      await this.stop();
      this.lastError = null;
      return this.state();
    }
    try {
      this.token = loadOrCreateApiToken(this.deps.userDataDir, this.deps.tokenStore);
    } catch {
      await this.stop();
      this.lastError = "encryption-unavailable";
      return this.state();
    }
    const wantLan = settings.lan.enabled;
    if (
      this.server !== null &&
      this.actualPort === settings.apiPort &&
      this.lanOn === wantLan
    ) {
      this.lastError = null;
      return this.state();
    }
    await this.stop();
    try {
      await this.listenWithFallback(settings.apiPort, wantLan ? "0.0.0.0" : "127.0.0.1");
      this.lanOn = wantLan;
      this.lanHosts = wantLan ? lanAddresses() : [];
      this.lanAllow = wantLan ? settings.lan.allowlist : [];
      this.lastError = null;
      this.armLanTimer(settings);
    } catch {
      this.lastError = "bind-failed";
      await this.stop();
    }
    return this.state();
  }

  /** Auto-disable LAN after N hours (opt-in): revert to loopback silently. */
  private armLanTimer(settings: LocalApiSettings): void {
    this.clearLanTimer();
    const hours = settings.lan.enabled ? settings.lan.autoDisableHours : null;
    if (hours === null) return;
    this.lanTimer = setTimeout(() => {
      this.lanTimer = null;
      try {
        saveSettingsToDisk(this.deps.userDataDir, { lanEnabled: false });
      } catch {
        // Settings write failed — stop the socket anyway (fail closed).
      }
      void this.sync().catch(() => undefined);
    }, hours * 3_600_000);
    try {
      this.lanTimer.unref();
    } catch {
      // Non-fatal; the timer still bounds LAN mode.
    }
  }

  private clearLanTimer(): void {
    if (this.lanTimer !== null) {
      clearTimeout(this.lanTimer);
      this.lanTimer = null;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.actualPort = null;
    this.lanOn = false;
    this.lanHosts = [];
    this.lanAllow = [];
    this.clearLanTimer();
    if (server === null) return;
    await new Promise<void>((resolve) => {
      try {
        server.close(() => {
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  private listenOnce(port: number, host: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handle(req, res).catch(() => {
          try {
            json(res, 500, { error: "internal" });
          } catch {
            // Socket already gone.
          }
        });
      });
      const onError = (err: unknown): void => {
        server.removeAllListeners();
        reject(err instanceof Error ? err : new Error("listen failed"));
      };
      server.once("error", onError);
      server.listen(port, host, () => {
        server.removeListener("error", onError);
        server.on("error", () => undefined);
        this.server = server;
        const addr = server.address();
        this.actualPort = typeof addr === "object" && addr !== null ? addr.port : port;
        resolve();
      });
    });
  }

  /** Port conflict: walk up to 10 ports above the configured one (spec). */
  private async listenWithFallback(port: number, host: string): Promise<void> {
    if (port === 0) {
      await this.listenOnce(0, host);
      return;
    }
    let last: unknown = null;
    for (let candidate = port; candidate < port + 10; candidate += 1) {
      try {
        await this.listenOnce(candidate, host);
        return;
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof Error ? last : new Error("bind-failed");
  }

  private note(method: string, path: string, status: number): void {
    this.auditLog = pushAudit(this.auditLog, { t: Date.now(), method, path, status });
  }

  private authed(req: IncomingMessage): boolean {
    if (this.token === null) return false;
    const presented = parseBearer(req.headers.authorization);
    if (presented === null) return false;
    return tokensEqual(presented, this.token);
  }

  private readBody(req: IncomingMessage): Promise<Buffer | null> {
    return new Promise<Buffer | null>((resolve) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let done = false;
      const finish = (value: Buffer | null): void => {
        if (done) return;
        done = true;
        resolve(value);
      };
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > REMOTE_API_MAX_BODY_BYTES) {
          finish(null);
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        finish(Buffer.concat(chunks));
      });
      req.on("error", () => {
        finish(Buffer.from("", "utf8"));
      });
    });
  }

  private async queueViews(): Promise<ApiJobView[]> {
    let jobs: DownloadJob[];
    try {
      jobs = await this.deps.readQueue();
    } catch {
      jobs = [];
    }
    const overlay = new Map<string, QueueProgress>();
    try {
      for (const p of this.deps.readProgress()) overlay.set(p.id, p);
    } catch {
      // Snapshot alone still answers.
    }
    return jobs.map((job) => toApiJobView(job, overlay.get(job.id)));
  }

  private async routeApi(
    method: string,
    path: string,
    body: Buffer | null,
  ): Promise<RouteResult> {
    if (method === "GET" && path === "/health") {
      return {
        status: 200,
        body: { ok: true, app: APP_NAME, version: this.deps.appVersion },
        audit: true,
      };
    }
    if (method === "GET" && path === "/api/status") {
      const views = await this.queueViews();
      let queued = 0;
      let active = 0;
      let errors = 0;
      for (const v of views) {
        if (v.status === "error" || v.status === "postfailed") errors += 1;
        else if (
          v.status === "downloading" ||
          v.status === "processing" ||
          v.status === "analyzing" ||
          v.status === "probing"
        ) {
          active += 1;
        } else queued += 1;
      }
      return {
        status: 200,
        body: {
          running: true,
          port: this.actualPort,
          queue: { active, queued, errors },
          engineActive: this.deps.engineActiveCount(),
        },
        audit: true,
      };
    }
    if (method === "GET" && path === "/api/queue") {
      return { status: 200, body: { jobs: await this.queueViews() }, audit: true };
    }
    if (method === "POST" && path === "/api/add") {
      let raw: unknown = null;
      try {
        raw = JSON.parse((body ?? Buffer.from("", "utf8")).toString("utf8")) as unknown;
      } catch {
        return { status: 400, body: { error: "bad-request" }, audit: true };
      }
      const parsed = parseAddBody(raw);
      if (!parsed.ok) {
        return { status: 400, body: { error: "bad-request", detail: parsed.error }, audit: true };
      }
      try {
        this.deps.announceUrls(parsed.urls);
      } catch {
        return { status: 500, body: { error: "internal" }, audit: true };
      }
      return { status: 202, body: { accepted: parsed.urls.length }, audit: true };
    }
    if (method === "POST" && path === "/api/job") {
      let raw: unknown = null;
      try {
        raw = JSON.parse((body ?? Buffer.from("", "utf8")).toString("utf8")) as unknown;
      } catch {
        return { status: 400, body: { error: "bad-request" }, audit: true };
      }
      const parsed = parseJobBody(raw);
      if (!parsed.ok) {
        return { status: 400, body: { error: "bad-request", detail: parsed.error }, audit: true };
      }
      let handled = false;
      try {
        handled = await this.deps.controlActive(parsed.id, parsed.action);
      } catch {
        handled = false;
      }
      if (handled) {
        return { status: 200, body: { handled: "engine" }, audit: true };
      }
      this.pending.push({ kind: "job-action", id: parsed.id, action: parsed.action });
      return { status: 202, body: { handled: "queued" }, audit: true };
    }
    return { status: 404, body: { error: "not-found" }, audit: true };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    let path = "/";
    try {
      path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      json(res, 400, { error: "bad-request" });
      return;
    }
    const port = this.actualPort ?? 0;
    const extraHosts = this.lanOn ? this.lanHosts : undefined;

    // Host gate first: everything (PWA included) must name this server.
    const host = req.headers.host ?? "";
    if (!isLoopbackHost(host, port, extraHosts)) {
      json(res, 403, { error: "forbidden" });
      return;
    }

    // LAN IP allowlist (loopback always passes; empty list = any LAN).
    const clientIp = normalizeClientIp(req.socket.remoteAddress ?? "unknown");
    if (!clientAllowed(clientIp, this.lanAllow)) {
      this.note(method, path, 403);
      json(res, 403, { error: "forbidden" });
      return;
    }

    // CORS preflight: answered only for our own origin.
    if (method === "OPTIONS") {
      const origin = req.headers.origin;
      if (!originAllowed(origin, port, extraHosts)) {
        json(res, 403, { error: "forbidden" });
        return;
      }
      res.writeHead(204, {
        "Access-Control-Allow-Origin": typeof origin === "string" ? origin : "",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return;
    }

    // Same-origin PWA (no secret in the page; token stays client-side).
    if (method === "GET" && path === "/") {
      const text = PWA_HTML;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(text),
      });
      res.end(text);
      return;
    }
    if (method === "GET" && path === "/manifest.webmanifest") {
      res.writeHead(200, {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(PWA_MANIFEST_JSON),
      });
      res.end(PWA_MANIFEST_JSON);
      return;
    }

    const known =
      path === "/health" || path === "/api/status" || path === "/api/queue" || path === "/api/add" || path === "/api/job";
    if (!known) {
      this.note(method, path, 404);
      json(res, 404, { error: "not-found" });
      return;
    }
    if ((method !== "GET" && method !== "POST") || (method === "GET" && (path === "/api/add" || path === "/api/job"))) {
      this.note(method, path, 405);
      json(res, 405, { error: "method-not-allowed" });
      return;
    }

    // Origin gate, then auth, then rate limit — in that order so a
    // rebinding probe learns nothing about the token or the budget.
    if (!originAllowed(req.headers.origin, port, extraHosts)) {
      this.note(method, path, 403);
      json(res, 403, { error: "forbidden" });
      return;
    }
    if (!this.authed(req)) {
      this.note(method, path, 401);
      res.writeHead(401, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "WWW-Authenticate": "Bearer",
      });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    const ip = (req.socket.remoteAddress ?? "unknown").slice(0, 64);
    if (!this.limiter.check(ip)) {
      this.note(method, path, 429);
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Retry-After": "60",
      });
      res.end(JSON.stringify({ error: "rate-limited" }));
      return;
    }

    let body: Buffer | null = null;
    if (method === "POST") {
      body = await this.readBody(req);
      if (body === null) {
        this.note(method, path, 413);
        res.writeHead(413, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          Connection: "close",
        });
        res.end(JSON.stringify({ error: "body-too-large" }));
        return;
      }
    }
    const out = await this.routeApi(method, path, body);
    this.note(method, path, out.status);
    json(res, out.status, out.body);
  }
}

/** Queue snapshot reader for production wiring (queue.json on disk). */
export async function readQueueSnapshot(userDataDir: string): Promise<DownloadJob[]> {
  try {
    return await loadQueueFromDisk(userDataDir);
  } catch {
    return [];
  }
}

import { describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRateLimiter } from "@grabber/core/remoteApi.js";
import type { DownloadJob } from "@grabber/core/types.js";
import {
  LocalApiServer,
  clientAllowed,
  generateApiToken,
  loadOrCreateApiToken,
  normalizeClientIp,
  readApiToken,
  rotateApiToken,
  type LocalApiDeps,
  type TokenStore,
} from "./localApi.js";

/** Fake safeStorage: reversible prefix cipher, availability switchable. */
function fakeStore(available = true): TokenStore {
  return {
    available,
    encrypt: (plain: string) => Buffer.from(`E${plain}`, "utf8"),
    decrypt: (data: Buffer) => data.toString("utf8").replace(/^E/, ""),
  };
}

function fixtureJob(id: string, status: DownloadJob["status"]): DownloadJob {
  return {
    id,
    url: "https://example.com/watch?v=x",
    title: `Title ${id}`,
    preset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
    outputDir: "C:\\super\\secret\\downloads",
    status,
    progress: 10,
    speed: "1M/s",
    eta: "00:01",
    downloadedBytes: 5,
    totalBytes: 50,
    stage: "downloading",
    error: null,
    createdAt: 1,
    attempts: 0,
    nextRetryAt: null,
    destination: "C:\\super\\secret\\downloads\\file.mp4",
  };
}

interface FakeWorld {
  enabled: boolean;
  port: number;
  announced: string[][];
  controlled: Array<{ id: string; action: string }>;
  deps: LocalApiDeps;
}

function makeWorld(port: number): FakeWorld {
  const dir = mkdtempSync(join(tmpdir(), "fluxdl-api-"));
  const world: FakeWorld = {
    enabled: true,
    port,
    announced: [],
    controlled: [],
    deps: null as unknown as LocalApiDeps,
  };
  world.deps = {
    userDataDir: dir,
    appVersion: "9.9.9-test",
    tokenStore: fakeStore(true),
    readSettings: () => ({
      apiEnabled: world.enabled,
      apiPort: world.port,
      lan: { enabled: false, allowlist: [], autoDisableHours: null },
    }),
    readQueue: () => Promise.resolve([fixtureJob("q-1", "queued"), fixtureJob("d-1", "downloading")]),
    readProgress: () => [{ id: "d-1", progress: 42, speed: "2M/s", eta: "00:02" }],
    engineActiveCount: () => 1,
    controlActive: (id, action) => {
      world.controlled.push({ id, action });
      return Promise.resolve(id === "live-1");
    },
    announceUrls: (urls) => {
      world.announced.push([...urls]);
    },
  };
  return world;
}

interface CallOpts {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

async function call(
  port: number,
  opts: CallOpts = {},
): Promise<{ status: number; text: string; headers: Record<string, string | undefined> }> {
  const { method = "GET", path = "/health", headers = {}, body } = opts;
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const out: Record<string, string | undefined> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            out[k] = Array.isArray(v) ? v.join(",") : v;
          }
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8"), headers: out });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Raw socket when the Host header itself is under test. */
async function rawStatus(port: number, host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = netConnect(port, "127.0.0.1", () => {
      sock.write(`GET /health HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    sock.on("data", (c: Buffer) => {
      data += c.toString("utf8");
    });
    sock.on("end", () => {
      resolve(data.split("\r\n")[0] ?? "");
    });
    sock.on("error", reject);
  });
}

describe("localApi server", () => {
  it("starts when enabled, stops when disabled", async () => {
    const world = makeWorld(0);
    const server = new LocalApiServer(world.deps);
    const up = await server.sync();
    expect(up.running).toBe(true);
    expect(up.port).toBeGreaterThan(0);
    world.enabled = false;
    const down = await server.sync();
    expect(down.running).toBe(false);
    expect(down.port).toBeNull();
  });

  it("fails closed when encryption is unavailable", async () => {
    const world = makeWorld(0);
    world.deps = { ...world.deps, tokenStore: fakeStore(false) };
    const server = new LocalApiServer(world.deps);
    const st = await server.sync();
    expect(st.running).toBe(false);
    expect(st.error).toBe("encryption-unavailable");
  });

  it("requires a Bearer token on every API route", async () => {
    const world = makeWorld(0);
    const server = new LocalApiServer(world.deps);
    const st = await server.sync();
    const port = st.port ?? 0;
    expect(port).toBeGreaterThan(0);
    const anon = await call(port, { path: "/api/status" });
    expect(anon.status).toBe(401);
    expect(JSON.parse(anon.text)).toEqual({ error: "unauthorized" });
    expect(anon.headers["www-authenticate"]).toBe("Bearer");
    const wrong = await call(port, {
      path: "/api/status",
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.status).toBe(401);
    const token = server.tokenForPairing();
    const ok = await call(port, {
      path: "/health",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text)).toEqual({ ok: true, app: "FluxDL", version: "9.9.9-test" });
    await server.stop();
  });

  it("rejects foreign Host headers at the socket edge", async () => {
    const world = makeWorld(0);
    const server = new LocalApiServer(world.deps);
    const st = await server.sync();
    const port = st.port ?? 0;
    expect(await rawStatus(port, "evil.com")).toContain("403");
    // Right host, no token: past the Host gate, stopped by auth (401).
    expect(await rawStatus(port, `127.0.0.1:${String(port)}`)).toContain("401");
    await server.stop();
  });

  it("rejects foreign Origin headers", async () => {
    const world = makeWorld(0);
    const server = new LocalApiServer(world.deps);
    const st = await server.sync();
    const port = st.port ?? 0;
    const token = server.tokenForPairing();
    const evil = await call(port, {
      path: "/api/status",
      headers: { authorization: `Bearer ${token}`, origin: "http://evil.com" },
    });
    expect(evil.status).toBe(403);
    const own = await call(port, {
      path: "/api/status",
      headers: {
        authorization: `Bearer ${token}`,
        origin: `http://127.0.0.1:${String(port)}`,
      },
    });
    expect(own.status).toBe(200);
    await server.stop();
  });

  it("accepts add payloads and announces them (no drain for adds)", async () => {
    const world = makeWorld(0);
    const server = new LocalApiServer(world.deps);
    const st = await server.sync();
    const port = st.port ?? 0;
    const token = server.tokenForPairing();
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const one = await call(port, {
      method: "POST",
      path: "/api/add",
      headers: auth,
      body: JSON.stringify({ url: "https://example.com/v" }),
    });
    expect(one.status).toBe(202);
    expect(JSON.parse(one.text)).toEqual({ accepted: 1 });
    const two = await call(port, {
      method: "POST",
      path: "/api/add",
      headers: auth,
      body: JSON.stringify({ urls: ["https://a.example/", "https://b.example/"] }),
    });
    expect(two.status).toBe(202);
    expect(world.announced).toHaveLength(2);
    expect(server.drainActions()).toEqual([]);
    const bad = await call(port, {
      method: "POST",
      path: "/api/add",
      headers: auth,
      body: JSON.stringify({ url: "ftp://example.com/x" }),
    });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.text)).toEqual({ error: "bad-request", detail: "bad-url" });
    await server.stop();
  });

  it("routes job control to the engine or the renderer drain", async () => {
    const world = makeWorld(0);
    const server = new LocalApiServer(world.deps);
    const st = await server.sync();
    const port = st.port ?? 0;
    const token = server.tokenForPairing();
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const live = await call(port, {
      method: "POST",
      path: "/api/job",
      headers: auth,
      body: JSON.stringify({ id: "live-1", action: "pause" }),
    });
    expect(live.status).toBe(200);
    expect(JSON.parse(live.text)).toEqual({ handled: "engine" });
    const queued = await call(port, {
      method: "POST",
      path: "/api/job",
      headers: auth,
      body: JSON.stringify({ id: "q-1", action: "cancel" }),
    });
    expect(queued.status).toBe(202);
    expect(server.drainActions()).toEqual([
      { kind: "job-action", id: "q-1", action: "cancel" },
    ]);
    expect(server.drainActions()).toEqual([]);
    const badAction = await call(port, {
      method: "POST",
      path: "/api/job",
      headers: auth,
      body: JSON.stringify({ id: "q-1", action: "explode" }),
    });
    expect(badAction.status).toBe(400);
    await server.stop();
  });

  it("serves a path-free queue view with live progress overlay", async () => {
    const world = makeWorld(0);
    const server = new LocalApiServer(world.deps);
    const st = await server.sync();
    const port = st.port ?? 0;
    const token = server.tokenForPairing();
    const res = await call(port, {
      path: "/api/queue",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.text) as { jobs: unknown[] };
    expect(parsed.jobs).toHaveLength(2);
    expect(res.text).not.toContain("super");
    expect(res.text).not.toContain("secret");
    const live = (parsed.jobs as Array<{ id: string; progress: number | null }>).find(
      (j) => j.id === "d-1",
    );
    expect(live?.progress).toBe(42);
    await server.stop();
  });

  it("serves the PWA without auth and 404s unknown paths", async () => {
    const world = makeWorld(0);
    const server = new LocalApiServer(world.deps);
    const st = await server.sync();
    const port = st.port ?? 0;
    const page = await call(port, { path: "/" });
    expect(page.status).toBe(200);
    expect(page.text).toContain("FluxDL Remote");
    expect(page.text).toContain("/manifest.webmanifest");
    const manifest = await call(port, { path: "/manifest.webmanifest" });
    expect(manifest.status).toBe(200);
    const manifestBody = JSON.parse(manifest.text) as { share_target?: unknown };
    expect(manifestBody.share_target).toBeDefined();
    const missing = await call(port, { path: "/nope" });
    expect(missing.status).toBe(404);
    await server.stop();
  });

  it("rejects oversize bodies and unknown methods safely", async () => {
    const world = makeWorld(0);
    const server = new LocalApiServer(world.deps);
    const st = await server.sync();
    const port = st.port ?? 0;
    const token = server.tokenForPairing();
    const big = await call(port, {
      method: "POST",
      path: "/api/add",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: `{"url":"https://example.com/${"x".repeat(40_000)}"}`,
    });
    expect(big.status).toBe(413);
    const wrongMethod = await call(port, {
      method: "GET",
      path: "/api/add",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(wrongMethod.status).toBe(405);
    await server.stop();
  });

  it("rate-limits floods with 429", async () => {
    const world = makeWorld(0);
    const deps: LocalApiDeps = {
      ...world.deps,
      createLimiter: () => createRateLimiter({ limit: 1, windowMs: 60_000 }),
    };
    const server = new LocalApiServer(deps);
    const st = await server.sync();
    const port = st.port ?? 0;
    const token = server.tokenForPairing();
    const auth = { authorization: `Bearer ${token}` };
    expect((await call(port, { path: "/health", headers: auth })).status).toBe(200);
    const flooded = await call(port, { path: "/health", headers: auth });
    expect(flooded.status).toBe(429);
    expect(flooded.headers["retry-after"]).toBe("60");
    await server.stop();
  });

  it("auto-picks the next port on conflict", async () => {
    const a = makeWorld(0);
    const first = new LocalApiServer(a.deps);
    const up = await first.sync();
    const taken = up.port ?? 0;
    expect(taken).toBeGreaterThan(0);
    const b = makeWorld(taken);
    const second = new LocalApiServer(b.deps);
    const moved = await second.sync();
    expect(moved.running).toBe(true);
    expect(moved.port).not.toBe(taken);
    await first.stop();
    await second.stop();
  });

  it("keeps a redacted audit ring", async () => {
    const world = makeWorld(0);
    const server = new LocalApiServer(world.deps);
    const st = await server.sync();
    const port = st.port ?? 0;
    await call(port, { path: "/api/status" });
    const entries = server.auditEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(Object.keys(e).sort()).toEqual(["method", "path", "status", "t"]);
    }
    await server.stop();
  });

  it("gates LAN clients by loopback + allowlist", () => {
    expect(normalizeClientIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeClientIp("::1")).toBe("127.0.0.1");
    expect(normalizeClientIp("192.168.1.5")).toBe("192.168.1.5");
    expect(clientAllowed("127.0.0.1", ["10.0.0."])).toBe(true);
    expect(clientAllowed("192.168.1.5", [])).toBe(true);
    expect(clientAllowed("192.168.1.5", ["192.168.1."])).toBe(true);
    expect(clientAllowed("192.168.2.5", ["192.168.1."])).toBe(false);
    expect(clientAllowed("unknown", ["192.168.1."])).toBe(false);
  });

  it("stays loopback-only unless LAN is enabled", async () => {
    const world = makeWorld(0);
    const server = new LocalApiServer(world.deps);
    await server.sync();
    expect(server.lanAddresses()).toEqual([]);
    await server.stop();
  });
});

describe("api token file", () => {
  it("creates once, reads back stably, rotates on demand", () => {
    const dir = mkdtempSync(join(tmpdir(), "fluxdl-token-"));
    const store = fakeStore(true);
    expect(readApiToken(dir, store)).toBeNull();
    const first = loadOrCreateApiToken(dir, store);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(loadOrCreateApiToken(dir, store)).toBe(first);
    const rotated = rotateApiToken(dir, store);
    expect(rotated).not.toBe(first);
    expect(readApiToken(dir, store)).toBe(rotated);
    expect(generateApiToken()).not.toBe(generateApiToken());
  });

  it("throws encryption-unavailable instead of writing plaintext", () => {
    const dir = mkdtempSync(join(tmpdir(), "fluxdl-token-"));
    const store = fakeStore(false);
    expect(() => loadOrCreateApiToken(dir, store)).toThrow("encryption-unavailable");
    expect(() => rotateApiToken(dir, store)).toThrow("encryption-unavailable");
  });
});

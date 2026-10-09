import { describe, expect, it } from "vitest";
import {
  REMOTE_API_AUDIT_CAP,
  buildLanPairingLink,
  buildPairingLink,
  clampApiPort,
  createRateLimiter,
  isLoopbackHost,
  originAllowed,
  parseAddBody,
  parseBearer,
  parseJobBody,
  parsePairingLink,
  pushAudit,
  toApiJobView,
  tokensEqual,
} from "./remoteApi.js";
import type { DownloadJob } from "./types.js";

function job(): DownloadJob {
  return {
    id: "job-1",
    url: "https://example.com/watch?v=x",
    title: "Example",
    preset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
    outputDir: "C:\\secret\\downloads",
    status: "downloading",
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
    destination: "C:\\secret\\downloads\\file.mp4",
  };
}

describe("remoteApi protocol", () => {
  it("parses Bearer tokens and rejects everything else", () => {
    expect(parseBearer("Bearer abc123")).toBe("abc123");
    expect(parseBearer("bearer abc123")).toBeNull();
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer("Bearer ")).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer(42)).toBeNull();
  });

  it("compares tokens without early exits", () => {
    expect(tokensEqual("abc", "abc")).toBe(true);
    expect(tokensEqual("abc", "abd")).toBe(false);
    expect(tokensEqual("abc", "abcd")).toBe(false);
    expect(tokensEqual("", "")).toBe(true);
  });

  it("pins the Host header to loopback + exact port", () => {
    expect(isLoopbackHost("127.0.0.1:48127", 48127)).toBe(true);
    expect(isLoopbackHost("localhost:48127", 48127)).toBe(true);
    expect(isLoopbackHost("LOCALHOST:48127", 48127)).toBe(true);
    // DNS-rebinding shapes
    expect(isLoopbackHost("evil.com", 48127)).toBe(false);
    expect(isLoopbackHost("evil.com:48127", 48127)).toBe(false);
    expect(isLoopbackHost("127.0.0.1.evil.com:48127", 48127)).toBe(false);
    expect(isLoopbackHost("127.0.0.1:9999", 48127)).toBe(false);
    expect(isLoopbackHost("127.0.0.1", 48127)).toBe(false);
    expect(isLoopbackHost("", 48127)).toBe(false);
    expect(isLoopbackHost(null, 48127)).toBe(false);
  });

  it("allows absent Origin, pins present ones to loopback", () => {
    expect(originAllowed(undefined, 48127)).toBe(true);
    expect(originAllowed("", 48127)).toBe(true);
    expect(originAllowed("http://127.0.0.1:48127", 48127)).toBe(true);
    expect(originAllowed("http://localhost:48127", 48127)).toBe(true);
    expect(originAllowed("https://127.0.0.1:48127", 48127)).toBe(false);
    expect(originAllowed("http://evil.com", 48127)).toBe(false);
    expect(originAllowed("http://127.0.0.1:9999", 48127)).toBe(false);
  });

  it("validates add bodies", () => {
    const single = parseAddBody({ url: "https://example.com/v" });
    expect(single.ok).toBe(true);
    if (single.ok) expect(single.urls).toHaveLength(1);
    const multi = parseAddBody({ urls: ["https://a.example/", "https://b.example/"] });
    expect(multi.ok).toBe(true);
    expect(parseAddBody({})).toEqual({ ok: false, error: "empty" });
    expect(parseAddBody({ urls: [] })).toEqual({ ok: false, error: "empty" });
    expect(parseAddBody({ url: "ftp://example.com/x" })).toEqual({ ok: false, error: "bad-url" });
    expect(parseAddBody({ url: "not a url" })).toEqual({ ok: false, error: "bad-url" });
    expect(parseAddBody({ url: "x".repeat(3000) })).toEqual({ ok: false, error: "too-long" });
    expect(parseAddBody({ urls: new Array<string>(51).fill("https://example.com/") })).toEqual({
      ok: false,
      error: "too-many",
    });
    expect(parseAddBody(null)).toEqual({ ok: false, error: "empty" });
  });

  it("validates job bodies", () => {
    expect(parseJobBody({ id: "a", action: "pause" })).toEqual({
      ok: true,
      id: "a",
      action: "pause",
    });
    expect(parseJobBody({ id: "", action: "pause" })).toEqual({ ok: false, error: "bad-id" });
    expect(parseJobBody({ id: "a", action: "explode" })).toEqual({
      ok: false,
      error: "bad-action",
    });
    expect(parseJobBody(null)).toEqual({ ok: false, error: "bad-id" });
  });

  it("rate-limits per IP with a sliding window", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(limiter.check("1.2.3.4")).toBe(true);
    expect(limiter.check("1.2.3.4")).toBe(true);
    expect(limiter.check("1.2.3.4")).toBe(false);
    // Other IPs are unaffected.
    expect(limiter.check("5.6.7.8")).toBe(true);
    // Window expiry re-opens the gate.
    t = 1001;
    expect(limiter.check("1.2.3.4")).toBe(true);
  });

  it("caps the audit ring and keeps only method/path/status", () => {
    let log: ReturnType<typeof pushAudit> = [];
    for (let i = 0; i < REMOTE_API_AUDIT_CAP + 10; i += 1) {
      log = pushAudit(log, { t: i, method: "POST", path: "/api/add", status: 202 });
    }
    expect(log).toHaveLength(REMOTE_API_AUDIT_CAP);
    expect(log[0]?.t).toBe(10);
    for (const entry of log) {
      expect(Object.keys(entry).sort()).toEqual(["method", "path", "status", "t"]);
    }
  });

  it("round-trips pairing links and rejects garbage", () => {
    const link = buildPairingLink(48127, "tok_abc");
    expect(parsePairingLink(link)).toEqual({ port: 48127, token: "tok_abc" });
    expect(parsePairingLink("http://127.0.0.1:80/#token=x")).toBeNull();
    expect(parsePairingLink("https://127.0.0.1:48127/#token=x")).toBeNull();
    expect(parsePairingLink("http://evil.com:48127/#token=x")).toBeNull();
    expect(parsePairingLink("not a link")).toBeNull();
  });

  it("builds LAN pairing links for IPv4 addresses only", () => {
    expect(buildLanPairingLink("192.168.1.5", 48127, "tok")).toBe(
      "http://192.168.1.5:48127/#token=tok",
    );
    expect(() => buildLanPairingLink("evil.com", 48127, "tok")).toThrow();
    expect(() => buildLanPairingLink("", 48127, "tok")).toThrow();
    // Unrecognized hosts fall back to loopback (never a foreign name).
    expect(buildPairingLink(48127, "tok", "evil.com")).toBe(
      "http://127.0.0.1:48127/#token=tok",
    );
    expect(buildPairingLink(48127, "tok", "localhost")).toBe(
      "http://localhost:48127/#token=tok",
    );
  });

  it("clamps API ports", () => {
    expect(clampApiPort(48127, 48127)).toBe(48127);
    expect(clampApiPort(80, 48127)).toBe(48127);
    expect(clampApiPort(99999, 48127)).toBe(48127);
    expect(clampApiPort("48127", 48127)).toBe(48127);
  });

  it("strips filesystem paths from the queue view", () => {
    const view = toApiJobView(job(), { progress: 42 });
    expect(view).toEqual({
      id: "job-1",
      url: "https://example.com/watch?v=x",
      title: "Example",
      status: "downloading",
      progress: 42,
      speed: "1M/s",
      eta: "00:01",
    });
    expect(JSON.stringify(view)).not.toContain("secret");
  });

  it("fuzzes validators without throwing (Phase 6B, seeded)", () => {
    // Deterministic LCG: same sequence every run, no new dependency.
    let seed = 0x17460121;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 0x100000000;
    };
    const alphabet = "abcXYZ019 \t\n:/.-_~+=Bearer{}[]\"'\\";
    const randString = (max: number): string => {
      const len = Math.floor(next() * max);
      let out = "";
      for (let i = 0; i < len; i += 1) {
        out += alphabet[Math.floor(next() * alphabet.length)] ?? "";
      }
      return out;
    };
    const randJson = (depth: number): unknown => {
      const r = next();
      if (depth <= 0 || r < 0.3) {
        const scalars: unknown[] = [null, true, 42, -3.5, "", randString(40)];
        return scalars[Math.floor(next() * scalars.length)];
      }
      if (r < 0.65) {
        return [randJson(depth - 1), randJson(depth - 1), { url: randString(60), urls: [randString(60)] }];
      }
      return { url: randString(60), urls: [randString(60), 7, null], id: randString(20), action: randString(12) };
    };
    for (let i = 0; i < 2000; i += 1) {
      const s = randString(120);
      expect(() => parseBearer(s)).not.toThrow();
      expect(() => tokensEqual(s, randString(120))).not.toThrow();
      expect(typeof isLoopbackHost(s, 48127)).toBe("boolean");
      expect(typeof originAllowed(s, 48127)).toBe("boolean");
      const body = parseAddBody(randJson(3));
      if (body.ok) {
        expect(body.urls.length).toBeGreaterThan(0);
        expect(body.urls.length).toBeLessThanOrEqual(50);
        for (const u of body.urls) expect(u).toMatch(/^https?:\/\//i);
      } else {
        expect(typeof body.error).toBe("string");
      }
      const jb = parseJobBody(randJson(2));
      if (jb.ok) {
        expect(["pause", "resume", "cancel"]).toContain(jb.action);
        expect(jb.id.length).toBeGreaterThan(0);
      } else {
        expect(typeof jb.error).toBe("string");
      }
    }
  });
});

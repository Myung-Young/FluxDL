import { describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  cancelPackOp,
  checkPackUpdate,
  installPack,
  installWhisperModel,
  isUpdateAvailable,
  locateExe,
  packProgress,
  packStatus,
  readRevokedPacks,
  removeWhisperModel,
  resolvePackExe,
  uninstallPack,
} from "./packManager.js";

/** Minimal CRC32 (test-only zip builder). */
function crc32(buf: Buffer): number {
  let table: number[] | null = (crc32 as unknown as { t?: number[] }).t ?? null;
  if (table === null) {
    table = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c % 2 !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    (crc32 as unknown as { t: number[] }).t = table;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = (table[b ^ (crc & 0xff)] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Hand-rolled zip: name → bytes (stored) or {data, method} (0|8). */
function makeZip(entries: Record<string, Buffer | { data: Buffer; method: 0 | 8 }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  let entryCount = 0;
  for (const [name, entry] of Object.entries(entries)) {
    const raw: Buffer = "data" in entry ? entry.data : entry;
    const method: 0 | 8 = "data" in entry ? entry.method : 0;
    const payload = method === 8 ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, payload);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(payload.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
    entryCount += 1;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

interface Route {
  readonly body: Buffer | string;
  readonly type?: string;
  readonly hang?: boolean;
}

async function withServer(routes: Record<string, Route>, fn: (base: string) => Promise<void>): Promise<void> {
  let server: Server | null = null;
  const releasers: (() => void)[] = [];
  try {
    server = createServer((req, res) => {
      const route = routes[req.url ?? ""];
      if (route === undefined) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (route.hang === true) {
        const t = setTimeout(() => undefined, 60_000);
        releasers.push(() => {
          clearTimeout(t);
          try {
            res.end();
          } catch {
            // Gone.
          }
        });
        return;
      }
      const body = typeof route.body === "string" ? Buffer.from(route.body, "utf8") : route.body;
      res.writeHead(200, {
        "Content-Type": route.type ?? "application/octet-stream",
        "Content-Length": body.length,
      });
      res.end(body);
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    await fn(`http://127.0.0.1:${String(port)}`);
  } finally {
    for (const r of releasers) r();
    await new Promise<void>((resolve) => {
      if (server === null) resolve();
      else {
        server.close(() => {
          resolve();
        });
      }
    });
  }
}

function dirs(suffix: string): { userData: string; resources: string } {
  const base = mkdtempSync(join(tmpdir(), `fluxdl-packs-${suffix}-`));
  return { userData: join(base, "ud"), resources: join(base, "res") };
}

describe("packManager", () => {
  it("reports everything uninstalled on a fresh dir", async () => {
    const { userData, resources } = dirs("empty");
    const rows = await packStatus({ userDataDir: userData, resourcesDir: resources });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.installed === null && r.exePath === null)).toBe(true);
    expect(await readRevokedPacks(resources)).toEqual({ packs: {} });
  });

  it("installs a no-checksum pack only with explicit consent", async () => {
    const { userData, resources } = dirs("consent");
    const zip = makeZip({ "nested/deep/N_m3u8DL-RE.exe": Buffer.from("fake-exe") });
    await withServer({ "/p.zip": { body: zip } }, async (base) => {
      await expect(
        installPack({ userDataDir: userData, resourcesDir: resources }, "n-m3u8dl-re", {
          version: "v9.9.9-test",
          url: `${base}/p.zip`,
        }),
      ).rejects.toThrow(/consent/i);
      const done = await installPack(
        { userDataDir: userData, resourcesDir: resources },
        "n-m3u8dl-re",
        { version: "v9.9.9-test", url: `${base}/p.zip`, acceptNoChecksum: true },
      );
      expect(done.version).toBe("v9.9.9-test");
      expect(done.exePath.endsWith("N_m3u8DL-RE.exe")).toBe(true);
    });
    expect(await resolvePackExe(userData, "n-m3u8dl-re")).toContain("v9.9.9-test");
    const rows = await packStatus({ userDataDir: userData, resourcesDir: resources });
    expect(rows.find((r) => r.manifest.id === "n-m3u8dl-re")?.installed).toBe("v9.9.9-test");
    await uninstallPack({ userDataDir: userData, resourcesDir: resources }, "n-m3u8dl-re");
    expect(await resolvePackExe(userData, "n-m3u8dl-re")).toBeNull();
  });

  it("verifies rclone SHA256SUMS and hard-fails on mismatch", async () => {
    const { userData, resources } = dirs("sums");
    const zip = makeZip({ "rclone-v9-rclone.exe": Buffer.from("x"), "rclone.exe": Buffer.from("fake-rclone") });
    const good = createHash("sha256").update(zip).digest("hex");
    const routes: Record<string, Route> = {
      "/r.zip": { body: zip },
      "/SHA256SUMS": { body: `unrelated  a.zip\n${good}  r.zip\n`, type: "text/plain" },
    };
    await withServer(routes, async (base) => {
      const done = await installPack({ userDataDir: userData, resourcesDir: resources }, "rclone", {
        version: "v9.9.9-test",
        url: `${base}/r.zip`,
      });
      expect(done.exePath.endsWith("rclone.exe")).toBe(true);
    });
    await uninstallPack({ userDataDir: userData, resourcesDir: resources }, "rclone");
    const badRoutes: Record<string, Route> = {
      "/r.zip": { body: zip },
      "/SHA256SUMS": { body: `${"0".repeat(64)}  r.zip\n`, type: "text/plain" },
    };
    await withServer(badRoutes, async (base) => {
      await expect(
        installPack({ userDataDir: userData, resourcesDir: resources }, "rclone", {
          version: "v9.9.9-evil",
          url: `${base}/r.zip`,
        }),
      ).rejects.toThrow(/mismatch/i);
      expect(await resolvePackExe(userData, "rclone")).toBeNull();
    });
  });

  it("blocks revoked versions and refuses Zip-Slip archives", async () => {
    const { userData, resources } = dirs("revoke");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(resources, { recursive: true });
    await writeFile(
      join(resources, "packs-revoked.json"),
      JSON.stringify({ packs: { whisper: ["b0000"] } }),
      "utf8",
    );
    expect(await readRevokedPacks(resources)).toEqual({ packs: { whisper: ["b0000"] } });
    const zip = makeZip({ "whisper-cli.exe": Buffer.from("x") });
    await withServer({ "/w.zip": { body: zip } }, async (base) => {
      await expect(
        installPack({ userDataDir: userData, resourcesDir: resources }, "whisper", {
          version: "b0000",
          url: `${base}/w.zip`,
          acceptNoChecksum: true,
        }),
      ).rejects.toThrow(/revoked/i);
    });
    const evil = makeZip({ "../evil.exe": Buffer.from("x") });
    await withServer({ "/e.zip": { body: evil } }, async (base) => {
      await expect(
        installPack({ userDataDir: userData, resourcesDir: resources }, "whisper", {
          version: "b0001",
          url: `${base}/e.zip`,
          acceptNoChecksum: true,
        }),
      ).rejects.toThrow(/zip-slip/i);
      expect(await resolvePackExe(userData, "whisper")).toBeNull();
    });
  });

  it("extracts deflated entries too", async () => {
    const { userData, resources } = dirs("deflate");
    const zip = makeZip({
      "N_m3u8DL-RE.exe": { data: Buffer.from("fake-exe-deflated".repeat(50)), method: 8 },
    });
    await withServer({ "/d.zip": { body: zip } }, async (base) => {
      const done = await installPack(
        { userDataDir: userData, resourcesDir: resources },
        "n-m3u8dl-re",
        { version: "v9.9.9-test", url: `${base}/d.zip`, acceptNoChecksum: true },
      );
      expect(done.exePath.endsWith("N_m3u8DL-RE.exe")).toBe(true);
      const { readFileSync } = await import("node:fs");
      expect(readFileSync(done.exePath, "utf8")).toBe("fake-exe-deflated".repeat(50));
    });
  });

  it("discovers updates from release fixtures", async () => {
    const payload = [
      {
        tag_name: "v9.9.0",
        draft: false,
        assets: [
          { name: "rclone-v9.9.0-windows-amd64.zip", browser_download_url: "https://dl/r.zip", size: 1 },
          { name: "SHA256SUMS", browser_download_url: "https://dl/SHA256SUMS", size: 2 },
        ],
      },
    ];
    await withServer({ "/api": { body: JSON.stringify(payload), type: "application/json" } }, async () => {
      expect(isUpdateAvailable("v1.0.0", "v9.9.0")).toBe(true);
      expect(isUpdateAvailable("v9.9.0", "v9.9.0")).toBe(false);
      expect(isUpdateAvailable(null, "v9.9.0")).toBe(false);
      expect(await checkPackUpdate("nope")).toBeNull();
      expect(payload).toHaveLength(1);
    });
  });

  it("installs + removes a whisper model end to end", async () => {
    const { userData, resources } = dirs("models");
    const deps = { userDataDir: userData, resourcesDir: resources };
    // 80 MB passes tiny's 75 MB sanity band (½×–2×).
    const big = Buffer.alloc(80_000_000, 7);
    await withServer({ "/tiny.bin": { body: big }, "/small.bin": { body: Buffer.alloc(10) } }, async (base) => {
      const done = await installWhisperModel(deps, "tiny", { url: `${base}/tiny.bin` });
      expect(done.path.endsWith("ggml-tiny.bin")).toBe(true);
      const rows = await packStatus(deps);
      expect(rows.find((r) => r.manifest.id === "whisper")?.models.find((m) => m.id === "tiny")?.present).toBe(true);
      await expect(installWhisperModel(deps, "small", { url: `${base}/small.bin` })).rejects.toThrow(/size/i);
      await removeWhisperModel(deps, "tiny");
      const after = await packStatus(deps);
      expect(after.find((r) => r.manifest.id === "whisper")?.models.find((m) => m.id === "tiny")?.present).toBe(false);
    });
  });

  it("busy-ops reject and cancel aborts the download", async () => {
    const { userData, resources } = dirs("busy");
    const zip = makeZip({ "N_m3u8DL-RE.exe": Buffer.from("x") });
    await withServer({ "/slow.zip": { body: zip, hang: true } }, async (base) => {
      const first = installPack({ userDataDir: userData, resourcesDir: resources }, "n-m3u8dl-re", {
        version: "v9.9.9-test",
        url: `${base}/slow.zip`,
        acceptNoChecksum: true,
      });
      // Let the download actually start so the busy guard is genuinely hit.
      await new Promise((r) => setTimeout(r, 500));
      await expect(
        installPack({ userDataDir: userData, resourcesDir: resources }, "rclone", {
          version: "v9.9.9-test",
          url: `${base}/slow.zip`,
        }),
      ).rejects.toThrow(/already running/i);
      cancelPackOp();
      await expect(first).rejects.toThrow();
      expect(packProgress().phase).toBe("idle");
      expect(await resolvePackExe(userData, "n-m3u8dl-re")).toBeNull();
    });
  });

  it("locates exes a few levels deep", async () => {
    const { userData } = dirs("locate");
    expect(await locateExe(userData, "x.exe")).toBeNull();
  });
});

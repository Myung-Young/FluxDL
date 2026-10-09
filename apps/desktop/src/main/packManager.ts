import { existsSync, statfsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  PACK_MANIFESTS,
  discoverNm3u8dl,
  discoverRclone,
  discoverStreamlink,
  discoverWhisper,
  isAllowedPackUrl,
  isRevoked,
  packManifest,
  parseSha256sums,
  whisperModel,
  type DiscoveredAsset,
  type PackManifest,
  type RevokedPacks,
} from "@grabber/core/packs.js";
import { compareVersions } from "@grabber/core/tools.js";
import { sha256File } from "./binaries.js";

/**
 * Optional Tool Packs (Phase 5, main-side only). On-demand download into
 * `userData/packs/<id>/<version>/`, checksum-verified where the project
 * publishes sums (rclone), explicit-consent + size-checked otherwise.
 * Args arrays everywhere, never shell. A crashing pack never crashes the
 * app: every op is guarded and partial installs are cleaned up.
 */

export interface PackManagerDeps {
  readonly userDataDir: string;
  /** Dir containing packs-revoked.json (resources root). */
  readonly resourcesDir: string;
}

export interface PackStatusEntry {
  readonly manifest: PackManifest;
  readonly installed: string | null;
  readonly exePath: string | null;
  readonly diskBytes: number;
  readonly models: readonly { id: string; sizeBytes: number; present: boolean }[];
}

export type PackPhase = "idle" | "checking" | "downloading" | "verifying" | "extracting" | "finalizing";

export interface PackProgress {
  readonly phase: PackPhase;
  readonly packId: string | null;
  readonly receivedBytes: number;
  readonly totalBytes: number | null;
  readonly detail: string | null;
}

const API_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 30 * 60_000;
const MAX_DIR_ENTRIES = 5_000;

let progress: PackProgress = { phase: "idle", packId: null, receivedBytes: 0, totalBytes: null, detail: null };
let aborter: AbortController | null = null;

function setProgress(p: PackProgress): void {
  progress = p;
}

/** Current op progress for the 500 ms UI poll. */
export function packProgress(): PackProgress {
  return progress;
}

/** Cancel the in-flight download/extract (the store UI offers this). */
export function cancelPackOp(): void {
  aborter?.abort();
}

function packsRoot(userDataDir: string): string {
  return join(userDataDir, "packs");
}

function packDir(userDataDir: string, id: string): string {
  return join(packsRoot(userDataDir), id);
}

function versionDir(userDataDir: string, id: string, version: string): string {
  return join(packDir(userDataDir, id), version);
}

function installedFile(userDataDir: string, id: string): string {
  return join(packDir(userDataDir, id), "installed.json");
}

async function readInstalled(userDataDir: string, id: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(installedFile(userDataDir, id), "utf8")) as unknown;
    if (typeof raw === "object" && raw !== null) {
      const v = (raw as Record<string, unknown>)["version"];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeInstalled(userDataDir: string, id: string, version: string): Promise<void> {
  await mkdir(packDir(userDataDir, id), { recursive: true });
  const tmp = `${installedFile(userDataDir, id)}.tmp`;
  await writeFile(tmp, JSON.stringify({ version }), "utf8");
  await rename(tmp, installedFile(userDataDir, id));
}

/** Bundled revoke list (absent in some dev checkouts = nothing revoked). */
export async function readRevokedPacks(resourcesDir: string): Promise<RevokedPacks> {
  try {
    const raw = JSON.parse(await readFile(join(resourcesDir, "packs-revoked.json"), "utf8")) as unknown;
    if (typeof raw === "object" && raw !== null) {
      const packs = (raw as Record<string, unknown>)["packs"];
      if (typeof packs === "object" && packs !== null) {
        const clean: Record<string, readonly string[]> = {};
        for (const [k, v] of Object.entries(packs as Record<string, unknown>)) {
          if (Array.isArray(v) && v.every((x) => typeof x === "string")) clean[k] = [...v];
        }
        return { packs: clean };
      }
    }
    return { packs: {} };
  } catch {
    return { packs: {} };
  }
}

/** Locate the pack exe by walk (zips nest it 1-2 levels deep). */
export async function locateExe(root: string, exe: string): Promise<string | null> {
  const want = exe.toLowerCase();
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let seen = 0;
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || next.depth > 3) continue;
    let entries;
    try {
      entries = await readdir(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries.slice(0, 500)) {
      seen += 1;
      if (seen > MAX_DIR_ENTRIES) return null;
      const full = join(next.dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === want) return full;
      if (e.isDirectory()) queue.push({ dir: full, depth: next.depth + 1 });
    }
  }
  return null;
}

/** Recursive disk usage (entry-capped, best effort). */
export async function dirSizeBytes(root: string): Promise<number> {
  let total = 0;
  let seen = 0;
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop();
    if (dir === undefined) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      seen += 1;
      if (seen > MAX_DIR_ENTRIES) return total;
      const full = join(dir, e.name);
      if (e.isDirectory()) queue.push(full);
      else if (e.isFile()) {
        try {
          total += (await stat(full)).size;
        } catch {
          // Raced deletion.
        }
      }
    }
  }
  return total;
}

/** Resolve the installed exe (null when absent). */
export async function resolvePackExe(userDataDir: string, id: string): Promise<string | null> {
  const manifest = packManifest(id);
  if (manifest === null) return null;
  const version = await readInstalled(userDataDir, id);
  if (version === null) return null;
  const found = await locateExe(versionDir(userDataDir, id, version), manifest.exe);
  if (found === null || !existsSync(found)) return null;
  return found;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "FluxDL", Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`Release API answered ${String(res.status)}.`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/** Newest available release for a pack (null when offline/unknown). */
export async function checkPackUpdate(
  id: string,
): Promise<(DiscoveredAsset & { sumsUrl?: string | null }) | null> {
  const manifest = packManifest(id);
  if (manifest === null) return null;
  const payload = await fetchJson(manifest.releasesApi, API_TIMEOUT_MS);
  if (id === "streamlink") return discoverStreamlink(payload);
  if (id === "n-m3u8dl-re") return discoverNm3u8dl(payload);
  if (id === "whisper") return discoverWhisper(payload);
  return discoverRclone(payload);
}

export function isUpdateAvailable(installed: string | null, latest: string | null): boolean {
  if (installed === null || latest === null) return false;
  return compareVersions(latest, installed) > 0;
}

async function ensureFreeSpace(dir: string, needBytes: number): Promise<void> {
  await mkdir(dir, { recursive: true });
  let free = Number.MAX_SAFE_INTEGER;
  try {
    const fs = statfsSync(dir);
    free = fs.bfree * fs.bsize;
  } catch {
    // Unknown — proceed.
  }
  if (free < needBytes) {
    throw new Error(
      `Not enough free space for this pack (need ${(needBytes / 1_048_576).toFixed(0)} MB).`,
    );
  }
}

interface DownloadResult {
  readonly path: string;
  readonly bytes: number;
}

/** Stream a URL to a temp file with progress + abort + size cap. */
async function downloadToTemp(
  packId: string,
  url: string,
  destDir: string,
  filename: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<DownloadResult> {
  if (!isAllowedPackUrl(url)) throw new Error("Pack URL host is not allowlisted.");
  await mkdir(destDir, { recursive: true });
  const path = join(destDir, `${filename}.part`);
  const ctrl = new AbortController();
  const onAbort = (): void => {
    ctrl.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    ctrl.abort();
  }, INSTALL_TIMEOUT_MS);
  if (typeof timer.unref === "function") timer.unref();
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "FluxDL" } });
    if (!res.ok || res.body === null) throw new Error(`Download answered ${String(res.status)}.`);
    const total = res.headers.get("content-length");
    const totalBytes = total === null ? null : Number.parseInt(total, 10);
    setProgress({
      phase: "downloading",
      packId,
      receivedBytes: 0,
      totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
      detail: null,
    });
    const fh = await open(path, "w");
    let received = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > maxBytes) throw new Error("Download exceeded the expected size — aborted.");
        await fh.write(value);
        setProgress({
          phase: "downloading",
          packId,
          receivedBytes: received,
          totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
          detail: null,
        });
      }
    } finally {
      await fh.close();
    }
    if (received === 0) throw new Error("Downloaded file is empty.");
    return { path, bytes: received };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/** Extract a zip with no external process (system tar is GNU tar under
 * git-bash and chokes on `C:\` paths; PowerShell needs string commands).
 * Supports stored + deflated entries via the central directory; absolute,
 * drive-letter and `..` names are refused (Zip-Slip).
 */
async function extractZip(archive: string, staging: string): Promise<void> {
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const buf = await readFile(archive);
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("Archive is not a readable zip.");
  const total = buf.readUInt16LE(eocd + 10);
  let dirOff = buf.readUInt32LE(eocd + 16);
  const staged = resolve(staging);
  const { inflateRawSync } = await import("node:zlib");
  for (let i = 0; i < total; i += 1) {
    if (buf.readUInt32LE(dirOff) !== 0x02014b50) throw new Error("Archive central directory is corrupt.");
    const method = buf.readUInt16LE(dirOff + 10);
    const crc = buf.readUInt32LE(dirOff + 16);
    const compSize = buf.readUInt32LE(dirOff + 20);
    const nameLen = buf.readUInt16LE(dirOff + 28);
    const extraLen = buf.readUInt16LE(dirOff + 30);
    const commentLen = buf.readUInt16LE(dirOff + 32);
    const localOff = buf.readUInt32LE(dirOff + 42);
    const name = buf.toString("utf8", dirOff + 46, dirOff + 46 + nameLen);
    dirOff += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    assertSafeEntry(name);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported zip method ${String(method)} for ${name}.`);
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error("Archive local header is corrupt.");
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(dataOff, dataOff + compSize);
    if (data.length !== compSize) throw new Error("Archive is truncated.");
    const raw = method === 8 ? inflateRawSync(data) : data;
    if (crc32(raw) !== crc) throw new Error(`Archive entry ${name} fails its checksum.`);
    const out = join(staged, ...name.split("/"));
    if (resolve(out) !== staged && !resolve(out).startsWith(`${staged}\\`) && !resolve(out).startsWith(`${staged}/`)) {
      throw new Error("Archive escapes its folder (Zip-Slip) — refused.");
    }
    await mkdir(join(staged, ...name.split("/").slice(0, -1)), { recursive: true });
    await writeFile(out, raw);
  }
}

/** CRC32 for zip entry verification (small table, no dependency). */
function crc32(buf: Buffer): number {
  let table = CRC_TABLE;
  if (table === null) {
    const t: number[] = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c % 2 !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    CRC_TABLE = t;
    table = t;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = (table[b ^ (crc & 0xff)] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

let CRC_TABLE: number[] | null = null;

/** Refuse absolute, drive-letter and parent-climbing entry names. */
function assertSafeEntry(name: string): void {
  if (
    name.length === 0 ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    /^[a-zA-Z]:/.test(name) ||
    name.split("/").includes("..")
  ) {
    throw new Error("Archive escapes its folder (Zip-Slip) — refused.");
  }
}

/** Offset of the end-of-central-directory record (-1 when absent). */
function findEocd(buf: Buffer): number {
  const stop = Math.max(0, buf.length - 65_557);
  for (let i = buf.length - 22; i >= stop; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

export interface InstallOpts {
  /** Explicit version (defaults to discovered latest, else pinned). */
  readonly version?: string;
  /** Explicit URL (defaults to discovered/pinned). */
  readonly url?: string;
  /** Required when the project publishes no checksums file. */
  readonly acceptNoChecksum?: boolean;
}

function guarded<T>(
  packId: string,
  phase: PackPhase,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (progress.phase !== "idle") throw new Error("Another pack operation is already running.");
  const controller = new AbortController();
  aborter = controller;
  setProgress({ phase, packId, receivedBytes: 0, totalBytes: null, detail: null });
  return fn(controller.signal).finally(() => {
    aborter = null;
    setProgress({ phase: "idle", packId: null, receivedBytes: 0, totalBytes: null, detail: null });
  });
}

/**
 * Install (or update to) one pack version: revoke gate → free-space gate →
 * download → verify → extract → exe locate → atomic swap. Partial installs
 * are always cleaned up; checksum mismatch is a hard fail.
 */
export async function installPack(
  deps: PackManagerDeps,
  id: string,
  opts: InstallOpts = {},
): Promise<{ version: string; exePath: string }> {
  const manifest = packManifest(id);
  if (manifest === null) throw new Error(`Unknown pack: ${id}.`);
  return guarded(id, "downloading", async (signal) => {
    const revoked = await readRevokedPacks(deps.resourcesDir);
    let version = opts.version ?? null;
    let url = opts.url ?? null;
    if ((version === null || url === null) && opts.url === undefined) {
      try {
        const latest = await checkPackUpdate(id);
        if (latest !== null) {
          version ??= latest.version;
          url ??= latest.url;
        }
      } catch {
        // Offline: fall back to pinned.
      }
    }
    version ??= manifest.version;
    url ??= manifest.url;
    if (isRevoked(revoked, id, version)) {
      throw new Error(`${manifest.name} ${version} was revoked — install blocked.`);
    }
    await ensureFreeSpace(packsRoot(deps.userDataDir), manifest.requiredFreeBytes);
    const tmpDir = join(packDir(deps.userDataDir, id), ".tmp");
    await rm(tmpDir, { recursive: true, force: true });
    try {
      const dl = await downloadToTemp(id, url, tmpDir, `${id}-${version}.zip`, manifest.sizeBytes * 4 + 50_000_000, signal);
      // rclone: strict SHA256SUMS verification (hard fail on mismatch).
      if (manifest.sumsAsset !== undefined) {
        setProgress({ phase: "verifying", packId: id, receivedBytes: dl.bytes, totalBytes: dl.bytes, detail: null });
        const sumsUrl = url.slice(0, url.lastIndexOf("/") + 1) + manifest.sumsAsset;
        if (!isAllowedPackUrl(sumsUrl)) throw new Error("Checksum URL host is not allowlisted.");
        const ctrl = new AbortController();
        const timer = setTimeout(() => {
          ctrl.abort();
        }, API_TIMEOUT_MS);
        try {
          const res = await fetch(sumsUrl, { signal: ctrl.signal, headers: { "User-Agent": "FluxDL" } });
          if (!res.ok) throw new Error(`Checksums file answered ${String(res.status)}.`);
          const assetName = url.slice(url.lastIndexOf("/") + 1);
          const want = parseSha256sums(await res.text(), assetName);
          if (want === null) throw new Error("Release has no checksum for this asset — refused.");
          const got = (await sha256File(dl.path)).toLowerCase();
          if (got !== want.toLowerCase()) throw new Error("SHA256 mismatch — install blocked, file deleted.");
        } finally {
          clearTimeout(timer);
        }
      } else if (opts.acceptNoChecksum !== true) {
        throw new Error(
          `${manifest.name} publishes no checksums file. Re-run with explicit consent to install anyway.`,
        );
      }
      setProgress({ phase: "extracting", packId: id, receivedBytes: dl.bytes, totalBytes: dl.bytes, detail: null });
      const staging = join(tmpDir, "stage");
      await extractZip(dl.path, staging);
      const exe = await locateExe(staging, manifest.exe);
      if (exe === null) throw new Error(`Installed archive has no ${manifest.exe} — refused.`);
      setProgress({ phase: "finalizing", packId: id, receivedBytes: dl.bytes, totalBytes: dl.bytes, detail: null });
      const target = versionDir(deps.userDataDir, id, version);
      await rm(target, { recursive: true, force: true });
      await mkdir(packDir(deps.userDataDir, id), { recursive: true });
      await rename(staging, target);
      await writeInstalled(deps.userDataDir, id, version);
      const finalExe = await locateExe(target, manifest.exe);
      if (finalExe === null) throw new Error("Installed pack has no executable — refused.");
      return { version, exePath: finalExe };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

/** Remove every installed version of a pack. */
export async function uninstallPack(deps: PackManagerDeps, id: string): Promise<void> {
  if (packManifest(id) === null) throw new Error(`Unknown pack: ${id}.`);
  if (progress.phase !== "idle") throw new Error("Another pack operation is already running.");
  await rm(packDir(deps.userDataDir, id), { recursive: true, force: true });
}

/** Installed version pointer (null when never installed). */
export async function installedPackVersion(userDataDir: string, id: string): Promise<string | null> {
  return readInstalled(userDataDir, id);
}

/** Installed versions (dir scan) + active pointer. */
export async function installedVersions(userDataDir: string, id: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(packDir(userDataDir, id), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && e.name !== ".tmp").map((e) => e.name);
  } catch {
    return [];
  }
}

/** Full status rows for the store UI (installed + exe + disk + models). */
export async function packStatus(deps: PackManagerDeps): Promise<PackStatusEntry[]> {
  const out: PackStatusEntry[] = [];
  for (const manifest of PACK_MANIFESTS) {
    const installed = await readInstalled(deps.userDataDir, manifest.id);
    const exePath = installed === null ? null : await resolvePackExe(deps.userDataDir, manifest.id);
    const diskBytes = await dirSizeBytes(packDir(deps.userDataDir, manifest.id));
    const models: { id: string; sizeBytes: number; present: boolean }[] = [];
    if (manifest.id === "whisper") {
      for (const m of ["tiny", "base", "small"] as const) {
        const meta = whisperModel(m);
        const present = meta === null ? false : existsSync(whisperModelPath(deps.userDataDir, m));
        models.push({ id: m, sizeBytes: meta?.sizeBytes ?? 0, present });
      }
    }
    out.push({ manifest, installed, exePath, diskBytes, models });
  }
  return out;
}

export function whisperModelPath(userDataDir: string, size: "tiny" | "base" | "small"): string {
  return join(packDir(userDataDir, "whisper"), "models", `ggml-${size}.bin`);
}

/** Download a whisper model (size sanity-checked; none publish checksums). */
export async function installWhisperModel(
  deps: PackManagerDeps,
  size: "tiny" | "base" | "small",
  opts: { url?: string } = {},
): Promise<{ path: string }> {
  const meta = whisperModel(size);
  if (meta === null) throw new Error(`Unknown model: ${size}.`);
  return guarded("whisper", "downloading", async (signal) => {
    const modelsDir = join(packDir(deps.userDataDir, "whisper"), "models");
    await ensureFreeSpace(modelsDir, meta.sizeBytes * 2);
    const tmpDir = join(modelsDir, ".tmp");
    await rm(tmpDir, { recursive: true, force: true });
    try {
      const dl = await downloadToTemp("whisper", opts.url ?? meta.url, tmpDir, `ggml-${size}.bin`, meta.sizeBytes * 2 + 50_000_000, signal);
      if (dl.bytes < meta.sizeBytes / 2 || dl.bytes > meta.sizeBytes * 2) {
        throw new Error("Model size looks wrong — download deleted.");
      }
      const final = whisperModelPath(deps.userDataDir, size);
      await mkdir(modelsDir, { recursive: true });
      await rename(dl.path, final);
      return { path: final };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

/** Remove a whisper model file. */
export async function removeWhisperModel(
  deps: PackManagerDeps,
  size: "tiny" | "base" | "small",
): Promise<void> {
  if (progress.phase !== "idle") throw new Error("Another pack operation is already running.");
  await rm(whisperModelPath(deps.userDataDir, size), { force: true });
}

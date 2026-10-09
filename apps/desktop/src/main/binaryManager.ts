import { existsSync } from "node:fs";
import { copyFile, mkdir, rename, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { sha256File } from "./binaries.js";

/**
 * Generic tool manager (Phase 1 foundation, reused in Phases 2 and 5).
 * yt-dlp/ffmpeg keep their bespoke resolvers in binaries.ts; this registry
 * adds gallery-dl (and future pack tools) without rewriting them.
 *
 * Guarantees: args-array spawns only (callers), atomic temp→verify→rename,
 * previous version kept for rollback, Windows file-in-use tolerated,
 * never blocks startup, offline-safe (returns last-known on network failure).
 */

export interface ToolManifest {
  readonly id: string;
  readonly exe: string;
  readonly version: string;
  readonly url: string;
  readonly sha256: string | null;
  readonly license: string;
  readonly required: boolean;
}

export const GALLERYDL_EXE = "gallery-dl.exe";

export function galleryDlManifest(version: string): ToolManifest {
  return {
    id: "gallery-dl",
    exe: GALLERYDL_EXE,
    version,
    url: `https://github.com/mikf/gallery-dl/releases/download/v${version}/gallery-dl.exe`,
    sha256: null,
    license: "GPL-2.0-only",
    required: false,
  };
}

export function userToolPath(userDataDir: string, exe: string): string {
  return join(userDataDir, "bin", exe);
}

export function bundledToolPath(bundledBinDir: string, exe: string): string {
  return join(bundledBinDir, exe);
}

/** Resolve: userData/bin override → bundled resources → PATH fallback. */
export function resolveToolPath(
  userDataDir: string,
  bundledBinDir: string,
  exe: string,
): string {
  const userCopy = userToolPath(userDataDir, exe);
  if (existsSync(userCopy)) return userCopy;
  const bundled = bundledToolPath(bundledBinDir, exe);
  if (existsSync(bundled)) return bundled;
  return exe;
}

export function isToolPresent(userDataDir: string, bundledBinDir: string, exe: string): boolean {
  return resolveToolPath(userDataDir, bundledBinDir, exe) !== exe;
}

/**
 * Atomic install: caller downloads to tempPath, we verify (when a hash is
 * pinned) then rename into userData/bin, keeping the previous as .bak.
 * Returns the installed path. Throws on checksum mismatch (hard fail).
 */
export async function installToolAtomic(
  userDataDir: string,
  exe: string,
  tempPath: string,
  expectedSha256: string | null,
): Promise<string> {
  if (expectedSha256 !== null) {
    const actual = (await sha256File(tempPath)).toLowerCase();
    if (actual !== expectedSha256.toLowerCase()) {
      await unlink(tempPath).catch(() => undefined);
      throw new Error(`Checksum mismatch for ${exe}.`);
    }
  }
  const dir = join(userDataDir, "bin");
  await mkdir(dir, { recursive: true });
  const target = join(dir, exe);
  const backup = `${target}.bak`;
  if (existsSync(target)) {
    await copyFile(target, backup).catch(() => undefined);
  }
  try {
    await rename(tempPath, target);
  } catch (err) {
    // Windows file-in-use: best-effort copy over, caller surfaces guidance.
    if (!existsSync(target)) throw err;
    await copyFile(tempPath, target);
    await unlink(tempPath).catch(() => undefined);
  }
  return target;
}

/** Roll back to the .bak kept by installToolAtomic (false when none). */
export async function rollbackTool(userDataDir: string, exe: string): Promise<boolean> {
  const target = join(userDataDir, "bin", exe);
  const backup = `${target}.bak`;
  if (!existsSync(backup)) return false;
  await copyFile(backup, target);
  return true;
}

/**
 * Reinstall a bundled tool: re-copy from packaged resources into destDir,
 * verifying the pinned hash when one is known. Throws with placement
 * guidance when the bundled copy is absent (corrupt install).
 */
export async function reinstallBundledTool(
  destDir: string,
  bundledBinDir: string,
  exe: string,
  expectedSha256: string | null,
): Promise<string> {
  const source = join(bundledBinDir, exe);
  if (!existsSync(source)) {
    throw new Error(`Bundled ${exe} is missing; reinstall the app to restore it.`);
  }
  await mkdir(destDir, { recursive: true });
  const target = join(destDir, exe);
  if (existsSync(target)) {
    await copyFile(target, `${target}.bak`).catch(() => undefined);
  }
  await copyFile(source, target);
  if (expectedSha256 !== null) {
    const actual = (await sha256File(target)).toLowerCase();
    if (actual !== expectedSha256.toLowerCase()) {
      await copyFile(`${target}.bak`, target).catch(() => undefined);
      throw new Error(`Checksum mismatch for ${exe}.`);
    }
  }
  return target;
}

export interface DetectedTool {
  /** Resolved binary (absolute path or PATH name). Null when absent. */
  readonly binary: string | null;
  /** First stdout line, or null. */
  readonly version: string | null;
}

/**
 * Detect an optional tool: userData/bin drop-in → PATH name probe
 * (`--version`, short timeout, never throws). Returns nulls when absent.
 */
export function detectTool(
  userDataDir: string,
  exe: string,
  versionArgs: readonly string[] = ["--version"],
  timeoutMs = 8000,
): Promise<DetectedTool> {
  const dropIn = join(userDataDir, "bin", exe);
  const candidates = existsSync(dropIn) ? [dropIn, exe] : [exe];
  return (async () => {
    for (const binary of candidates) {
      const version = await toolVersion(binary, versionArgs, timeoutMs);
      if (version !== null) return { binary, version };
    }
    return { binary: null, version: null };
  })();
}

function toolVersion(
  binary: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null): void => {
      if (done) return;
      done = true;
      resolve(v);
    };
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(binary, [...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
    } catch {
      finish(null);
      return;
    }
    let out = "";
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Best effort.
      }
      finish(null);
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    proc.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(null);
        return;
      }
      const first = out.trim().split(/\r?\n/)[0]?.trim().slice(0, 64) ?? "";
      finish(first.length > 0 ? first : null);
    });
  });
}

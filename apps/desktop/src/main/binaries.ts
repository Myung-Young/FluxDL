import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * Binary resolution: userData copy -> bundled fallback -> PATH fallback.
 * On first run yt-dlp.exe is copied into userData (writable) so the
 * self-updater works even when installed under Program Files.
 * Pure path helpers take explicit dirs (no Electron globals) for testability.
 */

export const YTDLP_EXE = "yt-dlp.exe";
export const FFMPEG_EXE = "ffmpeg.exe";
export const FFPROBE_EXE = "ffprobe.exe";

export function userDataYtDlpPath(userDataDir: string): string {
  return join(userDataDir, YTDLP_EXE);
}

export function bundledYtDlpPath(bundledBinDir: string): string {
  return join(bundledBinDir, YTDLP_EXE);
}

export function bundledFfmpegPath(bundledBinDir: string): string {
  return join(bundledBinDir, FFMPEG_EXE);
}

export function bundledFfprobePath(bundledBinDir: string): string {
  return join(bundledBinDir, FFPROBE_EXE);
}

/** Resolve yt-dlp: userData copy first, then bundled, then PATH fallback. */
export function resolveYtDlpPath(userDataDir: string, bundledBinDir: string): string {
  const userCopy = userDataYtDlpPath(userDataDir);
  if (existsSync(userCopy)) return userCopy;
  const bundled = bundledYtDlpPath(bundledBinDir);
  if (existsSync(bundled)) return bundled;
  return YTDLP_EXE;
}

/** Resolve ffmpeg dir for `--ffmpeg-location` (null = rely on PATH). */
export function resolveFfmpegDir(bundledBinDir: string): string | null {
  if (existsSync(bundledFfmpegPath(bundledBinDir))) return bundledBinDir;
  return null;
}

export function resolveFfmpegPath(bundledBinDir: string): string {
  const bundled = bundledFfmpegPath(bundledBinDir);
  if (existsSync(bundled)) return bundled;
  return FFMPEG_EXE;
}

export function resolveFfprobePath(bundledBinDir: string): string {
  const bundled = bundledFfprobePath(bundledBinDir);
  if (existsSync(bundled)) return bundled;
  return FFPROBE_EXE;
}

/**
 * Copy bundled yt-dlp.exe into userData on first run.
 * Returns the userData path when available, otherwise the resolved fallback.
 */
export async function ensureUserDataBinary(
  userDataDir: string,
  bundledBinDir: string,
): Promise<string> {
  const target = userDataYtDlpPath(userDataDir);
  if (existsSync(target)) return target;
  const source = bundledYtDlpPath(bundledBinDir);
  if (!existsSync(source)) return resolveYtDlpPath(userDataDir, bundledBinDir);
  await mkdir(userDataDir, { recursive: true });
  await copyFile(source, target);
  return target;
}

/** SHA256 of a file (streamed; binaries are tens of MB). */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk: Buffer | string) => {
      hash.update(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.on("error", (err: Error) => {
      reject(err);
    });
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });
}

export interface PinnedVersions {
  readonly ytdlpSha256: string | null;
  readonly ffmpegSha256: string | null;
}

/** Pinned hashes from fetch-binaries (absent in some dev checkouts). */
export function readPinnedVersions(bundledBinDir: string): PinnedVersions {
  try {
    const raw = JSON.parse(
      readFileSync(join(bundledBinDir, "versions.json"), "utf8"),
    ) as unknown;
    if (typeof raw !== "object" || raw === null) return { ytdlpSha256: null, ffmpegSha256: null };
    const rec = raw as Record<string, unknown>;
    return {
      ytdlpSha256: typeof rec["ytdlpSha256"] === "string" ? rec["ytdlpSha256"] : null,
      ffmpegSha256: typeof rec["ffmpegSha256"] === "string" ? rec["ffmpegSha256"] : null,
    };
  } catch {
    return { ytdlpSha256: null, ffmpegSha256: null };
  }
}

export interface RepairResult {
  readonly repaired: string[];
  readonly failed: string[];
}

/**
 * Repair (M1.4): force re-copy yt-dlp.exe from the bundle into userData and
 * verify it against the pinned hash; confirm ffmpeg/ffprobe resolve.
 * Note: versions.json pins the ffmpeg ZIP hash, not extracted files, so the
 * ffmpeg gate is existence + a version run (done by repairEngine), not a hash.
 */
export async function repairBinaries(
  userDataDir: string,
  bundledBinDir: string,
): Promise<RepairResult> {
  const repaired: string[] = [];
  const failed: string[] = [];
  const pinned = readPinnedVersions(bundledBinDir);
  const source = bundledYtDlpPath(bundledBinDir);
  if (!existsSync(source)) {
    failed.push(YTDLP_EXE);
  } else {
    await mkdir(userDataDir, { recursive: true });
    await copyFile(source, userDataYtDlpPath(userDataDir));
    if (pinned.ytdlpSha256 !== null) {
      const actual = await sha256File(userDataYtDlpPath(userDataDir));
      if (actual === pinned.ytdlpSha256.toLowerCase()) repaired.push(YTDLP_EXE);
      else failed.push(YTDLP_EXE);
    } else {
      repaired.push(YTDLP_EXE);
    }
  }
  for (const exe of [FFMPEG_EXE, FFPROBE_EXE]) {
    // Presence-checked only (see docstring): missing entries fail the repair.
    if (!existsSync(join(bundledBinDir, exe))) failed.push(exe);
  }
  return { repaired, failed };
}

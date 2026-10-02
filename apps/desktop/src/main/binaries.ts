import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
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

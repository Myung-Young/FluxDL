import { buildDownloadArgs } from "@grabber/core/args.js";
import type { AppSettings, DownloadJobInput } from "@grabber/core/types.js";

/**
 * Pure argv builder for a download (R1).
 *
 * Extracted from `DesktopEngine.start()` so the whole settings -> argv
 * mapping is unit-testable without spawning yt-dlp. This is the hop that
 * silently dropped the M4.1/M4.2 flags, so it gets its own test file.
 */
export interface StartArgsDeps {
  /** Settings as persisted on disk (main-side source of truth, D25). */
  readonly settings: AppSettings;
  /** Resolved ffmpeg dir, or null when unavailable. */
  readonly ffmpegDir: string | null;
  /** Pre-validated cookies.txt path, or null. */
  readonly cookiesFile: string | null;
  /** --download-archive path, or null when archiving is off for this job. */
  readonly archivePath: string | null;
  /** Detected JS runtime name (deno/node) or null when none is present. */
  readonly jsRuntime?: string | null;
  /** True when an aria2c binary was detected (toggle still gates use). */
  readonly aria2cAvailable?: boolean;
}

const FALLBACK_TEMPLATE = "%(title)s [%(id)s].%(ext)s";

export function buildStartArgs(input: DownloadJobInput, deps: StartArgsDeps): string[] {
  const s = deps.settings;
  return buildDownloadArgs({
    url: input.url,
    preset: input.preset,
    outputDir: input.outputDir,
    filenameTemplate: s.filenameTemplate.trim().length > 0 ? s.filenameTemplate : FALLBACK_TEMPLATE,
    ffmpegDir: deps.ffmpegDir,
    mergeContainer: s.mergeContainer,
    embedThumbnail: s.embedThumbnail,
    embedMetadata: s.embedMetadata,
    writeSubs: s.subtitles,
    subLangs: s.subtitleLangs,
    embedSubs: s.embedSubs,
    writeAutoSubs: s.includeAutoSubs,
    sponsorBlock: s.sponsorBlock,
    speedLimit: s.speedLimit,
    proxy: s.proxy,
    cookiesFromBrowser: input.cookiesFromBrowser ?? s.cookiesFromBrowser,
    cookiesFile: deps.cookiesFile,
    codecPreference: s.codecPreference,
    playlistSubdir: input.playlistSubdir ?? null,
    archivePath: deps.archivePath,
    noPlaylist: true,
    liveStatus: input.liveStatus ?? null,
    liveFromStart: input.liveFromStart === true,
    waitForVideo: input.waitForVideo === true,
    splitChapters: input.splitChapters === true,
    audioMetadata: input.audioMetadata ?? null,
    forceOverwrite: input.forceOverwrite === true,
    // Polite pacing (v1.7.2). Off by default; sanitized on the way in, so a
    // hand-edited settings file can never hand yt-dlp a NaN or negative delay.
    sleepRequestsSec: s.pacing.sleepRequestsSec,
    minSleepIntervalSec: s.pacing.minSleepIntervalSec,
    maxSleepIntervalSec: s.pacing.maxSleepIntervalSec,
    sleepSubtitlesSec: s.pacing.sleepSubtitlesSec,
    // Phase 2 hardening knobs. All off by default; the default argv is
    // byte-identical to earlier releases (pinned by test).
    sponsorBlockCategories: s.sponsorBlockCategories,
    jsRuntime: deps.jsRuntime ?? null,
    useAria2c: s.useAria2c && deps.aria2cAvailable === true,
    concurrentFragments: s.concurrentFragments,
    downloadRetries: s.downloadRetries,
    socketTimeoutSec: s.socketTimeoutSec,
    trimStart: input.trimStart ?? null,
    trimEnd: input.trimEnd ?? null,
    impersonateClient: s.impersonateClient,
  });
}

export interface GalleryStartDeps {
  readonly settings: AppSettings;
  /** App-owned gallery-dl config file (generated from settings). */
  readonly configPath: string;
  /** Destination directory for this job. */
  readonly downloadDir: string;
  /** Pre-validated cookies.txt path, or null. */
  readonly cookiesFile: string | null;
}

/**
 * Pure gallery-dl argv (Phase 1). Verified shape only — every flag must exist
 * in `gallery-dl --help` before use; unknown flags fail closed in the engine.
 * Args array only, never shell. Secrets ride the config file, not argv.
 */
export function buildGalleryDlArgs(input: DownloadJobInput, deps: GalleryStartDeps): string[] {
  const images = deps.settings.images;
  const args: string[] = ["--config", deps.configPath, "--dest", deps.downloadDir];
  const retries = images.retries ?? 3;
  if (Number.isFinite(retries) && retries >= 0) {
    args.push("--retries", String(Math.min(20, Math.floor(retries))));
  }
  const proxy = images.proxy ?? deps.settings.proxy;
  if (proxy !== null && proxy.trim().length > 0) args.push("--proxy", proxy.trim());
  if (deps.cookiesFile !== null) args.push("--cookies", deps.cookiesFile);
  if (images.sleepRequestsSec !== null) {
    args.push("--sleep-request", String(images.sleepRequestsSec));
  }
  if (images.maxSleepIntervalSec !== null) {
    args.push("--sleep", String(images.maxSleepIntervalSec));
  }
  args.push("--", input.url);
  return args;
}

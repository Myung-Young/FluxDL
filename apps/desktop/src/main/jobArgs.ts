import { join } from "node:path";
import { buildDownloadArgs } from "@grabber/core/args.js";
import type { AppSettings, DownloadJobInput } from "@grabber/core/types.js";
import { sanitizeFileStem } from "@grabber/core/packs.js";
import { cleanGalleryRange } from "@grabber/core/galleryProbe.js";
import { FFMPEG_EXE } from "./binaries.js";

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
    proxy:
      typeof input.proxyOverride === "string" && input.proxyOverride.trim().length > 0
        ? input.proxyOverride.trim()
        : s.proxy,
    cookiesFromBrowser: input.cookiesFromBrowser ?? s.cookiesFromBrowser,
    cookiesFile: deps.cookiesFile,
    codecPreference: s.codecPreference,
    customFormat: s.customFormat,
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
 *
 * Phase 4: native post-processors from the official docs — `--zip`/`--cbz`
 * package the gallery, `--ugoira FMT` converts Pixiv animations via FFmpeg
 * (the child needs ffmpeg on PATH; see launchGallery).
 */
export function buildGalleryDlArgs(input: DownloadJobInput, deps: GalleryStartDeps): string[] {
  const images = deps.settings.images;
  const post = deps.settings.postProcess;
  const args: string[] = ["--config", deps.configPath, "--dest", deps.downloadDir];
  const retries = images.retries ?? 3;
  if (Number.isFinite(retries) && retries >= 0) {
    args.push("--retries", String(Math.min(20, Math.floor(retries))));
  }
  const proxy =
    (typeof input.proxyOverride === "string" && input.proxyOverride.trim().length > 0
      ? input.proxyOverride.trim()
      : null) ??
    images.proxy ??
    deps.settings.proxy;
  if (proxy !== null && proxy.trim().length > 0) args.push("--proxy", proxy.trim());
  if (deps.cookiesFile !== null) args.push("--cookies", deps.cookiesFile);
  if (images.sleepRequestsSec !== null) {
    args.push("--sleep-request", String(images.sleepRequestsSec));
  }
  if (images.maxSleepIntervalSec !== null) {
    args.push("--sleep", String(images.maxSleepIntervalSec));
  }
  if (post.packageGallery === "zip" || post.packageGallery === "cbz") {
    args.push(`--${post.packageGallery}`);
  }
  if (post.ugoiraFormat !== "off") {
    args.push("--ugoira", post.ugoiraFormat);
  }
  // v1.8.5: selected-items downloads (preview checkboxes → indices).
  // `--range` is verified in 1.32.15 `--help`; the value was validated at
  // the trust boundary (queue projection + IPC), re-checked here.
  const range = cleanGalleryRange(input.range ?? null);
  if (range !== null) {
    args.push("--range", range);
  }
  args.push("--", input.url);
  return args;
}

export interface PackStartDeps {
  /** Resolved ffmpeg dir (N_m3u8DL-RE muxing), or null when unavailable. */
  readonly ffmpegDir: string | null;
}

export interface PackStartArgs {
  readonly args: string[];
  /** Output file known upfront (both pack engines take -o/--save-×). */
  readonly destination: string;
}

/**
 * Pure streamlink argv (Phase 5). `best` to a raw `.ts` file (streamlink
 * writes the transport stream as-is; no remux flags — verified flags only:
 * URL, STREAM, -o, --force). Progress is indeterminate (its progress
 * format is unverified — no fake percentages).
 */
export function buildStreamlinkArgs(input: DownloadJobInput, outputDir: string): PackStartArgs {
  const stem = sanitizeFileStem(input.title);
  const destination = join(outputDir, `${stem}.ts`);
  return { args: [input.url, "best", "-o", destination, "--force"], destination };
}

/**
 * Pure N_m3u8DL-RE argv (Phase 5, flags verified against the v0.6.0 README).
 * Muxes to mp4 with our ffmpeg; temp dir is deleted by the engine after.
 */
export function buildNm3u8dlArgs(
  input: DownloadJobInput,
  outputDir: string,
  deps: PackStartDeps,
  nonce: string,
): PackStartArgs & { tmpDir: string } {
  const stem = sanitizeFileStem(input.title);
  const destination = join(outputDir, `${stem}.mp4`);
  const tmpDir = join(outputDir, `.n-m3u8dl-tmp-${nonce}`);
  const args = [
    input.url,
    "--save-dir", outputDir,
    "--save-name", stem,
    "-M", "format=mp4",
    "--auto-select",
    "--tmp-dir", tmpDir,
    "--del-after-done",
    "--log-level", "INFO",
  ];
  if (deps.ffmpegDir !== null) {
    args.push("--ffmpeg-binary-path", join(deps.ffmpegDir, FFMPEG_EXE));
  }
  return { args, destination, tmpDir };
}

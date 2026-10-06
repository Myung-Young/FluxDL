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
  });
}
import type { CodecPreference, Container, DownloadPreset, LiveStatus } from "./types.js";
import { CONTAINERS, MERGE_CONTAINERS } from "./types.js";
import { PROGRESS_TEMPLATE } from "./progress.js";
import { normalizeUrl } from "./url.js";
import { sanitizePlaylistTitle } from "./playlist.js";
import { buildParseMetadataArgs, type AudioMetadata } from "./metadata.js";

/**
 * yt-dlp arg builder. Always returns an args array (never a shell string).
 * Flags verified against yt-dlp 2026.08.19 (`yt-dlp --help`):
 * -J/--dump-single-json, --flat-playlist, --newline, --progress-template,
 * -c/--continue, -o/--output, -f/--format, -S/--format-sort, -x/--extract-audio,
 * --audio-format, --audio-quality,
 * --merge-output-format, --ffmpeg-location, --embed-*, --write-subs, --write-auto-subs,
 * --sponsorblock-*, --limit-rate, --proxy, --cookies-from-browser, --cookies,
 * --download-archive, -U/--update, --live-from-start, --wait-for-video, --hls-use-mpegts,
 * --merge-output-format, --remux-video,
 * --sleep-requests, --min-sleep-interval, --max-sleep-interval, --sleep-subtitles.
 *
 * Value sets verified against the BUNDLED yt-dlp 2026.08.19:
 *   --audio-format       best aac alac flac m4a mp3 opus vorbis wav
 *   --remux-video        avi flv gif mkv mov mp4 webm aac aiff alac flac m4a mka
 *                        mp3 ogg opus vorbis wav
 *   --merge-output-format avi flv mkv mov mp4 webm
 * Anything outside those lists is dropped rather than passed on: yt-dlp aborts
 * on an unknown value, so a stale setting must never reach the child process.
 */

export interface DownloadArgsInput {
  readonly url: string;
  readonly preset: DownloadPreset;
  readonly outputDir: string;
  readonly filenameTemplate: string;
  readonly ffmpegDir: string | null;
  readonly mergeContainer: string;
  readonly embedThumbnail: boolean;
  readonly embedMetadata: boolean;
  readonly writeSubs: boolean;
  readonly subLangs: string;
  readonly embedSubs: boolean;
  /** Also fetch auto-generated captions alongside manual subs. */
  readonly writeAutoSubs?: boolean;
  readonly sponsorBlock: boolean;
  readonly speedLimit: string | null;
  readonly proxy: string | null;
  readonly cookiesFromBrowser: string | null;
  readonly cookiesFile: string | null;
  readonly codecPreference: CodecPreference;
  /** yt-dlp --download-archive path, or null to not use one. */
  readonly archivePath: string | null;
  /** Sanitized playlist subfolder (joined under the output dir). */
  readonly playlistSubdir: string | null;
  readonly noPlaylist: boolean;
  /** Global custom `-f` selector (per-job rawFormat wins). Null = off. */
  readonly customFormat?: string | null;
  /** Live status detected for this download (M4.1). */
  readonly liveStatus?: LiveStatus | null;
  /** Record livestream from start (--live-from-start) (M4.1). */
  readonly liveFromStart?: boolean;
  /** Wait for scheduled upcoming stream (--wait-for-video) (M4.1). */
  readonly waitForVideo?: boolean;
  /** Split video into multiple files based on internal chapters (M4.2). */
  readonly splitChapters?: boolean | null;
  /** Per-job audio tag overrides (M4.3); forces --embed-metadata. */
  readonly audioMetadata?: AudioMetadata | null;
  /**
   * Re-download even when the output file already exists (M4.8). yt-dlp
   * otherwise reports "has already been downloaded" and silently skips, which
   * made Library > "Download again" a no-op.
   */
  readonly forceOverwrite?: boolean;
  /**
   * Polite pacing delays in seconds (v1.7.2). All optional and all off by
   * default; only finite values >= 0 are emitted, and `--max-sleep-interval`
   * only alongside `--min-sleep-interval` because yt-dlp rejects it alone.
   */
  readonly sleepRequestsSec?: number | null;
  readonly minSleepIntervalSec?: number | null;
  readonly maxSleepIntervalSec?: number | null;
  readonly sleepSubtitlesSec?: number | null;
  /** Phase 2 network/hardening knobs. All off by default (null/false). */
  /** Detected JS runtime name for --js-runtimes (null = omit). */
  readonly jsRuntime?: string | null;
  /** External downloader (aria2c) when its binary is present. */
  readonly useAria2c?: boolean;
  /** Concurrent HLS/DASH fragments (-N). */
  readonly concurrentFragments?: number | null;
  /** Retries (-R + --fragment-retries). */
  readonly downloadRetries?: number | null;
  /** --socket-timeout seconds. */
  readonly socketTimeoutSec?: number | null;
  /** SponsorBlock remove list (used when sponsorBlock is on). */
  readonly sponsorBlockCategories?: string;
  /** Trim section bounds for --download-sections (null/empty = off). */
  readonly trimStart?: string | null;
  readonly trimEnd?: string | null;
  /** Experimental --impersonate client (null = off). */
  readonly impersonateClient?: string | null;
}

/** A finite delay of at least `min` seconds, or null when it is off. */
function delayArg(value: number | null | undefined, min: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Off is checked BEFORE the floor: 0 must mean "no flag", never "floor to
  // the minimum", otherwise a cleared field would silently add a delay.
  if (value <= 0) return null;
  const seconds = Math.max(min, Math.floor(value));
  return seconds <= 0 ? null : String(seconds);
}

/**
 * yt-dlp pacing flags for a download, in the order yt-dlp documents them.
 * Pure and exported so the mapping is pinned by tests without spawning.
 */
export function pacingArgs(pacing: {
  readonly sleepRequestsSec?: number | null | undefined;
  readonly minSleepIntervalSec?: number | null | undefined;
  readonly maxSleepIntervalSec?: number | null | undefined;
  readonly sleepSubtitlesSec?: number | null | undefined;
}): string[] {
  const out: string[] = [];
  const requests = delayArg(pacing.sleepRequestsSec, 0);
  if (requests !== null) out.push("--sleep-requests", requests);
  const min = delayArg(pacing.minSleepIntervalSec, 1);
  if (min !== null) {
    out.push("--min-sleep-interval", min);
    const max = delayArg(pacing.maxSleepIntervalSec, 1);
    // --max-sleep-interval is only accepted together with the minimum.
    if (max !== null && Number(max) >= Number(min)) {
      out.push("--max-sleep-interval", max);
    }
  }
  const subs = delayArg(pacing.sleepSubtitlesSec, 0);
  if (subs !== null) out.push("--sleep-subtitles", subs);
  return out;
}

export function buildChapterOutputTemplate(
  outputDir: string,
  playlistSubdir: string | null,
): string {
  const dir = outputDir.replace(/[/\\]+$/, "");
  if (playlistSubdir === null) {
    return `${dir}/%(title)s/%(section_number)03d - %(section_title)s.%(ext)s`;
  }
  const segs = sanitizePlaylistSubdir(playlistSubdir);
  if (segs === null) {
    return `${dir}/%(title)s/%(section_number)03d - %(section_title)s.%(ext)s`;
  }
  return `${dir}/${segs}/%(title)s/%(section_number)03d - %(section_title)s.%(ext)s`;
}

function joinOutputTemplate(
  outputDir: string,
  filenameTemplate: string,
  playlistSubdir: string | null,
): string {
  const dir = outputDir.replace(/[/\\]+$/, "");
  if (playlistSubdir === null) return `${dir}/${filenameTemplate}`;
  const segs = sanitizePlaylistSubdir(playlistSubdir);
  if (segs === null) return `${dir}/${filenameTemplate}`;
  return `${dir}/${segs}/${filenameTemplate}`;
}

function sanitizePlaylistSubdir(raw: string): string | null {
  const cleaned = sanitizePlaylistTitle(raw);
  const segs = cleaned
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "." && s !== "..");
  return segs.length > 0 ? segs.join("/") : null;
}

/**
 * yt-dlp `-x` target for an audio preset.
 *
 * Verified against yt-dlp 2026.08.19 (`--audio-format`): best (default), aac,
 * alac, flac, m4a, mp3, opus, vorbis, wav. "Best" is NOT a conversion target —
 * it means keep the source stream, so the caller must skip `-x` entirely
 * (returning null here is how that is expressed).
 */
export function audioFormatOf(preset: DownloadPreset): string | null {
  switch (preset.audioPreset) {
    case "MP3":
      return "mp3";
    case "M4A":
      return "m4a";
    case "AAC":
      return "aac";
    case "Opus":
      return "opus";
    case "Vorbis":
      return "vorbis";
    case "FLAC":
      return "flac";
    case "ALAC":
      return "alac";
    case "WAV":
      return "wav";
    case "Best":
      return null;
  }
}

function videoFormatOf(preset: DownloadPreset): string {
  switch (preset.videoPreset) {
    case "Best":
      return "bestvideo+bestaudio/best";
    case "2160":
      return "bestvideo[height<=2160]+bestaudio/best[height<=2160]/best";
    case "1440":
      return "bestvideo[height<=1440]+bestaudio/best[height<=1440]/best";
    case "1080":
      return "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best";
    case "720":
      return "bestvideo[height<=720]+bestaudio/best[height<=720]/best";
    case "480":
      return "bestvideo[height<=480]+bestaudio/best[height<=480]/best";
    case "Compatible":
      // Same 1080p cap as "1080"; codecSortOf() forces H.264 + AAC via -S.
      return "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best";
    case "Smallest":
      return "worstvideo+worstaudio/worst";
  }
}

/**
 * Container for a video job: the per-job override when set, else the global
 * setting. Only values the bundled yt-dlp accepts are honoured — an unknown
 * container makes it abort, so a stale or hand-edited setting is dropped rather
 * than passed on (v1.7.2).
 */
function chosenContainer(input: Pick<DownloadArgsInput, "preset" | "mergeContainer">): string | null {
  const override = input.preset.container;
  const chosen =
    typeof override === "string" && override.length > 0 ? override : input.mergeContainer;
  const value = chosen.trim().toLowerCase();
  return CONTAINERS.includes(value as Container) ? value : null;
}

/**
 * `--merge-output-format` value, or null. yt-dlp's mergeable set is narrower
 * than its remux set (no gif), so a remux-only target gets the remux flag only.
 */
export function mergeContainerOf(
  input: Pick<DownloadArgsInput, "preset" | "mergeContainer">,
): string | null {
  const value = chosenContainer(input);
  if (value === null) return null;
  return MERGE_CONTAINERS.includes(value as Container) ? value : null;
}

/** `--remux-video` value, or null (covers single-stream sources too). */
export function remuxContainerOf(
  input: Pick<DownloadArgsInput, "preset" | "mergeContainer">,
): string | null {
  return chosenContainer(input);
}

/**
 * yt-dlp `-S` sort expression for a codec preference, or null for default
 * ordering. Verified empirically against yt-dlp 2026.08.19 on a video with
 * av1/vp9/h264 variants (default selects av01; `-S vcodec:h264` selects
 * avc1; `-S vcodec:h264,acodec:aac` selects avc1+mp4a).
 */
export function codecSortOf(preset: DownloadPreset, codecPref: CodecPreference): string | null {
  if (preset.kind !== "video") return null;
  if (preset.rawFormat !== null && preset.rawFormat.trim().length > 0) return null;
  if (preset.videoPreset === "Compatible") return "vcodec:h264,acodec:aac";
  switch (codecPref) {
    case "h264":
      return "vcodec:h264";
    case "vp9":
      return "vcodec:vp9";
    case "av1":
      return "vcodec:av01";
    case "auto":
      return null;
  }
}

/** Metadata without downloading. Playlist-aware via --flat-playlist. */
export function buildInfoArgs(rawUrl: string): string[] {
  const url = normalizeUrl(rawUrl);
  return [
    "--dump-single-json",
    "--flat-playlist",
    "--no-warnings",
    "--ignore-config",
    "--no-progress",
    url,
  ];
}

export function buildDownloadArgs(input: DownloadArgsInput): string[] {
  const url = normalizeUrl(input.url);
  const args: string[] = [
    "--newline",
    "--progress-template",
    PROGRESS_TEMPLATE,
    "--continue",
    "--ignore-config",
    "--no-warnings",
    // Keep very long titles inside Windows path limits.
    "--trim-filenames",
    "200",
  ];

  args.push(
    "--output",
    joinOutputTemplate(input.outputDir, input.filenameTemplate, input.playlistSubdir),
  );

  if (input.preset.rawFormat !== null && input.preset.rawFormat.trim().length > 0) {
    args.push("--format", input.preset.rawFormat.trim());
  } else if (
    input.customFormat !== undefined &&
    input.customFormat !== null &&
    input.customFormat.trim().length > 0
  ) {
    // Global Advanced selector (Phase 2): per-job rawFormat wins when set.
    args.push("--format", input.customFormat.trim());
  } else if (input.preset.kind === "audio") {
    args.push("--format", "bestaudio/best");
    // "Best" keeps the source stream: no extraction, no re-encode (v1.7.2).
    const audioFormat = audioFormatOf(input.preset);
    if (audioFormat !== null) {
      args.push("--extract-audio");
      args.push("--audio-format", audioFormat);
      // Default yt-dlp audio quality is VBR ~5 (~160kbps). Music downloads
      // expect studio quality, so pin the best VBR level.
      args.push("--audio-quality", "0");
    }
  } else {
    args.push("--format", videoFormatOf(input.preset));
    const sort = codecSortOf(input.preset, input.codecPreference);
    if (sort !== null) {
      args.push("--format-sort", sort);
    }
    const container = chosenContainer(input);
    if (container !== null) {
      // Both flags on purpose: --merge-output-format only applies when a merge
      // is required, while --remux-video also covers a single-stream source.
      // Together they make the chosen container stick (v1.7.2). The merge set
      // is narrower than the remux set (no gif), so they are gated separately.
      const merge = mergeContainerOf(input);
      if (merge !== null) args.push("--merge-output-format", merge);
      args.push("--remux-video", container);
    }
  }

  if (input.ffmpegDir !== null && input.ffmpegDir.trim().length > 0) {
    args.push("--ffmpeg-location", input.ffmpegDir.trim());
  }
  if (input.embedThumbnail) args.push("--embed-thumbnail");
  // M4.3: explicit tags are useless unless they are embedded, so overrides
  // force --embed-metadata even when the global setting is off.
  const metaArgs = buildParseMetadataArgs(input.audioMetadata ?? null);
  if (metaArgs.length > 0) {
    args.push("--embed-metadata");
    for (const meta of metaArgs) args.push("--parse-metadata", meta);
  } else if (input.embedMetadata) {
    args.push("--embed-metadata");
  }
  if (input.writeSubs) {
    args.push("--write-subs");
    // Most YouTube videos only carry auto-generated captions (no manual
    // upload from the creator), so manual-only fetching silently yields
    // nothing. Off by default only when the user opts out in Settings.
    if (input.writeAutoSubs !== false) args.push("--write-auto-subs");
    if (input.subLangs.trim().length > 0) {
      args.push("--sub-langs", input.subLangs.trim());
    }
    if (input.embedSubs) args.push("--embed-subs");
  }
  if (input.sponsorBlock) {
    const cats =
      typeof input.sponsorBlockCategories === "string" &&
      input.sponsorBlockCategories.trim().length > 0
        ? input.sponsorBlockCategories.trim()
        : "all,-filler";
    args.push("--sponsorblock-remove", cats);
  } else {
    args.push("--no-sponsorblock");
  }
  if (input.speedLimit !== null && input.speedLimit.trim().length > 0) {
    args.push("--limit-rate", input.speedLimit.trim());
  }
  if (input.proxy !== null && input.proxy.trim().length > 0) {
    args.push("--proxy", input.proxy.trim());
  }
  if (input.cookiesFile !== null && input.cookiesFile.trim().length > 0) {
    args.push("--cookies", input.cookiesFile.trim());
  }
  if (input.cookiesFromBrowser !== null && input.cookiesFromBrowser.trim().length > 0) {
    args.push("--cookies-from-browser", input.cookiesFromBrowser.trim());
  }
  if (input.archivePath !== null && input.archivePath.trim().length > 0) {
    args.push("--download-archive", input.archivePath.trim());
  }
  // Explicit re-download: yt-dlp otherwise reports "has already been
  // downloaded" and exits 0, so the file is never refetched (M4.8).
  // --force-overwrites implies --no-continue, which is what "download again"
  // means; ordinary downloads keep --continue.
  if (input.forceOverwrite === true) {
    args.push("--force-overwrites");
  }
  if (input.liveFromStart === true) {
    args.push("--live-from-start");
  }
  if (input.waitForVideo === true) {
    args.push("--wait-for-video", "60");
  }
  if (input.liveStatus === "is_live" || input.liveFromStart === true) {
    args.push("--hls-use-mpegts");
  }
  if (input.splitChapters === true) {
    args.push("--split-chapters");
    args.push(
      "--output",
      `chapter:${buildChapterOutputTemplate(input.outputDir, input.playlistSubdir)}`,
    );
  }
  args.push(input.noPlaylist ? "--no-playlist" : "--yes-playlist");
  // Phase 2 hardening knobs. Every one is off by default, so the default
  // argv stays byte-identical to earlier releases. All verified against
  // yt-dlp 2026.08.19 --help.
  if (typeof input.jsRuntime === "string" && input.jsRuntime.trim().length > 0) {
    args.push("--js-runtimes", input.jsRuntime.trim().slice(0, 64));
  }
  if (input.useAria2c === true) {
    // Bare --downloader: yt-dlp defaults apply. Custom tuning is deliberately
    // absent (unverified against an aria2c binary here).
    args.push("--downloader", "aria2c");
  }
  if (
    typeof input.concurrentFragments === "number" &&
    Number.isFinite(input.concurrentFragments)
  ) {
    const n = Math.min(16, Math.max(1, Math.floor(input.concurrentFragments)));
    args.push("-N", String(n));
  }
  if (typeof input.downloadRetries === "number" && Number.isFinite(input.downloadRetries)) {
    const raw = Math.floor(input.downloadRetries);
    if (raw >= 0) {
      const n = Math.min(30, raw);
      args.push("-R", String(n));
      args.push("--fragment-retries", String(n));
    }
  }
  if (typeof input.socketTimeoutSec === "number" && Number.isFinite(input.socketTimeoutSec)) {
    const n = Math.min(300, Math.max(5, Math.floor(input.socketTimeoutSec)));
    args.push("--socket-timeout", String(n));
  }
  const trimStart = typeof input.trimStart === "string" ? input.trimStart.trim() : "";
  const trimEnd = typeof input.trimEnd === "string" ? input.trimEnd.trim() : "";
  if (trimStart.length > 0 || trimEnd.length > 0) {
    args.push("--download-sections", `*${trimStart.slice(0, 32)}-${trimEnd.slice(0, 32)}`);
    args.push("--force-keyframes-at-cuts");
  }
  if (typeof input.impersonateClient === "string" && input.impersonateClient.trim().length > 0) {
    args.push("--impersonate", input.impersonateClient.trim().slice(0, 64));
  }
  // Polite pacing last, right before the URL (v1.7.2). Off by default: an
  // empty array adds nothing, so the default argv is byte-identical to before.
  args.push(
    ...pacingArgs({
      sleepRequestsSec: input.sleepRequestsSec,
      minSleepIntervalSec: input.minSleepIntervalSec,
      maxSleepIntervalSec: input.maxSleepIntervalSec,
      sleepSubtitlesSec: input.sleepSubtitlesSec,
    }),
  );
  args.push(url);
  return args;
}

const SECRET_FLAGS: ReadonlySet<string> = new Set(["--cookies", "--proxy"]);

/**
 * Redact secret-adjacent argv values (cookie file paths, proxy credentials)
 * before a command is shown anywhere (Logs "show command", diagnostics).
 * Shape-preserving: flags stay, values become "(redacted)".
 */
export function redactArgs(args: readonly string[]): string[] {
  const out = [...args];
  for (let i = 0; i < out.length; i += 1) {
    if (!SECRET_FLAGS.has(out[i] ?? "")) continue;
    if (i + 1 < out.length) out[i + 1] = "(redacted)";
  }
  return out;
}

export function buildVersionArgs(): string[] {
  return ["--version"];
}

export function buildUpdateArgs(): string[] {
  return ["--update"];
}

/** Channel-aware updater: stable uses -U, nightly uses --update-to. */
export function buildUpdateToArgs(channel: "stable" | "nightly"): string[] {
  if (channel === "nightly") return ["--update-to", "nightly@latest"];
  return ["--update"];
}

export function buildFfmpegVersionArgs(): string[] {
  return ["-version"];
}

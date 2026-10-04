import type { CodecPreference, DownloadPreset, LiveStatus } from "./types.js";
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
 * --download-archive, -U/--update, --live-from-start, --wait-for-video, --hls-use-mpegts.
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

function audioFormatOf(preset: DownloadPreset): string {
  switch (preset.audioPreset) {
    case "MP3":
      return "mp3";
    case "M4A":
      return "m4a";
    case "Opus":
      return "opus";
    case "FLAC":
      return "flac";
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
  }
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
  } else if (input.preset.kind === "audio") {
    args.push("--format", "bestaudio/best");
    args.push("--extract-audio");
    args.push("--audio-format", audioFormatOf(input.preset));
    // Default yt-dlp audio quality is VBR ~5 (~160kbps). Music downloads
    // expect studio quality, so pin the best VBR level.
    args.push("--audio-quality", "0");
  } else {
    args.push("--format", videoFormatOf(input.preset));
    const sort = codecSortOf(input.preset, input.codecPreference);
    if (sort !== null) {
      args.push("--format-sort", sort);
    }
    if (input.mergeContainer.trim().length > 0) {
      args.push("--merge-output-format", input.mergeContainer.trim());
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
    args.push("--sponsorblock-remove", "all,-filler");
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

export function buildFfmpegVersionArgs(): string[] {
  return ["-version"];
}

import type { DownloadPreset } from "./types.js";
import { PROGRESS_TEMPLATE } from "./progress.js";
import { normalizeUrl } from "./url.js";

/**
 * yt-dlp arg builder. Always returns an args array (never a shell string).
 * Flags verified against yt-dlp 2026.08.19 (`yt-dlp --help`):
 * -J/--dump-single-json, --flat-playlist, --newline, --progress-template,
 * -c/--continue, -o/--output, -f/--format, -x/--extract-audio,
 * --merge-output-format, --ffmpeg-location, --embed-*, --write-subs,
 * --sponsorblock-*, --limit-rate, --proxy, --cookies-from-browser, -U/--update.
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
  readonly sponsorBlock: boolean;
  readonly speedLimit: string | null;
  readonly proxy: string | null;
  readonly cookiesFromBrowser: string | null;
  readonly noPlaylist: boolean;
}

function joinOutputTemplate(outputDir: string, filenameTemplate: string): string {
  const dir = outputDir.replace(/[/\\]+$/, "");
  return `${dir}/${filenameTemplate}`;
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

  args.push("--output", joinOutputTemplate(input.outputDir, input.filenameTemplate));

  if (input.preset.rawFormat !== null && input.preset.rawFormat.trim().length > 0) {
    args.push("--format", input.preset.rawFormat.trim());
  } else if (input.preset.kind === "audio") {
    args.push("--format", "bestaudio/best");
    args.push("--extract-audio");
    args.push("--audio-format", audioFormatOf(input.preset));
  } else {
    args.push("--format", videoFormatOf(input.preset));
    if (input.mergeContainer.trim().length > 0) {
      args.push("--merge-output-format", input.mergeContainer.trim());
    }
  }

  if (input.ffmpegDir !== null && input.ffmpegDir.trim().length > 0) {
    args.push("--ffmpeg-location", input.ffmpegDir.trim());
  }
  if (input.embedThumbnail) args.push("--embed-thumbnail");
  if (input.embedMetadata) args.push("--embed-metadata");
  if (input.writeSubs) {
    args.push("--write-subs");
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
  if (input.cookiesFromBrowser !== null && input.cookiesFromBrowser.trim().length > 0) {
    args.push("--cookies-from-browser", input.cookiesFromBrowser.trim());
  }
  args.push(input.noPlaylist ? "--no-playlist" : "--yes-playlist");
  args.push(url);
  return args;
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

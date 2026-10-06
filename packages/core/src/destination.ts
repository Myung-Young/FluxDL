/**
 * Destination recovery (M3.1). Pure helpers for the non-ASCII mojibake gap:
 * the frozen yt-dlp binary prints non-ASCII path segments as U+FFFD, so the
 * reported destination may not resolve. When that happens the engine scans
 * the output dir for the most likely real file.
 */

import type { MediaKind } from "./types.js";

/**
 * Season folder from episode-style titles ("Show S01E02", "Show 1x02",
 * "Show Season 1") — "Season 01", else null. Used by auto-sort (F1/F3).
 */
export function episodeSeasonFolder(title: string): string | null {
  const m = /(?:\b[Ss](\d{1,2})[Ee](\d{1,3})\b|\b(\d{1,2})[xX](\d{1,3})\b|\b[Ss]eason\s+(\d{1,2})\b)/.exec(
    title,
  );
  const season = m?.[1] ?? m?.[3] ?? m?.[5];
  if (season === undefined || season.length === 0) return null;
  return `Season ${season.padStart(2, "0")}`;
}

/**
 * Auto-sort subfolder (F1): audio goes to Music, video to Videos (plus a
 * season folder when the title carries one). Null keeps the flat layout.
 */
export function autoSortSubdir(kind: MediaKind, title: string): string | null {
  if (kind === "audio") return "Music";
  const season = episodeSeasonFolder(title);
  return season === null ? "Videos" : `Videos/${season}`;
}

export interface DirEntry {
  readonly name: string;
  readonly mtimeMs: number;
}

/**
 * Every media extension yt-dlp can produce, so a finished file is recognised
 * no matter which container it landed in (v1.7.2).
 *
 * Video: mp4/m4v, webm, mkv, flv/f4v/f4a/f4b/f4p, 3gp/3g2, avi, mov/qt,
 * ts/m2ts/mts/tsv, mpg/mpeg/m2v, vob, ogv/ogg, wmv/asf, gif.
 * Audio: m4a/m4b, aac, webm, mp3, flac, opus, ogg/oga, wav, alac, wma, mka,
 * aiff/aif, amr, ac3/eac3, dts.
 * Live-stream manifests are listed too: they are what a live recording is
 * fetched as, and the user still expects them to open.
 *
 * Verified container choices against the bundled yt-dlp 2026.08.19; the
 * container LIST here is about recognising output, which is wider than the set
 * yt-dlp will happily remux into.
 */
const MEDIA_EXTS: readonly string[] = [
  // Video containers
  ".mp4",
  ".m4v",
  ".webm",
  ".mkv",
  ".flv",
  ".f4v",
  ".f4a",
  ".f4b",
  ".f4p",
  ".3gp",
  ".3g2",
  ".avi",
  ".mov",
  ".qt",
  ".ts",
  ".m2ts",
  ".mts",
  ".tsv",
  ".mpg",
  ".mpeg",
  ".m2v",
  ".vob",
  ".ogv",
  ".wmv",
  ".asf",
  ".gif",
  // Audio containers / formats
  ".m4a",
  ".m4b",
  ".aac",
  ".mp3",
  ".flac",
  ".opus",
  ".ogg",
  ".oga",
  ".wav",
  ".alac",
  ".wma",
  ".mka",
  ".aiff",
  ".aif",
  ".amr",
  ".ac3",
  ".eac3",
  ".dts",
  // Live-stream manifests
  ".m3u8",
  ".mpd",
  ".ism",
  ".isml",
  ".f4m",
];

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/** True when yt-dlp likely mangled the path (lossy replacement char). */
export function hasMojibake(path: string): boolean {
  return path.includes("�");
}

/** True for files yt-dlp could plausibly have produced. */
export function isMediaFile(name: string): boolean {
  return MEDIA_EXTS.includes(extOf(name));
}

const EXEC_EXTS: readonly string[] = [
  ".exe",
  ".msi",
  ".bat",
  ".cmd",
  ".ps1",
  ".scr",
  ".com",
  ".pif",
  ".reg",
  ".vbs",
  ".wsf",
  ".msc",
];

/** True when opening the path would execute code (warn first, C5). */
export function isExecutablePath(path: string): boolean {
  const lower = path.toLowerCase();
  return EXEC_EXTS.some((ext) => lower.endsWith(ext));
}

/** Audio/video grouping for storage insights (F2); null for anything else. */
export const AUDIO_GROUP: readonly string[] = [
  ".mp3",
  ".m4a",
  ".m4b",
  ".aac",
  ".opus",
  ".ogg",
  ".oga",
  ".wav",
  ".flac",
  ".alac",
  ".wma",
  ".mka",
  ".aiff",
  ".aif",
  ".amr",
  ".ac3",
  ".eac3",
  ".dts",
];
export const VIDEO_GROUP: readonly string[] = [
  ".mp4",
  ".m4v",
  ".mkv",
  ".webm",
  ".flv",
  ".f4v",
  ".3gp",
  ".3g2",
  ".avi",
  ".mov",
  ".qt",
  ".ts",
  ".m2ts",
  ".mts",
  ".tsv",
  ".mpg",
  ".mpeg",
  ".m2v",
  ".vob",
  ".ogv",
  ".wmv",
  ".asf",
  ".gif",
];

/**
 * Streaming manifests are neither audio nor video for the storage card: they
 * are tiny pointers, so counting them as media would distort the totals.
 */
const MANIFEST_EXTS: readonly string[] = [".m3u8", ".mpd", ".ism", ".isml", ".f4m"];

export function mediaGroup(name: string): "audio" | "video" | null {
  const ext = extOf(name);
  if (MANIFEST_EXTS.includes(ext)) return null;
  if (AUDIO_GROUP.includes(ext)) return "audio";
  if (VIDEO_GROUP.includes(ext)) return "video";
  return null;
}

/**
 * Pick the most likely real output from a directory listing.
 * - Prefer a media file whose name contains the video id
 *   (`[id]` from the default template, or a bare occurrence).
 * - Else the most recently modified media file within maxAgeMs of `now`.
 * - Else null (caller keeps the reported destination; Missing badge covers it).
 */
export function pickFallbackFile(
  videoId: string | null,
  files: readonly DirEntry[],
  now = Date.now(),
  maxAgeMs = 5 * 60 * 1000,
): string | null {
  const media = files.filter((f) => isMediaFile(f.name));
  if (media.length === 0) return null;
  const id = videoId?.trim() ?? "";
  if (id.length > 0) {
    const bracket = media.find((f) => f.name.includes(`[${id}]`));
    if (bracket !== undefined) return bracket.name;
    const bare = media.find((f) => f.name.includes(id));
    if (bare !== undefined) return bare.name;
  }
  let best: DirEntry | null = null;
  for (const f of media) {
    if (!Number.isFinite(f.mtimeMs)) continue;
    if (now - f.mtimeMs > maxAgeMs) continue;
    if (best === null || f.mtimeMs > best.mtimeMs) best = f;
  }
  return best?.name ?? null;
}

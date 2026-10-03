/**
 * Destination recovery (M3.1). Pure helpers for the non-ASCII mojibake gap:
 * the frozen yt-dlp binary prints non-ASCII path segments as U+FFFD, so the
 * reported destination may not resolve. When that happens the engine scans
 * the output dir for the most likely real file.
 */

export interface DirEntry {
  readonly name: string;
  readonly mtimeMs: number;
}

const MEDIA_EXTS: readonly string[] = [
  ".mp4",
  ".mkv",
  ".webm",
  ".m4a",
  ".mp3",
  ".opus",
  ".flac",
  ".wav",
  ".m4v",
  ".mov",
  ".aac",
  ".ogg",
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

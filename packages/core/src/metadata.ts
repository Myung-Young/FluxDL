import type { DownloadPreset, MediaInfo } from "./types.js";

/**
 * Audio metadata (M4.3) — pure helpers.
 *
 * Values reach the file as yt-dlp `meta_*` info fields, written by
 * `--parse-metadata` and flushed to the container by `--embed-metadata`.
 *
 * The escaping rules below are not guesses: they come from
 * `yt_dlp/postprocessor/metadataparser.py` + `YoutubeDL.evaluate_outtmpl`
 * (yt-dlp 2026.08.19), and every rule here is pinned by a unit test and by a
 * live ffprobe round trip (see DECISIONS D80b).
 *
 *   1. `FROM:TO` splits on the first colon NOT preceded by a backslash
 *      (regex `(?s)(?P<in>.*?)(?<!\\):(?P<out>.+)$`), then FROM gets every
 *      `\:` collapsed back to `:`. So EVERY literal colon must be `\:`.
 *   2. FROM is evaluated as an yt-dlp *output template*, where `%` is a
 *      format character. `%%` is the only way to write a literal `%`, and
 *      without it a value like `%(title)s` expands to real metadata.
 *   3. A FROM that is a bare `[a-zA-Z_]+` word is read as a *field
 *      reference* and silently resolves to the `NA` placeholder — which is
 *      why every value carries a sentinel suffix.
 *   4. TO is compiled as a Python regex unless it contains `%(field)s`, so the
 *      regex metacharacters in a literal must be escaped, and `(` must be
 *      escaped too: an escaped `\(` stops the `%\(\w+\)s` field pattern from
 *      matching, so a literal `%(title)s` stays literal instead of becoming a
 *      named group.
 *
 * Both sides are derived from the same value by `escapeTemplate` /
 * `escapeRegex`, so they cannot disagree.
 */

/** Appended to FROM and matched (uncaptured) at the end of TO. */
const SENTINEL = "~";

/** File metadata fields the editor can override. */
export type AudioMetaField = "title" | "artist" | "album" | "date";

/** yt-dlp `meta_` field written for each editable field. */
const META_FIELD: Readonly<Record<AudioMetaField, string>> = {
  title: "meta_title",
  artist: "meta_artist",
  album: "meta_album",
  date: "meta_date",
};

export interface AudioMetadata {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly year: string;
}

/** yt-dlp output-template escaping for the FROM side of `--parse-metadata`. */
function escapeTemplate(value: string): string {
  return value.split("%").join("%%").split(":").join("\\:");
}

/** Python-regex escaping for the TO side (metacharacters only). */
function escapeRegex(value: string): string {
  return value.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
}

/**
 * One `--parse-metadata` value for one field, or null when the value is empty
 * (yt-dlp would otherwise write an empty tag).
 */
export function buildParseMetadataArg(field: AudioMetaField, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const metaField = META_FIELD[field];
  return `${escapeTemplate(`${trimmed}${SENTINEL}`)}:(?P<${metaField}>${escapeRegex(trimmed)})${SENTINEL}`;
}

/** `--parse-metadata` values for every non-empty field, in a stable order. */
export function buildParseMetadataArgs(meta: AudioMetadata | null): string[] {
  if (meta === null) return [];
  const pairs: readonly (readonly [AudioMetaField, string])[] = [
    ["title", meta.title],
    ["artist", meta.artist],
    ["album", meta.album],
    ["date", meta.year],
  ];
  const out: string[] = [];
  for (const [field, value] of pairs) {
    const arg = buildParseMetadataArg(field, value);
    if (arg !== null) out.push(arg);
  }
  return out;
}

/** True when at least one field would actually change the file's tags. */
export function hasAudioMetadata(meta: AudioMetadata | null): boolean {
  return buildParseMetadataArgs(meta).length > 0;
}

const ARTIST_TITLE = /^(.{1,120}?)\s+[-–—]\s+(.+)$/;

/**
 * Seed the editor from the analyzed media: an "Artist - Title" heuristic for
 * the title, the uploader as the artist, and the upload year when the dump
 * carries one. Best effort only — every field stays editable.
 */
export function defaultAudioMetadata(
  info: Pick<MediaInfo, "title" | "uploader" | "uploadDate">,
): AudioMetadata {
  const split = ARTIST_TITLE.exec(info.title.trim());
  const artistFromTitle = split?.[1]?.trim() ?? "";
  const titleFromSplit = split?.[2]?.trim() ?? "";
  const year = /^\d{4}/.exec(info.uploadDate ?? "")?.[0] ?? "";
  return {
    title: titleFromSplit.length > 0 ? titleFromSplit : info.title,
    artist: artistFromTitle.length > 0 ? artistFromTitle : (info.uploader ?? ""),
    album: info.uploader ?? "",
    year,
  };
}

/** True when the preset produces an audio file (metadata editor applies). */
export function isAudioPreset(preset: Pick<DownloadPreset, "kind" | "rawFormat">): boolean {
  return preset.kind === "audio" && (preset.rawFormat ?? "").trim().length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Trust boundary (R1 rule 4): the renderer is untrusted, so rebuild the
 * payload from primitives instead of trusting its shape. Non-strings become
 * empty (and an all-empty result simply produces no flags).
 */
export function normalizeAudioMetadata(raw: unknown): AudioMetadata | null {
  if (!isRecord(raw)) return null;
  return {
    title: field(raw["title"]),
    artist: field(raw["artist"]),
    album: field(raw["album"]),
    year: field(raw["year"]),
  };
}

/** True when the payload carries at least one non-empty tag value. */
export function isAudioMetadata(raw: unknown): boolean {
  const meta = normalizeAudioMetadata(raw);
  return meta !== null && hasAudioMetadata(meta);
}
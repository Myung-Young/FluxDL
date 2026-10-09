import type { EngineId, MediaKind, PostProcessSettings } from "./types.js";

/**
 * Post-processing pipeline (Phase 4, pure). Step selection, MusicBrainz
 * query/parse, ffprobe summary parse, HW-encoder pick. Execution lives
 * main-side (`apps/desktop/src/main/postprocess.ts`); gallery-native steps
 * (zip/cbz/ugoira) ride the gallery argv, only their settings live here.
 */

/** Steps the local runner executes (gallery-native steps ride argv). */
export type PostStep =
  | "convert-image"
  | "tag-audio"
  | "compress-video"
  | "transcribe-audio"
  | "upload-remote";

export const POST_STEPS: readonly PostStep[] = [
  "convert-image",
  "tag-audio",
  "compress-video",
  "transcribe-audio",
  "upload-remote",
];

const IMAGE_EXTS: readonly string[] = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
];

const AUDIO_EXTS: readonly string[] = [
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
  ".aiff",
  ".aif",
];

const VIDEO_EXTS: readonly string[] = [
  ".mp4",
  ".m4v",
  ".webm",
  ".mkv",
  ".mov",
  ".avi",
  ".wmv",
  ".flv",
  ".mpg",
  ".mpeg",
  ".ts",
  ".m2ts",
  ".3gp",
];

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return dot > slash && dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

export function isImageFile(path: string): boolean {
  return IMAGE_EXTS.includes(extOf(path));
}

export function isAudioFile(path: string): boolean {
  return AUDIO_EXTS.includes(extOf(path));
}

export function isVideoFile(path: string): boolean {
  return VIDEO_EXTS.includes(extOf(path));
}

/** A resolved input file with its detected class. */
export interface PostFile {
  readonly path: string;
  readonly class: "image" | "audio" | "video" | "other";
}

export function classifyPostFile(path: string): PostFile {
  if (isImageFile(path)) return { path, class: "image" };
  if (isAudioFile(path)) return { path, class: "audio" };
  if (isVideoFile(path)) return { path, class: "video" };
  return { path, class: "other" };
}

export interface StepsForInput {
  readonly kind: MediaKind;
  readonly engine: EngineId | null;
  readonly files: readonly PostFile[];
  readonly settings: PostProcessSettings;
  /** True when gallery-dl already zipped the outputs (convert can't reach them). */
  readonly packaged: boolean;
}

/**
 * Which runner steps apply to a finished job. Gallery-native
 * packaging/ugoira ride argv (no runner code); the runner handles
 * conversion, tagging, compression, transcription and upload.
 * Upload is manual-only unless autoUpload is on with a remote set.
 * Empty = nothing to do.
 */
export function stepsFor(input: StepsForInput): PostStep[] {
  const s = input.settings;
  const out: PostStep[] = [];
  const has = (c: PostFile["class"]): boolean => input.files.some((f) => f.class === c);
  if (s.convertImages && !input.packaged && has("image")) out.push("convert-image");
  if (s.autoTagAudio && (input.kind === "audio" || input.engine === null) && has("audio")) {
    out.push("tag-audio");
  }
  if (s.compressVideo !== "off" && input.kind === "video" && has("video")) {
    out.push("compress-video");
  }
  if (s.transcribeAudio && has("audio")) out.push("transcribe-audio");
  if (s.autoUpload && s.rcloneRemote !== null && (has("video") || has("audio"))) {
    out.push("upload-remote");
  }
  return out;
}

/** Output path for a conversion step (sibling, suffix before the ext). */
export function convertOutputPath(inputPath: string, format: "jpg" | "png"): string {
  const dot = inputPath.lastIndexOf(".");
  const base = dot >= 0 ? inputPath.slice(0, dot) : inputPath;
  return `${base}.fluxdl.${format}`;
}

/** whisper-cli argv: model + 16 kHz wav in, .srt sidecar out. */
export function buildWhisperArgs(modelPath: string, wavPath: string, srtBase: string): string[] {
  return ["-m", modelPath, "-f", wavPath, "-osrt", "-of", srtBase];
}

/** rclone destination: remote dir + basename (remotes are folders by convention). */
export function rcloneDest(remote: string, filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const trimmed = remote.trim();
  return trimmed.endsWith("/") || trimmed.endsWith("\\") ? `${trimmed}${base}` : `${trimmed}/${base}`;
}

/** rclone copyto argv (non-interactive, quiet, auto-confirm). */
export function buildRcloneArgs(filePath: string, remote: string): string[] {
  return ["copyto", filePath, rcloneDest(remote, filePath), "--auto-confirm", "-q"];
}

/** 16 kHz mono wav temp next to the source (whisper's native diet). */
export function wavTempPath(inputPath: string): string {
  const dot = inputPath.lastIndexOf(".");
  const base = dot >= 0 ? inputPath.slice(0, dot) : inputPath;
  return `${base}.fluxdl-16k.wav`;
}

/** .srt sidecar base next to the source (whisper appends .srt). */
export function srtBasePath(inputPath: string): string {
  const dot = inputPath.lastIndexOf(".");
  const base = dot >= 0 ? inputPath.slice(0, dot) : inputPath;
  return `${base}.fluxdl`;
}

/** ffmpeg image-convert argv (scale cap, quality, metadata strip). */
export function buildConvertArgs(
  inputPath: string,
  outputPath: string,
  opts: { format: "jpg" | "png"; quality: number; maxDim: number; stripExif: boolean },
): string[] {
  const q = Math.min(100, Math.max(1, Math.floor(opts.quality)));
  const dim = Math.min(8192, Math.max(64, Math.floor(opts.maxDim)));
  const args = ["-hide_banner", "-y", "-i", inputPath];
  args.push("-vf", `scale='min(${String(dim)},iw)':-2`);
  if (opts.format === "jpg") args.push("-q:v", String(Math.round(31 - (q / 100) * 29)));
  else args.push("-compression_level", String(Math.round(9 - (q / 100) * 9)));
  if (opts.stripExif) args.push("-map_metadata", "-1");
  args.push(outputPath);
  return args;
}

/** ffmpeg compress argv for the three presets (encoder picked by caller). */
export function buildCompressArgs(
  inputPath: string,
  outputPath: string,
  preset: "small" | "balanced" | "archive",
  encoder: string,
): string[] {
  const hw = encoder !== "libx264";
  const args = ["-hide_banner", "-y", "-i", inputPath];
  if (preset === "small") {
    args.push("-vf", "scale='min(1280,iw)':-2", "-c:v", encoder);
    args.push(hw ? "-cq" : "-crf", "28", "-preset", hw ? "p4" : "veryfast");
    args.push("-c:a", "aac", "-b:a", "128k");
  } else if (preset === "balanced") {
    args.push("-c:v", encoder);
    args.push(hw ? "-cq" : "-crf", "23", "-preset", hw ? "p4" : "medium");
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-c:v", encoder === "libx264" ? "libx265" : encoder);
    args.push(hw ? "-cq" : "-crf", "26", "-preset", hw ? "p4" : "medium");
    args.push("-c:a", "aac", "-b:a", "192k");
  }
  args.push(outputPath);
  return args;
}

// ---------------------------------------------------------------------------
// MusicBrainz (query builder + response parser; fetching lives main-side).
// ---------------------------------------------------------------------------

/** Minimum score (0-100) for silent auto-apply; below needs a human. */
export const TAG_AUTO_SCORE = 85;

export interface TagCandidate {
  readonly mbid: string;
  readonly title: string;
  readonly artist: string;
  readonly release: string | null;
  readonly releaseMbid: string | null;
  readonly date: string | null;
  readonly score: number;
}

/** Lucene query for a recording search (title + artist when known). */
export function buildRecordingQuery(title: string, artist: string | null): string {
  const t = title.trim().slice(0, 200);
  const a = artist === null ? "" : artist.trim().slice(0, 200);
  const parts = [`recording:"${t.replace(/"/g, "")}"`];
  if (a.length > 0) parts.push(`artist:"${a.replace(/"/g, "")}"`);
  return parts.join(" AND ");
}

/**
 * Search hint from a finished file: strips the directory, the extension and
 * a trailing " [id]" suffix (the default template). Best effort — the
 * caller prefers real metadata (job title/uploader) when it has it.
 */
export function hintFromFilename(path: string): { title: string; artist: null } {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  const noExt = (dot > 0 ? base.slice(0, dot) : base).trim();
  // Strip a trailing " [id]" suffix (the default filename template).
  let title = noExt;
  if (noExt.endsWith("]")) {
    const open = noExt.lastIndexOf(" [");
    if (open > 0) title = noExt.slice(0, open).trim();
  }
  return { title: title.length > 0 ? title : noExt, artist: null };
}

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parse a recording-search payload into ranked candidates (best first). */
export function parseRecordingResponse(payload: unknown): TagCandidate[] {
  if (typeof payload !== "object" || payload === null) return [];
  const recs: unknown = (payload as Record<string, unknown>)["recordings"];
  if (!Array.isArray(recs)) return [];
  const out: TagCandidate[] = [];
  for (const item of recs.slice(0, 10)) {
    const rec: unknown = item;
    if (typeof rec !== "object" || rec === null) continue;
    const fields = rec as Record<string, unknown>;
    const mbid = firstString(fields["id"]);
    const title = firstString(fields["title"]);
    if (mbid === null || title === null) continue;
    const credit: unknown = Array.isArray(fields["artist-credit"]) ? fields["artist-credit"] : [];
    const artist =
      Array.isArray(credit)
        ? credit
            .map((c: unknown) =>
              typeof c === "object" && c !== null
                ? firstString((c as Record<string, unknown>)["name"])
                : null,
            )
            .filter((n): n is string => n !== null)
            .join(", ") || "Unknown artist"
        : "Unknown artist";
    const releases: unknown = Array.isArray(fields["releases"]) ? fields["releases"] : [];
    const first: unknown = Array.isArray(releases) ? releases[0] : undefined;
    const rel = typeof first === "object" && first !== null ? (first as Record<string, unknown>) : null;
    const score = typeof fields["score"] === "number" ? fields["score"] : 0;
    out.push({
      mbid,
      title,
      artist,
      release: rel === null ? null : firstString(rel["title"]),
      releaseMbid: rel === null ? null : firstString(rel["id"]),
      date: rel === null ? null : firstString(rel["date"]),
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Split candidates into auto-apply vs needs-a-human at the threshold. */
export function pickTagCandidate(
  candidates: readonly TagCandidate[],
  minScore = TAG_AUTO_SCORE,
): { auto: TagCandidate | null; bestBelow: TagCandidate | null } {
  const best = candidates[0] ?? null;
  if (best === null) return { auto: null, bestBelow: null };
  if (best.score >= minScore) return { auto: best, bestBelow: null };
  return { auto: null, bestBelow: best };
}

/** Parse a single-recording lookup (apply-tag path) into a candidate. */
export function parseRecordingDetail(payload: unknown): TagCandidate | null {
  const out = parseRecordingResponse({ recordings: [payload] });
  return out[0] ?? null;
}

// ---------------------------------------------------------------------------
// ffprobe summary + HW encoder pick.
// ---------------------------------------------------------------------------

export interface MediaSummary {
  readonly durationSec: number | null;
  readonly sizeBytes: number | null;
  readonly formatName: string | null;
  readonly video: { codec: string; width: number | null; height: number | null; fps: string | null } | null;
  readonly audio: { codec: string; bitrate: number | null; sampleRate: number | null } | null;
  readonly tags: Readonly<Record<string, string>>;
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Parse `ffprobe -show_format -show_streams -of json` (never throws). */
export function parseMediaSummary(payload: unknown): MediaSummary | null {
  if (typeof payload !== "object" || payload === null) return null;
  const root = payload as Record<string, unknown>;
  const format = typeof root["format"] === "object" && root["format"] !== null
    ? (root["format"] as Record<string, unknown>)
    : null;
  const streams = Array.isArray(root["streams"]) ? root["streams"] : [];
  let video: MediaSummary["video"] = null;
  let audio: MediaSummary["audio"] = null;
  for (const s of streams) {
    if (typeof s !== "object" || s === null) continue;
    const st = s as Record<string, unknown>;
    if (st["codec_type"] === "video" && video === null) {
      const codec = firstString(st["codec_name"]);
      if (codec === null) continue;
      video = {
        codec,
        width: numOrNull(st["width"]),
        height: numOrNull(st["height"]),
        fps: firstString(st["avg_frame_rate"]) ?? firstString(st["r_frame_rate"]),
      };
    } else if (st["codec_type"] === "audio" && audio === null) {
      const codec = firstString(st["codec_name"]);
      if (codec === null) continue;
      audio = {
        codec,
        bitrate: numOrNull(st["bit_rate"]),
        sampleRate: numOrNull(st["sample_rate"]),
      };
    }
  }
  const tags: Record<string, string> = {};
  const rawTags = format !== null && typeof format["tags"] === "object" && format["tags"] !== null
    ? (format["tags"] as Record<string, unknown>)
    : {};
  for (const [k, v] of Object.entries(rawTags)) {
    if (typeof v === "string") tags[k.toLowerCase()] = v;
  }
  return {
    durationSec: format === null ? null : numOrNull(format["duration"]),
    sizeBytes: format === null ? null : numOrNull(format["size"]),
    formatName: format === null ? null : firstString(format["format_name"]),
    video,
    audio,
    tags,
  };
}

/** True when title+artist tags are already present (skip auto-tag). */
export function hasBasicTags(summary: MediaSummary): boolean {
  const t = summary.tags["title"] ?? "";
  const a = summary.tags["artist"] ?? "";
  return t.trim().length > 0 && a.trim().length > 0;
}

/** Method names from `ffmpeg -hwaccels` (lowercased, never throws). */
export function parseHwaccels(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length > 0 && l !== "hardware acceleration methods:");
}

/** True when an -encoders line names the given encoder. */
export function hasEncoder(encodersOutput: string, name: string): boolean {
  return encodersOutput
    .split(/\r?\n/)
    .some((l) => l.trim().split(/\s+/).includes(name));
}

/**
 * Pick an H.264 encoder: NVENC > QSV > AMF when both the method and the
 * encoder exist, else libx264 (always present in our builds).
 */
export function pickH264Encoder(hwaccels: readonly string[], encodersOutput: string): string {
  const hw = new Set(hwaccels);
  if (hw.has("cuda") && hasEncoder(encodersOutput, "h264_nvenc")) return "h264_nvenc";
  if (hw.has("qsv") && hasEncoder(encodersOutput, "h264_qsv")) return "h264_qsv";
  if (hw.has("amf") && hasEncoder(encodersOutput, "h264_amf")) return "h264_amf";
  return "libx264";
}

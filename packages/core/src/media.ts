import type {
  CodecPreference,
  DownloadPreset,
  FormatOption,
  MediaInfo,
  PlaylistEntry,
  VideoPreset,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickFirstString(values: readonly unknown[]): string | null {
  for (const v of values) {
    const s = asString(v);
    if (s !== null) return s;
  }
  return null;
}

function mapFormat(raw: unknown, index: number): FormatOption | null {
  if (!isRecord(raw)) return null;
  const formatId = asString(raw["format_id"]) ?? `f${String(index)}`;
  const ext = asString(raw["ext"]) ?? "mp4";
  const vcodec = asString(raw["vcodec"]);
  const acodec = asString(raw["acodec"]);
  const protocol = asString(raw["protocol"]);
  const kind =
    protocol === "mhtml" || ext === "mhtml"
      ? "storyboard"
      : vcodec !== null && vcodec !== "none" && acodec !== null && acodec !== "none"
        ? "video+audio"
        : vcodec !== null && vcodec !== "none"
          ? "video"
          : "audio";
  const resolution = asString(raw["resolution"]) ?? asString(raw["format_note"]);
  const labelParts: string[] = [formatId];
  if (resolution !== null) labelParts.push(resolution);
  labelParts.push(ext);
  return {
    formatId,
    label: labelParts.join(" · "),
    ext,
    kind,
    resolution,
    width: asNumber(raw["width"]),
    height: asNumber(raw["height"]),
    fps: asNumber(raw["fps"]),
    vcodec,
    acodec,
    tbr: asNumber(raw["tbr"]),
    filesize: asNumber(raw["filesize"]) ?? asNumber(raw["filesize_approx"]),
    protocol,
  };
}

function entryUrl(raw: Record<string, unknown>, fallback: string): string {
  const direct = pickFirstString([raw["webpage_url"], raw["original_url"], raw["url"]]);
  if (direct !== null && /^https?:\/\//.test(direct)) return direct;
  // flat-playlist `url` is often a bare id; fall back to the source URL.
  return fallback;
}

function mapEntry(raw: unknown, fallbackUrl: string): PlaylistEntry | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw["id"]);
  if (id === null) return null;
  return {
    id,
    title: asString(raw["title"]) ?? id,
    url: entryUrl(raw, fallbackUrl),
    duration: asNumber(raw["duration"]),
    thumbnail: asString(raw["thumbnail"]),
    selected: true,
  };
}

/**
 * Map `--dump-single-json` output (single video or playlist) to MediaInfo.
 * Never throws on missing fields; throws only when the payload is not an object.
 */
export function parseMediaInfo(sourceUrl: string, data: unknown): MediaInfo {
  if (!isRecord(data)) {
    throw new Error("Invalid metadata payload: expected a JSON object.");
  }
  const isPlaylist = data["_type"] === "playlist";
  const rawEntries: unknown = data["entries"];
  const entries: PlaylistEntry[] = [];
  if (Array.isArray(rawEntries)) {
    for (const e of rawEntries) {
      const mapped = mapEntry(e, sourceUrl);
      if (mapped !== null) entries.push(mapped);
    }
  }
  const rawFormats: unknown = data["formats"];
  const formats: FormatOption[] = [];
  if (Array.isArray(rawFormats)) {
    rawFormats.forEach((f, i) => {
      const mapped = mapFormat(f, i);
      if (mapped !== null) formats.push(mapped);
    });
  }
  return {
    url: sourceUrl,
    title: asString(data["title"]) ?? "Untitled",
    uploader: pickFirstString([data["uploader"], data["uploader_id"], data["channel"]]),
    duration: asNumber(data["duration"]),
    thumbnail: asString(data["thumbnail"]),
    isPlaylist: isPlaylist || entries.length > 0,
    extractor: pickFirstString([data["extractor_key"], data["extractor"]]),
    videoId: asString(data["id"]),
    entries,
    formats,
  };
}

export interface SizeEstimate {
  readonly bytes: number;
  /** True when any component came from tbr x duration instead of a filesize. */
  readonly approximate: boolean;
}

function heightCapOf(videoPreset: VideoPreset): number {
  switch (videoPreset) {
    case "Best":
      return Number.POSITIVE_INFINITY;
    case "2160":
      return 2160;
    case "1440":
      return 1440;
    case "1080":
    case "Compatible":
      return 1080;
    case "720":
      return 720;
    case "480":
      return 480;
  }
}

/** Preferred vcodec prefix for a codec preference (null = no preference). */
function vcodecPrefixOf(codecPref: CodecPreference, videoPreset: VideoPreset): string | null {
  if (videoPreset === "Compatible") return "avc1";
  switch (codecPref) {
    case "h264":
      return "avc1";
    case "vp9":
      return "vp9";
    case "av1":
      return "av01";
    case "auto":
      return null;
  }
}

/**
 * Bytes for one format: exact filesize when known, else tbr (kbps) x
 * duration. Returns null when neither is usable. `usedFallback` reports
 * whether the tbr path was taken.
 */
function formatBytes(
  f: FormatOption,
  durationSec: number | null,
): { bytes: number; usedFallback: boolean } | null {
  if (f.filesize !== null) return { bytes: f.filesize, usedFallback: false };
  if (f.tbr !== null && durationSec !== null && durationSec > 0) {
    return { bytes: Math.round((f.tbr * 1000 * durationSec) / 8), usedFallback: true };
  }
  return null;
}

function betterCandidate(a: FormatOption, b: FormatOption): boolean {
  const ha = a.height ?? 0;
  const hb = b.height ?? 0;
  if (ha !== hb) return ha > hb;
  return (a.tbr ?? a.filesize ?? 0) > (b.tbr ?? b.filesize ?? 0);
}

function pickBest(candidates: readonly FormatOption[]): FormatOption | null {
  let best: FormatOption | null = null;
  for (const c of candidates) {
    if (best === null || betterCandidate(c, best)) best = c;
  }
  return best;
}

/**
 * Pure per-preset size estimate from analyzed formats.
 * Video: best video stream within the height cap (+ best audio stream when
 * the video stream carries no audio). Audio: best audio stream. Returns
 * null when no usable filesize/tbr data exists. `approximate` is true
 * whenever any component used the tbr x duration fallback.
 */
export function estimatePresetSize(
  info: MediaInfo,
  preset: DownloadPreset,
  codecPref: CodecPreference,
): SizeEstimate | null {
  if (preset.kind === "audio") {
    const audios = info.formats.filter((f) => f.kind === "audio");
    const best = pickBest(audios);
    if (best === null) return null;
    const sized = formatBytes(best, info.duration);
    if (sized === null) return null;
    return { bytes: sized.bytes, approximate: sized.usedFallback };
  }
  const cap = heightCapOf(preset.videoPreset);
  const prefix = vcodecPrefixOf(codecPref, preset.videoPreset);
  let videos = info.formats.filter(
    (f) => (f.kind === "video" || f.kind === "video+audio") && (f.height ?? 0) <= cap,
  );
  if (prefix !== null) {
    const matching = videos.filter((f) => f.vcodec !== null && f.vcodec.startsWith(prefix));
    if (matching.length > 0) videos = matching;
  }
  const video = pickBest(videos);
  if (video === null) return null;
  const videoSized = formatBytes(video, info.duration);
  if (videoSized === null) return null;
  if (video.kind === "video+audio") {
    return { bytes: videoSized.bytes, approximate: videoSized.usedFallback };
  }
  const audio = pickBest(info.formats.filter((f) => f.kind === "audio"));
  if (audio === null) {
    return { bytes: videoSized.bytes, approximate: true };
  }
  const audioSized = formatBytes(audio, info.duration);
  if (audioSized === null) {
    return { bytes: videoSized.bytes, approximate: true };
  }
  return {
    bytes: videoSized.bytes + audioSized.bytes,
    approximate: videoSized.usedFallback || audioSized.usedFallback,
  };
}

/** Human size for estimate chips, e.g. 1283456789 -> "1.2 GB" (Intl decimals). */
export function formatSize(bytes: number, locale = "en"): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const label = units[unit] ?? "B";
  const text =
    unit <= 1
      ? String(Math.round(value))
      : new Intl.NumberFormat(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
          useGrouping: false,
        }).format(value);
  return `${text} ${label}`;
}

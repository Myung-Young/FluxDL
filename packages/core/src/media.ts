import type { FormatOption, MediaInfo, PlaylistEntry } from "./types.js";

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
  const kind =
    vcodec !== null && vcodec !== "none" && acodec !== null && acodec !== "none"
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
    fps: asNumber(raw["fps"]),
    vcodec,
    acodec,
    tbr: asNumber(raw["tbr"]),
    filesize: asNumber(raw["filesize"]) ?? asNumber(raw["filesize_approx"]),
    protocol: asString(raw["protocol"]),
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
    entries,
    formats,
  };
}

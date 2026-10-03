/**
 * Machine-parseable progress template + pure line parser.
 *
 * Verified against yt-dlp 2026.08.19 (`yt-dlp --help`):
 * - `--newline` forces one progress line per update.
 * - `--progress-template [TYPES:]TEMPLATE` exposes `info` + `progress` fields.
 * Parser also handles classic `[download] 12.3% ...` lines as fallback.
 */

export const PROGRESS_TEMPLATE =
  "[GRABBER] downloaded:%(progress.downloaded_bytes)s total:%(progress.total_bytes)s percent:%(progress._percent_str)s speed:%(progress._speed_str)s eta:%(progress._eta_str)s elapsed:%(progress._elapsed_str)s";

export interface ParsedProgress {
  readonly percent: number | null;
  readonly speed: string | null;
  readonly eta: string | null;
  readonly downloadedBytes: number | null;
  readonly totalBytes: number | null;
  readonly stage: string;
  readonly elapsed?: string | null;
}

const TEMPLATE_RE =
  /\[GRABBER\]\s+downloaded:\s*(?<dl>\d+|NA)\s+total:\s*(?<tot>\d+|NA)\s+percent:\s*(?<pct>[\d.]+|NA)%?\s+speed:\s*(?<spd>.+?)\s+eta:\s*(?<eta>\S+)(?:\s+elapsed:\s*(?<elap>\S+))?/;

const CLASSIC_RE =
  /\[download\]\s+(?<pct>[\d.]+)%\s+of\s+(?:~\s+)?(?<tot>\S+)\s+in\s+\S+\s+at\s+(?<spd>\S+)(?:\s+ETA\s+(?<eta>\S+))?/;

const CLASSIC_LIVE_RE =
  /\[download\]\s+(?<dl>[\d.]+\s*[KMGTPE]?i?B)\s+at\s+(?<spd>\S+)(?:\s+\((?<elap>[\d:]+)\))?/;

function toBytesOrNull(raw: string): number | null {
  if (raw === "NA") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function toPercentOrNull(raw: string): number | null {
  if (raw === "NA") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function nullIfNA(raw: string): string | null {
  const t = raw.trim();
  if (t === "NA") return null;
  if (t.toLowerCase().startsWith("unknown")) return null;
  return t;
}

/**
 * Parse one yt-dlp console line. Returns null for non-progress lines
 * (extractor info, warnings, etc.) so callers can ignore them.
 */
export function parseProgressLine(line: string): ParsedProgress | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;

  const tpl = TEMPLATE_RE.exec(trimmed);
  if (tpl !== null && tpl.groups !== undefined) {
    const percent = toPercentOrNull(tpl.groups["pct"] ?? "NA");
    const speed = nullIfNA(tpl.groups["spd"] ?? "NA");
    const eta = nullIfNA(tpl.groups["eta"] ?? "NA");
    const elapsed = nullIfNA(tpl.groups["elap"] ?? "NA");
    const downloadedBytes = toBytesOrNull(tpl.groups["dl"] ?? "NA");
    const totalBytes = toBytesOrNull(tpl.groups["tot"] ?? "NA");
    return {
      percent,
      speed,
      eta,
      downloadedBytes,
      totalBytes,
      stage: percent === null ? "recording" : "downloading",
      elapsed,
    };
  }

  if (/\[download\]\s+Destination:/.test(trimmed)) {
    return {
      percent: 0,
      speed: null,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: "downloading",
    };
  }

  if (/has already been downloaded/.test(trimmed)) {
    return {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: "done",
    };
  }

  if (
    /^\[(Merger|ExtractAudio|VideoConvertor|VideoRemuxer|EmbedSubtitle|ThumbnailsConvertor|Metadata|SubtitlesConvertor|Fixup)/.test(
      trimmed,
    )
  ) {
    return {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: "processing",
    };
  }

  const classic = CLASSIC_RE.exec(trimmed);
  if (classic !== null && classic.groups !== undefined) {
    const percent = toPercentOrNull(classic.groups["pct"] ?? "NA");
    if (percent === null) return null;
    return {
      percent,
      speed: nullIfNA(classic.groups["spd"] ?? "NA"),
      eta: classic.groups["eta"] !== undefined ? nullIfNA(classic.groups["eta"] ?? "NA") : null,
      downloadedBytes: null,
      totalBytes: null,
      stage: percent >= 100 ? "done" : "downloading",
    };
  }

  const classicLive = CLASSIC_LIVE_RE.exec(trimmed);
  if (classicLive !== null && classicLive.groups !== undefined) {
    const speed = nullIfNA(classicLive.groups["spd"] ?? "NA");
    const elapsed = nullIfNA(classicLive.groups["elap"] ?? "NA");
    return {
      percent: null,
      speed,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: "recording",
      elapsed,
    };
  }

  return null;
}

const SPEED_RE = /^\s*([\d.]+)\s*([KMGTPE]?)(i?)(B?)\s*\/s\s*$/i;

/**
 * Parse a yt-dlp speed string ("3.35MiB/s", "512KiB/s", "1M/s") to bytes/s.
 * Returns null for missing/unparseable values ("NA", "Unknown").
 */
export function parseSpeedBps(raw: string | null): number | null {
  if (raw === null) return null;
  const m = SPEED_RE.exec(raw);
  if (m === null) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  const prefix = (m[2] ?? "").toUpperCase();
  const mult =
    prefix === "K"
      ? 1024
      : prefix === "M"
        ? 1024 ** 2
        : prefix === "G"
          ? 1024 ** 3
          : prefix === "T"
            ? 1024 ** 4
            : prefix === "P"
              ? 1024 ** 5
              : prefix === "E"
                ? 1024 ** 6
                : 1;
  return value * mult;
}

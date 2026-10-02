/**
 * Machine-parseable progress template + pure line parser.
 *
 * Verified against yt-dlp 2026.08.19 (`yt-dlp --help`):
 * - `--newline` forces one progress line per update.
 * - `--progress-template [TYPES:]TEMPLATE` exposes `info` + `progress` fields.
 * Parser also handles classic `[download] 12.3% ...` lines as fallback.
 */

export const PROGRESS_TEMPLATE =
  "[GRABBER] downloaded:%(progress.downloaded_bytes)s total:%(progress.total_bytes)s percent:%(progress._percent_str)s speed:%(progress._speed_str)s eta:%(progress._eta_str)s";

export interface ParsedProgress {
  readonly percent: number;
  readonly speed: string | null;
  readonly eta: string | null;
  readonly downloadedBytes: number | null;
  readonly totalBytes: number | null;
  readonly stage: string;
}

const TEMPLATE_RE =
  /\[GRABBER\]\s+downloaded:\s*(?<dl>\d+|NA)\s+total:\s*(?<tot>\d+|NA)\s+percent:\s*(?<pct>[\d.]+|NA)%?\s+speed:\s*(?<spd>.+?)\s+eta:\s*(?<eta>\S+)/;

const CLASSIC_RE =
  /\[download\]\s+(?<pct>[\d.]+)%\s+of\s+(?:~\s+)?(?<tot>\S+)\s+in\s+\S+\s+at\s+(?<spd>\S+)(?:\s+ETA\s+(?<eta>\S+))?/;

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
    if (percent === null) return null;
    return {
      percent,
      speed: nullIfNA(tpl.groups["spd"] ?? "NA"),
      eta: nullIfNA(tpl.groups["eta"] ?? "NA"),
      downloadedBytes: toBytesOrNull(tpl.groups["dl"] ?? "NA"),
      totalBytes: toBytesOrNull(tpl.groups["tot"] ?? "NA"),
      stage: "downloading",
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

  return null;
}

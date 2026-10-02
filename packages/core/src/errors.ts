/**
 * Raw stderr -> human message + category. Always keeps `raw` accessible
 * for the Logs screen. Case-insensitive substring matching, specific first.
 */

export type ErrorCategory =
  | "ffmpeg-missing"
  | "geo-blocked"
  | "private"
  | "age-gated"
  | "network"
  | "disk-full"
  | "unsupported-url"
  | "rate-limited"
  | "unknown";

export interface MappedError {
  readonly category: ErrorCategory;
  readonly message: string;
  readonly raw: string;
  readonly suggestCookies: boolean;
}

const RULES: ReadonlyArray<{
  readonly category: ErrorCategory;
  readonly pattern: RegExp;
  readonly message: string;
  readonly suggestCookies: boolean;
}> = [
  {
    category: "ffmpeg-missing",
    pattern: /ffmpeg.*not found|ffprobe.*not found|requires ffmpeg|ffmpeg.*missing/i,
    message: "FFmpeg is missing. Reinstall the app or place ffmpeg beside the engine.",
    suggestCookies: false,
  },
  {
    category: "geo-blocked",
    pattern: /not available in your country|geo.?blocked|geo restriction/i,
    message: "This video is blocked in your country or network region.",
    suggestCookies: false,
  },
  {
    category: "private",
    pattern: /private video|this video is private|login required.*private/i,
    message: "This video is private. Sign in or use cookies if you have access.",
    suggestCookies: false,
  },
  {
    category: "age-gated",
    pattern: /confirm your age|age.?gated|sign in to confirm/i,
    message: "Age-restricted video. Export browser cookies and retry.",
    suggestCookies: true,
  },
  {
    category: "disk-full",
    pattern: /no space left|disk.*full|not enough.*disk/i,
    message: "Disk is full. Free space or pick another download folder.",
    suggestCookies: false,
  },
  {
    category: "network",
    pattern:
      /network.*unreachable|connection.*timed out|temporary failure|failed to resolve|socket.*timeout|connection refused|urlopen error/i,
    message: "Network error. Check your connection or proxy and retry.",
    suggestCookies: false,
  },
  {
    category: "rate-limited",
    pattern: /rate.?limited|too many requests|\b429\b/i,
    message: "Rate-limited by the site. Wait a bit, then retry.",
    suggestCookies: false,
  },
  {
    category: "unsupported-url",
    pattern:
      /unsupported url|no suitable extractor|no video formats found|requested format not available/i,
    message: "This link is not supported or has no downloadable formats.",
    suggestCookies: false,
  },
];

export function mapDownloadError(raw: string): MappedError {
  const text = raw.trim();
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return {
        category: rule.category,
        message: rule.message,
        raw,
        suggestCookies: rule.suggestCookies,
      };
    }
  }
  return {
    category: "unknown",
    message:
      text.length > 0
        ? "Download failed. See logs for details."
        : "Download failed with no error output. See logs for details.",
    raw,
    suggestCookies: false,
  };
}

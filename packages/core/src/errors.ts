/**
 * Raw stderr -> human message + category + follow-up actions.
 * Always keeps `raw` accessible for the Logs screen.
 * Case-insensitive substring matching, specific first.
 * Messages are localized (M2.8): patterns are shared, message tables per
 * locale with EN as the source of truth.
 */

export type ErrorLocale = "en" | "ms";

export type ErrorCategory =
  | "ffmpeg-missing"
  | "engine-broken"
  | "geo-blocked"
  | "private"
  | "age-gated"
  | "cookie-unavailable"
  | "network"
  | "disk-full"
  | "extractor-failed"
  | "unsupported-url"
  | "rate-limited"
  | "timeout"
  | "cancelled"
  | "unknown";

export type ErrorActionId =
  | "retry"
  | "update-retry"
  | "cookies-once"
  | "cookies-always"
  | "repair"
  | "settings"
  | "logs"
  | "folder";

export interface ErrorAction {
  readonly id: ErrorActionId;
  /** Settings anchor for the "settings" action (e.g. "cookies"). */
  readonly section?: string;
}

export interface MappedError {
  readonly category: ErrorCategory;
  readonly message: string;
  readonly raw: string;
  readonly suggestCookies: boolean;
  readonly actions: readonly ErrorAction[];
}

const RETRY: ErrorAction = { id: "retry" };
const UPDATE_RETRY: ErrorAction = { id: "update-retry" };
const COOKIES_ONCE: ErrorAction = { id: "cookies-once" };
const COOKIES_ALWAYS: ErrorAction = { id: "cookies-always" };
const REPAIR: ErrorAction = { id: "repair" };
const LOGS: ErrorAction = { id: "logs" };
const FOLDER: ErrorAction = { id: "folder" };

const RULES: ReadonlyArray<{
  readonly category: ErrorCategory;
  readonly pattern: RegExp;
  readonly suggestCookies: boolean;
  readonly actions: readonly ErrorAction[];
}> = [
  {
    category: "ffmpeg-missing",
    pattern: /ffmpeg.*not found|ffprobe.*not found|requires ffmpeg|ffmpeg.*missing/i,
    suggestCookies: false,
    actions: [REPAIR, LOGS],
  },
  {
    category: "engine-broken",
    pattern:
      /not a valid Win32 application|bad image|ERRORLEVEL 9009|spawn .* ENOENT|-syntax error.*binary|unexpected magic/i,
    suggestCookies: false,
    actions: [REPAIR, LOGS],
  },
  {
    category: "geo-blocked",
    pattern: /not available in your country|geo.?blocked|geo restriction/i,
    suggestCookies: false,
    actions: [{ id: "settings", section: "proxy" }, LOGS],
  },
  {
    category: "private",
    pattern: /private video|this video is private|login required.*private/i,
    suggestCookies: false,
    actions: [COOKIES_ONCE, LOGS],
  },
  {
    category: "age-gated",
    pattern: /confirm your age|age.?gated|sign in to confirm/i,
    suggestCookies: true,
    actions: [COOKIES_ONCE, COOKIES_ALWAYS, { id: "settings", section: "cookies" }, LOGS],
  },
  {
    // Verified against real stderr (yt-dlp 2026.08.19, Chrome locked by a
    // running instance): "ERROR: Could not copy Chrome cookie database."
    category: "cookie-unavailable",
    pattern:
      /could not copy .* cookie database|could not find .* cookies database|unsupported browser specified for cookies|decrypt.*cookies?|cookies?.*decrypt|DPAPI|CryptUnprotect/i,
    suggestCookies: true,
    actions: [COOKIES_ONCE, COOKIES_ALWAYS, { id: "settings", section: "cookies" }, LOGS],
  },
  {
    category: "disk-full",
    pattern: /no space left|disk.*full|not enough.*disk/i,
    suggestCookies: false,
    actions: [FOLDER, { id: "settings", section: "folder" }, LOGS],
  },
  {
    category: "extractor-failed",
    pattern:
      /signature.*(extract|failed)|failed to extract.*signature|ExtractorError|HTTP Error 403|unable to extract/i,
    suggestCookies: false,
    actions: [UPDATE_RETRY, LOGS],
  },
  {
    category: "network",
    pattern:
      /network.*unreachable|connection.*timed out|temporary failure|failed to resolve|socket.*timeout|connection refused|urlopen error|unable to connect|newconnectionerror|proxyerror|failed to establish.*connection|name or service not known|getaddrinfo failed/i,
    suggestCookies: false,
    actions: [RETRY, LOGS],
  },
  {
    category: "rate-limited",
    pattern: /rate.?limited|too many requests|\b429\b/i,
    suggestCookies: false,
    actions: [RETRY, LOGS],
  },
  {
    category: "unsupported-url",
    pattern:
      /unsupported url|no suitable extractor|no video formats found|requested format not available/i,
    suggestCookies: false,
    actions: [LOGS],
  },
];

const MESSAGES: Record<ErrorCategory, Record<ErrorLocale, string>> = {
  "ffmpeg-missing": {
    en: "FFmpeg is missing. Reinstall the app or place ffmpeg beside the engine.",
    ms: "FFmpeg tiada. Pasang semula app atau letakkan ffmpeg di sisi enjin.",
  },
  "engine-broken": {
    en: "The engine binary is missing or damaged. Repair it and retry.",
    ms: "Binari enjin tiada atau rosak. Baiki dan cuba semula.",
  },
  "geo-blocked": {
    en: "This video is blocked in your country or network region.",
    ms: "Video ini disekat di negara atau rantau rangkaian anda.",
  },
  private: {
    en: "This video is private. Sign in or use cookies if you have access.",
    ms: "Video ini peribadi. Log masuk atau guna kuki jika anda ada akses.",
  },
  "age-gated": {
    en: "Age-restricted video. Export browser cookies and retry.",
    ms: "Video terhad umur. Eksport kuki pelayar dan cuba semula.",
  },
  "cookie-unavailable": {
    en: "Could not read cookies from that browser (it may be running, locked, or missing). Try Firefox or Edge, or point a cookies.txt file at it in Settings.",
    ms: "Kuki dari pelayar itu tidak dapat dibaca (mungkin sedang berjalan, dikunci, atau tiada). Cuba Firefox atau Edge, atau tetapkan fail cookies.txt dalam Tetapan.",
  },
  "disk-full": {
    en: "Disk is full. Free space or pick another download folder.",
    ms: "Cakera penuh. Kosongkan ruang atau pilih folder muat turun lain.",
  },
  "extractor-failed": {
    en: "The site changed how videos load, or the video is gone. Update the engine and retry.",
    ms: "Tapak mengubah cara video dimuatkan, atau video sudah tiada. Kemas kini enjin dan cuba semula.",
  },
  network: {
    en: "Network error. Check your connection or proxy and retry.",
    ms: "Ralat rangkaian. Semak sambungan atau proksi dan cuba semula.",
  },
  "rate-limited": {
    en: "Rate-limited by the site. Wait a bit, then retry.",
    ms: "Tapak mengehadkan kadar. Tunggu sebentar, kemudian cuba semula.",
  },
  "unsupported-url": {
    en: "This link is not supported or has no downloadable formats.",
    ms: "Pautan ini tidak disokong atau tiada format boleh dimuat turun.",
  },
  timeout: {
    en: "Analyze timed out.",
    ms: "Analisis tamat masa.",
  },
  cancelled: {
    en: "Analyze cancelled.",
    ms: "Analisis dibatalkan.",
  },
  unknown: {
    en: "Download failed. See logs for details.",
    ms: "Muat turun gagal. Lihat log.",
  },
};

const UNKNOWN_EMPTY: Record<ErrorLocale, string> = {
  en: "Download failed with no error output. See logs for details.",
  ms: "Muat turun gagal tanpa output ralat. Lihat log.",
};

export function mapDownloadError(raw: string, lang: ErrorLocale = "en"): MappedError {
  const text = raw.trim();
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return {
        category: rule.category,
        message: MESSAGES[rule.category][lang],
        raw,
        suggestCookies: rule.suggestCookies,
        actions: rule.actions,
      };
    }
  }
  return {
    category: "unknown",
    message: text.length > 0 ? MESSAGES.unknown[lang] : UNKNOWN_EMPTY[lang],
    raw,
    suggestCookies: false,
    actions: [RETRY, LOGS],
  };
}

/** Follow-up actions for a stored category (error cards). */
export function actionsFor(category: ErrorCategory | null | undefined): readonly ErrorAction[] {
  if (category === null || category === undefined) return [RETRY, LOGS];
  for (const rule of RULES) {
    if (rule.category === category) return rule.actions;
  }
  return [RETRY, LOGS];
}

/** Synthetic mapping for user-cancelled analyzes (no buttons). */
export function cancelledMapped(lang: ErrorLocale = "en"): MappedError {
  return {
    category: "cancelled",
    message: MESSAGES.cancelled[lang],
    raw: "",
    suggestCookies: false,
    actions: [],
  };
}

/** Synthetic mapping for analyze timeouts. */
export function timeoutMapped(seconds: number, lang: ErrorLocale = "en"): MappedError {
  const base = MESSAGES.timeout[lang].replace(/\.$/, "");
  return {
    category: "timeout",
    message: `${base} (${String(seconds)}s).`,
    raw: "",
    suggestCookies: false,
    actions: [RETRY, LOGS],
  };
}

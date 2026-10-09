/**
 * Core domain types. No Electron/Node imports allowed in this file.
 * Everything UI + state talks to the `DownloadEngine` interface only.
 */
import type { ErrorCategory } from "./errors.js";
import type { AudioMetadata } from "./metadata.js";

export type JobStatus =
  | "queued"
  | "analyzing"
  | "probing"
  | "downloading"
  | "processing"
  | "paused"
  | "done"
  | "partial"
  | "interrupted"
  | "error"
  | "postfailed"
  | "cancelled";

/** yt-dlp release channel (Phase 2). */
export type YtDlpChannel = "stable" | "nightly";

export const YTDLP_CHANNELS: readonly YtDlpChannel[] = ["stable", "nightly"];

/** Which engine owns a job. Old rows omit it (= yt-dlp). */
export type EngineId = "yt-dlp" | "gallery-dl" | "streamlink" | "n-m3u8dl-re";

export const ENGINE_IDS: readonly EngineId[] = ["yt-dlp", "gallery-dl", "streamlink", "n-m3u8dl-re"];

/** Router mode: Auto picks per domain/rules, or pin one engine. */
export type RouterMode = "auto" | "video" | "images";

export const ROUTER_MODES: readonly RouterMode[] = ["auto", "video", "images"];

/** One downloaded file inside a (possibly multi-file) job. */
export interface FileResult {
  readonly path: string;
  readonly size: number | null;
  readonly status: "downloaded" | "skipped" | "failed";
}

/** Images (gallery-dl) preferences. All optional-safe via mergeSettings. */
export interface ImagesSettings {
  /** Default folder for image jobs (empty = Downloads/FluxDL/Images). */
  readonly downloadDir: string;
  readonly folderTemplate: string;
  readonly filenameTemplate: string;
  readonly sleepRequestsSec: number | null;
  readonly maxSleepIntervalSec: number | null;
  readonly retries: number | null;
  readonly proxy: string | null;
  readonly archive: boolean;
  readonly metadataSidecar: boolean;
  /**
   * Raw gallery-dl config override (JSON text, validated before use).
   * Null = generate from the fields above. "Reset" clears back to null.
   */
  readonly customConfig: string | null;
}

/** Gallery packaging via gallery-dl's native post-processor. */
export type GalleryPackage = "off" | "zip" | "cbz";

export const GALLERY_PACKAGES: readonly GalleryPackage[] = ["off", "zip", "cbz"];

/** Pixiv ugoira conversion via gallery-dl (`--ugoira`, needs FFmpeg). */
export type UgoiraFormat = "off" | "mp4" | "gif" | "webm";

export const UGOIRA_FORMATS: readonly UgoiraFormat[] = ["off", "mp4", "gif", "webm"];

/** Image conversion target. */
export type ConvertFormat = "jpg" | "png";

/** Video compress preset. */
export type CompressPreset = "off" | "small" | "balanced" | "archive";

export const COMPRESS_PRESETS: readonly CompressPreset[] = ["off", "small", "balanced", "archive"];

/** whisper.cpp model size (on-demand download, sizes shown in the UI). */
export type WhisperModelSize = "tiny" | "base" | "small";

export const WHISPER_MODEL_SIZES: readonly WhisperModelSize[] = ["tiny", "base", "small"];

/**
 * Post-processing preferences (Phase 4). Gallery-native steps (package,
 * ugoira) ride the gallery argv; the local runner handles conversion,
 * tagging and compression. All optional-safe via mergeSettings.
 */
export interface PostProcessSettings {
  readonly convertImages: boolean;
  readonly imageFormat: ConvertFormat;
  /** JPG/PNG quality 1-100 (mapped to each codec's scale). */
  readonly imageQuality: number;
  /** Downscale longer side to at most this (px). No upscale, ever. */
  readonly imageMaxDim: number;
  /** Strip EXIF/GPS metadata on convert. */
  readonly stripExif: boolean;
  readonly packageGallery: GalleryPackage;
  readonly ugoiraFormat: UgoiraFormat;
  readonly autoTagAudio: boolean;
  readonly compressVideo: CompressPreset;
  /** Transcribe audio to an .srt sidecar (whisper pack, CPU, experimental). */
  readonly transcribeAudio: boolean;
  readonly whisperModel: WhisperModelSize;
  /** rclone remote target (`remote:path`, pack-owned config) or null. */
  readonly rcloneRemote: string | null;
  /** Upload finished video/audio via rclone automatically. */
  readonly autoUpload: boolean;
  /** Keep the original file next to the output (default true). */
  readonly keepOriginals: boolean;
}

export interface FormatOption {
  readonly formatId: string;
  readonly label: string;
  readonly ext: string;
  /** e.g. "video" | "audio" | "video+audio" | "storyboard" */
  readonly kind: string;
  readonly resolution: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: number | null;
  readonly vcodec: string | null;
  readonly acodec: string | null;
  readonly tbr: number | null;
  readonly filesize: number | null;
  readonly protocol: string | null;
}

export interface PlaylistEntry {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly duration: number | null;
  readonly thumbnail: string | null;
  readonly selected: boolean;
}

export type LiveStatus = "is_live" | "is_upcoming" | "was_live" | "not_live" | "post_live";

/**
 * Runtime mirrors of the domain unions above, so validators (the IPC
 * boundary) check against one source instead of a hand-copied list (R1).
 */
export const LIVE_STATUSES: readonly LiveStatus[] = [
  "is_live",
  "is_upcoming",
  "was_live",
  "not_live",
  "post_live",
];

/** Queue priority tier (Phase 3): 2 high starts before 1 normal before 0 low. */
export type JobPriority = 0 | 1 | 2;

export const JOB_PRIORITIES: readonly JobPriority[] = [0, 1, 2];

/** What the window X button does: hide to tray, or quit the app. */
/**
 * A watched channel/playlist (A6). The app diffs fresh entries against
 * `lastVideoId`: the first check only sets the baseline, later checks
 * surface genuinely new uploads.
 *
 * Phase 3 subscriptions: each channel carries its own delivery mode,
 * destination, preset, engine, interval and health counters. Every field
 * past `lastCheckedAt` is optional-safe: the normalizer fills defaults so
 * pre-Phase-3 rows keep working.
 */
export interface WatchChannel {
  readonly url: string;
  readonly title: string;
  readonly lastVideoId: string | null;
  readonly lastCheckedAt: number | null;
  /** "auto" downloads new items, "notify" only toasts. Default "notify". */
  readonly mode: SubscriptionMode;
  /** Per-sub folder override. Null = global downloadDir. */
  readonly folder: string | null;
  /** Per-sub preset override. Null = global defaultPreset. */
  readonly preset: DownloadPreset | null;
  /** Per-sub engine override. Null = router decides. */
  readonly engine: EngineId | null;
  /** Check interval in minutes, clamped ≥ 30. Default 60. */
  readonly intervalMin: number;
  /** Paused subs are never polled. Default false. */
  readonly paused: boolean;
  /** Consecutive failed checks. Reset on success. */
  readonly failCount: number;
  /** True after MAX_SUB_FAILURES consecutive failures (needs re-enable). */
  readonly autoDisabled: boolean;
}

/** Subscription delivery mode: download new items, or just notify. */
export type SubscriptionMode = "auto" | "notify";

export const SUBSCRIPTION_MODES: readonly SubscriptionMode[] = ["auto", "notify"];

export type CloseBehavior = "tray" | "quit";

export const CLOSE_BEHAVIORS: readonly CloseBehavior[] = ["tray", "quit"];

export const VIDEO_PRESETS: readonly VideoPreset[] = [
  "Best",
  "2160",
  "1440",
  "1080",
  "720",
  "480",
  "Compatible",
  "Smallest",
];

export const AUDIO_PRESETS: readonly AudioPreset[] = [
  "MP3",
  "M4A",
  "AAC",
  "Opus",
  "Vorbis",
  "FLAC",
  "ALAC",
  "WAV",
  "Best",
];

/**
 * Output containers offered for VIDEO downloads.
 *
 * Verified against the bundled yt-dlp 2026.08.19 (`yt-dlp --help`):
 * - `--merge-output-format`: avi, flv, mkv, mov, mp4, webm
 * - `--remux-video` / `--recode-video`: the video subset below plus gif and
 *   the audio-only targets (aac, aiff, alac, flac, m4a, mka, mp3, ogg, opus,
 *   vorbis, wav) — those are reachable through the audio presets instead.
 *
 * The longer lists sometimes quoted for remux (ogv/mpg/mpeg/ts/vob/3gp/m2ts/
 * wmv/f4v) are NOT accepted by this binary and are deliberately absent.
 */
export const CONTAINERS: readonly Container[] = ["mp4", "mkv", "webm", "avi", "flv", "mov", "gif"];

/** yt-dlp `--merge-output-format` value used when a merge is required. */
export const MERGE_CONTAINERS: readonly Container[] = ["mp4", "mkv", "webm", "avi", "flv", "mov"];

export interface ChapterInfo {
  readonly title: string;
  readonly startTime: number;
  readonly endTime: number;
}

export interface MediaInfo {
  readonly url: string;
  readonly title: string;
  readonly uploader: string | null;
  readonly duration: number | null;
  readonly thumbnail: string | null;
  readonly isPlaylist: boolean;
  /** Extractor key (e.g. "youtube") when the dump provides one. */
  readonly extractor: string | null;
  /** Top-level video id when the dump provides one (absent for playlists). */
  readonly videoId: string | null;
  readonly entries: readonly PlaylistEntry[];
  readonly formats: readonly FormatOption[];
  /** Live stream status reported by yt-dlp (M4.1). */
  readonly liveStatus?: LiveStatus | null;
  /** Internal video chapters if present (M4.2). */
  readonly chapters?: readonly ChapterInfo[] | null;
  /** Raw `upload_date` (YYYYMMDD) used to seed the metadata editor (M4.3). */
  readonly uploadDate?: string | null;
}

export type MediaKind = "video" | "audio";

/**
 * Audio targets = exactly yt-dlp's `--audio-format` set:
 * best (default), aac, alac, flac, m4a, mp3, opus, vorbis, wav.
 * "Best" keeps the source stream untouched (no `-x`).
 */
export type AudioPreset =
  | "MP3"
  | "M4A"
  | "AAC"
  | "Opus"
  | "Vorbis"
  | "FLAC"
  | "ALAC"
  | "WAV"
  | "Best";
export type VideoPreset = "Best" | "2160" | "1440" | "1080" | "720" | "480" | "Compatible" | "Smallest";

/** Video output container (see CONTAINERS for the verified value set). */
export type Container = "mp4" | "mkv" | "webm" | "avi" | "flv" | "mov" | "gif";

/** Preferred video codec for downloads (applied via yt-dlp `-S` format sort). */
export type CodecPreference = "auto" | "h264" | "vp9" | "av1";

export interface DownloadPreset {
  readonly kind: MediaKind;
  readonly videoPreset: VideoPreset;
  readonly audioPreset: AudioPreset;
  /** Raw yt-dlp `-f` value when user picks Advanced. Takes precedence if set. */
  readonly rawFormat: string | null;
  /**
   * Per-job output container override (Advanced). Null = the global setting.
   * Applied as `--merge-output-format` plus `--remux-video` so the target is
   * honoured whether or not a merge is required (v1.7.2).
   */
  readonly container?: Container | null;
}

/**
 * Polite pacing (v1.7.2) — the "don't look like a scraper" knobs, all of them
 * straight yt-dlp flags. Seconds; null/0 = off.
 *
 * yt-dlp 2026.08.19:
 *   --sleep-requests SECONDS     pause between extraction requests
 *   --min-sleep-interval SECONDS (alias of --sleep-interval) pause before each download
 *   --max-sleep-interval SECONDS (only valid together with min)
 *   --sleep-subtitles SECONDS    pause before each subtitle download
 */
export interface PacingSettings {
  readonly sleepRequestsSec: number | null;
  readonly minSleepIntervalSec: number | null;
  readonly maxSleepIntervalSec: number | null;
  readonly sleepSubtitlesSec: number | null;
}

export interface DownloadJob {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly preset: DownloadPreset;
  readonly outputDir: string;
  readonly status: JobStatus;
  readonly progress: number | null;
  readonly speed: string | null;
  readonly eta: string | null;
  readonly downloadedBytes: number | null;
  readonly totalBytes: number | null;
  readonly stage: string | null;
  readonly error: string | null;
  readonly createdAt: number;
  /** Consecutive engine failures; reset on success. Drives backoff. */
  readonly attempts: number;
  /** Earliest retry time (ms epoch) or null when no retry is scheduled. */
  readonly nextRetryAt: number | null;
  /** Last known output file reported by the engine, if any. */
  readonly destination: string | null;
  /**
   * Pass --download-archive for this job (playlist targets when the
   * skipArchived setting is on). Optional: older records omit it (= false).
   */
  readonly useArchive?: boolean;
  /** Extractor key + video id when known at enqueue (duplicate guard). */
  readonly extractor?: string | null;
  readonly videoId?: string | null;
  /** Per-job cookie browser override (this download only). */
  readonly cookiesFromBrowser?: string | null;
  /** Sanitized playlist subfolder for this job (restart parity). */
  readonly playlistSubdir?: string;
  /** Stored failure category for actionable error cards (optional). */
  readonly errorCategory?: ErrorCategory | null;
  /** Set when the output file was trashed (history keeps the record). */
  readonly fileDeleted?: boolean;
  /** Live status detected for this job (M4.1). */
  readonly liveStatus?: LiveStatus | null;
  /** Record stream from start (--live-from-start) (M4.1). */
  readonly liveFromStart?: boolean;
  /** Wait for scheduled upcoming stream (--wait-for-video) (M4.1). */
  readonly waitForVideo?: boolean;
  /** Split by chapters into containing folder (M4.2). */
  readonly splitChapters?: boolean | null;
  /** Audio tag overrides for this job (M4.3), or null for none. */
  readonly audioMetadata?: AudioMetadata | null;
  /** Completion time (ms epoch). Absent on records written before v1.4. */
  readonly finishedAt?: number | null;
  /** Uploader/channel captured at enqueue, for the stats screen (M4.5). */
  readonly uploader?: string | null;
  /** Media duration in seconds at enqueue (M4.5). */
  readonly durationSec?: number | null;
  /** Refetch even if the output file exists (M4.8). */
  readonly forceOverwrite?: boolean;
  /** Do not start before this ms epoch (scheduled download, A4). */
  readonly startAfter?: number | null;
  /** Pinned jobs sort to the top of the list (B7). */
  readonly pinned?: boolean;
  /** Trim section for this job (Phase 2, --download-sections). */
  readonly trimStart?: string | null;
  readonly trimEnd?: string | null;
  /**
   * gallery-dl `--range` selector for this job (`5`, `8-20`, `1:24:3`,
   * `2-4,7`). Validated at every hop; absent = whole gallery.
   */
  readonly range?: string | null;
  /** Set once the outdated-engine auto-retry has fired (never loops). */
  readonly outdatedRetried?: boolean;
  /** Queue priority tier (Phase 3, optional: older rows read as normal). */
  readonly priority?: JobPriority;
  /** Per-job proxy override (Phase 3: this download only, else global). */
  readonly proxyOverride?: string | null;
  /**
   * Owning engine (Phase 1). Optional: rows written before v1.8 omit it
   * and read as yt-dlp.
   */
  readonly engineId?: EngineId | null;
  /** Per-file outcomes for multi-file (gallery) jobs. */
  readonly fileResults?: readonly FileResult[] | null;
  readonly downloadedCount?: number | null;
  readonly skippedCount?: number | null;
  readonly failedCount?: number | null;
}

export interface DownloadJobInput extends Pick<
  DownloadJob,
  | "url"
  | "title"
  | "preset"
  | "outputDir"
  | "extractor"
  | "videoId"
  | "cookiesFromBrowser"
  | "liveStatus"
  | "liveFromStart"
  | "waitForVideo"
  | "splitChapters"
  | "audioMetadata"
  | "uploader"
  | "durationSec"
  | "forceOverwrite"
  | "startAfter"
  | "pinned"
  | "engineId"
  | "trimStart"
  | "trimEnd"
  | "outdatedRetried"
  | "priority"
  | "proxyOverride"
  | "range"
> {
  readonly useArchive?: boolean;
  /** Sanitized playlist subfolder (UI-side, when the setting is on). */
  readonly playlistSubdir?: string | null;
  /** Per-job output container (v1.7.2); overrides the global setting. */
  readonly container?: Container | null;
}

export type ThemeName = "obsidian" | "midnight" | "ember" | "paper";

export type Density = "comfortable" | "compact";

/** UI language: explicit locale or follow the system (M2.8). */
export type Language = "auto" | "en" | "ms";

export interface AppSettings {
  readonly downloadDir: string;
  readonly filenameTemplate: string;
  readonly concurrency: number;
  /** Simultaneous gallery-dl jobs (polite default; yt-dlp keeps the global cap). */
  readonly concurrencyGallery: number;
  /** Download window bounds (HH:MM, local). Null = always open. */
  readonly downloadWindowStart: string | null;
  readonly downloadWindowEnd: string | null;
  readonly speedLimit: string | null;
  readonly proxy: string | null;
  readonly cookiesFromBrowser: string | null;
  /** Netscape cookies.txt file (validated main-side; never copied/logged). */
  readonly cookiesFile: string | null;
  readonly embedThumbnail: boolean;
  readonly embedMetadata: boolean;
  readonly subtitles: boolean;
  readonly subtitleLangs: string;
  readonly embedSubs: boolean;
  /** Also fetch YouTube auto-generated captions (most videos have no manual subs). */
  readonly includeAutoSubs: boolean;
  /** Default container when a merge is required (yt-dlp value set). */
  readonly mergeContainer: string;
  /**
   * Global custom yt-dlp `-f` selector (Advanced). Null = off. Per-job
   * rawFormat wins when set. Validated (non-empty, capped); the args array
   * carries it untouched, so no shell round-trip is possible.
   */
  readonly customFormat: string | null;
  /** Polite pacing delays in seconds; null/0 = off (v1.7.2). */
  readonly pacing: PacingSettings;
  readonly sponsorBlock: boolean;
  readonly codecPreference: CodecPreference;
  /** Playlist jobs pass --download-archive (default ON). */
  readonly skipArchived: boolean;
  readonly theme: ThemeName;
  readonly postDownloadAction: "none" | "open-file" | "reveal";
  readonly autoCheckUpdate: boolean;
  /** First-run wizard completed (M2.2). */
  readonly onboardingDone: boolean;
  /** Default preset for new analyses (chosen in onboarding). */
  readonly defaultPreset: DownloadPreset;
  /** Analyze timeout in seconds (M2.3). */
  readonly analyzeTimeoutSec: number;
  /** Tint the preview card with the thumbnail colour (M2.4, default ON). */
  readonly thumbnailAccent: boolean;
  /** Spacing/typography density (M2.5). */
  readonly density: Density;
  /** User accent override hex (#rrggbb) or null for theme default (M2.6). */
  readonly accentOverride: string | null;
  /** Playlist jobs download into a subfolder (M2.7, default ON). */
  readonly playlistSubfolder: boolean;
  /**
   * Last-used preset per extractor site ("youtube" -> Compatible MP4 …),
   * applied automatically on the next analyze. Silent smart default.
   */
  readonly presetBySite: Record<string, DownloadPreset>;
  /** Pinned Downloads searches (max 10) + recent ones (max 5). */
  readonly savedSearches: readonly string[];
  readonly recentSearches: readonly string[];
  /** Remembered UI (D2): last view + last Downloads filter. */
  readonly lastView: string;
  readonly lastQueueFilter: string;
  /** Unsent Batch textarea draft (D8), restored on boot. */
  readonly batchDraft: string;
  /** UI language (M2.8). */
  readonly language: Language;
  /** Keep the last N history entries (M2.9). */
  readonly historyLimit: number;
  /** OS notifications when downloads finish/fail (in-app toasts stay). */
  readonly notifyFinished: boolean;
  /**
   * Keep local crash reports (opt-in, never uploaded). View crashes are
   * stored in localStorage for the Logs screen + diagnostics export.
   */
  readonly crashReports: boolean;
  /** Follow the OS light/dark mode (light side is always Paper). */
  readonly followSystemTheme: boolean;
  /** Start with Windows (minimized to the tray). */
  readonly launchAtLogin: boolean;
  /** Sort downloads into Music/Videos(/Season NN) subfolders (F1/F3). */
  readonly autoSort: boolean;
  /** Experimental features (may change or break; off by default). */
  readonly experimental: boolean;
  /** Update tag the user asked not to be reminded about (null = none). */
  readonly skippedUpdate: string | null;
  /** What the X button does (tray = hide, quit = terminate). */
  readonly closeBehavior: CloseBehavior;
  /** Minimizing also hides the window to the tray. */
  readonly minimizeToTray: boolean;
  /** yt-dlp release channel (Phase 2). */
  readonly ytdlpChannel: YtDlpChannel;
  /** Auto-install tool updates when idle (opt-in, default off). */
  readonly autoUpdateTools: boolean;
  /** Use aria2c as external downloader when its binary is present. */
  readonly useAria2c: boolean;
  /** Concurrent HLS/DASH fragments (-N), null = yt-dlp default. */
  readonly concurrentFragments: number | null;
  /** Network retries (-R + --fragment-retries), null = yt-dlp default. */
  readonly downloadRetries: number | null;
  /** Socket timeout seconds, null = yt-dlp default. */
  readonly socketTimeoutSec: number | null;
  /** Stall watchdog seconds (0 = off). */
  readonly stalledTimeoutSec: number;
  /** SponsorBlock remove list (used when sponsorBlock is on). */
  readonly sponsorBlockCategories: string;
  /** Experimental anti-bot impersonate client (null = off). */
  readonly impersonateClient: string | null;
  /** Last tool-check epoch ms (Tools page), null = never. */
  readonly lastToolCheckAt: number | null;
  /** Engine router (Phase 1): auto picks per domain/rules. */
  readonly routerMode: RouterMode;
  /** User domain → engine overrides (suffix match, lowercase host). */
  readonly domainRules: Record<string, EngineId>;
  /** Images (gallery-dl) preferences (Phase 1). */
  readonly images: ImagesSettings;
  /** Post-processing preferences (Phase 4). */
  readonly postProcess: PostProcessSettings;
  /** Dismissed pack-suggestion keys (streamlink-live, …). Never reset. */
  readonly dismissedPackHints: readonly string[];
  /** Loopback Remote API (Phase 6A): disabled by default, 127.0.0.1 only. */
  readonly apiEnabled: boolean;
  /** Loopback Remote API port (unprivileged only, default 48127). */
  readonly apiPort: number;
  /** Discord webhook on finish/fail (URL lives encrypted, never here). */
  readonly notifyDiscord: boolean;
  /** Telegram message on finish/fail (token lives encrypted, never here). */
  readonly notifyTelegram: boolean;
  /** Telegram chat id (not a secret). Null = unset. */
  readonly telegramChatId: string | null;
  /** LAN mode (Phase 6B): explicit opt-in, binds 0.0.0.0. Off by default. */
  readonly lanEnabled: boolean;
  /** Allowed LAN IP prefixes, comma-separated. Empty = any LAN client. */
  readonly lanAllowlist: string;
  /** Auto-disable LAN after N hours. Null = stays on until toggled. */
  readonly lanAutoDisableHours: number | null;
  /** Last-used folder per media type ("video" | "images"). */
  readonly lastFolderByMedia: Record<string, string>;
}

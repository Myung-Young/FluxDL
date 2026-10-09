import type {
  AppSettings,
  DownloadJob,
  DownloadJobInput,
  MediaInfo,
  WatchChannel,
} from "./types.js";
import type { ErrorCategory } from "./errors.js";
import type { DoctorReport } from "./doctor.js";
import type { MediaSummary, PostStep, TagCandidate } from "./postprocess.js";
import type { GalleryProbeItem } from "./galleryProbe.js";
import type { RemoteApiAction } from "./remoteApi.js";

export type { DoctorCheck, DoctorReport, DoctorStatus } from "./doctor.js";
export type { MediaSummary, PostStep, TagCandidate } from "./postprocess.js";
export type { GalleryProbeItem } from "./galleryProbe.js";
export type { RemoteApiAction } from "./remoteApi.js";

/** Post-processing request (Phase 4): one channel, discriminated payload. */
export interface PostProcessRequest {
  /** "run": execute steps on files. "media-info": ffprobe summary. "apply-tag": force a tag match. */
  readonly action: "run" | "media-info" | "apply-tag";
  /** Input files for "run" (capped main-side). */
  readonly files?: readonly string[];
  /** Steps for "run" (validated against POST_STEPS). */
  readonly steps?: readonly PostStep[];
  /** Target file for "media-info" / "apply-tag" (guard-checked). */
  readonly path?: string;
  /** MusicBrainz recording id for "apply-tag" (UUID shape enforced). */
  readonly mbid?: string;
}

/** One finished pipeline step. */
export interface PostStepResult {
  readonly step: PostStep;
  readonly ok: boolean;
  readonly output: string | null;
  readonly savedBytes: number | null;
  readonly note: string | null;
}

/** Outcome of a "run" / "apply-tag" call. */
export interface PostReport {
  readonly ok: boolean;
  readonly results: readonly PostStepResult[];
  /** Low-confidence matches (manual flow: UI offers "apply anyway"). */
  readonly candidates: readonly TagCandidate[];
}

export type PostProcessResult =
  | { readonly kind: "report"; readonly report: PostReport }
  | { readonly kind: "media"; readonly summary: MediaSummary | null };

/**
 * Gallery probe outcome (Phase 1 v1.8.5): gallery-dl `-j` metadata for a
 * URL without downloading anything. `supported:false` means no extractor
 * handles the URL (router falls back to yt-dlp); `errors` carries partial
 * ([-1] tuples) or probe-level failures.
 */
export interface GalleryProbe {
  readonly supported: boolean;
  readonly items: readonly GalleryProbeItem[];
  readonly errors: readonly string[];
}

/** Tool Packs request (Phase 5): one channel, op-based payload. */
export type PackOp =
  | "status"
  | "check-update"
  | "install"
  | "update"
  | "uninstall"
  | "progress"
  | "cancel"
  | "install-model"
  | "remove-model";

export interface PackRequest {
  readonly op: PackOp;
  /** Pack id (all ops except status/progress). */
  readonly id?: string;
  /** Pinned install (tests / older builds). */
  readonly version?: string;
  readonly url?: string;
  /** Required when the project publishes no checksums file. */
  readonly acceptNoChecksum?: boolean;
  /** Whisper model size for install-model/remove-model. */
  readonly model?: string;
}

/** Renderer-facing pack row (manifest + install state, no fs handles). */
export interface PackStatusRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly exe: string;
  readonly version: string;
  readonly homepage: string;
  readonly license: string;
  readonly sizeBytes: number;
  readonly capabilities: readonly string[];
  readonly consentNote: string;
  readonly installed: string | null;
  readonly exePath: string | null;
  readonly diskBytes: number;
  readonly models: readonly { id: string; sizeBytes: number; present: boolean }[];
}

export interface PackProgressState {
  readonly phase: string;
  readonly packId: string | null;
  readonly receivedBytes: number;
  readonly totalBytes: number | null;
}

export type PacksResult =
  | { readonly kind: "status"; readonly rows: PackStatusRow[] }
  | { readonly kind: "progress"; readonly progress: PackProgressState }
  | { readonly kind: "installed"; readonly id: string; readonly version: string; readonly exePath: string }
  | { readonly kind: "latest"; readonly id: string; readonly current: string | null; readonly latest: string | null; readonly updateAvailable: boolean }
  | { readonly kind: "model"; readonly path: string }
  | { readonly kind: "ok" };

/** Loopback Remote API request (Phase 6A): one channel, op-based payload. */
export type RemoteApiOp = "status" | "rotate" | "reveal" | "drain" | "audit";

/** Notifier control (Phase 6B): secrets never cross this boundary. */
export type NotifierOp = "status" | "save" | "test-discord" | "test-telegram";

export interface NotifierRequest {
  readonly op: NotifierOp;
  /** Empty string clears; absent leaves unchanged. Never echoed back. */
  readonly discordWebhook?: string;
  readonly telegramBotToken?: string;
}

export type NotifierResult =
  | { readonly kind: "status"; readonly discord: boolean; readonly telegram: boolean }
  | { readonly kind: "ok" };

export interface RemoteApiRequest {
  readonly op: RemoteApiOp;
}

export interface RemoteApiStatus {
  readonly running: boolean;
  readonly port: number | null;
  readonly error: string | null;
  readonly queueActive: number;
  readonly queueQueued: number;
  readonly queueErrors: number;
  readonly engineActive: number;
  /** LAN mode (Phase 6B, optional: old mocks omit it). */
  readonly lan?: { readonly enabled: boolean; readonly addresses: readonly string[] };
}

export type RemoteApiResult =
  | { readonly kind: "status"; readonly status: RemoteApiStatus }
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "actions"; readonly actions: readonly RemoteApiAction[] }
  | {
      readonly kind: "audit";
      readonly entries: readonly { readonly t: number; readonly method: string; readonly path: string; readonly status: number }[];
    }
  | { readonly kind: "ok" };

/** Progress event pushed by the engine. */
export interface EngineProgress {
  readonly id: string;
  readonly percent: number | null;
  readonly speed: string | null;
  readonly eta: string | null;
  readonly downloadedBytes: number | null;
  readonly totalBytes: number | null;
  readonly stage: string;
  /** Last known output file reported by the engine, if any. */
  readonly destination: string | null;
  /** Gallery (multi-file) counters, when the engine tracks them. */
  readonly downloadedCount?: number | null;
  readonly skippedCount?: number | null;
  readonly failedCount?: number | null;
  /** Human failure message for "error" stages (mapped main-side). */
  readonly errorMessage?: string;
  readonly errorCategory?: ErrorCategory;
  /** Elapsed duration string (e.g. "00:01:23") when available (M4.1). */
  readonly elapsed?: string | null;
}

/** Unsubscribe function. */
export type Unsubscribe = () => void;

export type ProgressCallback = (event: EngineProgress) => void;

export interface EngineVersions {
  readonly ytdlp: string;
  readonly ffmpeg: string | null;
  readonly app: string;
  /** gallery-dl version when installed, else null (Phase 1). */
  readonly galleryDl?: string | null;
  /** Detected JS runtime version (deno/node) or null (Phase 2). */
  readonly jsRuntime?: string | null;
  /** aria2c version when a binary is present, else null (Phase 2). */
  readonly aria2c?: string | null;
  /** Resolved path per tool id (missing tools read null). */
  readonly toolPaths?: Readonly<Record<string, string | null>>;
  /** Platform details for diagnostics (absent from old mocks). */
  readonly os?: string;
  readonly arch?: string;
  readonly electron?: string;
  readonly node?: string;
}

/** Result of repairEngine(): which binaries were restored vs still broken. */
export interface RepairReport {
  readonly ok: boolean;
  readonly repaired: readonly string[];
  readonly failed: readonly string[];
  readonly versions: EngineVersions | null;
}

/** Throttled aggregate for taskbar progress + tray tooltip. */
export interface AggregateProgressState {
  readonly active: number;
  readonly percent: number | null;
  readonly tooltip: string;
}

/** Dominant thumbnail colour as 0-255 channels (null when unavailable). */
export interface ThumbnailColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Release details behind an available app update (for the launch popup). */
export interface AppReleaseInfo {
  readonly tag: string;
  readonly publishedAt: string | null;
  readonly notes: string | null;
  readonly setupName: string | null;
  readonly setupSize: number | null;
  readonly setupUrl: string | null;
  readonly portableName: string | null;
  readonly portableSize: number | null;
  readonly portableUrl: string | null;
}

/** Result of checkForUpdates(): app + yt-dlp freshness in one round trip. */
export interface UpdateStatus {
  readonly appCurrent: string;
  readonly appLatest: string | null;
  readonly appUpdate: boolean;
  /** Where to download the new release (GitHub Releases, allowlisted). */
  readonly appUrl: string;
  /** Full release metadata when an update is available (popup content). */
  readonly appRelease: AppReleaseInfo | null;
  readonly ytdlpCurrent: string;
  readonly ytdlpLatest: string | null;
  readonly ytdlpUpdate: boolean;
  /** ms epoch of this check (0 when never checked). */
  readonly checkedAt: number;
}

/** Polling snapshot of the in-app update download. */
export interface UpdateDownloadProgress {
  readonly state: "idle" | "downloading" | "done" | "installing" | "error";
  readonly receivedBytes: number;
  readonly totalBytes: number | null;
  readonly error: string | null;
}

/** Deep-link listener (fluxdl:// URL or CLI URL forwarded to the UI). */
export type DeepLinkCallback = (url: string) => void;

/** Scanned totals for the Stats storage card (best-effort, capped). */
export interface StorageInsights {
  readonly audioFiles: number;
  readonly audioBytes: number;
  readonly videoFiles: number;
  readonly videoBytes: number;
  readonly otherFiles: number;
  readonly otherBytes: number;
  readonly orphans: readonly string[];
  readonly orphanBytes: number;
}

/** Desired window chrome (M4.4 mini mode, M4.6 theme colors). */
export type { WindowChromeState } from "./window.js";
import type { WindowChromeState } from "./window.js";

export type WindowChromeListener = (state: WindowChromeState) => void;

/**
 * Single abstraction every platform engine must implement.
 * - Desktop: child_process wrapping yt-dlp binary (apps/desktop/DesktopEngine).
 *
 * Rules:
 * - All methods are async except listener registration.
 * - Implementations must validate/normalize URLs before touching the binary.
 * - Never spawn with shell:true (desktop); always pass an args array.
 */
export interface GetInfoInit {
  /** Client-generated id enabling cancelAnalyze() for this call. */
  readonly requestId?: string;
}

/** Which store file was quarantined + reset (renderer localizes the copy). */
export type RecoveryKind = "settings" | "queue" | "watchlist";

export interface RecoveryNotice {
  readonly kind: RecoveryKind;
  /** Quarantined copy path, or null when even the rename failed. */
  readonly backup: string | null;
}

export interface DownloadEngine {
  /** Fetch metadata without downloading. Must not write files. */
  getInfo(url: string, init?: GetInfoInit): Promise<MediaInfo>;
  /** Abort an in-flight getInfo by requestId (unknown ids are a no-op). */
  cancelAnalyze(requestId: string): Promise<void>;
  /**
   * Gallery metadata probe (no download). Resolves unsupported (never
   * rejects) when no extractor handles the URL; rejects on timeout,
   * cancel, or spawn failure. Cancel via cancelAnalyze(requestId).
   */
  probeGallery(url: string, init?: GetInfoInit): Promise<GalleryProbe>;
  /** Enqueue + start a download. Resolves with the job id. */
  start(job: DownloadJobInput): Promise<string>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  onProgress(cb: ProgressCallback): Unsubscribe;
  getEngineVersion(): Promise<EngineVersions>;
  updateEngine(): Promise<EngineVersions>;
  /** Re-copy bundled binaries, verify hashes, re-check versions. */
  repairEngine(): Promise<RepairReport>;
  /**
   * Restore the previous (.bak) copy of a userData/bin tool installed by
   * installToolAtomic. False when there is nothing to roll back.
   */
  rollbackTool(toolId: string): Promise<boolean>;
  /**
   * Reinstall a bundled tool from the packaged resources (re-copy + verify).
   * External tools (deno/aria2c) reject with placement guidance.
   */
  reinstallTool(toolId: string): Promise<EngineVersions>;
  /** Run the Doctor health checks (Phase 2). Never throws for offline. */
  runDoctor(): Promise<DoctorReport>;
  /**
   * Post-processing pipeline (Phase 4): manual step runs, media-info
   * summaries and forced tag matches. Auto runs happen engine-internally
   * after downloads finish (no channel needed for those).
   */
  postProcess(request: PostProcessRequest): Promise<PostProcessResult>;
  /** Optional Tool Packs (Phase 5): install/update/remove/status + models. */
  packs(request: PackRequest): Promise<PacksResult>;
  /**
   * Notifier secrets + tests (Phase 6B). Values flow renderer → main only;
   * status reports configured-flags, never the secrets themselves.
   */
  notifiers(request: NotifierRequest): Promise<NotifierResult>;
  /**
   * Loopback Remote API control (Phase 6A): server status, token
   * rotate/reveal, renderer drain of API-queued actions, redacted audit.
   * The HTTP server itself runs main-side and is off by default.
   */
  remoteApi(request: RemoteApiRequest): Promise<RemoteApiResult>;
  /**
   * Drain corrupt-store recovery notices (Phase 3): human-readable lines
   * for files that were quarantined + reset since the last call.
   */
  consumeRecoveryNotices(): Promise<RecoveryNotice[]>;
  /** Throttled aggregate state (taskbar progress bar + tray tooltip). */
  setAggregateProgress(state: AggregateProgressState): Promise<void>;
  /**
   * Window chrome (M4.4/M4.6): mini mode geometry + always-on-top, and the
   * native window colors that follow the theme. Main owns the geometry and
   * persists it outside AppSettings.
   */
  applyWindowChrome(state: WindowChromeState): Promise<void>;
  /** Push chrome changes made outside the renderer (tray menu). */
  onWindowChrome(cb: WindowChromeListener): Unsubscribe;
  /** Dominant colour of an https thumbnail (null when unavailable). */
  getThumbnailColor(url: string): Promise<ThumbnailColor | null>;
  pickFolder(): Promise<string | null>;
  /** File picker for locating moved downloads (null = cancelled). */
  pickFile(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  revealInFolder(path: string): Promise<void>;
  /** True when a job/history destination still exists on disk (guard-checked). */
  fileExists(path: string): Promise<boolean>;
  /** Bulk existence check (each path guard-checked; invalid entries read false). */
  fileExistsBulk(paths: string[]): Promise<boolean[]>;
  /**
   * Real on-disk size per path (guard-checked, null when unknown). Used by the
   * Stats screen to fill in sizes for history rows that predate the engine
   * reporting them — without it "total size" reads "Unknown" for old records.
   */
  fileSizesBulk(paths: string[]): Promise<Array<number | null>>;
  /** Which extractor::id keys appear in the download archive. */
  archiveHas(keys: string[]): Promise<boolean[]>;
  /** Move a finished file to the Recycle Bin (guard-checked, never unlink). */
  trashFile(path: string): Promise<void>;
  /** Replace one history record (e.g. mark "file deleted"). */
  updateHistory(job: DownloadJob): Promise<void>;
  /** Delete the yt-dlp download-archive file (re-allow archived entries). */
  clearArchive(): Promise<void>;
  /** Watched channels for new-upload checks (persisted main-side). */
  loadWatchlist(): Promise<WatchChannel[]>;
  saveWatchlist(channels: WatchChannel[]): Promise<void>;
  /** Free space for a path's drive (null when unknown). Never throws. */
  getDiskSpace(path: string): Promise<{ freeBytes: number } | null>;
  /** Redacted yt-dlp argv of a job (null when unknown). For transparency. */
  getJobArgs(id: string): Promise<string[] | null>;
  /** Storage breakdown of the download folder + orphan partials (F2). */
  getStorageInsights(): Promise<StorageInsights>;
  /** Raw console of a job for the Logs screen (kept by the engine). */
  getRawLog(id: string): Promise<string | null>;
  /**
   * Graceful teardown: kill active yt-dlp/ffmpeg children but keep .part
   * files so the next boot re-queues and resumes them. Called from
   * before-quit; after it resolves the app may exit immediately.
   */
  shutdown(): Promise<void>;
  /** Subscribe to deep-link URLs (second-instance / protocol / CLI arg). */
  onDeepLink(cb: DeepLinkCallback): Unsubscribe;
  /** Subscribe to batch-file text (.fluxdl opened from Explorer). */
  onBatchLink(cb: DeepLinkCallback): Unsubscribe;
  /**
   * System clipboard text (main-side Electron clipboard, no DOM permission
   * involved). Null when empty or unreadable — never throws.
   */
  readClipboard(): Promise<string | null>;
  /**
   * System clipboard write (main-side Electron clipboard). The DOM
   * `navigator.clipboard.writeText` path is denied inside the sandboxed
   * renderer, which is why every "Copy" button used to report a failure.
   * False when the clipboard refused it — never throws.
   */
  writeClipboard(text: string): Promise<boolean>;
  /**
   * One round trip for both updatables: the app itself (GitHub Releases)
   * and yt-dlp. Best-effort: offline checkers resolve update=false, never
   * throw for network reasons (invalid state still throws). Pass force=true
   * to bypass the hourly cache (the Logs button does; launch uses cache).
   */
  checkForUpdates(force?: boolean): Promise<UpdateStatus>;
  /**
   * Download the Setup installer of the pending update (progress via
   * getUpdateDownloadProgress). On completion the installer launches
   * silently and the app quits — that IS the install step.
   */
  startUpdateDownload(): Promise<void>;
  getUpdateDownloadProgress(): Promise<UpdateDownloadProgress>;
  cancelUpdateDownload(): Promise<void>;
  /**
   * Safe local-media URL for in-app preview, or null when the path is
   * outside the download roots or not a playable audio/video file.
   * Served main-side over an allowlisted custom protocol (never file://).
   */
  getMediaUrl(path: string): Promise<string | null>;
  /**
   * Open a URL in the OS browser. Allowlisted to the project's GitHub
   * Releases page only — anything else throws.
   */
  openExternal(url: string): Promise<void>;
  /** Settings persist main-side (atomic JSON). Renderer talks via these only. */
  loadSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /** Queue snapshot + finished history persist in main (JSON / JSONL). */
  loadQueue(): Promise<DownloadJob[]>;
  saveQueue(jobs: DownloadJob[]): Promise<void>;
  appendHistory(job: DownloadJob): Promise<void>;
  loadHistory(): Promise<DownloadJob[]>;
  removeHistory(id: string): Promise<void>;
  clearHistory(): Promise<void>;
  /**
   * Replace the WHOLE history in one atomic write (backup restore).
   * Never implemented as clear-then-append: that destroyed the existing
   * history before the new one was written and reported success on a partial
   * restore (v1.7.2).
   */
  restoreHistory(jobs: DownloadJob[]): Promise<void>;
}

/**
 * Single typed IPC channel map for Electron preload.
 * The preload exposes exactly these channels; nothing else.
 * Renderer (core UI) talks through this map only.
 */
export const IPC_CHANNELS = {
  getInfo: "engine:getInfo",
  cancelAnalyze: "engine:cancelAnalyze",
  probeGallery: "engine:probeGallery",
  start: "engine:start",
  pause: "engine:pause",
  resume: "engine:resume",
  cancel: "engine:cancel",
  onProgress: "engine:onProgress",
  getEngineVersion: "engine:getVersion",
  updateEngine: "engine:update",
  repairEngine: "engine:repair",
  rollbackTool: "engine:rollbackTool",
  reinstallTool: "engine:reinstallTool",
  runDoctor: "engine:runDoctor",
  postProcess: "engine:postProcess",
  packs: "engine:packs",
  notifiers: "engine:notifiers",
  remoteApi: "engine:remoteApi",
  consumeRecoveryNotices: "store:recoveryNotices",
  setAggregateProgress: "engine:aggregate",
  applyWindowChrome: "engine:windowChrome",
  onWindowChrome: "engine:windowChromeChanged",
  getThumbnailColor: "engine:thumbnailColor",
  pickFolder: "engine:pickFolder",
  pickFile: "engine:pickFile",
  openPath: "engine:openPath",
  revealInFolder: "engine:reveal",
  fileExists: "engine:fileExists",
  fileExistsBulk: "engine:fileExistsBulk",
  fileSizesBulk: "engine:fileSizesBulk",
  archiveHas: "engine:archiveHas",
  trashFile: "engine:trashFile",
  updateHistory: "store:updateHistory",
  clearArchive: "engine:clearArchive",
  loadSettings: "store:loadSettings",
  saveSettings: "store:saveSettings",
  loadQueue: "store:loadQueue",
  saveQueue: "store:saveQueue",
  appendHistory: "store:appendHistory",
  loadHistory: "store:loadHistory",
  removeHistory: "store:removeHistory",
  clearHistory: "store:clearHistory",
  restoreHistory: "store:restoreHistory",
  loadWatchlist: "store:loadWatchlist",
  saveWatchlist: "store:saveWatchlist",
  getDiskSpace: "engine:diskSpace",
  getJobArgs: "engine:jobArgs",
  getStorageInsights: "engine:storage",
  startUpdateDownload: "engine:startUpdate",
  getUpdateDownloadProgress: "engine:updateProgress",
  cancelUpdateDownload: "engine:cancelUpdate",
  getRawLog: "engine:getLog",
  onDeepLink: "app:deepLink",
  onBatchLink: "app:batchLink",
  readClipboard: "app:readClipboard",
  writeClipboard: "app:writeClipboard",
  checkForUpdates: "engine:checkUpdates",
  getMediaUrl: "engine:mediaUrl",
  openExternal: "app:openExternal",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

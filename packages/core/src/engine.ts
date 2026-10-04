import type {
  AppSettings,
  DownloadJob,
  DownloadJobInput,
  MediaInfo,
  WatchChannel,
} from "./types.js";
import type { ErrorCategory } from "./errors.js";

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

export interface DownloadEngine {
  /** Fetch metadata without downloading. Must not write files. */
  getInfo(url: string, init?: GetInfoInit): Promise<MediaInfo>;
  /** Abort an in-flight getInfo by requestId (unknown ids are a no-op). */
  cancelAnalyze(requestId: string): Promise<void>;
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
}

/**
 * Single typed IPC channel map for Electron preload.
 * The preload exposes exactly these channels; nothing else.
 * Renderer (core UI) talks through this map only.
 */
export const IPC_CHANNELS = {
  getInfo: "engine:getInfo",
  cancelAnalyze: "engine:cancelAnalyze",
  start: "engine:start",
  pause: "engine:pause",
  resume: "engine:resume",
  cancel: "engine:cancel",
  onProgress: "engine:onProgress",
  getEngineVersion: "engine:getVersion",
  updateEngine: "engine:update",
  repairEngine: "engine:repair",
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
  checkForUpdates: "engine:checkUpdates",
  getMediaUrl: "engine:mediaUrl",
  openExternal: "app:openExternal",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

import type { AppSettings, DownloadJob, DownloadJobInput, MediaInfo } from "./types.js";

/** Progress event pushed by the engine. */
export interface EngineProgress {
  readonly id: string;
  readonly percent: number;
  readonly speed: string | null;
  readonly eta: string | null;
  readonly downloadedBytes: number | null;
  readonly totalBytes: number | null;
  readonly stage: string;
  /** Last known output file reported by the engine, if any. */
  readonly destination: string | null;
}

/** Unsubscribe function. */
export type Unsubscribe = () => void;

export type ProgressCallback = (event: EngineProgress) => void;

export interface EngineVersions {
  readonly ytdlp: string;
  readonly ffmpeg: string | null;
  readonly app: string;
}

/**
 * Single abstraction every platform engine must implement.
 * - Desktop: child_process wrapping yt-dlp binary (apps/desktop/DesktopEngine).
 *
 * Rules:
 * - All methods are async except listener registration.
 * - Implementations must validate/normalize URLs before touching the binary.
 * - Never spawn with shell:true (desktop); always pass an args array.
 */
export interface DownloadEngine {
  /** Fetch metadata without downloading. Must not write files. */
  getInfo(url: string): Promise<MediaInfo>;
  /** Enqueue + start a download. Resolves with the job id. */
  start(job: DownloadJobInput): Promise<string>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  onProgress(cb: ProgressCallback): Unsubscribe;
  getEngineVersion(): Promise<EngineVersions>;
  updateEngine(): Promise<EngineVersions>;
  pickFolder(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  revealInFolder(path: string): Promise<void>;
  /** True when a job/history destination still exists on disk (guard-checked). */
  fileExists(path: string): Promise<boolean>;
  /** Delete the yt-dlp download-archive file (re-allow archived entries). */
  clearArchive(): Promise<void>;
  /** Raw console of a job for the Logs screen (kept by the engine). */
  getRawLog(id: string): Promise<string | null>;
  /** Settings persist in main (electron-store). Renderer talks via these only. */
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
  start: "engine:start",
  pause: "engine:pause",
  resume: "engine:resume",
  cancel: "engine:cancel",
  onProgress: "engine:onProgress",
  getEngineVersion: "engine:getVersion",
  updateEngine: "engine:update",
  pickFolder: "engine:pickFolder",
  openPath: "engine:openPath",
  revealInFolder: "engine:reveal",
  fileExists: "engine:fileExists",
  clearArchive: "engine:clearArchive",
  loadSettings: "store:loadSettings",
  saveSettings: "store:saveSettings",
  loadQueue: "store:loadQueue",
  saveQueue: "store:saveQueue",
  appendHistory: "store:appendHistory",
  loadHistory: "store:loadHistory",
  removeHistory: "store:removeHistory",
  clearHistory: "store:clearHistory",
  getRawLog: "engine:getLog",
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

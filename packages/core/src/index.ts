export { APP_NAME } from "./branding.js";
export type {
  AppSettings,
  AudioPreset,
  DownloadJob,
  DownloadJobInput,
  DownloadPreset,
  FormatOption,
  JobStatus,
  MediaInfo,
  MediaKind,
  PlaylistEntry,
  ThemeName,
  VideoPreset,
} from "./types.js";
export type {
  DownloadEngine,
  EngineProgress,
  EngineVersions,
  ProgressCallback,
  Unsubscribe,
} from "./engine.js";
export { IPC_CHANNELS } from "./engine.js";
export type { IpcChannel } from "./engine.js";
export { App } from "./App.js";
export { normalizeUrl, isValidUrl, UrlValidationError } from "./url.js";
export {
  buildDownloadArgs,
  buildFfmpegVersionArgs,
  buildInfoArgs,
  buildUpdateArgs,
  buildVersionArgs,
} from "./args.js";
export type { DownloadArgsInput } from "./args.js";
export { parseProgressLine, PROGRESS_TEMPLATE } from "./progress.js";
export type { ParsedProgress } from "./progress.js";
export { mapDownloadError } from "./errors.js";
export type { ErrorCategory, MappedError } from "./errors.js";
export { parseMediaInfo } from "./media.js";
export {
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
  MAX_HISTORY_ITEMS,
  canTransition,
  nextStatus,
  transition,
  applyEngineProgress,
  computeBackoffMs,
  clampConcurrency,
  activeCount,
  selectNextToStart,
  shouldRetry,
  makeJob,
  isFinished,
  searchHistory,
  pruneHistory,
} from "./queue.js";
export type { QueueEvent, TransitionOptions, EngineProgressLike } from "./queue.js";
export { QueueController } from "./queueController.js";
export type { QueueEngine, QueueClock, QueueControllerOptions } from "./queueController.js";
export { DEFAULT_SETTINGS, mergeSettings } from "./settings.js";
export { createQueueStore, createSettingsStore } from "./stores.js";
export type {
  QueueStoreEngine,
  QueueStoreState,
  SettingsStoreEngine,
  SettingsStoreState,
} from "./stores.js";

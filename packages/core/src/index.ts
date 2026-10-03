export { APP_NAME } from "./branding.js";
export type {
  AppSettings,
  AudioPreset,
  CodecPreference,
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
  AggregateProgressState,
  ProgressCallback,
  RepairReport,
  Unsubscribe,
} from "./engine.js";
export {
  aggregateStatus,
  formatSpeedBps,
  shouldSendAggregate,
  AGGREGATE_SEND_MS,
} from "./aggregate.js";
export type { AggregateStatus } from "./aggregate.js";
export { IPC_CHANNELS } from "./engine.js";
export type { IpcChannel } from "./engine.js";
export { App } from "./App.js";
export { Shell } from "./Shell.js";
export type { ShellView, ShellProps } from "./Shell.js";
export { flipShift, prefersReducedMotion, staggerIn, fadeSwap, pressScale, tweenProgress } from "./motion.js";
export { STRINGS } from "./strings.js";
export type { Strings } from "./strings.js";
export { Home, formatDuration } from "./Home.js";
export type { HomeProps } from "./Home.js";
export {
  MAX_BATCH_BYTES,
  MAX_BATCH_LINES,
  addBatchEntries,
  expandPlaylistEntry,
  parseBatchText,
  removeBatchEntry,
  retryBatchEntries,
  updateBatchEntry,
} from "./batch.js";
export { BatchPanel } from "./BatchPanel.js";
export type { BatchPanelProps } from "./BatchPanel.js";
export { useDuplicateGuard } from "./DuplicatePrompt.js";
export {
  filterDuplicates,
  findDuplicate,
  identityKey,
} from "./identity.js";
export type {
  BatchEntry,
  BatchEntryPatch,
  BatchInvalid,
  BatchParsed,
  BatchParseResult,
  BatchStatus,
} from "./batch.js";
export type {
  DuplicateChoice,
  DuplicateHit,
  DuplicateScope,
  DuplicateTarget,
  GuardedTarget,
  GuardInput,
} from "./identity.js";
export { Downloads } from "./Downloads.js";
export type { DownloadsProps } from "./Downloads.js";
export { Library } from "./Library.js";
export type { LibraryProps } from "./Library.js";
export { SettingsScreen } from "./SettingsScreen.js";
export type { SettingsScreenProps } from "./SettingsScreen.js";
export { Logs } from "./Logs.js";
export type { LogsProps } from "./Logs.js";
export { createToastStore } from "./toast.js";
export type { Toast, ToastAction, ToastKind, ToastStoreState } from "./toast.js";
export { Toasts } from "./Toasts.js";
export { ensureNotificationPermission, sendNotification } from "./notify.js";
export { comboFromEvent, isEditableTarget, isOpenSettings, isPasteAnalyze } from "./shortcuts.js";
export type { KeyCombo } from "./shortcuts.js";
export { readClipboardText, writeClipboardText } from "./clipboard.js";
export { menuItemsFor, presetForMenu, MENU_AUDIO_PRESETS, MENU_VIDEO_PRESETS } from "./menu.js";
export type { CardMenuId, MenuMove } from "./menu.js";
export { ContextMenu } from "./ContextMenu.js";
export type { ContextMenuProps, MenuItemDef } from "./ContextMenu.js";
export { buildJobMenu } from "./JobMenu.js";
export type { JobMenuHandlers } from "./JobMenu.js";
export { normalizeUrl, isValidUrl, UrlValidationError } from "./url.js";
export {
  buildDownloadArgs,
  buildFfmpegVersionArgs,
  buildInfoArgs,
  buildUpdateArgs,
  buildVersionArgs,
  codecSortOf,
} from "./args.js";
export type { DownloadArgsInput } from "./args.js";
export { parseProgressLine, PROGRESS_TEMPLATE, parseSpeedBps } from "./progress.js";
export type { ParsedProgress } from "./progress.js";
export { mapDownloadError, actionsFor } from "./errors.js";
export type { ErrorAction, ErrorActionId, ErrorCategory, MappedError } from "./errors.js";
export { ErrorActionButtons } from "./ErrorActions.js";
export type { ErrorActionButtonsProps, ErrorNavigate } from "./ErrorActions.js";
export { parseMediaInfo, estimatePresetSize, formatSize } from "./media.js";
export type { SizeEstimate } from "./media.js";
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
  reorder,
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

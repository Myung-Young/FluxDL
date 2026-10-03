export { APP_NAME } from "./branding.js";
export type {
  AppSettings,
  AudioPreset,
  CodecPreference,
  Density,
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
  GetInfoInit,
  ProgressCallback,
  RepairReport,
  ThumbnailColor,
  Unsubscribe,
} from "./engine.js";
export {
  aggregateStatus,
  formatSpeedBps,
  formatWindowTitle,
  shouldSendAggregate,
  AGGREGATE_SEND_MS,
} from "./aggregate.js";
export type { AggregateStatus } from "./aggregate.js";
export { IPC_CHANNELS } from "./engine.js";
export type { IpcChannel } from "./engine.js";
export { App } from "./App.js";
export { Shell } from "./Shell.js";
export type { ShellView, ShellProps } from "./Shell.js";
export { flipShift, prefersReducedMotion, staggerIn, fadeSwap, pressScale, tweenProgress, tweenAccentVar } from "./motion.js";
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
export { comboFromEvent, isEditableTarget, isOpenSettings, isPasteAnalyze, isCommandPalette, isShortcutHelp } from "./shortcuts.js";
export type { KeyCombo } from "./shortcuts.js";
export { ShortcutsDialog, shortcutRows } from "./ShortcutsDialog.js";
export type { ShortcutRow, ShortcutsDialogProps } from "./ShortcutsDialog.js";
export { readClipboardText, writeClipboardText } from "./clipboard.js";
export {
  contrastRatio,
  deriveAccent,
  deriveAccentScale,
  dominantColor,
  hexToRgb,
  hslToRgb,
  rgbToHex,
  rgbToHsl,
} from "./color.js";
export type { AccentScale, Hsl, Rgb } from "./color.js";
export { LruCache } from "./cache.js";
export type { CacheClock } from "./cache.js";
export {
  BUILTIN_COMMANDS,
  availableCommands,
  fuzzyScore,
  rankCommands,
} from "./commands.js";
export type { CommandContext, CommandDef, CommandView, RankedCommand } from "./commands.js";
export { CommandPalette } from "./CommandPalette.js";
export type { CommandPaletteProps } from "./CommandPalette.js";
export { Onboarding } from "./Onboarding.js";
export type { OnboardingProps } from "./Onboarding.js";
export {
  ONBOARDING_STEPS,
  isFirstStep,
  isLastStep,
  nextStep,
  prevStep,
  stepIndex,
} from "./Onboarding.js";
export type { OnboardingDraft, OnboardingStep } from "./Onboarding.js";
export {
  LOG_TAIL_CHARS,
  MAX_ERROR_EVENTS,
  baseName,
  buildDiagnostics,
  redactProxyCredentials,
  redactUrlSecrets,
  redactUserPaths,
  stripUrls,
} from "./diagnostics.js";
export type { DiagnosticError, DiagnosticsData } from "./diagnostics.js";
export { menuItemsFor, presetForMenu, MENU_AUDIO_PRESETS, MENU_VIDEO_PRESETS } from "./menu.js";
export type { CardMenuId, MenuMove } from "./menu.js";
export { ContextMenu } from "./ContextMenu.js";
export type { ContextMenuProps, MenuItemDef } from "./ContextMenu.js";
export { buildJobMenu } from "./JobMenu.js";
export type { JobMenuHandlers } from "./JobMenu.js";
export { VirtualList, visibleRange } from "./VirtualList.js";
export type { VirtualListProps } from "./VirtualList.js";
export { deriveEntryStates, sanitizePlaylistTitle } from "./playlist.js";
export type { EntryState } from "./playlist.js";
export { chunkDestinations, deriveMissingIds } from "./health.js";
export { hasMojibake, isMediaFile, pickFallbackFile } from "./destination.js";
export type { DirEntry } from "./destination.js";
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
export { mapDownloadError, actionsFor, cancelledMapped, timeoutMapped } from "./errors.js";
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
  retryInSeconds,
  makeJob,
  isFinished,
  searchHistory,
  pruneHistory,
  reorder,
  toStartInput,
} from "./queue.js";export type { QueueEvent, TransitionOptions, EngineProgressLike } from "./queue.js";
export {
  buildParseMetadataArg,
  buildParseMetadataArgs,
  defaultAudioMetadata,
  hasAudioMetadata,
  isAudioMetadata,
  isAudioPreset,
  normalizeAudioMetadata,
} from "./metadata.js";
export type { AudioMetaField, AudioMetadata } from "./metadata.js";
export { QueueController } from "./queueController.js";
export type { QueueEngine, QueueClock, QueueControllerOptions } from "./queueController.js";
export { DEFAULT_SETTINGS, mergeSettings } from "./settings.js";
export { filterSettingIds, matchSettingField } from "./settingsFilter.js";
export type { FilterableField } from "./settingsFilter.js";
export { countLogMatches, filterLogLines, isErrorLine } from "./logFilter.js";
export { previewFilename, validateFilenameTemplate, validateSpeedLimit } from "./validate.js";
export { createQueueStore, createSettingsStore } from "./stores.js";
export type {
  QueueStoreEngine,
  QueueStoreState,
  SettingsStoreEngine,
  SettingsStoreState,
} from "./stores.js";

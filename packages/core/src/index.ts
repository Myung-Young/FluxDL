export { APP_NAME } from "./branding.js";
export type {
  AppSettings,
  AudioPreset,
  CloseBehavior,
  CodecPreference,
  Density,
  DownloadJob,
  DownloadJobInput,
  DownloadPreset,
  EngineId,
  FileResult,
  FormatOption,
  ImagesSettings,
  JobStatus,
  MediaInfo,
  MediaKind,
  PlaylistEntry,
  RouterMode,
  ThemeName,
  VideoPreset,
  YtDlpChannel,
} from "./types.js";
export { CLOSE_BEHAVIORS, ENGINE_IDS, ROUTER_MODES, YTDLP_CHANNELS } from "./types.js";
export type { WatchChannel } from "./types.js";
export type { CompressPreset, ConvertFormat, GalleryPackage, JobPriority, PostProcessSettings, SubscriptionMode, UgoiraFormat } from "./types.js";
export { COMPRESS_PRESETS, GALLERY_PACKAGES, JOB_PRIORITIES, SUBSCRIPTION_MODES, UGOIRA_FORMATS } from "./types.js";
export { addWatchChannel, diffWatch, normalizeWatchlist, touchWatch } from "./watchlist.js";
export {
  MAX_NEW_PER_CHECK,
  MAX_SUB_FAILURES,
  MIN_SUB_INTERVAL_MIN,
  cleanIntervalMin,
  cleanSubMode,
  cleanSubscription,
  defaultSubFields,
  dueSubs,
  isSubDue,
  recordSubResult,
  subDelayMs,
} from "./subscriptions.js";
export {
  POST_STEPS,
  TAG_AUTO_SCORE,
  buildCompressArgs,
  buildConvertArgs,
  buildRcloneArgs,
  buildRecordingQuery,
  buildWhisperArgs,
  classifyPostFile,
  convertOutputPath,
  hasBasicTags,
  hasEncoder,
  hintFromFilename,
  isAudioFile,
  isImageFile,
  isVideoFile,
  parseHwaccels,
  parseMediaSummary,
  parseRecordingDetail,
  parseRecordingResponse,
  pickH264Encoder,
  pickTagCandidate,
  rcloneDest,
  srtBasePath,
  stepsFor,
  wavTempPath,
} from "./postprocess.js";
export type { MediaSummary, PostFile, PostStep, StepsForInput, TagCandidate } from "./postprocess.js";
export {
  PACK_MANIFESTS,
  WHISPER_MODELS,
  discoverNm3u8dl,
  discoverRclone,
  discoverStreamlink,
  discoverWhisper,
  isAllowedPackUrl,
  isManifestUrl,
  isRevoked,
  packManifest,
  parseSha256sums,
  sanitizeFileStem,
  whisperModel,
} from "./packs.js";
export type {
  DiscoveredAsset,
  PackId,
  PackKind,
  PackManifest,
  RcloneDiscovery,
  RevokedPacks,
  WhisperModel,
} from "./packs.js";
export { fuzzyMatch, fuzzyRank } from "./fuzzy.js";
export { exportBackup, parseBackup } from "./backup.js";
export type { BackupPayload, ParsedBackup } from "./backup.js";
export { describeIntent, parseIntent, runIntent } from "./intent.js";
export type { Intent, IntentLabel } from "./intent.js";
export type { WatchDiff } from "./watchlist.js";
export type {
  AppReleaseInfo,
  DeepLinkCallback,
  DownloadEngine,
  EngineProgress,
  EngineVersions,
  AggregateProgressState,
  GalleryProbe,
  GalleryProbeItem,
  GetInfoInit,
  PackRequest,
  PacksResult,
  PostProcessRequest,
  PostProcessResult,
  ProgressCallback,
  NotifierOp,
  NotifierRequest,
  NotifierResult,
  RemoteApiOp,
  RemoteApiRequest,
  RemoteApiResult,
  RemoteApiStatus,
  RepairReport,
  StorageInsights,
  ThumbnailColor,
  Unsubscribe,
  UpdateDownloadProgress,
  UpdateStatus,
} from "./engine.js";
export { extractDeepLinkTarget, parseFluxDlUrl } from "./deeplink.js";
export {
  REMOTE_API_AUDIT_CAP,
  REMOTE_API_DEFAULT_PORT,
  REMOTE_API_MAX_BODY_BYTES,
  REMOTE_API_MAX_URLS,
  REMOTE_API_MAX_URL_CHARS,
  REMOTE_API_RATE_LIMIT,
  REMOTE_API_RATE_WINDOW_MS,
  REMOTE_JOB_ACTIONS,
  buildPairingLink,
  buildLanPairingLink,
  clampApiPort,
  createRateLimiter,
  isLoopbackHost,
  originAllowed,
  parseAddBody,
  parseBearer,
  parseJobBody,
  parsePairingLink,
  pushAudit,
  toApiJobView,
  tokensEqual,
} from "./remoteApi.js";
export type {
  AddBodyError,
  AddBodyResult,
  ApiJobView,
  AuditEntry,
  JobBodyError,
  JobBodyResult,
  PairingInfo,
  RateLimiter,
  RemoteApiAction,
  RemoteJobAction,
} from "./remoteApi.js";
export {
  APP_API_URL,
  APP_ISSUES_URL,
  APP_RELEASES_URL,
  YTDLP_API_URL,
  buildIssueUrl,
  isAllowedExternalUrl,
  isNewerVersion,
  latestTagFromRelease,
  parseReleasePayload,
  pickPortableAsset,
  pickSetupAsset,
} from "./updates.js";
export {
  aggregateStatus,
  formatEta,
  formatSpeedBps,
  formatWindowTitle,
  queueEta,
  shouldSendAggregate,
  AGGREGATE_SEND_MS,
} from "./aggregate.js";
export type { AggregateStatus, QueueEta } from "./aggregate.js";
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
export { MiniView } from "./MiniView.js";
export type { MiniViewProps } from "./MiniView.js";
export { Stats } from "./StatsScreen.js";
export type { StatsProps } from "./StatsScreen.js";
export {
  computeStats,
  formatTotalDuration,
  startOfDay,
  startOfWeek,
  weekLabel,
} from "./stats.js";
export type { DownloadStats, PresetMixEntry, TopUploader, WeekBucket } from "./stats.js";
export { Library } from "./Library.js";
export type { LibraryProps } from "./Library.js";
export { ChangelogScreen } from "./ChangelogScreen.js";
export type { ChangelogScreenProps } from "./ChangelogScreen.js";
export { CHANGELOG_ENTRIES } from "./changelog.js";
export type { ChangelogEntry } from "./changelog.js";
export { PreviewModal } from "./PreviewModal.js";
export type { PreviewModalProps } from "./PreviewModal.js";
export { UpdateModal } from "./UpdateModal.js";
export type { UpdateModalProps } from "./UpdateModal.js";
export { AppIcon } from "./icons.js";
export type { IconName } from "./icons.js";
export { ErrorBoundary } from "./ErrorBoundary.js";
export type { ErrorBoundaryProps } from "./ErrorBoundary.js";
export { SettingsScreen } from "./SettingsScreen.js";
export type { SettingsScreenProps } from "./SettingsScreen.js";
export { PackStore } from "./PackStore.js";
export type { PackStoreProps } from "./PackStore.js";
export { ToolsSection } from "./ToolsSection.js";
export type { ToolsSectionProps } from "./ToolsSection.js";
export { GalleryPreview } from "./GalleryPreview.js";
export type { GalleryPreviewProps } from "./GalleryPreview.js";
export { RemoteSection } from "./RemoteSection.js";
export type { RemoteSectionProps } from "./RemoteSection.js";
export { usePackInstalled } from "./usePackInstalled.js";
export type { PackInstalled } from "./usePackInstalled.js";
export { Logs } from "./Logs.js";
export type { LogsProps } from "./Logs.js";
export { createToastStore } from "./toast.js";
export type { Toast, ToastAction, ToastKind, ToastStoreState } from "./toast.js";
export { Toasts } from "./Toasts.js";
export { ensureNotificationPermission, sendNotification } from "./notify.js";
export { comboFromEvent, isEditableTarget, isOpenSettings, isPasteAnalyze, isCommandPalette, isMiniMode, isShortcutHelp } from "./shortcuts.js";
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
export {
  autoSortSubdir,
  episodeSeasonFolder,
  hasMojibake,
  isExecutablePath,
  isMediaFile,
  mediaGroup,
  pickFallbackFile,
} from "./destination.js";
export type { DirEntry } from "./destination.js";
export { normalizeUrl, isValidUrl, UrlValidationError } from "./url.js";
export {
  buildDownloadArgs,
  buildFfmpegVersionArgs,
  buildInfoArgs,
  buildUpdateArgs,
  buildUpdateToArgs,
  buildVersionArgs,
  codecSortOf,
  redactArgs,
} from "./args.js";
export type { DownloadArgsInput } from "./args.js";
export { parseProgressLine, PROGRESS_TEMPLATE, parseSpeedBps } from "./progress.js";
export type { ParsedProgress } from "./progress.js";
export { resolveEngine, domainOf, engineLabel, BUILTIN_ENGINE_RULES } from "./engines.js";
export type { DomainRule, ResolveInput, ResolveOutput, ResolveReason, ProbeResult } from "./engines.js";
export { buildGalleryDlConfig, resolveGalleryConfigText, validateGalleryConfigJson } from "./galleryConfig.js";
export type { GalleryConfig, GalleryConfigInput } from "./galleryConfig.js";
export {
  parseGalleryDlLine,
  applyGalleryFileEvent,
  splitGalleryChunk,
  emptyGalleryProgress,
} from "./galleryProgress.js";
export type { GalleryFileEvent, GalleryProgress } from "./galleryProgress.js";
export {
  GALLERY_PROBE_MAX_ITEMS,
  GALLERY_PROBE_MAX_CHARS,
  PROBE_CACHE_TTL_MS,
  PROBE_CACHE_MAX_HOSTS,
  buildProbeArgs,
  createProbeCache,
  galleryStderrErrors,
  isUnsupportedUrlMessage,
  parseGalleryProbeJson,
} from "./galleryProbe.js";
export type {
  GalleryProbeParsed,
  ProbeArgsInput,
  ProbeCache,
  ProbeCacheClock,
} from "./galleryProbe.js";
export { TOOL_MANIFESTS, toolManifest, compareVersions, MIN_TOOL_VERSIONS } from "./tools.js";
export type { ToolInstallMode, ToolManifest } from "./tools.js";
export { buildDoctorReport, isCheckDue, isStalled, versionCheck } from "./doctor.js";
export type { DoctorCheck, DoctorReport, DoctorStatus } from "./doctor.js";
export { mapDownloadError, actionsFor, cancelledMapped, engineBrokenMapped, timeoutMapped } from "./errors.js";
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
  unfinishedCount,
  selectNextToStart,
  shouldRetry,
  retryInSeconds,
  makeJob,
  isFinished,
  engineOf,
  priorityOf,
  activeGalleryCount,
  isInDownloadWindow,
  filterHistory,
  sortHistory,
  DEFAULT_HISTORY_FILTER,
  HISTORY_SORTS,
  searchHistory,
  pruneHistory,
  reorder,
  toStartInput,
} from "./queue.js";export type { QueueEvent, TransitionOptions, EngineProgressLike, DownloadWindow, HistoryFilter, HistorySort } from "./queue.js";
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
export {
  MINI_HEIGHT,
  MINI_WIDTH,
  NORMAL_BOUNDS,
  RESTORE_VISIBLE_PX,
  WORK_AREA_MARGIN,
  boundsFor,
  centerIn,
  chromeState,
  fitToWorkArea,
  isRestorable,
  miniRows,
  miniSummary,
  restoreOrigin,
} from "./window.js";
export type { MiniSummary, Rect, WindowChromeState, WindowSize } from "./window.js";
export { THEMES, THEME_NAMES, isThemeName, themeSwatch } from "./themes.js";
export type { ThemeDef } from "./themes.js";
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

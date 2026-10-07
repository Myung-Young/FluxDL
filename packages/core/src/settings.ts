import type {
  AppSettings,
  AudioPreset,
  CodecPreference,
  Container,
  Density,
  DownloadPreset,
  EngineId,
  ImagesSettings,
  Language,
  RouterMode,
  VideoPreset,
  YtDlpChannel,
} from "./types.js";
import { AUDIO_PRESETS, CLOSE_BEHAVIORS, CONTAINERS, ENGINE_IDS, ROUTER_MODES, VIDEO_PRESETS, YTDLP_CHANNELS } from "./types.js";
import { THEME_NAMES } from "./themes.js";
import { clampConcurrency } from "./queue.js";

/** Defaults when no persisted settings exist yet. */
export const DEFAULT_SETTINGS: AppSettings = {
  downloadDir: "",
  filenameTemplate: "%(title)s [%(id)s].%(ext)s",
  concurrency: 2,
  speedLimit: null,
  proxy: null,
  cookiesFromBrowser: null,
  cookiesFile: null,
  embedThumbnail: false,
  embedMetadata: false,
  subtitles: false,
  subtitleLangs: "en",
  embedSubs: false,
  includeAutoSubs: true,
  mergeContainer: "mp4",
  // Polite pacing is OFF by default: a user who wants human-like delays opts
  // in, and the default argv stays byte-identical to earlier versions (v1.7.2).
  pacing: {
    sleepRequestsSec: null,
    minSleepIntervalSec: null,
    maxSleepIntervalSec: null,
    sleepSubtitlesSec: null,
  },
  sponsorBlock: false,
  codecPreference: "auto",
  skipArchived: true,
  theme: "obsidian",
  postDownloadAction: "none",
  autoCheckUpdate: true,
  onboardingDone: false,
  defaultPreset: { kind: "video", videoPreset: "Compatible", audioPreset: "MP3", rawFormat: null },
  analyzeTimeoutSec: 60,
  thumbnailAccent: true,
  density: "comfortable",
  accentOverride: null,
  playlistSubfolder: true,
  language: "auto",
  notifyFinished: true,
  followSystemTheme: false,
  launchAtLogin: false,
  autoSort: false,
  experimental: false,
  skippedUpdate: null,
  lastView: "home",
  lastQueueFilter: "all",
  batchDraft: "",
  presetBySite: {},
  savedSearches: [],
  recentSearches: [],
  historyLimit: 500,
  // X quits by default: hiding to tray only when the user opts in.
  // (An earlier default of "tray" made X ignore the minimize-to-tray toggle
  // and trap users who expected a real quit.)
  closeBehavior: "quit",
  minimizeToTray: false,
  ytdlpChannel: "stable",
  autoUpdateTools: false,
  useAria2c: false,
  concurrentFragments: null,
  downloadRetries: null,
  socketTimeoutSec: null,
  stalledTimeoutSec: 120,
  sponsorBlockCategories: "all,-filler",
  impersonateClient: null,
  lastToolCheckAt: null,
  routerMode: "auto",
  domainRules: {},
  images: {
    downloadDir: "",
    folderTemplate: "{site}/{gallery}",
    filenameTemplate: "{filename}.{extension}",
    sleepRequestsSec: null,
    maxSleepIntervalSec: null,
    retries: 3,
    proxy: null,
    archive: true,
    metadataSidecar: false,
  },
  lastFolderByMedia: {},
};

const DENSITIES: readonly Density[] = ["comfortable", "compact"];
const LANGUAGES: readonly Language[] = ["auto", "en", "ms"];
const CODECS: readonly CodecPreference[] = ["auto", "h264", "vp9", "av1"];
const POST_ACTIONS: readonly AppSettings["postDownloadAction"][] = ["none", "open-file", "reveal"];

function cleanString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function cleanNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function cleanBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampTimeoutSec(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 60;
  return Math.min(300, Math.max(10, Math.floor(n)));
}

function cleanAccentOverride(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return /^#[0-9a-f]{6}$/i.test(t) ? t.toLowerCase() : null;
}

function clampHistoryLimit(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 500;
  return Math.min(5000, Math.max(10, Math.floor(n)));
}

/**
 * Pacing delay: null (off) or whole seconds clamped to a sane band (v1.7.2).
 * yt-dlp rejects a negative or NaN value, so a hand-edited settings file must
 * never be able to break every download.
 */
function cleanDelay(value: unknown, maxSec: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const seconds = Math.floor(value);
  if (seconds <= 0) return null;
  return Math.min(maxSec, seconds);
}

function cleanPacing(value: unknown, base: AppSettings["pacing"]): AppSettings["pacing"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return base;
  const rec = value as Record<string, unknown>;
  return {
    sleepRequestsSec: cleanDelay(rec["sleepRequestsSec"], 60),
    minSleepIntervalSec: cleanDelay(rec["minSleepIntervalSec"], 3600),
    maxSleepIntervalSec: cleanDelay(rec["maxSleepIntervalSec"], 3600),
    sleepSubtitlesSec: cleanDelay(rec["sleepSubtitlesSec"], 600),
  };
}

/** Container value, dropped (rather than passed to yt-dlp) when unknown. */
function cleanContainer(value: unknown): Container | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return CONTAINERS.includes(v as Container) ? (v as Container) : null;
}

/** Per-site preset map: garbage keys/presets are dropped, never defaulted. */
function cleanPresetBySite(value: unknown): Record<string, DownloadPreset> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, DownloadPreset> = {};
  for (const [rawKey, rawVal] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase().slice(0, 64);
    if (key.length === 0 || typeof rawVal !== "object" || rawVal === null) continue;
    const rec = rawVal as Record<string, unknown>;
    const kind = rec["kind"];
    const videoPreset = rec["videoPreset"];
    const audioPreset = rec["audioPreset"];
    if (kind !== "video" && kind !== "audio") continue;
    if (
      typeof videoPreset !== "string" ||
      !(VIDEO_PRESETS as readonly string[]).includes(videoPreset)
    ) {
      continue;
    }
    if (
      typeof audioPreset !== "string" ||
      !(AUDIO_PRESETS as readonly string[]).includes(audioPreset)
    ) {
      continue;
    }
    const siteContainer = cleanContainer(rec["container"]);
    out[key] = {
      kind,
      videoPreset: videoPreset as VideoPreset,
      audioPreset: audioPreset as AudioPreset,
      rawFormat: null,
      ...(siteContainer !== null ? { container: siteContainer } : {}),
    };
  }
  return out;
}

/** Search lists: trimmed non-empty strings, capped. */
const SHELL_VIEWS: readonly string[] = [
  "home",
  "downloads",
  "library",
  "stats",
  "settings",
  "logs",
  "changelog",
];
const QUEUE_FILTERS: readonly string[] = ["all", "active", "error", "done"];

function cleanView(value: unknown): string {
  return typeof value === "string" && SHELL_VIEWS.includes(value) ? value : "home";
}

function cleanQueueFilter(value: unknown): string {
  return typeof value === "string" && QUEUE_FILTERS.includes(value) ? value : "all";
}

function cleanDraft(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.slice(0, 102_400);
}

function cleanSearchList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const t = item.trim().slice(0, 40);
    if (t.length === 0 || out.includes(t)) continue;
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

function cleanRouterMode(value: unknown, fallback: RouterMode): RouterMode {
  return typeof value === "string" && (ROUTER_MODES as readonly string[]).includes(value)
    ? (value as RouterMode)
    : fallback;
}

function cleanDomainRules(value: unknown): Record<string, EngineId> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, EngineId> = {};
  for (const [rawKey, rawVal] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase().slice(0, 64);
    if (key.length === 0) continue;
    if (typeof rawVal !== "string") continue;
    const v = rawVal.trim().toLowerCase();
    if ((ENGINE_IDS as readonly string[]).includes(v)) out[key] = v as EngineId;
    if (Object.keys(out).length >= 200) break;
  }
  return out;
}

function cleanRetries(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  if (n < 0) return null;
  return Math.min(20, n);
}

function cleanChannel(value: unknown, fallback: YtDlpChannel): YtDlpChannel {
  return typeof value === "string" && (YTDLP_CHANNELS as readonly string[]).includes(value)
    ? (value as YtDlpChannel)
    : fallback;
}

/** Optional small-int knob (fragments/retries/timeout); null = tool default. */
function cleanOptionalInt(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  if (n < min) return null;
  return Math.min(max, n);
}

function cleanStalledTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 120;
  return Math.min(600, Math.max(0, Math.floor(value)));
}

/** SponsorBlock remove list: comma/space separated known-ish tokens. */
function cleanSponsorCats(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parts = value
    .split(",")
    .map((p) => p.trim().toLowerCase().replace(/[^a-z_-]/g, "").slice(0, 32))
    .filter((p) => p.length > 0);
  if (parts.length === 0) return fallback;
  return [...new Set(parts)].slice(0, 16).join(",");
}

/** Impersonate client id (free-form, validated main-side against --help set). */
function cleanImpersonate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().slice(0, 64);
  return t.length > 0 ? t : null;
}

function cleanEpochOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function cleanImages(
  value: unknown,
  base: ImagesSettings,
): ImagesSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return base;
  const rec = value as Record<string, unknown>;
  const folderRaw = typeof rec["folderTemplate"] === "string" && rec["folderTemplate"].trim().length > 0
    ? rec["folderTemplate"].trim().slice(0, 200)
    : base.folderTemplate;
  const fileRaw = typeof rec["filenameTemplate"] === "string" && rec["filenameTemplate"].trim().length > 0
    ? rec["filenameTemplate"].trim().slice(0, 200)
    : base.filenameTemplate;
  return {
    downloadDir: typeof rec["downloadDir"] === "string" ? rec["downloadDir"].slice(0, 1024) : base.downloadDir,
    folderTemplate: folderRaw,
    filenameTemplate: fileRaw,
    sleepRequestsSec: cleanDelay(rec["sleepRequestsSec"], 60),
    maxSleepIntervalSec: cleanDelay(rec["maxSleepIntervalSec"], 3600),
    retries: rec["retries"] === undefined ? base.retries : cleanRetries(rec["retries"]) ?? base.retries,
    proxy: rec["proxy"] === undefined ? base.proxy : cleanNullableString(rec["proxy"]),
    archive: typeof rec["archive"] === "boolean" ? rec["archive"] : base.archive,
    metadataSidecar: typeof rec["metadataSidecar"] === "boolean" ? rec["metadataSidecar"] : base.metadataSidecar,
  };
}

function cleanFolderMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(value)) {
    const key = rawKey.trim().toLowerCase().slice(0, 32);
    if ((key !== "video" && key !== "images" && key !== "audio") || typeof rawVal !== "string") continue;
    const v = rawVal.trim().slice(0, 1024);
    if (v.length > 0) out[key] = v;
    if (Object.keys(out).length >= 8) break;
  }
  return out;
}

function cleanPreset(
  value: unknown,
  fallback: AppSettings["defaultPreset"],
): AppSettings["defaultPreset"] {
  if (typeof value !== "object" || value === null) return fallback;
  const rec = value as Record<string, unknown>;
  const kind = rec["kind"];
  const videoPreset = rec["videoPreset"];
  const audioPreset = rec["audioPreset"];
  if (kind !== "video" && kind !== "audio") return fallback;
  if (
    typeof videoPreset !== "string" ||
    !(VIDEO_PRESETS as readonly string[]).includes(videoPreset)
  ) {
    return fallback;
  }
  if (
    typeof audioPreset !== "string" ||
    !(AUDIO_PRESETS as readonly string[]).includes(audioPreset)
  ) {
    return fallback;
  }
  const container = cleanContainer(rec["container"]);
  return {
    kind,
    videoPreset: videoPreset as VideoPreset,
    audioPreset: audioPreset as AudioPreset,
    rawFormat: null,
    ...(container !== null ? { container } : {}),
  };
}

/**
 * Merge a persisted/partial patch over base, sanitizing every field.
 * Never throws — corrupt disk values fall back per-field.
 */
export function mergeSettings(base: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const concurrencyRaw =
    typeof patch.concurrency === "number" ? patch.concurrency : base.concurrency;
  const themeRaw = patch.theme ?? base.theme;
  const codecRaw = patch.codecPreference ?? base.codecPreference;
  const densityRaw = patch.density ?? base.density;
  const languageRaw = patch.language ?? base.language;
  const postRaw = patch.postDownloadAction ?? base.postDownloadAction;
  const closeRaw = patch.closeBehavior ?? base.closeBehavior;
  return {
    downloadDir: typeof patch.downloadDir === "string" ? patch.downloadDir : base.downloadDir,
    filenameTemplate: cleanString(patch.filenameTemplate, base.filenameTemplate),
    concurrency: clampConcurrency(concurrencyRaw),
    speedLimit:
      patch.speedLimit === undefined ? base.speedLimit : cleanNullableString(patch.speedLimit),
    proxy: patch.proxy === undefined ? base.proxy : cleanNullableString(patch.proxy),
    cookiesFromBrowser:
      patch.cookiesFromBrowser === undefined
        ? base.cookiesFromBrowser
        : cleanNullableString(patch.cookiesFromBrowser),
    cookiesFile:
      patch.cookiesFile === undefined ? base.cookiesFile : cleanNullableString(patch.cookiesFile),
    embedThumbnail: cleanBool(patch.embedThumbnail, base.embedThumbnail),
    embedMetadata: cleanBool(patch.embedMetadata, base.embedMetadata),
    subtitles: cleanBool(patch.subtitles, base.subtitles),
    subtitleLangs: cleanString(patch.subtitleLangs, base.subtitleLangs),
    embedSubs: cleanBool(patch.embedSubs, base.embedSubs),
    includeAutoSubs: cleanBool(patch.includeAutoSubs, base.includeAutoSubs),
    mergeContainer: cleanContainer(patch.mergeContainer) ?? base.mergeContainer,
    pacing: cleanPacing(patch.pacing ?? base.pacing, base.pacing),
    sponsorBlock: cleanBool(patch.sponsorBlock, base.sponsorBlock),
    codecPreference: CODECS.includes(codecRaw) ? codecRaw : base.codecPreference,
    skipArchived: cleanBool(patch.skipArchived, base.skipArchived),
    theme: THEME_NAMES.includes(themeRaw) ? themeRaw : base.theme,
    postDownloadAction: POST_ACTIONS.includes(postRaw) ? postRaw : base.postDownloadAction,
    autoCheckUpdate: cleanBool(patch.autoCheckUpdate, base.autoCheckUpdate),
    onboardingDone: cleanBool(patch.onboardingDone, base.onboardingDone),
    defaultPreset: cleanPreset(
      patch.defaultPreset ?? base.defaultPreset,
      base.defaultPreset,
    ),
    analyzeTimeoutSec:
      patch.analyzeTimeoutSec === undefined
        ? base.analyzeTimeoutSec
        : clampTimeoutSec(patch.analyzeTimeoutSec),
    thumbnailAccent: cleanBool(patch.thumbnailAccent, base.thumbnailAccent),
    density: DENSITIES.includes(densityRaw) ? densityRaw : base.density,
    accentOverride:
      patch.accentOverride === undefined
        ? base.accentOverride
        : cleanAccentOverride(patch.accentOverride),
    playlistSubfolder: cleanBool(patch.playlistSubfolder, base.playlistSubfolder),
    language: LANGUAGES.includes(languageRaw) ? languageRaw : base.language,
    presetBySite:
      patch.presetBySite === undefined ? base.presetBySite : cleanPresetBySite(patch.presetBySite),
    savedSearches:
      patch.savedSearches === undefined ? base.savedSearches : cleanSearchList(patch.savedSearches, 10),
    recentSearches:
      patch.recentSearches === undefined
        ? base.recentSearches
        : cleanSearchList(patch.recentSearches, 5),
    historyLimit:
      patch.historyLimit === undefined
        ? base.historyLimit
        : clampHistoryLimit(patch.historyLimit),
    lastView: patch.lastView === undefined ? base.lastView : cleanView(patch.lastView),
    lastQueueFilter:
      patch.lastQueueFilter === undefined
        ? base.lastQueueFilter
        : cleanQueueFilter(patch.lastQueueFilter),
    batchDraft:
      patch.batchDraft === undefined ? base.batchDraft : cleanDraft(patch.batchDraft),
    followSystemTheme: cleanBool(patch.followSystemTheme, base.followSystemTheme),
    launchAtLogin: cleanBool(patch.launchAtLogin, base.launchAtLogin),
    autoSort: cleanBool(patch.autoSort, base.autoSort),
    experimental: cleanBool(patch.experimental, base.experimental),
    skippedUpdate:
      patch.skippedUpdate === undefined
        ? base.skippedUpdate
        : typeof patch.skippedUpdate === "string" && patch.skippedUpdate.trim().length > 0
          ? patch.skippedUpdate.trim().slice(0, 32)
          : null,
    closeBehavior: CLOSE_BEHAVIORS.includes(closeRaw) ? closeRaw : base.closeBehavior,
    minimizeToTray: cleanBool(patch.minimizeToTray, base.minimizeToTray),
    notifyFinished: cleanBool(patch.notifyFinished, base.notifyFinished),
    ytdlpChannel: cleanChannel(patch.ytdlpChannel ?? base.ytdlpChannel, base.ytdlpChannel),
    autoUpdateTools: cleanBool(patch.autoUpdateTools, base.autoUpdateTools),
    useAria2c: cleanBool(patch.useAria2c, base.useAria2c),
    concurrentFragments:
      patch.concurrentFragments === undefined
        ? base.concurrentFragments
        : cleanOptionalInt(patch.concurrentFragments, 1, 16),
    downloadRetries:
      patch.downloadRetries === undefined
        ? base.downloadRetries
        : cleanOptionalInt(patch.downloadRetries, 0, 30),
    socketTimeoutSec:
      patch.socketTimeoutSec === undefined
        ? base.socketTimeoutSec
        : cleanOptionalInt(patch.socketTimeoutSec, 5, 300),
    stalledTimeoutSec:
      patch.stalledTimeoutSec === undefined
        ? base.stalledTimeoutSec
        : cleanStalledTimeout(patch.stalledTimeoutSec),
    sponsorBlockCategories: cleanSponsorCats(
      patch.sponsorBlockCategories ?? base.sponsorBlockCategories,
      base.sponsorBlockCategories,
    ),
    impersonateClient:
      patch.impersonateClient === undefined
        ? base.impersonateClient
        : cleanImpersonate(patch.impersonateClient),
    lastToolCheckAt:
      patch.lastToolCheckAt === undefined
        ? base.lastToolCheckAt
        : cleanEpochOrNull(patch.lastToolCheckAt),
    routerMode: cleanRouterMode(patch.routerMode ?? base.routerMode, base.routerMode),
    domainRules:
      patch.domainRules === undefined ? base.domainRules : cleanDomainRules(patch.domainRules),
    images: cleanImages(patch.images ?? base.images, base.images),
    lastFolderByMedia:
      patch.lastFolderByMedia === undefined
        ? base.lastFolderByMedia
        : cleanFolderMap(patch.lastFolderByMedia),
  };
}

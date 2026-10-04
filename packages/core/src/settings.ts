import type {
  AppSettings,
  AudioPreset,
  CodecPreference,
  Density,
  DownloadPreset,
  Language,
  VideoPreset,
} from "./types.js";
import { AUDIO_PRESETS, CLOSE_BEHAVIORS, VIDEO_PRESETS } from "./types.js";
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
    out[key] = {
      kind,
      videoPreset: videoPreset as VideoPreset,
      audioPreset: audioPreset as AudioPreset,
      rawFormat: null,
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
  return {
    kind,
    videoPreset: videoPreset as VideoPreset,
    audioPreset: audioPreset as AudioPreset,
    rawFormat: null,
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
    mergeContainer: cleanString(patch.mergeContainer, base.mergeContainer),
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
  };
}

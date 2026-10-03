import type {
  AppSettings,
  AudioPreset,
  CodecPreference,
  ThemeName,
  VideoPreset,
} from "./types.js";
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
};

const THEMES: readonly ThemeName[] = ["obsidian", "midnight", "ember"];
const CODECS: readonly CodecPreference[] = ["auto", "h264", "vp9", "av1"];
const POST_ACTIONS: readonly AppSettings["postDownloadAction"][] = ["none", "open-file", "reveal"];
const VIDEO_PRESETS: readonly VideoPreset[] = [
  "Best",
  "2160",
  "1440",
  "1080",
  "720",
  "480",
  "Compatible",
];
const AUDIO_PRESETS: readonly AudioPreset[] = ["MP3", "M4A", "Opus", "FLAC"];

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
  const postRaw = patch.postDownloadAction ?? base.postDownloadAction;
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
    mergeContainer: cleanString(patch.mergeContainer, base.mergeContainer),
    sponsorBlock: cleanBool(patch.sponsorBlock, base.sponsorBlock),
    codecPreference: CODECS.includes(codecRaw) ? codecRaw : base.codecPreference,
    skipArchived: cleanBool(patch.skipArchived, base.skipArchived),
    theme: THEMES.includes(themeRaw) ? themeRaw : base.theme,
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
  };
}

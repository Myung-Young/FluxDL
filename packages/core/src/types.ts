/**
 * Core domain types. No Electron/Node imports allowed in this file.
 * Everything UI + state talks to the `DownloadEngine` interface only.
 */
import type { ErrorCategory } from "./errors.js";

export type JobStatus =
  "queued" | "analyzing" | "downloading" | "processing" | "paused" | "done" | "error" | "cancelled";

export interface FormatOption {
  readonly formatId: string;
  readonly label: string;
  readonly ext: string;
  /** e.g. "video" | "audio" | "video+audio" | "storyboard" */
  readonly kind: string;
  readonly resolution: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: number | null;
  readonly vcodec: string | null;
  readonly acodec: string | null;
  readonly tbr: number | null;
  readonly filesize: number | null;
  readonly protocol: string | null;
}

export interface PlaylistEntry {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly duration: number | null;
  readonly thumbnail: string | null;
  readonly selected: boolean;
}

export interface MediaInfo {
  readonly url: string;
  readonly title: string;
  readonly uploader: string | null;
  readonly duration: number | null;
  readonly thumbnail: string | null;
  readonly isPlaylist: boolean;
  /** Extractor key (e.g. "youtube") when the dump provides one. */
  readonly extractor: string | null;
  /** Top-level video id when the dump provides one (absent for playlists). */
  readonly videoId: string | null;
  readonly entries: readonly PlaylistEntry[];
  readonly formats: readonly FormatOption[];
}

export type MediaKind = "video" | "audio";

export type AudioPreset = "MP3" | "M4A" | "Opus" | "FLAC";
export type VideoPreset = "Best" | "2160" | "1440" | "1080" | "720" | "480" | "Compatible";

/** Preferred video codec for downloads (applied via yt-dlp `-S` format sort). */
export type CodecPreference = "auto" | "h264" | "vp9" | "av1";

export interface DownloadPreset {
  readonly kind: MediaKind;
  readonly videoPreset: VideoPreset;
  readonly audioPreset: AudioPreset;
  /** Raw yt-dlp `-f` value when user picks Advanced. Takes precedence if set. */
  readonly rawFormat: string | null;
}

export interface DownloadJob {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly preset: DownloadPreset;
  readonly outputDir: string;
  readonly status: JobStatus;
  readonly progress: number;
  readonly speed: string | null;
  readonly eta: string | null;
  readonly downloadedBytes: number | null;
  readonly totalBytes: number | null;
  readonly stage: string | null;
  readonly error: string | null;
  readonly createdAt: number;
  /** Consecutive engine failures; reset on success. Drives backoff. */
  readonly attempts: number;
  /** Earliest retry time (ms epoch) or null when no retry is scheduled. */
  readonly nextRetryAt: number | null;
  /** Last known output file reported by the engine, if any. */
  readonly destination: string | null;
  /**
   * Pass --download-archive for this job (playlist targets when the
   * skipArchived setting is on). Optional: older records omit it (= false).
   */
  readonly useArchive?: boolean;
  /** Extractor key + video id when known at enqueue (duplicate guard). */
  readonly extractor?: string | null;
  readonly videoId?: string | null;
  /** Per-job cookie browser override (this download only). */
  readonly cookiesFromBrowser?: string | null;
  /** Stored failure category for actionable error cards (optional). */
  readonly errorCategory?: ErrorCategory | null;
  /** Set when the output file was trashed (history keeps the record). */
  readonly fileDeleted?: boolean;
}

export interface DownloadJobInput extends Pick<
  DownloadJob,
  "url" | "title" | "preset" | "outputDir" | "extractor" | "videoId" | "cookiesFromBrowser"
> {
  readonly useArchive?: boolean;
}

export type ThemeName = "obsidian" | "midnight" | "ember";

export interface AppSettings {
  readonly downloadDir: string;
  readonly filenameTemplate: string;
  readonly concurrency: number;
  readonly speedLimit: string | null;
  readonly proxy: string | null;
  readonly cookiesFromBrowser: string | null;
  /** Netscape cookies.txt file (validated main-side; never copied/logged). */
  readonly cookiesFile: string | null;
  readonly embedThumbnail: boolean;
  readonly embedMetadata: boolean;
  readonly subtitles: boolean;
  readonly subtitleLangs: string;
  readonly embedSubs: boolean;
  readonly mergeContainer: string;
  readonly sponsorBlock: boolean;
  readonly codecPreference: CodecPreference;
  /** Playlist jobs pass --download-archive (default ON). */
  readonly skipArchived: boolean;
  readonly theme: ThemeName;
  readonly postDownloadAction: "none" | "open-file" | "reveal";
  readonly autoCheckUpdate: boolean;
  /** First-run wizard completed (M2.2). */
  readonly onboardingDone: boolean;
  /** Default preset for new analyses (chosen in onboarding). */
  readonly defaultPreset: DownloadPreset;
  /** Analyze timeout in seconds (M2.3). */
  readonly analyzeTimeoutSec: number;
  /** Tint the preview card with the thumbnail colour (M2.4, default ON). */
  readonly thumbnailAccent: boolean;
}

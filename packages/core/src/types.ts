/**
 * Core domain types. No Electron/Node imports allowed in this file.
 * Everything UI + state talks to the `DownloadEngine` interface only.
 */

export type JobStatus =
  "queued" | "analyzing" | "downloading" | "processing" | "paused" | "done" | "error" | "cancelled";

export interface FormatOption {
  readonly formatId: string;
  readonly label: string;
  readonly ext: string;
  /** e.g. "video" | "audio" | "video+audio" | "storyboard" */
  readonly kind: string;
  readonly resolution: string | null;
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
  readonly entries: readonly PlaylistEntry[];
  readonly formats: readonly FormatOption[];
}

export type MediaKind = "video" | "audio";

export type AudioPreset = "MP3" | "M4A" | "Opus" | "FLAC";
export type VideoPreset = "Best" | "2160" | "1440" | "1080" | "720" | "480";

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
}

export type DownloadJobInput = Pick<DownloadJob, "url" | "title" | "preset" | "outputDir">;

export type ThemeName = "obsidian" | "midnight" | "ember";

export interface AppSettings {
  readonly downloadDir: string;
  readonly filenameTemplate: string;
  readonly concurrency: number;
  readonly speedLimit: string | null;
  readonly proxy: string | null;
  readonly cookiesFromBrowser: string | null;
  readonly embedThumbnail: boolean;
  readonly embedMetadata: boolean;
  readonly subtitles: boolean;
  readonly subtitleLangs: string;
  readonly mergeContainer: string;
  readonly sponsorBlock: boolean;
  readonly theme: ThemeName;
  readonly postDownloadAction: "none" | "open-file" | "reveal";
  readonly autoCheckUpdate: boolean;
}

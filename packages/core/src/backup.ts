import { DEFAULT_SETTINGS, mergeSettings } from "./settings.js";
import type { AppSettings, DownloadJob, WatchChannel } from "./types.js";
import { AUDIO_PRESETS, VIDEO_PRESETS } from "./types.js";
import { normalizeWatchlist } from "./watchlist.js";

/**
 * Settings + queue + history + watchlist backup (D9): one JSON file,
 * portable across PCs. Export is total except secrets; import sanitizes
 * everything (settings through the normal merge, jobs through a shape
 * check) and reports what was dropped.
 */

/** Settings keys stripped on export (secrets stay on the machine). */
export const BACKUP_REDACTED_KEYS: readonly string[] = [
  "proxy",
  "cookiesFile",
  "cookiesFromBrowser",
];

export interface BackupPayload {
  readonly app: "FluxDL";
  readonly version: 1;
  readonly settings: AppSettings;
  readonly queue: readonly DownloadJob[];
  readonly history: readonly DownloadJob[];
  readonly watchlist: readonly WatchChannel[];
  readonly redacted: readonly string[];
}

export function exportBackup(
  settings: AppSettings,
  queue: readonly DownloadJob[],
  history: readonly DownloadJob[],
  watchlist: readonly WatchChannel[] = [],
): string {
  const scrubbed: AppSettings = {
    ...settings,
    proxy: null,
    cookiesFile: null,
    cookiesFromBrowser: null,
  };
  return JSON.stringify({
    app: "FluxDL",
    version: 1,
    settings: scrubbed,
    queue,
    history,
    watchlist,
    redacted: [...BACKUP_REDACTED_KEYS],
  });
}

function isPresetLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r["kind"] !== "video" && r["kind"] !== "audio") return false;
  if (
    typeof r["videoPreset"] !== "string" ||
    !(VIDEO_PRESETS as readonly string[]).includes(r["videoPreset"])
  ) {
    return false;
  }
  if (
    typeof r["audioPreset"] !== "string" ||
    !(AUDIO_PRESETS as readonly string[]).includes(r["audioPreset"])
  ) {
    return false;
  }
  return true;
}

const STATUSES: readonly string[] = [
  "queued",
  "analyzing",
  "downloading",
  "processing",
  "paused",
  "done",
  "error",
  "postfailed",
  "cancelled",
];

function isJob(value: unknown): value is DownloadJob {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (typeof r["id"] !== "string" || typeof r["url"] !== "string") return false;
  if (typeof r["title"] !== "string" || typeof r["outputDir"] !== "string") return false;
  if (typeof r["createdAt"] !== "number" || typeof r["attempts"] !== "number") return false;
  if (typeof r["status"] !== "string" || !STATUSES.includes(r["status"])) return false;
  return isPresetLike(r["preset"]);
}

/** In-flight jobs come back as queued (nothing runs mid-import). */
function restoreJob(job: DownloadJob): DownloadJob {
  const active =
    job.status === "downloading" || job.status === "processing" || job.status === "analyzing";
  return {
    ...job,
    status: active ? ("queued" as const) : job.status,
    speed: null,
    eta: null,
    stage: null,
    progress: job.status === "done" ? 100 : 0,
  };
}

export interface ParsedBackup {
  readonly settings: AppSettings;
  readonly queue: DownloadJob[];
  readonly history: DownloadJob[];
  readonly watchlist: WatchChannel[];
  readonly dropped: number;
}

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Not a FluxDL backup file.");
  }
  if (typeof raw !== "object" || raw === null) throw new Error("Not a FluxDL backup file.");
  const rec = raw as Record<string, unknown>;
  if (rec["app"] !== "FluxDL") throw new Error("Not a FluxDL backup file.");
  const cleanJobs = (value: unknown): { kept: DownloadJob[]; dropped: number } => {
    if (!Array.isArray(value)) return { kept: [], dropped: 0 };
    const kept: DownloadJob[] = [];
    let dropped = 0;
    for (const item of value.slice(0, 5000)) {
      if (isJob(item)) kept.push(restoreJob(item));
      else dropped += 1;
    }
    return { kept, dropped };
  };
  const q = cleanJobs(rec["queue"]);
  const h = cleanJobs(rec["history"]);
  return {
    settings: mergeSettings(DEFAULT_SETTINGS, rec["settings"] ?? {}),
    queue: q.kept,
    history: h.kept,
    watchlist: normalizeWatchlist(rec["watchlist"] ?? []),
    dropped: q.dropped + h.dropped,
  };
}

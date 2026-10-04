import type { DownloadJob } from "./types.js";

/**
 * Download statistics (M4.5) — pure, derived entirely from history.
 *
 * Nothing is stored separately: clearing history clears the stats, which is
 * stated in the UI. Every number here tolerates missing data, because records
 * written before v1.4 have no `finishedAt`, `uploader` or `durationSec` and
 * those count as "unknown" rather than zero.
 */

export interface WeekBucket {
  /** Local Monday 00:00 of that week (ms epoch). */
  readonly start: number;
  readonly label: string;
  readonly count: number;
}

export interface TopUploader {
  readonly name: string;
  readonly count: number;
}

export interface PresetMixEntry {
  readonly label: string;
  readonly count: number;
}

export interface PresetSuccess {
  readonly label: string;
  readonly done: number;
  readonly total: number;
  /** done/total, or null when the preset has no finished-or-failed runs. */
  readonly rate: number | null;
}

export interface DownloadStats {
  /** Records with status "done". */
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  /** Sum of known byte counts; null when no record reported a size. */
  readonly totalBytes: number | null;
  /** Sum of known durations (seconds); null when none is known. */
  readonly totalDurationSec: number | null;
  /** Completed downloads with no size information (pre-v1.4 records). */
  readonly unknownSizeCount: number;
  /** Completed downloads with no duration information. */
  readonly unknownDurationCount: number;
  readonly weeks: readonly WeekBucket[];
  readonly topUploaders: readonly TopUploader[];
  readonly presets: readonly PresetMixEntry[];
  /** Top extractors ("youtube", …; "?" when the record predates identity). */
  readonly sites: readonly TopUploader[];
  /** Per-preset success rates over done + error runs (local insight, F7). */
  readonly presetSuccess: readonly PresetSuccess[];
  /** True when history holds nothing at all. */
  readonly empty: boolean;
}

const MS_PER_DAY = 86_400_000;
const WEEK_COUNT = 12;
const TOP_UPLOADERS = 5;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Local midnight of the day containing `ts`. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local Monday 00:00 of the week containing `ts` (locale-independent). */
export function startOfWeek(ts: number): number {
  const day = startOfDay(ts);
  const dow = new Date(day).getDay(); // 0 = Sunday
  const offset = (dow + 6) % 7; // Monday-based
  return day - offset * MS_PER_DAY;
}

/** Short label like "5 Oct" for a week start. */
export function weekLabel(start: number): string {
  const d = new Date(start);
  return `${String(d.getDate())} ${MONTH_LABELS[d.getMonth()] ?? ""}`;
}

/**
 * Completion time when known, else enqueue time. Records without either are
 * still counted in the totals but land in the oldest bucket only.
 */
function timeOf(record: DownloadJob): number {
  if (typeof record.finishedAt === "number" && Number.isFinite(record.finishedAt)) {
    return record.finishedAt;
  }
  return record.createdAt;
}

function sizeOf(record: DownloadJob): number | null {
  if (typeof record.totalBytes === "number" && record.totalBytes > 0) return record.totalBytes;
  if (typeof record.downloadedBytes === "number" && record.downloadedBytes > 0) {
    return record.downloadedBytes;
  }
  return null;
}

function durationOf(record: DownloadJob): number | null {
  return typeof record.durationSec === "number" &&
    Number.isFinite(record.durationSec) &&
    record.durationSec > 0
    ? record.durationSec
    : null;
}

function presetLabel(record: DownloadJob): string {
  const p = record.preset;
  return p.kind === "audio" ? `Audio · ${p.audioPreset}` : `Video · ${p.videoPreset}`;
}

/**
 * Everything the Stats screen renders. Pure so it can be tested against mixed
 * old/new records without touching the filesystem.
 */
export function computeStats(history: readonly DownloadJob[], now: number): DownloadStats {
  const completed: DownloadJob[] = [];
  let failed = 0;
  let cancelled = 0;
  let totalBytes = 0;
  let bytesKnown = false;
  let totalDuration = 0;
  let durationKnown = false;
  let unknownSize = 0;
  let unknownDuration = 0;
  const uploaders = new Map<string, number>();
  const presets = new Map<string, number>();
  const sites = new Map<string, number>();
  const presetDone = new Map<string, number>();
  const presetRuns = new Map<string, number>();
  const weekCounts = new Map<number, number>();

  const thisWeek = startOfWeek(now);
  const oldestWeek = thisWeek - (WEEK_COUNT - 1) * 7 * MS_PER_DAY;

  for (const record of history) {
    if (record.status === "done") {
      completed.push(record);
      const size = sizeOf(record);
      if (size === null) unknownSize += 1;
      else {
        totalBytes += size;
        bytesKnown = true;
      }
      const duration = durationOf(record);
      if (duration === null) unknownDuration += 1;
      else {
        totalDuration += duration;
        durationKnown = true;
      }
      const name = record.uploader;
      if (typeof name === "string" && name.trim().length > 0) {
        const key = name.trim();
        uploaders.set(key, (uploaders.get(key) ?? 0) + 1);
      }
    } else if (record.status === "error") {
      failed += 1;
    } else if (record.status === "cancelled") {
      cancelled += 1;
    }
    const label = presetLabel(record);
    presets.set(label, (presets.get(label) ?? 0) + 1);
    if (record.status === "done" || record.status === "error") {
      presetRuns.set(label, (presetRuns.get(label) ?? 0) + 1);
      if (record.status === "done") presetDone.set(label, (presetDone.get(label) ?? 0) + 1);
    }
    const site =
      typeof record.extractor === "string" && record.extractor.trim().length > 0
        ? record.extractor.trim().toLowerCase()
        : "?";
    sites.set(site, (sites.get(site) ?? 0) + 1);

    const week = startOfWeek(timeOf(record));
    if (week >= oldestWeek && week <= thisWeek) {
      weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);
    }
  }

  const weeks: WeekBucket[] = [];
  for (let i = WEEK_COUNT - 1; i >= 0; i -= 1) {
    const start = thisWeek - i * 7 * MS_PER_DAY;
    weeks.push({ start, label: weekLabel(start), count: weekCounts.get(start) ?? 0 });
  }

  const topUploaders = [...uploaders.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_UPLOADERS);

  const presetMix = [...presets.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const topSites = [...sites.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_UPLOADERS);

  const presetSuccess: PresetSuccess[] = [...presetRuns.entries()]
    .map(([label, total]) => {
      const done = presetDone.get(label) ?? 0;
      return { label, done, total, rate: total > 0 ? done / total : null };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || a.label.localeCompare(b.label));

  return {
    completed: completed.length,
    failed,
    cancelled,
    totalBytes: bytesKnown ? totalBytes : null,
    totalDurationSec: durationKnown ? totalDuration : null,
    unknownSizeCount: unknownSize,
    unknownDurationCount: unknownDuration,
    weeks,
    topUploaders,
    presets: presetMix,
    sites: topSites,
    presetSuccess,
    empty: history.length === 0,
  };
}

/** Human duration for the stats totals: "3 h 12 min", "45 min", "20 s". */
export function formatTotalDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${String(h)} h ${String(m)} min`;
  if (m > 0) return `${String(m)} min`;
  return `${String(s)} s`;
}
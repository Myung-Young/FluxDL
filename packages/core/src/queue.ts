import type {
  Container,
  DownloadJob,
  DownloadJobInput,
  EngineId,
  JobPriority,
  JobStatus,
  MediaKind,
} from "./types.js";
import { ENGINE_IDS } from "./types.js";
import type { ErrorCategory } from "./errors.js";
import { isAudioMetadata, normalizeAudioMetadata } from "./metadata.js";
import { cleanGalleryRange } from "./galleryProbe.js";
import { fuzzyRank } from "./fuzzy.js";

/**
 * Queue state machine (pure, no I/O). The orchestrator (`queueController.ts`)
 * and zustand stores drive engines through these transitions only.
 *
 * Statuses: queued|analyzing|downloading|processing|paused|done|error|cancelled
 */

export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 5;
export const DEFAULT_MAX_RETRIES = 3;
export const MAX_HISTORY_ITEMS = 500;

export type QueueEvent =
  | "analyze"
  | "probe"
  | "start"
  | "resume"
  | "pause"
  | "progress"
  | "process"
  | "done"
  | "partial"
  | "postfail"
  | "fail"
  | "cancel"
  | "retry";

const TRANSITIONS: Readonly<Record<QueueEvent, ReadonlySet<JobStatus>>> = {
  analyze: new Set<JobStatus>(["queued", "error", "interrupted"]),
  probe: new Set<JobStatus>(["queued", "error", "interrupted"]),
  start: new Set<JobStatus>(["queued", "analyzing", "probing", "paused", "interrupted"]),
  resume: new Set<JobStatus>(["paused", "interrupted"]),
  pause: new Set<JobStatus>(["queued", "analyzing", "probing", "downloading", "processing"]),
  progress: new Set<JobStatus>(["downloading", "processing", "paused", "probing"]),
  process: new Set<JobStatus>(["downloading"]),
  done: new Set<JobStatus>(["downloading", "processing", "analyzing", "probing", "paused"]),
  partial: new Set<JobStatus>(["downloading", "processing", "probing", "paused"]),
  // Post-process failure (Phase 4): the download itself is intact on disk,
  // only the pipeline failed. Terminal, history-bound, reprocessable —
  // attempts untouched (never auto-retried).
  postfail: new Set<JobStatus>(["done", "processing"]),
  fail: new Set<JobStatus>([
    "queued",
    "analyzing",
    "probing",
    "downloading",
    "processing",
    "paused",
    "interrupted",
  ]),
  cancel: new Set<JobStatus>([
    "queued",
    "analyzing",
    "probing",
    "downloading",
    "processing",
    "paused",
    "error",
    "interrupted",
  ]),
  retry: new Set<JobStatus>(["error", "cancelled", "partial", "postfailed", "interrupted"]),
};

export function canTransition(from: JobStatus, event: QueueEvent): boolean {
  return TRANSITIONS[event].has(from);
}

export interface TransitionOptions {
  readonly error?: string | null;
  readonly now?: number;
}

export function nextStatus(from: JobStatus, event: QueueEvent): JobStatus {
  switch (event) {
    case "analyze":
      return "analyzing";
    case "probe":
      return "probing";
    case "start":
    case "resume":
      return "downloading";
    case "pause":
      return "paused";
    case "progress":
      if (from === "processing") return "processing";
      if (from === "probing") return "probing";
      return "downloading";
    case "process":
      return "processing";
    case "done":
      return "done";
    case "partial":
      return "partial";
    case "postfail":
      return "postfailed";
    case "fail":
      return "error";
    case "cancel":
      return "cancelled";
    case "retry":
      return "queued";
  }
}

/**
 * Apply a status event. Throws on illegal transitions so bugs surface
 * loudly instead of silently corrupting the queue.
 */
export function transition(
  job: DownloadJob,
  event: QueueEvent,
  opts: TransitionOptions = {},
): DownloadJob {
  if (!canTransition(job.status, event)) {
    throw new Error(`Illegal queue transition: ${job.status} + ${event}`);
  }
  const now = opts.now ?? Date.now();
  const status = nextStatus(job.status, event);
  switch (event) {
    case "fail": {
      const attempts = job.attempts + 1;
      return {
        ...job,
        status,
        error: opts.error ?? "Download failed.",
        attempts,
        nextRetryAt: now + computeBackoffMs(attempts),
      };
    }
    case "retry":
      return { ...job, status, error: null, nextRetryAt: null };
    case "done":
      return { ...job, status, progress: 100, error: null, nextRetryAt: null };
    case "partial":
      return { ...job, status, error: job.error, nextRetryAt: null };
    case "postfail":
      return { ...job, status, error: opts.error ?? job.error, nextRetryAt: null };
    case "cancel":
      return { ...job, status, error: null, nextRetryAt: null };
    default:
      return { ...job, status };
  }
}

export interface EngineProgressLike {
  readonly percent: number | null;
  readonly speed: string | null;
  readonly eta: string | null;
  readonly downloadedBytes: number | null;
  readonly totalBytes: number | null;
  readonly stage: string;
  readonly destination: string | null;
  readonly errorMessage?: string;
  readonly errorCategory?: ErrorCategory;
  readonly elapsed?: string | null;
  /** Gallery (multi-file) counters, when the engine tracks them. */
  readonly downloadedCount?: number | null;
  readonly skippedCount?: number | null;
  readonly failedCount?: number | null;
}

/**
 * Fold an engine progress event into queue state (pure).
 *
 * Byte counts are MONOTONIC here: yt-dlp reports `total: NA` / no byte fields
 * on post-processing lines ([Merger], [ExtractAudio], [Fixup], …) and on the
 * final `done` event. Writing those nulls straight through wiped the size the
 * download phase had already reported, so every audio job (which always runs
 * `[ExtractAudio]`) and every merged video reached the history — and the Stats
 * "total size" tile — with no size at all, i.e. "Unknown". A null from the
 * engine therefore means "no new information", never "forget what you knew".
 */
export function applyEngineProgress(job: DownloadJob, p: EngineProgressLike): DownloadJob {
  const bytes = {
    downloadedBytes: p.downloadedBytes ?? job.downloadedBytes,
    totalBytes: p.totalBytes ?? job.totalBytes,
  };
  // Gallery (multi-file) counters ride alongside bytes: the engine reports
  // per-file downloaded/skipped/failed, which the cards render as "N files"
  // instead of a byte size (a gallery count is not a byte count). Keys are
  // added only once either side knows them, so yt-dlp snapshots stay
  // byte-identical (no null-key churn on every progress fold).
  const counters: {
    -readonly [K in "downloadedCount" | "skippedCount" | "failedCount"]?: number | null;
  } = {};
  if (p.downloadedCount !== undefined || job.downloadedCount !== undefined) {
    counters.downloadedCount = p.downloadedCount ?? job.downloadedCount ?? null;
  }
  if (p.skippedCount !== undefined || job.skippedCount !== undefined) {
    counters.skippedCount = p.skippedCount ?? job.skippedCount ?? null;
  }
  if (p.failedCount !== undefined || job.failedCount !== undefined) {
    counters.failedCount = p.failedCount ?? job.failedCount ?? null;
  }
  switch (p.stage) {
    case "processing":
      if (!canTransition(job.status, "process") && job.status !== "processing") return job;
      return {
        ...job,
        status: "processing",
        progress: p.percent,
        speed: p.speed,
        eta: p.eta,
        ...bytes,
        ...counters,
        stage: p.stage,
        destination: p.destination ?? job.destination,
      };
    case "done":
      if (!canTransition(job.status, "done")) return job;
      return {
        ...job,
        status: "done",
        progress: 100,
        speed: null,
        eta: null,
        ...bytes,
        ...counters,
        stage: p.stage,
        error: null,
        nextRetryAt: null,
        destination: p.destination ?? job.destination,
      };
    case "partial":
      if (!canTransition(job.status, "partial")) return job;
      return {
        ...job,
        status: "partial",
        speed: null,
        eta: null,
        ...bytes,
        ...counters,
        stage: p.stage,
        destination: p.destination ?? job.destination,
        nextRetryAt: null,
      };
    case "postfailed":
      // Phase 4: the engine finished the download, then a pipeline step
      // failed. The output file is intact — only post-processing needs a
      // re-run (Reprocess), never the download.
      if (!canTransition(job.status, "postfail")) return job;
      return transition(job, "postfail", {
        error: p.errorMessage ?? job.error ?? "Post-processing failed.",
      });
    case "error":
      // v1.7.2: never throw out of a progress fold (this runs inside a
      // `void`-ed promise in the controller), and prefer the ENGINE's mapped
      // message over the previous job error — the old `job.error ?? …` threw
      // away `mapDownloadError`'s explanation for the generic string.
      if (!canTransition(job.status, "fail")) return job;
      return transition(job, "fail", {
        error: p.errorMessage ?? job.error ?? "Download failed.",
      });
    case "paused":
      if (!canTransition(job.status, "pause")) return job;
      return {
        ...job,
        status: "paused",
        speed: null,
        eta: null,
        stage: p.stage,
        destination: p.destination ?? job.destination,
      };
    case "stalled":
      // Watchdog heartbeat (Phase 2): the job is still downloading, but no
      // output arrived within the stall window. Never throws, never moves.
      if (job.status !== "downloading" && job.status !== "processing") return job;
      return { ...job, stage: "stalled" };
    case "cancelled":
      if (!canTransition(job.status, "cancel")) return job;
      return {
        ...job,
        status: "cancelled",
        speed: null,
        eta: null,
        stage: p.stage,
        destination: p.destination ?? job.destination,
      };
    default:
      if (!canTransition(job.status, "progress") && job.status !== "downloading") return job;
      return {
        ...job,
        status: job.status === "processing" || job.status === "probing" ? job.status : "downloading",
        progress: p.percent,
        speed: p.speed,
        eta: p.eta,
        ...bytes,
        ...counters,
        stage: p.stage,
        destination: p.destination ?? job.destination,
      };
  }
}

/** Exponential backoff: 2s, 4s, 8s… capped at 30s. Attempt is 1-based. */
export function computeBackoffMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return 2000;
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
}

export function clampConcurrency(n: number): number {
  if (!Number.isFinite(n)) return MIN_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.floor(n)));
}

export function activeCount(jobs: readonly DownloadJob[]): number {
  let n = 0;
  for (const j of jobs) {
    if (
      j.status === "analyzing" ||
      j.status === "probing" ||
      j.status === "downloading" ||
      j.status === "processing"
    ) {
      n += 1;
    }
  }
  return n;
}

/**
 * Jobs the ENGINE still owns a child process for — anything not finished,
 * PAUSED INCLUDED. `activeCount` is the wrong number for "is it safe to run
 * `yt-dlp -U`": a paused download keeps its engine entry (and, for a resumed
 * one, its file lock), so the engine refuses the update while the renderer's
 * active-only check happily lets it through (v1.7.2).
 */
export function unfinishedCount(jobs: readonly DownloadJob[]): number {
  let n = 0;
  for (const j of jobs) {
    if (
      j.status !== "done" &&
      j.status !== "partial" &&
      j.status !== "error" &&
      j.status !== "postfailed" &&
      j.status !== "cancelled"
    ) {
      n += 1;
    }
  }
  return n;
}

/**
 * Priority tier with back-compat default (rows before Phase 3 omit it):
 * 2 high, 1 normal, 0 low. Garbage reads as normal, never as high.
 */
export function priorityOf(job: { readonly priority?: JobPriority | undefined }): JobPriority {
  return job.priority === 0 || job.priority === 2 ? job.priority : 1;
}

/** Validated download-window bounds (HH:MM); either side null = no window. */
export interface DownloadWindow {
  readonly start: string | null;
  readonly end: string | null;
}

function windowMinutes(t: string | null): number | null {
  if (t === null) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t.trim());
  if (m === null) return null;
  return Number.parseInt(m[1] as string, 10) * 60 + Number.parseInt(m[2] as string, 10);
}

/**
 * True when epoch-ms `now` (local time) falls inside the window. A missing
 * or half-set window is always open; overnight ranges (22:00→06:00) wrap
 * past midnight. Garbage reads as open, never as closed.
 */
export function isInDownloadWindow(now: number, window: DownloadWindow | null): boolean {
  if (window === null) return true;
  const start = windowMinutes(window.start);
  const end = windowMinutes(window.end);
  if (start === null || end === null || start === end) return true;
  const d = new Date(now);
  const t = d.getHours() * 60 + d.getMinutes();
  if (start < end) return t >= start && t < end;
  return t >= start || t < end;
}

function isDue(job: DownloadJob, now: number): boolean {
  return job.nextRetryAt === null || job.nextRetryAt <= now;
}

/** Active (engine-owned) gallery-dl jobs — the polite per-engine cap. */
export function activeGalleryCount(jobs: readonly DownloadJob[]): number {
  let n = 0;
  for (const j of jobs) {
    if (engineOf(j) !== "gallery-dl") continue;
    if (
      j.status === "analyzing" ||
      j.status === "probing" ||
      j.status === "downloading" ||
      j.status === "processing"
    ) {
      n += 1;
    }
  }
  return n;
}

/**
 * Priority order, then FIFO: highest tier first, earliest-created wins
 * inside a tier. Gallery candidates additionally honor their own cap
 * (default 2) so image jobs never crowd out the global slots. A closed
 * download window starts nothing (running jobs finish).
 */
export function selectNextToStart(
  jobs: readonly DownloadJob[],
  concurrency: number,
  now: number,
  galleryCap = 2,
  window: DownloadWindow | null = null,
): DownloadJob | null {
  if (!isInDownloadWindow(now, window)) return null;
  if (activeCount(jobs) >= clampConcurrency(concurrency)) return null;
  const galleryFull = activeGalleryCount(jobs) >= clampConcurrency(galleryCap);
  const due: DownloadJob[] = [];
  for (const j of jobs) {
    if (j.status !== "queued" || !isDue(j, now)) continue;
    if (j.startAfter !== undefined && j.startAfter !== null && j.startAfter > now) continue;
    if (galleryFull && engineOf(j) === "gallery-dl") continue;
    due.push(j);
  }
  due.sort(
    (a, b) =>
      priorityOf(b) - priorityOf(a) ||
      a.createdAt - b.createdAt ||
      (a.id < b.id ? -1 : 1),
  );
  return due[0] ?? null;
}

export function shouldRetry(job: DownloadJob, maxRetries: number, now: number): boolean {
  if (job.status !== "error") return false;
  if (job.attempts > maxRetries) return false;
  return isDue(job, now);
}

/**
 * Seconds until the scheduled auto-retry (M3.2). Null when the job is not
 * an error with a future backoff deadline — the card then shows the plain
 * attempt count instead of a ticking countdown.
 */
export function retryInSeconds(job: DownloadJob, now: number): number | null {
  if (job.status !== "error" || job.nextRetryAt === null) return null;
  const ms = job.nextRetryAt - now;
  return ms > 0 ? Math.ceil(ms / 1000) : null;
}

/**
 * Optional per-job fields carried between the UI, the queue and the engine.
 *
 * This allow-list is the single source of truth for BOTH directions:
 * `makeJob()` copies these in (input -> job) and `toStartInput()` copies the
 * same set back out (job -> input), so the two cannot drift. That is the whole
 * point: the M4.1/M4.2 flags were silently dropped at the job -> engine hop
 * because every hop kept its own hand-written copy list (R1 / D81).
 * Unknown keys are dropped on purpose (the renderer is untrusted).
 */
type StartOptions = Partial<
  Pick<
    DownloadJob,
    | "useArchive"
    | "extractor"
    | "videoId"
    | "cookiesFromBrowser"
    | "playlistSubdir"
    | "liveStatus"
    | "liveFromStart"
    | "waitForVideo"
    | "splitChapters"
    | "audioMetadata"
    | "uploader"
    | "durationSec"
    | "forceOverwrite"
    | "startAfter"
    | "pinned"
    | "engineId"
    | "trimStart"
    | "trimEnd"
    | "outdatedRetried"
    | "range"
  >
> & {
    /** Per-job container override (v1.7.2); lives on the preset. */
    readonly container?: Container | null;
  };
function pickJobOptions(source: DownloadJobInput): StartOptions {
  // v1.8.5: gallery-dl --range, validated once here so every hop agrees.
  const range = cleanGalleryRange(source.range ?? null);
  return {
    ...(source.useArchive === true ? { useArchive: true as const } : {}),
    ...(typeof source.extractor === "string" && source.extractor.length > 0
      ? { extractor: source.extractor }
      : {}),
    ...(typeof source.videoId === "string" && source.videoId.length > 0
      ? { videoId: source.videoId }
      : {}),
    ...(typeof source.cookiesFromBrowser === "string" && source.cookiesFromBrowser.length > 0
      ? { cookiesFromBrowser: source.cookiesFromBrowser }
      : {}),
    ...(typeof source.playlistSubdir === "string" && source.playlistSubdir.length > 0
      ? { playlistSubdir: source.playlistSubdir }
      : {}),
    ...(source.liveStatus !== undefined && source.liveStatus !== null
      ? { liveStatus: source.liveStatus }
      : {}),
    ...(source.liveFromStart === true ? { liveFromStart: true as const } : {}),
    ...(source.waitForVideo === true ? { waitForVideo: true as const } : {}),
    ...(source.splitChapters === true ? { splitChapters: true as const } : {}),
    ...(source.forceOverwrite === true ? { forceOverwrite: true as const } : {}),
    ...(isAudioMetadata(source.audioMetadata)
      ? { audioMetadata: normalizeAudioMetadata(source.audioMetadata) }
      : {}),
    ...(typeof source.uploader === "string" && source.uploader.trim().length > 0
      ? { uploader: source.uploader }
      : {}),
    ...(typeof source.durationSec === "number" && Number.isFinite(source.durationSec)
      ? { durationSec: source.durationSec }
      : {}),
    ...(typeof source.startAfter === "number" && Number.isFinite(source.startAfter)
      ? { startAfter: source.startAfter }
      : {}),
    ...(source.pinned === true ? { pinned: true as const } : {}),
    ...(typeof source.engineId === "string" &&
    (ENGINE_IDS as readonly string[]).includes(source.engineId)
      ? { engineId: source.engineId }
      : {}),
    ...(typeof source.trimStart === "string" && source.trimStart.trim().length > 0
      ? { trimStart: source.trimStart.trim().slice(0, 32) }
      : {}),
    ...(typeof source.trimEnd === "string" && source.trimEnd.trim().length > 0
      ? { trimEnd: source.trimEnd.trim().slice(0, 32) }
      : {}),
    ...(source.outdatedRetried === true ? { outdatedRetried: true as const } : {}),
    // v1.8.5: --range survives the hop or selected-items downloads silently
    // become whole-gallery ones (R1 lesson again).
    ...(range !== null ? { range } : {}),
    ...(source.priority === 0 || source.priority === 1 || source.priority === 2
      ? { priority: source.priority }
      : {}),
    ...(typeof source.proxyOverride === "string" && source.proxyOverride.trim().length > 0
      ? { proxyOverride: source.proxyOverride.trim().slice(0, 512) }
      : {}),
    // v1.7.2: a per-job container override rides on the preset, so it must
    // survive this hop or the job silently falls back to the global setting.
    ...(source.container !== undefined && source.container !== null
      ? { container: source.container }
      : {}),
  };
}

/**
 * Project a download into the engine start input.
 *
 * Accepts a queued job or an already-shaped input (a `DownloadJob` is
 * structurally assignable to `DownloadJobInput`, so the queue and the engine
 * share this one projection). Every optional flag (live, chapters, cookies,
 * archive, playlist subdir) survives, so `--live-from-start`,
 * `--wait-for-video`, `--hls-use-mpegts` and `--split-chapters` actually reach
 * yt-dlp (R1).
 */
export function toStartInput(source: DownloadJobInput): DownloadJobInput {
  return {
    url: source.url,
    title: source.title,
    preset: source.preset,
    outputDir: source.outputDir,
    ...pickJobOptions(source),
  };
}

/** Factory for new queue entries (status queued, zero attempts). */
export function makeJob(id: string, input: DownloadJobInput, createdAt: number): DownloadJob {
  const carried = pickJobOptions(input);
  return {
    id,
    url: input.url,
    title: input.title,
    preset: input.preset,
    outputDir: input.outputDir,
    status: "queued",
    progress: 0,
    speed: null,
    eta: null,
    downloadedBytes: null,
    totalBytes: null,
    stage: null,
    error: null,
    createdAt,
    attempts: 0,
    nextRetryAt: null,
    destination: null,
    // Old callers omit engineId — default to yt-dlp so history stays honest.
    engineId: "yt-dlp",
    // Priority rides the same hop (R1 lesson); absent reads as normal (1).
    priority: priorityOf(input),
    ...carried,
  };
}

export function isFinished(job: DownloadJob): boolean {
  return (
    job.status === "done" ||
    job.status === "partial" ||
    job.status === "error" ||
    job.status === "postfailed" ||
    job.status === "cancelled"
  );
}

/** Engine id with back-compat default (rows before v1.8 omit it). */
export function engineOf(job: Pick<DownloadJob, "engineId">): EngineId {
  if (job.engineId === "gallery-dl") return "gallery-dl";
  if (job.engineId === "streamlink") return "streamlink";
  if (job.engineId === "n-m3u8dl-re") return "n-m3u8dl-re";
  return "yt-dlp";
}

/**
 * True when two snapshots hold the same job objects in the same order.
 *
 * The controller only replaces the objects it actually changed, so identity
 * comparison is enough — and keeping the previous array identity lets React
 * bail out of re-rendering instead of re-rendering once per queue pump (M4.8).
 */
export function jobsEqual(
  a: readonly DownloadJob[],
  b: readonly DownloadJob[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function searchHistory(history: readonly DownloadJob[], query: string): DownloadJob[] {
  const q = query.trim();
  if (q.length === 0) return [...history];
  // Fuzzy + typo-tolerant (B1): plain substrings still match, so every old
  // test expectation holds; "big buk buni" now finds Big Buck Bunny too.
  return history
    .map((h) => ({ h, s: fuzzyRank(`${h.title} ${h.url}`, q) }))
    .filter((r): r is { h: DownloadJob; s: number } => r.s !== null)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.h);
}

/** Newest-first, capped. */
export function pruneHistory(history: readonly DownloadJob[], max: number): DownloadJob[] {
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_HISTORY_ITEMS;
  return [...history]
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
    .slice(0, cap);
}

/** Library filter state (Phase 3): all = no filtering on that axis. */
export interface HistoryFilter {
  readonly kind: "all" | MediaKind;
  readonly engine: "all" | EngineId;
  /** Substring matched against the extractor key (empty = all sites). */
  readonly site: string;
}

export const DEFAULT_HISTORY_FILTER: HistoryFilter = { kind: "all", engine: "all", site: "" };

/** Filter history rows (pure; search runs separately via searchHistory). */
export function filterHistory(
  history: readonly DownloadJob[],
  filter: HistoryFilter,
): DownloadJob[] {
  const site = filter.site.trim().toLowerCase();
  return history.filter(
    (h) =>
      (filter.kind === "all" || h.preset.kind === filter.kind) &&
      (filter.engine === "all" || engineOf(h) === filter.engine) &&
      (site.length === 0 || (h.extractor ?? "").toLowerCase().includes(site)),
  );
}

/** Library sort order (Phase 3). */
export type HistorySort = "newest" | "oldest" | "title" | "size";

export const HISTORY_SORTS: readonly HistorySort[] = ["newest", "oldest", "title", "size"];

function historySize(h: DownloadJob): number {
  const v = h.totalBytes ?? h.downloadedBytes;
  return typeof v === "number" && Number.isFinite(v) ? v : -1;
}

/** Sort history rows (pure; unknown sizes sink to the bottom). */
export function sortHistory(history: readonly DownloadJob[], sort: HistorySort): DownloadJob[] {
  const arr = [...history];
  switch (sort) {
    case "oldest":
      return arr.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    case "title":
      return arr.sort(
        (a, b) => a.title.localeCompare(b.title) || b.createdAt - a.createdAt,
      );
    case "size":
      return arr.sort(
        (a, b) => historySize(b) - historySize(a) || b.createdAt - a.createdAt,
      );
    case "newest":
    default:
      return arr.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
  }
}

/**
 * Move a queued job to a position within the queued subsequence.
 * Implemented as a createdAt permutation (no schema change): the FIFO
 * selector already orders by createdAt, so it honors the new order, the
 * snapshot persists it, and hydrate keeps it. Non-queued jobs and unknown
 * ids pass through untouched. Out-of-range targets clamp.
 */
export function reorder(
  jobs: readonly DownloadJob[],
  id: string,
  toIndex: number,
): DownloadJob[] {
  const queued = jobs.filter((j) => j.status === "queued");
  const from = queued.findIndex((j) => j.id === id);
  if (from === -1) return [...jobs];
  const clamped = Math.max(0, Math.min(toIndex, queued.length - 1));
  if (from === clamped) return [...jobs];
  const order = [...queued];
  const moved = order.splice(from, 1)[0];
  if (moved === undefined) return [...jobs];
  order.splice(clamped, 0, moved);
  // Permute createdAt (strictly increasing) to enforce the new order.
  const times = order.map((j) => j.createdAt).sort((a, b) => a - b);
  const assigned = new Map<string, number>();
  let prev = Number.NEGATIVE_INFINITY;
  order.forEach((j, i) => {
    const t = Math.max(times[i] ?? j.createdAt, prev + 1);
    assigned.set(j.id, t);
    prev = t;
  });
  return jobs.map((j) => {
    const t = assigned.get(j.id);
    return t === undefined ? j : { ...j, createdAt: t };
  });
}

import type { DownloadJob, DownloadJobInput, JobStatus } from "./types.js";
import type { ErrorCategory } from "./errors.js";

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
  | "start"
  | "resume"
  | "pause"
  | "progress"
  | "process"
  | "done"
  | "fail"
  | "cancel"
  | "retry";

const TRANSITIONS: Readonly<Record<QueueEvent, ReadonlySet<JobStatus>>> = {
  analyze: new Set<JobStatus>(["queued", "error"]),
  start: new Set<JobStatus>(["queued", "analyzing", "paused"]),
  resume: new Set<JobStatus>(["paused"]),
  pause: new Set<JobStatus>(["queued", "analyzing", "downloading", "processing"]),
  progress: new Set<JobStatus>(["downloading", "processing", "paused"]),
  process: new Set<JobStatus>(["downloading"]),
  done: new Set<JobStatus>(["downloading", "processing", "analyzing", "paused"]),
  fail: new Set<JobStatus>(["queued", "analyzing", "downloading", "processing", "paused"]),
  cancel: new Set<JobStatus>([
    "queued",
    "analyzing",
    "downloading",
    "processing",
    "paused",
    "error",
  ]),
  retry: new Set<JobStatus>(["error", "cancelled"]),
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
    case "start":
    case "resume":
      return "downloading";
    case "pause":
      return "paused";
    case "progress":
      return from === "processing" ? "processing" : "downloading";
    case "process":
      return "processing";
    case "done":
      return "done";
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
}

/** Fold an engine progress event into queue state (pure). */
export function applyEngineProgress(job: DownloadJob, p: EngineProgressLike): DownloadJob {
  switch (p.stage) {
    case "processing":
      if (!canTransition(job.status, "process") && job.status !== "processing") return job;
      return {
        ...job,
        status: "processing",
        progress: p.percent,
        speed: p.speed,
        eta: p.eta,
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes,
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
        downloadedBytes: p.downloadedBytes ?? job.downloadedBytes,
        totalBytes: p.totalBytes ?? job.totalBytes,
        stage: p.stage,
        error: null,
        nextRetryAt: null,
        destination: p.destination ?? job.destination,
      };
    case "error":
      return transition(job, "fail", { error: job.error ?? "Download failed." });
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
        status: job.status === "processing" ? "processing" : "downloading",
        progress: p.percent,
        speed: p.speed,
        eta: p.eta,
        downloadedBytes: p.downloadedBytes,
        totalBytes: p.totalBytes,
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
    if (j.status === "analyzing" || j.status === "downloading" || j.status === "processing") {
      n += 1;
    }
  }
  return n;
}

function isDue(job: DownloadJob, now: number): boolean {
  return job.nextRetryAt === null || job.nextRetryAt <= now;
}

/**
 * FIFO: earliest-created queued job whose backoff has elapsed,
 * or null when all slots are busy / nothing is due.
 */
export function selectNextToStart(
  jobs: readonly DownloadJob[],
  concurrency: number,
  now: number,
): DownloadJob | null {
  if (activeCount(jobs) >= clampConcurrency(concurrency)) return null;
  let best: DownloadJob | null = null;
  for (const j of jobs) {
    if (j.status !== "queued" || !isDue(j, now)) continue;
    if (
      best === null ||
      j.createdAt < best.createdAt ||
      (j.createdAt === best.createdAt && j.id < best.id)
    ) {
      best = j;
    }
  }
  return best;
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

/** Factory for new queue entries (status queued, zero attempts). */export function makeJob(id: string, input: DownloadJobInput, createdAt: number): DownloadJob {
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
    ...(input.useArchive === true ? { useArchive: true as const } : {}),
    ...(typeof input.extractor === "string" && input.extractor.length > 0
      ? { extractor: input.extractor }
      : {}),
    ...(typeof input.videoId === "string" && input.videoId.length > 0
      ? { videoId: input.videoId }
      : {}),
    ...(typeof input.cookiesFromBrowser === "string" && input.cookiesFromBrowser.length > 0
      ? { cookiesFromBrowser: input.cookiesFromBrowser }
      : {}),
    ...(typeof input.playlistSubdir === "string" && input.playlistSubdir.length > 0
      ? { playlistSubdir: input.playlistSubdir }
      : {}),
    ...(input.liveStatus !== undefined && input.liveStatus !== null
      ? { liveStatus: input.liveStatus }
      : {}),
    ...(input.liveFromStart === true ? { liveFromStart: true as const } : {}),
    ...(input.waitForVideo === true ? { waitForVideo: true as const } : {}),
  };
}

export function isFinished(job: DownloadJob): boolean {
  return job.status === "done" || job.status === "error" || job.status === "cancelled";
}

export function searchHistory(history: readonly DownloadJob[], query: string): DownloadJob[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...history];
  return history.filter(
    (h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q),
  );
}

/** Newest-first, capped. */
export function pruneHistory(history: readonly DownloadJob[], max: number): DownloadJob[] {
  const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_HISTORY_ITEMS;
  return [...history]
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
    .slice(0, cap);
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

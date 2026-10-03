import type { DownloadEngine, EngineProgress } from "./engine.js";
import type { DownloadJob, DownloadJobInput } from "./types.js";
import {
  applyEngineProgress,
  canTransition,
  clampConcurrency,
  makeJob,
  reorder as reorderJobs,
  selectNextToStart,
  shouldRetry,
  transition,
} from "./queue.js";
import { normalizeUrl } from "./url.js";

export type QueueEngine = Pick<
  DownloadEngine,
  "start" | "pause" | "resume" | "cancel" | "onProgress" | "saveQueue" | "appendHistory"
>;

export interface QueueClock {
  now(): number;
}

export interface QueueControllerOptions {
  readonly engine: QueueEngine;
  readonly concurrency: number;
  readonly maxRetries: number;
  readonly clock?: QueueClock;
  readonly createId?: () => string;
  readonly onChange?: (jobs: readonly DownloadJob[]) => void;
}

function defaultId(): string {
  const c = globalThis.crypto as unknown as { randomUUID?: () => string } | undefined;
  if (c !== undefined && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * FIFO orchestrator with concurrency cap + backoff retries.
 * Deterministic: no internal timers — callers advance time via `pump()`,
 * which starts due jobs and auto-retries eligible errors.
 */
export class QueueController {
  private readonly engine: QueueEngine;
  private readonly clock: QueueClock;
  private readonly createId: () => string;
  private readonly onChange: ((jobs: readonly DownloadJob[]) => void) | null;
  private concurrency: number;
  private readonly maxRetries: number;
  private readonly jobs = new Map<string, DownloadJob>();
  /** queueId -> engineId for jobs handed to the engine. */
  private readonly engineIds = new Map<string, string>();
  private readonly revEngineIds = new Map<string, string>();
  private readonly unsubscribe: () => void;

  constructor(opts: QueueControllerOptions) {
    this.engine = opts.engine;
    this.concurrency = clampConcurrency(opts.concurrency);
    this.maxRetries = opts.maxRetries;
    this.clock = opts.clock ?? { now: () => Date.now() };
    this.createId = opts.createId ?? defaultId;
    this.onChange = opts.onChange ?? null;
    this.unsubscribe = this.engine.onProgress((p) => {
      void this.handleEngineProgress(p);
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  setConcurrency(n: number): void {
    this.concurrency = clampConcurrency(n);
    void this.pump();
  }

  getJobs(): DownloadJob[] {
    return [...this.jobs.values()].sort(
      (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
    );
  }

  /** Restore a snapshot (e.g. from loadQueue); in-flight jobs re-queue. */
  hydrate(snapshot: readonly DownloadJob[]): void {
    this.jobs.clear();
    this.engineIds.clear();
    this.revEngineIds.clear();
    for (const j of snapshot) {
      const back =
        j.status === "downloading" || j.status === "processing" || j.status === "analyzing"
          ? { ...j, status: "queued" as const, speed: null, eta: null, stage: null }
          : j;
      this.jobs.set(back.id, back);
    }
    this.emit();
  }

  async enqueue(input: DownloadJobInput): Promise<string> {
    const url = normalizeUrl(input.url);
    const now = this.clock.now();
    const id = this.createId();
    this.jobs.set(id, makeJob(id, { ...input, url }, now));
    this.emit();
    await this.persist();
    await this.pump();
    return id;
  }

  async pause(queueId: string): Promise<void> {
    const job = this.require(queueId);
    if (job.status === "paused") return;
    const engineId = this.engineIds.get(queueId);
    if (engineId !== undefined) {
      await this.engine.pause(engineId);
    }
    // Engine confirms via progress event; optimistically mark paused for queued jobs.
    if (engineId === undefined) {
      this.jobs.set(queueId, transition(job, "pause"));
      this.emit();
      await this.persist();
    }
  }

  async resume(queueId: string): Promise<void> {
    const job = this.require(queueId);
    if (job.status !== "paused") return;
    const engineId = this.engineIds.get(queueId);
    if (engineId !== undefined) {
      await this.engine.resume(engineId);
      return;
    }
    this.jobs.set(queueId, transition(job, "resume"));
    this.emit();
    await this.persist();
    await this.pump();
  }

  async cancel(queueId: string): Promise<void> {
    const job = this.require(queueId);
    const engineId = this.engineIds.get(queueId);
    if (engineId !== undefined) {
      await this.engine.cancel(engineId);
    }
    const cancelled = transition(job, "cancel");
    await this.finish(cancelled);
  }

  /** Per-job cookie browser override ("use cookies for this download"). */
  async setJobCookies(queueId: string, browser: string | null): Promise<void> {
    const job = this.require(queueId);
    const next: DownloadJob =
      browser !== null && browser.length > 0
        ? { ...job, cookiesFromBrowser: browser }
        : { ...job, cookiesFromBrowser: null };
    this.jobs.set(queueId, next);
    this.emit();
    await this.persist();
  }

  /** Swap the preset of a failed job (retry-with-another-preset). */
  async setJobPreset(queueId: string, preset: DownloadJob["preset"]): Promise<void> {
    const job = this.require(queueId);
    if (!canTransition(job.status, "retry")) {
      throw new Error(`Cannot change the preset of a ${job.status} job.`);
    }
    this.jobs.set(queueId, { ...job, preset });
    this.emit();
    await this.persist();
  }

  /** Drop a job from the list without recording history. */
  async remove(queueId: string): Promise<void> {
    const job = this.require(queueId);
    if (!canTransition(job.status, "cancel")) {
      throw new Error(`Cannot remove an active download: ${job.status}`);
    }
    const engineId = this.engineIds.get(queueId);
    if (engineId !== undefined) {
      await this.engine.cancel(engineId).catch(() => undefined);
      this.engineIds.delete(queueId);
      this.revEngineIds.delete(engineId);
    }
    this.jobs.delete(queueId);
    this.emit();
    await this.persist();
  }

  /** Move a queued job within the queue (order persists). */
  async reorder(queueId: string, toIndex: number): Promise<void> {
    const job = this.require(queueId);
    if (job.status !== "queued") {
      throw new Error(`Only queued downloads can be reordered: ${job.status}`);
    }
    for (const j of reorderJobs(this.getJobs(), queueId, toIndex)) {
      this.jobs.set(j.id, j);
    }
    this.emit();
    await this.persist();
  }

  /** Pause everything pausable (queued locally, active via the engine). */
  async pauseAll(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (!canTransition(job.status, "pause")) continue;
      const engineId = this.engineIds.get(job.id);
      if (engineId !== undefined) {
        await this.engine.pause(engineId).catch(() => undefined);
      } else {
        this.jobs.set(job.id, transition(job, "pause"));
      }
    }
    this.emit();
    await this.persist();
  }

  /** Resume every paused job. */
  async resumeAll(): Promise<void> {
    let pumped = false;
    for (const job of this.jobs.values()) {
      if (job.status !== "paused") continue;
      const engineId = this.engineIds.get(job.id);
      if (engineId !== undefined) {
        await this.engine.resume(engineId).catch(() => undefined);
      } else {
        this.jobs.set(job.id, transition(job, "resume"));
        pumped = true;
      }
    }
    this.emit();
    await this.persist();
    if (pumped) await this.pump();
  }

  /** Cancel every queued job (each lands in history, like single cancel). */
  async cancelQueued(): Promise<void> {
    const ids = [...this.jobs.values()]
      .filter((j) => j.status === "queued")
      .map((j) => j.id);
    for (const id of ids) {
      await this.cancel(id);
    }
  }

  /** Sweep error jobs into history (abandon their retries). */
  async clearFinished(): Promise<void> {
    const ids = [...this.jobs.values()]
      .filter((j) => j.status === "error")
      .map((j) => j.id);
    for (const id of ids) {
      const job = this.jobs.get(id);
      if (job !== undefined) await this.finish(job);
    }
  }

  /** Manual retry: fresh attempts, immediate re-queue. */
  async retry(queueId: string): Promise<void> {
    const job = this.require(queueId);
    const reset: DownloadJob = {
      ...transition(job, "retry"),
      attempts: 0,
      nextRetryAt: null,
    };
    this.jobs.set(queueId, reset);
    this.emit();
    await this.persist();
    await this.pump();
  }

  /**
   * Start due jobs while slots are free + auto-retry eligible errors.
   * Safe to call after any mutation or clock advance.
   */
  async pump(): Promise<void> {
    const now = this.clock.now();
    for (const job of this.getJobs()) {
      if (shouldRetry(job, this.maxRetries, now)) {
        this.jobs.set(job.id, transition(job, "retry"));
      }
    }
    this.emit();
    for (;;) {
      const next = selectNextToStart(this.getJobs(), this.concurrency, this.clock.now());
      if (next === null) break;
      try {
        const engineId = await this.engine.start({
          url: next.url,
          title: next.title,
          preset: next.preset,
          outputDir: next.outputDir,
          ...(next.useArchive === true ? { useArchive: true as const } : {}),
          ...(typeof next.cookiesFromBrowser === "string" && next.cookiesFromBrowser.length > 0
            ? { cookiesFromBrowser: next.cookiesFromBrowser }
            : {}),
        });
        const current = this.jobs.get(next.id);
        if (current === undefined) {
          await this.engine.cancel(engineId).catch(() => undefined);
          break;
        }
        this.engineIds.set(next.id, engineId);
        this.revEngineIds.set(engineId, next.id);
        this.jobs.set(next.id, transition(current, "start"));
        this.emit();
      } catch (err) {
        const current = this.jobs.get(next.id);
        if (current === undefined) break;
        const failed = transition(current, "fail", {
          error: err instanceof Error ? err.message : "Failed to start.",
          now: this.clock.now(),
        });
        if (failed.attempts > this.maxRetries) {
          await this.finish(failed);
        } else {
          this.jobs.set(next.id, failed);
          this.emit();
        }
        break;
      }
    }
    await this.persist();
  }

  private async handleEngineProgress(p: EngineProgress): Promise<void> {
    const queueId = this.revEngineIds.get(p.id);
    if (queueId === undefined) return;
    const job = this.jobs.get(queueId);
    if (job === undefined) return;
    if (p.stage === "error") {
      const failed = transition(job, "fail", {
        error: p.errorMessage ?? job.error ?? "Download failed.",
        now: this.clock.now(),
      });
      const categorized: DownloadJob =
        p.errorCategory !== undefined ? { ...failed, errorCategory: p.errorCategory } : failed;
      if (categorized.attempts > this.maxRetries) {
        await this.finish(categorized);
      } else {
        this.jobs.set(queueId, categorized);
        this.emit();
        await this.persist();
      }
      return;
    }
    const updated = applyEngineProgress(job, p);
    if (updated.status === "done" || updated.status === "cancelled") {
      await this.finish(updated);
      return;
    }
    this.jobs.set(queueId, updated);
    this.emit();
  }

  private async finish(job: DownloadJob): Promise<void> {
    this.jobs.delete(job.id);
    const engineId = this.engineIds.get(job.id);
    if (engineId !== undefined) {
      this.engineIds.delete(job.id);
      this.revEngineIds.delete(engineId);
    }
    await this.engine.appendHistory(job).catch(() => undefined);
    this.emit();
    await this.persist();
    await this.pump();
  }

  private async persist(): Promise<void> {
    await this.engine.saveQueue(this.getJobs()).catch(() => undefined);
  }

  private require(queueId: string): DownloadJob {
    const job = this.jobs.get(queueId);
    if (job === undefined) throw new Error(`Unknown job: ${queueId}`);
    return job;
  }

  private emit(): void {
    this.onChange?.(this.getJobs());
  }
}

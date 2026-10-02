import type { DownloadEngine, EngineProgress } from "./engine.js";
import type { DownloadJob, DownloadJobInput } from "./types.js";
import {
  applyEngineProgress,
  clampConcurrency,
  makeJob,
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
        error: job.error ?? "Download failed.",
        now: this.clock.now(),
      });
      if (failed.attempts > this.maxRetries) {
        await this.finish(failed);
      } else {
        this.jobs.set(queueId, failed);
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

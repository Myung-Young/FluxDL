import { describe, expect, it, vi } from "vitest";
import { QueueController, type QueueEngine } from "./queueController.js";
import type { DownloadJob, DownloadJobInput, EngineProgress } from "./index.js";
import { makeJob } from "./queue.js";

const input: DownloadJobInput = {
  url: "https://youtu.be/aqz-KE-bpKQ",
  title: "Big Buck Bunny",
  preset: { kind: "video", videoPreset: "720", audioPreset: "MP3", rawFormat: null },
  outputDir: "C:\\Vids",
};

interface Fake extends QueueEngine {
  started: DownloadJobInput[];
  paused: string[];
  resumed: string[];
  cancelled: string[];
  saved: DownloadJob[][];
  history: DownloadJob[];
  failStart: Error | null;
  updated: number;
  failUpdate: boolean;
  fire(p: EngineProgress): void;
}

function makeFake(): Fake {
  let cb: ((p: EngineProgress) => void) | null = null;
  let n = 0;
  const fake: Fake = {
    started: [],
    paused: [],
    resumed: [],
    cancelled: [],
    saved: [],
    history: [],
    failStart: null,
    updated: 0,
    failUpdate: false,
    fire: (p) => {
      cb?.(p);
    },
    start: (job) => {
      if (fake.failStart !== null) {
        const err = fake.failStart;
        fake.failStart = null;
        return Promise.reject(err);
      }
      fake.started.push(job);
      n += 1;
      return Promise.resolve(`eng-${String(n)}`);
    },
    pause: (id) => {
      fake.paused.push(id);
      return Promise.resolve();
    },
    resume: (id) => {
      fake.resumed.push(id);
      return Promise.resolve();
    },
    cancel: (id) => {
      fake.cancelled.push(id);
      return Promise.resolve();
    },
    onProgress: (fn) => {
      cb = fn;
      return () => {
        cb = null;
      };
    },
    saveQueue: (jobs) => {
      fake.saved.push([...jobs]);
      return Promise.resolve();
    },
    appendHistory: (job) => {
      fake.history.push(job);
      return Promise.resolve();
    },
    removeHistory: (id) => {
      fake.history = fake.history.filter((h) => h.id !== id);
      return Promise.resolve();
    },
    updateEngine: () => {
      if (fake.failUpdate) return Promise.reject(new Error("offline"));
      fake.updated += 1;
      return Promise.resolve({
        ytdlp: "2026.08.19",
        ffmpeg: "7.1",
        app: "test",
      });
    },
  };
  return fake;
}

function downloading(id: string, percent = 10): EngineProgress {
  return {
    id,
    percent,
    speed: "1M/s",
    eta: "00:01",
    downloadedBytes: 10,
    totalBytes: 100,
    stage: "downloading",
    destination: null,
  };
}

function done(id: string): EngineProgress {
  return {
    id,
    percent: 100,
    speed: null,
    eta: null,
    downloadedBytes: 100,
    totalBytes: 100,
    stage: "done",
    destination: "C:\\Vids\\done.mp4",
  };
}

describe("QueueController", () => {
  it("rejects invalid URLs before touching the engine", async () => {
    const fake = makeFake();
    const ctrl = new QueueController({ engine: fake, concurrency: 2, maxRetries: 3 });
    await expect(ctrl.enqueue({ ...input, url: "not a url" })).rejects.toThrow();
    expect(fake.started).toHaveLength(0);
    ctrl.dispose();
  });

  it("runs FIFO with a concurrency cap", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    await ctrl.enqueue({ ...input, title: "Second" });
    expect(fake.started).toHaveLength(1);
    expect(ctrl.getJobs().map((j) => j.status)).toEqual(["downloading", "queued"]);
    fake.fire(done("eng-1"));
    await vi.waitFor(() => {
      expect(fake.started).toHaveLength(2);
    });
    expect(ctrl.getJobs().map((j) => j.title)).toEqual(["Second"]);
    ctrl.dispose();
  });

  it("pauses queued jobs locally and active jobs via the engine", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    await ctrl.enqueue({ ...input, title: "B" });
    await ctrl.pause("q2");
    expect(fake.paused).toHaveLength(0);
    expect(ctrl.getJobs().find((j) => j.id === "q2")?.status).toBe("paused");
    await ctrl.pause("q1");
    expect(fake.paused).toEqual(["eng-1"]);
    ctrl.dispose();
  });

  it("retries errors with backoff then moves to history past max", async () => {
    const fake = makeFake();
    let now = 0;
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 2,
      maxRetries: 1,
      clock: { now: () => now },
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    expect(fake.started).toHaveLength(1);
    fake.fire({ ...downloading("eng-1"), stage: "error" });
    await vi.waitFor(() => {
      expect(ctrl.getJobs()[0]?.status).toBe("error");
    });
    // Backoff gates the retry.
    await ctrl.pump();
    expect(fake.started).toHaveLength(1);
    now = 60_000;
    await ctrl.pump();
    expect(fake.started).toHaveLength(2);
    // Second failure exceeds maxRetries=1 -> history.
    fake.fire({ ...downloading("eng-2"), stage: "error" });
    await vi.waitFor(() => {
      expect(fake.history).toHaveLength(1);
    });
    expect(ctrl.getJobs()).toHaveLength(0);
    expect(fake.history[0]?.status).toBe("error");
    ctrl.dispose();
  });

  it("manual retry resets attempts and cancel records history", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 5,
      maxRetries: 5,
      createId: () => `q${String((n += 1))}`,
    });
    fake.failStart = new Error("boom");
    await ctrl.enqueue(input);
    await vi.waitFor(() => {
      expect(ctrl.getJobs()[0]?.status).toBe("error");
    });
    expect(ctrl.getJobs()[0]?.attempts).toBe(1);
    await ctrl.retry("q1");
    expect(ctrl.getJobs()[0]?.attempts).toBe(0);
    await vi.waitFor(() => {
      expect(fake.started).toHaveLength(1);
    });
    expect(ctrl.getJobs()[0]?.status).toBe("downloading");
    await ctrl.cancel("q1");
    await vi.waitFor(() => {
      expect(fake.history.map((h) => h.status)).toContain("cancelled");
    });
    expect(ctrl.getJobs()).toHaveLength(0);
    await expect(ctrl.retry("missing")).rejects.toThrow();
    ctrl.dispose();
  });

  it("hydrate recovers in-flight jobs as interrupted (never auto-starts)", async () => {    const fake = makeFake();
    const ctrl = new QueueController({ engine: fake, concurrency: 1, maxRetries: 3 });
    ctrl.hydrate([
      {
        id: "old",
        url: input.url,
        title: "Old",
        preset: input.preset,
        outputDir: input.outputDir,
        status: "downloading",
        progress: 50,
        speed: null,
        eta: null,
        downloadedBytes: null,
        totalBytes: null,
        stage: "downloading",
        error: null,
        createdAt: 1,
        attempts: 0,
        nextRetryAt: null,
        destination: null,
      },
    ]);
    expect(ctrl.getJobs()[0]?.status).toBe("interrupted");
    await ctrl.pump();
    expect(fake.started).toHaveLength(0);
    await ctrl.resume("old");
    expect(fake.started).toHaveLength(1);
    ctrl.dispose();
  });

  it("captures engine error message + category on failure", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    fake.fire({
      ...downloading("eng-1"),
      stage: "error",
      errorMessage: "Age-restricted video.",
      errorCategory: "age-gated",
    });
    await vi.waitFor(() => {
      expect(ctrl.getJobs()[0]?.status).toBe("error");
    });
    expect(ctrl.getJobs()[0]?.error).toBe("Age-restricted video.");
    expect(ctrl.getJobs()[0]?.errorCategory).toBe("age-gated");
    ctrl.dispose();
  });

  it("sets per-job cookie overrides and forwards them at start", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    await ctrl.setJobCookies("q1", "firefox");
    expect(ctrl.getJobs()[0]?.cookiesFromBrowser).toBe("firefox");
    // Fail, then manual retry re-starts with the stored override.
    fake.fire({ ...downloading("eng-1"), stage: "error" });
    await vi.waitFor(() => {
      expect(ctrl.getJobs()[0]?.status).toBe("error");
    });
    await ctrl.retry("q1");
    await vi.waitFor(() => {
      expect(fake.started).toHaveLength(2);
    });
    expect(fake.started[1]?.cookiesFromBrowser).toBe("firefox");
    await ctrl.setJobCookies("q1", null);
    expect(ctrl.getJobs()[0]?.cookiesFromBrowser).toBeNull();
    ctrl.dispose();
  });

  it("removes idle jobs without history and swaps presets on failed jobs", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    await expect(ctrl.setJobPreset("q1", input.preset)).rejects.toThrow();
    fake.fire({ ...downloading("eng-1"), stage: "error" });
    await vi.waitFor(() => {
      expect(ctrl.getJobs()[0]?.status).toBe("error");
    });
    const compat = { kind: "video", videoPreset: "Compatible", audioPreset: "MP3", rawFormat: null } as const;
    await ctrl.setJobPreset("q1", compat);
    expect(ctrl.getJobs()[0]?.preset.videoPreset).toBe("Compatible");
    await ctrl.remove("q1");
    expect(ctrl.getJobs()).toHaveLength(0);
    expect(fake.history).toHaveLength(0);
    await expect(ctrl.remove("missing")).rejects.toThrow();
    ctrl.dispose();
  });

  it("schedules queued jobs and rejects anything else (A4)", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    await ctrl.enqueue({ ...input, title: "B" });
    // q1 started; q2 waits queued.
    await ctrl.setJobSchedule("q2", 2000);
    expect(ctrl.getJobs().find((j) => j.id === "q2")?.startAfter).toBe(2000);
    await ctrl.setJobSchedule("q2", null);
    expect(ctrl.getJobs().find((j) => j.id === "q2")?.startAfter).toBeNull();
    await expect(ctrl.setJobSchedule("q1", 2000)).rejects.toThrow(/queued/);
    await expect(ctrl.setJobSchedule("q2", Number.NaN)).rejects.toThrow(/Invalid/);
    await expect(ctrl.setJobSchedule("missing", 2000)).rejects.toThrow();
    ctrl.dispose();
  });

  it("undoes a sweep exactly (C2)", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    await ctrl.enqueue({ ...input, title: "B" });
    // q1 runs; q2 + q3 wait queued.
    await ctrl.enqueue({ ...input, title: "C" });
    const swept = await ctrl.cancelQueued();
    expect(swept).toBe(2);
    expect(ctrl.getJobs()).toHaveLength(1);
    expect(fake.history).toHaveLength(2);
    expect(await ctrl.undoSweep()).toBe(2);
    expect(ctrl.getJobs()).toHaveLength(3);
    expect(fake.history).toHaveLength(0);
    // Second undo is a no-op.
    expect(await ctrl.undoSweep()).toBe(0);
    ctrl.dispose();
  });

  it("pins jobs to the top without disturbing the pump (B7)", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    await ctrl.enqueue({ ...input, title: "B" });
    await ctrl.togglePin("q2");
    expect(ctrl.getJobs().map((j) => j.id)).toEqual(["q2", "q1"]);
    await ctrl.togglePin("q2");
    expect(ctrl.getJobs().map((j) => j.id)).toEqual(["q1", "q2"]);
    await expect(ctrl.togglePin("missing")).rejects.toThrow();
    ctrl.dispose();
  });

  it("reorders queued jobs, persists the order, and hydrates it back", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      clock: { now: () => 1000 },
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    await ctrl.enqueue({ ...input, title: "B" });
    await ctrl.enqueue({ ...input, title: "C" });
    // q1 started (downloading); q2/q3 queued with tied createdAt.
    await ctrl.reorder("q3", 0);
    expect(fake.started).toHaveLength(1);
    await expect(ctrl.reorder("q1", 0)).rejects.toThrow();
    // Persisted snapshot keeps the queued order.
    const saved = fake.saved[fake.saved.length - 1] ?? [];
    const queuedSaved = saved.filter((j) => j.status === "queued");
    expect(queuedSaved[0]?.id).toBe("q3");
    // Hydrate restores the same start order (in-flight q1 comes back
    // interrupted and needs an explicit resume, so only queued jobs start).
    const fake2 = makeFake();
    const ctrl2 = new QueueController({ engine: fake2, concurrency: 5, maxRetries: 3 });
    ctrl2.hydrate(saved);
    await ctrl2.pump();
    expect(fake2.started.map((s) => s.title)).toEqual(["C", "B"]);
    ctrl.dispose();
    ctrl2.dispose();
  });

  it("pauses/resumes everything across engine and local paths", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    await ctrl.enqueue({ ...input, title: "B" });
    await ctrl.pauseAll();
    // Active job goes through the engine; queued job pauses locally.
    expect(fake.paused).toEqual(["eng-1"]);
    expect(ctrl.getJobs().find((j) => j.id === "q2")?.status).toBe("paused");
    fake.fire({ ...downloading("eng-1"), stage: "paused" });
    await vi.waitFor(() => {
      expect(ctrl.getJobs().every((j) => j.status === "paused")).toBe(true);
    });
    await ctrl.resumeAll();
    expect(fake.resumed).toEqual(["eng-1"]);
    await vi.waitFor(() => {
      expect(ctrl.getJobs().find((j) => j.id === "q2")?.status).toBe("downloading");
    });
    // Empty-queue bulk ops are safe no-ops.
    const empty = makeFake();
    const ctrlEmpty = new QueueController({ engine: empty, concurrency: 2, maxRetries: 3 });
    await ctrlEmpty.pauseAll();
    await ctrlEmpty.resumeAll();
    await ctrlEmpty.cancelQueued();
    await ctrlEmpty.clearFinished();
    expect(empty.started).toHaveLength(0);
    ctrl.dispose();
    ctrlEmpty.dispose();
  });

  it("cancelQueued lands in history and clearFinished sweeps lingering errors", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 0,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    await ctrl.enqueue({ ...input, title: "B" });
    await ctrl.cancelQueued();
    expect(ctrl.getJobs().map((j) => j.status)).toEqual(["downloading"]);
    expect(fake.history.map((h) => h.status)).toEqual(["cancelled"]);
    fake.fire({ ...downloading("eng-1"), stage: "error" });
    await vi.waitFor(() => {
      expect(fake.history).toHaveLength(2);
    });
    // maxRetries=0: the error went straight to history; nothing to clear.
    await ctrl.clearFinished();
    expect(ctrl.getJobs()).toHaveLength(0);
    // A backoff-gated error lingers in the queue until cleared.
    const slow = makeFake();
    let m = 0;
    const ctrl2 = new QueueController({
      engine: slow,
      concurrency: 1,
      maxRetries: 3,
      clock: { now: () => 0 },
      createId: () => `w${String((m += 1))}`,
    });
    await ctrl2.enqueue(input);
    slow.fire({ ...downloading("eng-1"), stage: "error" });
    await vi.waitFor(() => {
      expect(ctrl2.getJobs()[0]?.status).toBe("error");
    });
    await ctrl2.clearFinished();
    expect(ctrl2.getJobs()).toHaveLength(0);
    expect(slow.history).toHaveLength(1);
    expect(slow.history[0]?.status).toBe("error");
    ctrl.dispose();
    ctrl2.dispose();
  });

  it("clearFinished sweeps cancelled and done jobs in addition to error jobs", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 2,
      maxRetries: 3,
      createId: () => `c${String((n += 1))}`,
    });
    // Manually inject jobs into the controller's internal map via hydrate for testing.
    ctrl.hydrate([
      { ...makeJob("j-err", input, 1), status: "error", error: "err", nextRetryAt: 9999 },
      { ...makeJob("j-done", input, 2), status: "done", progress: 1, destination: "/out/a.mp4" },
      { ...makeJob("j-cancel", input, 3), status: "cancelled" },
    ]);
    expect(ctrl.getJobs()).toHaveLength(3);
    await ctrl.clearFinished();
    expect(ctrl.getJobs()).toHaveLength(0);
    expect(fake.history).toHaveLength(3);
    ctrl.dispose();
  });

  it("carries extractor/videoId through to engine.start (M3.1)", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue({ ...input, extractor: "youtube", videoId: "abc123" });
    expect(fake.started[0]?.extractor).toBe("youtube");
    expect(fake.started[0]?.videoId).toBe("abc123");
    ctrl.dispose();
  });

  it("retryAll resets every failed job in FIFO order (M3.2)", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      clock: { now: () => 0 },
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue({ ...input, title: "A" });
    await ctrl.enqueue({ ...input, title: "B" });
    fake.fire({ ...downloading("eng-1"), stage: "error" });
    await vi.waitFor(() => {
      expect(ctrl.getJobs().filter((j) => j.status === "error")).toHaveLength(1);
    });
    await ctrl.retryAll();
    expect(ctrl.getJobs().filter((j) => j.status === "error")).toHaveLength(0);
    expect(fake.started.length).toBeGreaterThanOrEqual(2);
    ctrl.dispose();
  });

  it("drops an overlapping pump so one job starts once (M4.1)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: DownloadJobInput[] = [];
    const slow: QueueEngine = {
      start: (job) => {
        started.push(job);
        return gate.then(() => "eng-1");
      },
      pause: () => Promise.resolve(),
      resume: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      onProgress: () => () => undefined,
      saveQueue: () => Promise.resolve(),
      appendHistory: () => Promise.resolve(),
      removeHistory: () => Promise.resolve(),
      updateEngine: () => Promise.reject(new Error("not implemented in test fake")),
    };
    const ctrl = new QueueController({
      engine: slow,
      concurrency: 1,
      maxRetries: 3,
      createId: () => "q1",
    });
    const pending = ctrl.enqueue(input);
    await vi.waitFor(() => {
      expect(started).toHaveLength(1);
    });
    await ctrl.pump();
    await ctrl.pump();
    release();
    await pending;
    expect(started).toHaveLength(1);
    expect(ctrl.getJobs()[0]?.status).toBe("downloading");
    ctrl.dispose();
  });
});

describe("idle pumping (M4.8)", () => {
  it("neither emits nor persists when a pump finds nothing to do", async () => {
    const fake = makeFake();
    const emits: (readonly DownloadJob[])[] = [];
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 2,
      maxRetries: 3,
      onChange: (jobs) => {
        emits.push(jobs);
      },
    });
    // Stand in for the 1 s Shell tick firing 60 times with an idle queue.
    for (let i = 0; i < 60; i += 1) {
      await ctrl.pump();
    }
    expect(emits).toHaveLength(0);
    expect(fake.saved).toHaveLength(0);
    ctrl.dispose();
  });

  it("stays silent while a paused job waits", async () => {
    const fake = makeFake();
    let n = 0;
    const emits: (readonly DownloadJob[])[] = [];
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
      onChange: (jobs) => {
        emits.push(jobs);
      },
    });
    const id = await ctrl.enqueue(input);
    await ctrl.pause(id);
    const settled = emits.length;
    const saved = fake.saved.length;
    for (let i = 0; i < 30; i += 1) {
      await ctrl.pump();
    }
    expect(emits.length).toBe(settled);
    expect(fake.saved.length).toBe(saved);
    ctrl.dispose();
  });

  it("still emits and persists when work actually happens", async () => {
    const fake = makeFake();
    let n = 0;
    const emits: (readonly DownloadJob[])[] = [];
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
      onChange: (jobs) => {
        emits.push(jobs);
      },
    });
    await ctrl.enqueue({ ...input, useArchive: false });
    expect(emits.length).toBeGreaterThan(0);
    expect(fake.saved.length).toBeGreaterThan(0);
    ctrl.dispose();
  });

  it("persists when a paused job fails and is retried", async () => {
    const fake = makeFake();
    let now = 1_000;
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      clock: { now: () => now },
      createId: () => `q${String((n += 1))}`,
    });
    const id = await ctrl.enqueue(input);
    await ctrl.pause(id);
    const before = fake.saved.length;
    // Make the paused job eligible for a backoff retry.
    fake.fire({
      ...downloading("eng-1"),
      id: "eng-1",
      stage: "error",
      errorMessage: "boom",
    });
    now += 5_000;
    await ctrl.pump();
    expect(fake.started.length).toBeGreaterThan(1);
    expect(fake.saved.length).toBeGreaterThan(before);
    ctrl.dispose();
  });

  it("auto-retries an outdated engine once when it is the only job", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    fake.fire({
      ...downloading("eng-1"),
      stage: "error",
      errorMessage: "Signature extraction failed",
      errorCategory: "extractor-failed",
    });
    await vi.waitFor(() => {
      expect(fake.updated).toBe(1);
    });
    // Updated once, then re-queued and restarted exactly once more.
    expect(fake.started).toHaveLength(2);
    expect(ctrl.getJobs()[0]?.outdatedRetried).toBe(true);
    ctrl.dispose();
  });

  it("never loops the outdated retry (flag set, update failure falls through)", async () => {
    const fake = makeFake();
    fake.failUpdate = true;
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    fake.fire({
      ...downloading("eng-1"),
      stage: "error",
      errorMessage: "HTTP Error 403",
      errorCategory: "extractor-failed",
    });
    await vi.waitFor(() => {
      expect(ctrl.getJobs()[0]?.status).toBe("error");
    });
    expect(fake.started).toHaveLength(1);
    expect(ctrl.getJobs()[0]?.outdatedRetried).toBe(true);
    // A second identical failure (after an explicit manual retry) must not
    // update again: the flag allows exactly one automatic attempt.
    await ctrl.retry("q1");
    await vi.waitFor(() => {
      expect(fake.started).toHaveLength(2);
    });
    fake.fire({
      ...downloading("eng-2"),
      stage: "error",
      errorMessage: "HTTP Error 403",
      errorCategory: "extractor-failed",
    });
    await vi.waitFor(() => {
      expect(ctrl.getJobs()[0]?.status).toBe("error");
    });
    expect(fake.updated).toBe(0);
    expect(fake.started).toHaveLength(2);
    ctrl.dispose();
  });

  it("leaves outdated failures to the banner when other jobs run", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 2,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    await ctrl.enqueue({ ...input, title: "B" });
    fake.fire({
      ...downloading("eng-1"),
      stage: "error",
      errorMessage: "Signature extraction failed",
      errorCategory: "extractor-failed",
    });
    await vi.waitFor(() => {
      expect(ctrl.getJobs().some((j) => j.status === "error")).toBe(true);
    });
    expect(fake.updated).toBe(0);
    ctrl.dispose();
  });

  it("keeps stalled progress in place without moving state", async () => {
    const fake = makeFake();
    let n = 0;
    const ctrl = new QueueController({
      engine: fake,
      concurrency: 1,
      maxRetries: 3,
      createId: () => `q${String((n += 1))}`,
    });
    await ctrl.enqueue(input);
    fake.fire({ ...downloading("eng-1"), stage: "stalled" });
    await vi.waitFor(() => {
      expect(ctrl.getJobs()[0]?.stage).toBe("stalled");
    });
    expect(ctrl.getJobs()[0]?.status).toBe("downloading");
    ctrl.dispose();
  });
});

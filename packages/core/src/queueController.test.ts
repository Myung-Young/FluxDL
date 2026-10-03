import { describe, expect, it, vi } from "vitest";
import { QueueController, type QueueEngine } from "./queueController.js";
import type { DownloadJob, DownloadJobInput, EngineProgress } from "./index.js";

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

  it("hydrate re-queues in-flight jobs from a snapshot", async () => {    const fake = makeFake();
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
    expect(ctrl.getJobs()[0]?.status).toBe("queued");
    await ctrl.pump();
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
    // Hydrate restores the same start order.
    const fake2 = makeFake();
    const ctrl2 = new QueueController({ engine: fake2, concurrency: 5, maxRetries: 3 });
    ctrl2.hydrate(saved);
    await ctrl2.pump();
    expect(fake2.started.map((s) => s.title)).toEqual(["Big Buck Bunny", "C", "B"]);
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
});

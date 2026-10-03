import { describe, expect, it } from "vitest";
import {
  activeCount,
  applyEngineProgress,
  canTransition,
  clampConcurrency,
  computeBackoffMs,
  isFinished,
  makeJob,
  pruneHistory,
  reorder,
  retryInSeconds,
  searchHistory,
  selectNextToStart,
  shouldRetry,
  transition,
} from "./queue.js";
import type { DownloadJob, DownloadJobInput } from "./types.js";

const input: DownloadJobInput = {
  url: "https://youtu.be/aqz-KE-bpKQ",
  title: "Big Buck Bunny",
  preset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
  outputDir: "C:\\Vids",
};

function jobAt(status: DownloadJob["status"], createdAt = 1, id = "j1"): DownloadJob {
  return {
    ...makeJob(id, input, createdAt),
    status,
  };
}

describe("queue state machine", () => {
  it("covers the happy path queued -> downloading -> processing -> done", () => {
    let j = makeJob("a", input, 1);
    expect(j.status).toBe("queued");
    j = transition(j, "start");
    expect(j.status).toBe("downloading");
    j = transition(j, "process");
    expect(j.status).toBe("processing");
    j = transition(j, "done");
    expect(j.status).toBe("done");
    expect(j.progress).toBe(100);
    expect(isFinished(j)).toBe(true);
  });

  it("covers pause/resume/cancel from every active state", () => {
    for (const from of ["queued", "analyzing", "downloading", "processing"] as const) {
      expect(canTransition(from, "pause")).toBe(true);
      const paused = transition(jobAt(from), "pause");
      expect(paused.status).toBe("paused");
      expect(transition(paused, "resume").status).toBe("downloading");
      expect(transition(paused, "cancel").status).toBe("cancelled");
    }
    expect(canTransition("done", "pause")).toBe(false);
    expect(() => transition(jobAt("done"), "pause")).toThrow();
  });

  it("covers fail -> retry with attempts and backoff", () => {
    let j = transition(jobAt("downloading"), "fail", { error: "boom", now: 1000 });
    expect(j.status).toBe("error");
    expect(j.attempts).toBe(1);
    expect(j.nextRetryAt).toBe(1000 + computeBackoffMs(1));
    expect(shouldRetry(j, 3, 1000)).toBe(false);
    expect(shouldRetry(j, 3, (j.nextRetryAt ?? 0) + 1)).toBe(true);
    j = transition(j, "retry");
    expect(j.status).toBe("queued");
    expect(j.error).toBeNull();
  });

  it("applies engine progress stages to queue state", () => {
    let j = transition(jobAt("queued"), "start");
    j = applyEngineProgress(j, {
      percent: 12.5,
      speed: "1M/s",
      eta: "00:01",
      downloadedBytes: 10,
      totalBytes: 100,
      stage: "downloading",
      destination: null,
    });
    expect(j.progress).toBe(12.5);
    j = applyEngineProgress(j, {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: 100,
      totalBytes: 100,
      stage: "processing",
      destination: "C:\\Vids\\a.mp4",
    });
    expect(j.status).toBe("processing");
    expect(j.destination).toBe("C:\\Vids\\a.mp4");
    j = applyEngineProgress(j, {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: 100,
      totalBytes: 100,
      stage: "done",
      destination: null,
    });
    expect(j.status).toBe("done");
    expect(j.destination).toBe("C:\\Vids\\a.mp4");
  });

  it("resumes accept progress and done events after pause (D53)", () => {
    const paused = transition(jobAt("downloading"), "pause");
    expect(paused.status).toBe("paused");
    const resumed = applyEngineProgress(paused, {
      percent: 50,
      speed: "1M/s",
      eta: "00:01",
      downloadedBytes: 50,
      totalBytes: 100,
      stage: "downloading",
      destination: null,
    });
    expect(resumed.status).toBe("downloading");
    const finished = applyEngineProgress(paused, {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: 100,
      totalBytes: 100,
      stage: "done",
      destination: "C:\\Vids\\a.mp4",
    });
    expect(finished.status).toBe("done");
  });

  it("enforces FIFO with concurrency 1-5 and backoff gating", () => {
    const a = jobAt("queued", 1, "a");
    const b = jobAt("queued", 2, "b");
    expect(selectNextToStart([b, a], 5, 0)?.id).toBe("a");
    expect(activeCount([jobAt("downloading"), jobAt("processing"), a])).toBe(2);
    expect(selectNextToStart([jobAt("downloading"), a], 1, 0)).toBeNull();
    const waiting = { ...a, nextRetryAt: 9999 };
    expect(selectNextToStart([waiting], 5, 0)).toBeNull();
    expect(selectNextToStart([waiting], 5, 9999)?.id).toBe("a");
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(99)).toBe(5);
  });

  it("computes capped exponential backoff", () => {
    expect(computeBackoffMs(1)).toBe(2000);
    expect(computeBackoffMs(2)).toBe(4000);
    expect(computeBackoffMs(3)).toBe(8000);
    expect(computeBackoffMs(99)).toBe(30_000);
  });

  it("searches and prunes history", () => {
    const h = [jobAt("done", 3, "c"), jobAt("error", 1, "a"), jobAt("cancelled", 2, "b")];
    expect(searchHistory(h, "buck")).toHaveLength(3);
    expect(searchHistory(h, "youtu.be")).toHaveLength(3);
    expect(searchHistory(h, "nope")).toHaveLength(0);
    expect(pruneHistory(h, 2).map((j) => j.id)).toEqual(["c", "b"]);
  });

  it("reorders queued jobs by permuting createdAt (FIFO honors it)", () => {
    const a = jobAt("queued", 1, "a");
    const b = jobAt("queued", 2, "b");
    const c = jobAt("queued", 3, "c");
    const active = jobAt("downloading", 0, "z");
    const moved = reorder([a, b, c, active], "c", 0);
    // createdAt multiset preserved, strictly increasing in the new order.
    expect(moved.map((j) => j.createdAt).sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
    const queuedOrder = moved
      .filter((j) => j.status === "queued")
      .sort((x, y) => x.createdAt - y.createdAt)
      .map((j) => j.id);
    expect(queuedOrder).toEqual(["c", "a", "b"]);
    expect(selectNextToStart(moved, 5, 0)?.id).toBe("c");
    expect(moved.find((j) => j.id === "z")?.createdAt).toBe(0);
  });

  it("reorder clamps, ignores unknown ids and non-queued jobs", () => {
    const a = jobAt("queued", 1, "a");
    const b = jobAt("queued", 2, "b");
    expect(reorder([a, b], "zzz", 0).map((j) => j.id)).toEqual(["a", "b"]);
    expect(reorder([a, b], "a", 0)).toEqual([a, b]);
    const toEnd = reorder([a, b], "a", 99);
    expect(toEnd.find((j) => j.id === "a")?.createdAt).toBeGreaterThan(
      toEnd.find((j) => j.id === "b")?.createdAt ?? 0,
    );
    const first = reorder([a, b], "b", 0);
    expect(first[0]?.id).toBe("a");
    expect(first[1]?.id).toBe("b");
    // b now sorts first by createdAt.
    expect(first[1]?.createdAt).toBeLessThan(first[0]?.createdAt ?? 0);
    const paused = jobAt("paused", 5, "p");
    expect(reorder([a, paused], "p", 0).map((j) => j.id)).toEqual(["a", "p"]);
  });

  it("reorder breaks createdAt ties so batch-enqueued jobs keep an order", () => {
    const a = jobAt("queued", 7, "a");
    const b = jobAt("queued", 7, "b");
    const c = jobAt("queued", 7, "c");
    const moved = reorder([a, b, c], "c", 0);
    const times = moved.map((j) => j.createdAt);
    expect(new Set(times).size).toBe(3);
    expect(selectNextToStart(moved, 5, 0)?.id).toBe("c");
  });

  it("reports retry countdown seconds only for future backoff deadlines", () => {
    const failed = transition(jobAt("downloading", 1, "f"), "fail", { error: "x", now: 0 });
    expect(failed.nextRetryAt).toBe(2000);
    expect(retryInSeconds(failed, 0)).toBe(2);
    expect(retryInSeconds(failed, 1500)).toBe(1);
    expect(retryInSeconds(failed, 2000)).toBeNull();
    expect(retryInSeconds(jobAt("queued"), 0)).toBeNull();
  });
});

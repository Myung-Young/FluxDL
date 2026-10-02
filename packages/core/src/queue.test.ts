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
    });
    expect(j.progress).toBe(12.5);
    j = applyEngineProgress(j, {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: 100,
      totalBytes: 100,
      stage: "processing",
    });
    expect(j.status).toBe("processing");
    j = applyEngineProgress(j, {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: 100,
      totalBytes: 100,
      stage: "done",
    });
    expect(j.status).toBe("done");
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
});

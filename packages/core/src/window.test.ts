import { describe, expect, it } from "vitest";
import {
  MINI_HEIGHT,
  MINI_MIN_HEIGHT,
  MINI_MIN_WIDTH,
  MINI_WIDTH,
  NORMAL_BOUNDS,
  boundsFor,
  chromeState,
  miniRows,
  miniSummary,
} from "./window.js";
import type { DownloadJob, JobStatus } from "./types.js";

function job(status: JobStatus, createdAt = 1, id = "j1"): DownloadJob {
  return {
    id,
    url: "https://youtu.be/aqz-KE-bpKQ",
    title: `Job ${id}`,
    preset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
    outputDir: "C:\\Vids",
    status,
    progress: status === "done" ? 100 : 0,
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
  };
}

describe("mini window metrics", () => {
  it("uses the specified compact size", () => {
    expect(MINI_WIDTH).toBe(360);
    expect(MINI_HEIGHT).toBe(520);
    expect(boundsFor(true)).toEqual({ width: 360, height: 520 });
    expect(boundsFor(false)).toEqual(NORMAL_BOUNDS);
  });

  it("keeps the minimum smaller than the target so resizing stays possible", () => {
    expect(MINI_MIN_WIDTH).toBeLessThan(MINI_WIDTH);
    expect(MINI_MIN_HEIGHT).toBeLessThan(MINI_HEIGHT);
  });

  it("carries the theme alongside the mini flag", () => {
    expect(chromeState(true, "paper")).toEqual({ mini: true, theme: "paper" });
    expect(chromeState(false, "obsidian")).toEqual({ mini: false, theme: "obsidian" });
  });
});

describe("miniSummary", () => {
  it("counts only in-flight jobs as active", () => {
    const jobs = [
      job("downloading", 1, "a"),
      job("processing", 2, "b"),
      job("analyzing", 3, "c"),
      job("queued", 4, "d"),
      job("paused", 5, "e"),
      job("done", 6, "f"),
    ];
    expect(miniSummary(jobs)).toEqual({ active: 3, total: 6, hasWork: true });
  });

  it("reports an empty queue", () => {
    expect(miniSummary([])).toEqual({ active: 0, total: 0, hasWork: false });
  });
});

describe("miniRows", () => {
  it("hides terminal jobs and orders by urgency", () => {
    const rows = miniRows([
      job("done", 1, "done"),
      job("error", 2, "err"),
      job("paused", 3, "paused"),
      job("queued", 4, "queuedA"),
      job("queued", 5, "queuedB"),
      job("downloading", 6, "dl"),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["dl", "queuedA", "queuedB", "paused"]);
  });

  it("keeps analyzing above queued but below downloading", () => {
    const rows = miniRows([job("queued", 1, "q"), job("analyzing", 2, "a")]);
    expect(rows.map((r) => r.id)).toEqual(["a", "q"]);
  });

  it("returns nothing when every job is terminal", () => {
    expect(miniRows([job("done"), job("error"), job("cancelled")])).toEqual([]);
  });
});
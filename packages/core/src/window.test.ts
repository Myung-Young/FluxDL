import { describe, expect, it } from "vitest";
import {
  MINI_HEIGHT,
  MINI_WIDTH,
  NORMAL_BOUNDS,
  WORK_AREA_MARGIN,
  boundsFor,
  centerIn,
  chromeState,
  fitToWorkArea,
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

describe("fixed window size", () => {
  it("is exactly 1180x820 in normal mode and 360x520 in mini mode", () => {
    // D127: one size per mode, the window can never be resized.
    expect(NORMAL_BOUNDS).toEqual({ width: 1180, height: 820 });
    expect(boundsFor(true)).toEqual({ width: 360, height: 520 });
    expect(boundsFor(false)).toEqual(NORMAL_BOUNDS);
  });

  it("never returns a mini size below the compact minimum", () => {
    expect(MINI_WIDTH).toBeGreaterThanOrEqual(320);
    expect(MINI_HEIGHT).toBeGreaterThanOrEqual(420);
  });

  it("carries the theme alongside the mini flag", () => {
    expect(chromeState(true, "paper")).toEqual({ mini: true, theme: "paper" });
    expect(chromeState(false, "obsidian")).toEqual({ mini: false, theme: "obsidian" });
  });
});

describe("fitToWorkArea", () => {
  it("keeps the fixed size on a display with room to spare", () => {
    // The author's two monitors: 2560x1440 and 1920x1080.
    expect(fitToWorkArea(NORMAL_BOUNDS, { width: 2560, height: 1392 })).toEqual({
      width: 1180,
      height: 820,
    });
    expect(fitToWorkArea(NORMAL_BOUNDS, { width: 1920, height: 1032 })).toEqual({
      width: 1180,
      height: 820,
    });
  });

  it("shrinks to fit a 1366x768 laptop instead of overflowing", () => {
    // Width still fits (1286 available), height does not (648 available).
    const fitted = fitToWorkArea(NORMAL_BOUNDS, { width: 1366, height: 728 });
    expect(fitted).toEqual({ width: 1180, height: 648 });
    expect(fitted.height).toBeLessThanOrEqual(728);
  });

  it("shrinks on a 150% scaled 1920x1080 panel (1280x720 DIP)", () => {
    expect(fitToWorkArea(NORMAL_BOUNDS, { width: 1280, height: 720 })).toEqual({
      width: 1180,
      height: 640,
    });
  });

  it("never grows a size and never returns zero", () => {
    const huge = fitToWorkArea({ width: 360, height: 520 }, { width: 3840, height: 2160 });
    expect(huge).toEqual({ width: 360, height: 520 });
    const tiny = fitToWorkArea(NORMAL_BOUNDS, { width: 40, height: 30 });
    expect(tiny).toEqual({ width: 1, height: 1 });
    expect(fitToWorkArea(NORMAL_BOUNDS, { width: 100, height: 100 }, 0)).toEqual({
      width: 100,
      height: 100,
    });
  });

  it("defaults to a 40px margin on every side", () => {
    expect(fitToWorkArea(NORMAL_BOUNDS, { width: 1260, height: 900 })).toEqual({
      width: 1180,
      height: 820,
    });
    expect(WORK_AREA_MARGIN).toBe(40);
  });
});

describe("centerIn", () => {
  it("centers the fixed window on the work area", () => {
    expect(centerIn({ x: 0, y: 0, width: 2560, height: 1392 }, { width: 1180, height: 820 })).toEqual({
      x: 690,
      y: 286,
    });
  });

  it("accounts for a secondary monitor's origin", () => {
    // A left-hand 1920x1080 display starting at x = -1920, y = 0. Negative
    // coordinates are real on-screen positions, so they must survive.
    const origin = centerIn({ x: -1920, y: 0, width: 1920, height: 1040 }, { width: 1180, height: 820 });
    expect(origin).toEqual({ x: -1550, y: 110 });
  });

  it("pins to the origin when the window is as large as the display", () => {
    // Larger than the display on both axes: keep the top-left reachable.
    expect(centerIn({ x: -400, y: -300, width: 300, height: 200 }, { width: 1180, height: 820 })).toEqual({
      x: -400,
      y: -300,
    });
    // Full height, but 100px of slack on the width.
    expect(centerIn({ x: 0, y: 0, width: 1280, height: 700 }, { width: 1180, height: 700 })).toEqual({
      x: 50,
      y: 0,
    });
  });

  it("never overflows the far edge of the work area", () => {
    const area = { x: 0, y: 0, width: 1280, height: 700 };
    const origin = centerIn(area, { width: 1180, height: 640 });
    expect(origin.x + 1180).toBeLessThanOrEqual(area.width);
    expect(origin.y + 640).toBeLessThanOrEqual(area.height);
    expect(origin).toEqual({ x: 50, y: 30 });
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
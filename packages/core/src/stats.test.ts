import { describe, expect, it } from "vitest";
import { computeStats, formatTotalDuration, startOfDay, startOfWeek, weekLabel } from "./stats.js";
import type { DownloadJob } from "./types.js";

const NOW = new Date(2026, 9, 3, 12, 0, 0).getTime(); // Sat 3 Oct 2026, local

interface Over {
  readonly status?: DownloadJob["status"];
  readonly createdAt?: number;
  readonly finishedAt?: number | null;
  readonly totalBytes?: number | null;
  readonly downloadedBytes?: number | null;
  readonly uploader?: string | null;
  readonly durationSec?: number | null;
  readonly kind?: "video" | "audio";
  readonly videoPreset?: DownloadJob["preset"]["videoPreset"];
  readonly audioPreset?: DownloadJob["preset"]["audioPreset"];
}

function rec(id: string, over: Over = {}): DownloadJob {
  return {
    id,
    url: `https://youtu.be/${id}`,
    title: `Title ${id}`,
    preset: {
      kind: over.kind ?? "video",
      videoPreset: over.videoPreset ?? "1080",
      audioPreset: over.audioPreset ?? "MP3",
      rawFormat: null,
    },
    outputDir: "C:\\Vids",
    status: over.status ?? "done",
    progress: 100,
    speed: null,
    eta: null,
    downloadedBytes: over.downloadedBytes ?? null,
    totalBytes: over.totalBytes ?? null,
    stage: "done",
    error: null,
    createdAt: over.createdAt ?? NOW,
    attempts: 0,
    nextRetryAt: null,
    destination: `C:\\Vids\\${id}.mp4`,
    ...(over.finishedAt !== undefined ? { finishedAt: over.finishedAt } : {}),
    ...(over.uploader !== undefined ? { uploader: over.uploader } : {}),
    ...(over.durationSec !== undefined ? { durationSec: over.durationSec } : {}),
  };
}

describe("week helpers", () => {
  it("snaps to local midnight", () => {
    expect(startOfDay(NOW)).toBe(new Date(2026, 9, 3, 0, 0, 0, 0).getTime());
  });

  it("snaps to Monday (never Sunday)", () => {
    // Saturday 3 Oct 2026 -> Monday 28 Sep 2026.
    expect(startOfWeek(NOW)).toBe(new Date(2026, 8, 28, 0, 0, 0, 0).getTime());
    // Sunday belongs to the week that started six days earlier.
    const sunday = new Date(2026, 8, 27, 23, 59, 0, 0).getTime();
    expect(startOfWeek(sunday)).toBe(new Date(2026, 8, 21, 0, 0, 0, 0).getTime());
    // Monday maps to itself.
    const monday = new Date(2026, 8, 28, 0, 0, 0, 0).getTime();
    expect(startOfWeek(monday)).toBe(monday);
  });

  it("labels a week by its Monday date", () => {
    expect(weekLabel(new Date(2026, 8, 29).getTime())).toBe("29 Sep");
  });
});

describe("computeStats", () => {
  it("reports an empty history", () => {
    const stats = computeStats([], NOW);
    expect(stats.empty).toBe(true);
    expect(stats.completed).toBe(0);
    expect(stats.totalBytes).toBeNull();
    expect(stats.totalDurationSec).toBeNull();
    expect(stats.weeks).toHaveLength(12);
    expect(stats.weeks.every((w) => w.count === 0)).toBe(true);
  });

  it("separates completed, failed and cancelled", () => {
    const stats = computeStats(
      [
        rec("a"),
        rec("b", { status: "error" }),
        rec("c", { status: "cancelled" }),
        rec("d", { status: "done" }),
      ],
      NOW,
    );
    expect(stats.completed).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.cancelled).toBe(1);
    expect(stats.empty).toBe(false);
  });

  it("sums sizes from totalBytes, falling back to downloadedBytes", () => {
    const stats = computeStats(
      [rec("a", { totalBytes: 1000 }), rec("b", { downloadedBytes: 500 })],
      NOW,
    );
    expect(stats.totalBytes).toBe(1500);
    expect(stats.unknownSizeCount).toBe(0);
  });

  it("counts unknown sizes/durations instead of pretending they are zero", () => {
    const stats = computeStats([rec("a", { totalBytes: null, durationSec: null })], NOW);
    expect(stats.totalBytes).toBeNull();
    expect(stats.totalDurationSec).toBeNull();
    expect(stats.unknownSizeCount).toBe(1);
    expect(stats.unknownDurationCount).toBe(1);
  });

  it("mixes known and unknown: known sums, unknown counted", () => {
    const stats = computeStats(
      [
        rec("a", { totalBytes: 2000, durationSec: 60 }),
        rec("b", { totalBytes: null, durationSec: null }),
        rec("c", { totalBytes: 3000, durationSec: 120 }),
      ],
      NOW,
    );
    expect(stats.totalBytes).toBe(5000);
    expect(stats.totalDurationSec).toBe(180);
    expect(stats.unknownSizeCount).toBe(1);
    expect(stats.unknownDurationCount).toBe(1);
  });

  it("buckets by finishedAt, not createdAt", () => {
    // Enqueued weeks ago, finished today: the bucket must follow finishedAt.
    const old = NOW - 40 * 86_400_000;
    const stats = computeStats([rec("a", { createdAt: old, finishedAt: NOW })], NOW);
    expect(stats.weeks[stats.weeks.length - 1]?.count).toBe(1);
  });

  it("falls back to createdAt when finishedAt is absent (v1.0-v1.3 records)", () => {
    const lastWeek = NOW - 7 * 86_400_000;
    const stats = computeStats([rec("a", { createdAt: lastWeek })], NOW);
    expect(stats.weeks[stats.weeks.length - 2]?.count).toBe(1);
  });

  it("ignores records older than the visible window", () => {
    const ancient = NOW - 200 * 86_400_000;
    const stats = computeStats([rec("a", { createdAt: ancient })], NOW);
    expect(stats.completed).toBe(1);
    expect(stats.weeks.every((w) => w.count === 0)).toBe(true);
  });

  it("ignores a finishedAt in the future (clock skew)", () => {
    const stats = computeStats([rec("a", { finishedAt: NOW + 30 * 86_400_000 })], NOW);
    expect(stats.weeks.every((w) => w.count === 0)).toBe(true);
  });

  it("orders weeks oldest to newest", () => {
    const stats = computeStats([], NOW);
    for (let i = 1; i < stats.weeks.length; i += 1) {
      const prev = stats.weeks[i - 1];
      const cur = stats.weeks[i];
      expect(prev?.start).toBeLessThan(cur?.start ?? 0);
    }
  });

  it("ranks top uploaders and skips unknown ones", () => {
    const stats = computeStats(
      [
        rec("a", { uploader: "Alpha" }),
        rec("b", { uploader: "Alpha" }),
        rec("c", { uploader: "Beta" }),
        rec("d", { uploader: null }),
        rec("e", { uploader: "   " }),
      ],
      NOW,
    );
    expect(stats.topUploaders).toEqual([
      { name: "Alpha", count: 2 },
      { name: "Beta", count: 1 },
    ]);
  });

  it("caps top uploaders at five", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      rec(`u${String(i)}`, { uploader: `Chan ${String(i)}` }),
    );
    expect(computeStats(many, NOW).topUploaders).toHaveLength(5);
  });

  it("mixes audio and video presets, most used first", () => {
    const stats = computeStats(
      [
        rec("a"),
        rec("b"),
        rec("c", { kind: "audio", audioPreset: "FLAC" }),
      ],
      NOW,
    );
    expect(stats.presets[0]).toEqual({ label: "Video · 1080", count: 2 });
    expect(stats.presets[1]).toEqual({ label: "Audio · FLAC", count: 1 });
  });

  it("counts presets across all outcomes, not just completed ones", () => {
    const stats = computeStats([rec("a"), rec("b", { status: "error" })], NOW);
    expect(stats.presets).toEqual([{ label: "Video · 1080", count: 2 }]);
  });
});

describe("formatTotalDuration", () => {
  it("scales the unit to the magnitude", () => {
    expect(formatTotalDuration(0)).toBe("0 s");
    expect(formatTotalDuration(45)).toBe("45 s");
    expect(formatTotalDuration(90)).toBe("1 min");
    expect(formatTotalDuration(3600)).toBe("1 h 0 min");
    expect(formatTotalDuration(11520)).toBe("3 h 12 min");
  });

  it("never renders a negative duration", () => {
    expect(formatTotalDuration(-5)).toBe("0 s");
  });
});
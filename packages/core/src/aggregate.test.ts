import { describe, expect, it } from "vitest";
import {
  aggregateStatus,
  formatEta,
  formatSpeedBps,
  formatWindowTitle,
  queueEta,
  shouldSendAggregate,
} from "./aggregate.js";
import { parseSpeedBps } from "./progress.js";
import type { DownloadJob } from "./types.js";

function job(over: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "a",
    url: "https://example.com/a",
    title: "A",
    preset: { kind: "video", videoPreset: "720", audioPreset: "MP3", rawFormat: null },
    outputDir: "C:\\Vids",
    status: "queued",
    progress: 0,
    speed: null,
    eta: null,
    downloadedBytes: null,
    totalBytes: null,
    stage: null,
    error: null,
    createdAt: 1,
    attempts: 0,
    nextRetryAt: null,
    destination: null,
    ...over,
  };
}

describe("parseSpeedBps", () => {
  it("parses yt-dlp speed strings", () => {
    expect(parseSpeedBps("3.35MiB/s")).toBeCloseTo(3.35 * 1024 ** 2, 0);
    expect(parseSpeedBps("512KiB/s")).toBe(512 * 1024);
    expect(parseSpeedBps("1M/s")).toBe(1024 ** 2);
    expect(parseSpeedBps("2.5 GB/s")).toBeCloseTo(2.5 * 1024 ** 3, 0);
    expect(parseSpeedBps(null)).toBeNull();
    expect(parseSpeedBps("NA")).toBeNull();
    expect(parseSpeedBps("Unknown")).toBeNull();
    expect(parseSpeedBps("fast")).toBeNull();
  });
});

describe("aggregateStatus", () => {
  it("counts active/queued, means downloading percents, sums speed", () => {
    const agg = aggregateStatus([
      job({ id: "a", status: "downloading", progress: 20, speed: "1MiB/s" }),
      job({ id: "b", status: "downloading", progress: 60, speed: "3MiB/s" }),
      job({ id: "c", status: "queued" }),
      job({ id: "d", status: "done" }),
    ]);
    expect(agg.active).toBe(2);
    expect(agg.queued).toBe(1);
    expect(agg.percent).toBe(40);
    expect(agg.speedBps).toBe(4 * 1024 ** 2);
  });

  it("returns null percent when idle or when only analyzing/processing", () => {
    expect(aggregateStatus([]).percent).toBeNull();
    expect(
      aggregateStatus([
        job({ status: "analyzing" }),
        job({ id: "p", status: "processing", progress: 100 }),
      ]).percent,
    ).toBeNull();
  });
});

describe("formatSpeedBps", () => {
  it("formats bytes/s for the aggregate line", () => {
    expect(formatSpeedBps(0)).toBe("0 B/s");
    expect(formatSpeedBps(512)).toBe("512 B/s");
    expect(formatSpeedBps(1536)).toBe("1.5 KB/s");
    expect(formatSpeedBps(12.4 * 1024 ** 2)).toBe("12.4 MB/s");
    expect(formatSpeedBps(Number.NaN)).toBe("-");
  });

  it("localizes decimals via Intl", () => {
    const decimals = new Intl.NumberFormat("ms-MY", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: false,
    }).format(12.4);
    expect(formatSpeedBps(12.4 * 1024 ** 2, "ms-MY")).toBe(`${decimals} MB/s`);
  });
});

describe("shouldSendAggregate", () => {
  it("gates sends to 4/s with an injected clock", () => {
    expect(shouldSendAggregate(null, 1000)).toBe(true);
    expect(shouldSendAggregate(1000, 1000)).toBe(false);
    expect(shouldSendAggregate(1000, 1249)).toBe(false);
    expect(shouldSendAggregate(1000, 1250)).toBe(true);
  });
});

describe("queueEta", () => {
  it("sums remaining bytes and divides by the aggregate speed", () => {
    const eta = queueEta(
      [
        job({ id: "a", status: "downloading", downloadedBytes: 40, totalBytes: 100 }),
        job({ id: "b", status: "queued", downloadedBytes: null, totalBytes: 200 }),
        job({ id: "c", status: "done", downloadedBytes: 50, totalBytes: 50 }),
      ],
      130,
    );
    expect(eta?.remainingBytes).toBe(260);
    expect(eta?.etaSeconds).toBe(2);
  });

  it("returns null ETA seconds while the speed is unknown", () => {
    const eta = queueEta([job({ status: "downloading", totalBytes: 100 })], 0);
    expect(eta?.remainingBytes).toBe(100);
    expect(eta?.etaSeconds).toBeNull();
  });

  it("returns null when no job has a known size", () => {
    expect(queueEta([job({ status: "downloading" })], 100)).toBeNull();
    expect(queueEta([], 100)).toBeNull();
  });
});

describe("formatEta", () => {
  it("formats m:ss and h:mm:ss, dash when unknown", () => {
    expect(formatEta(75)).toBe("1:15");
    expect(formatEta(3720)).toBe("1:02:00");
    expect(formatEta(null)).toBe("—");
    expect(formatEta(-5)).toBe("—");
  });
});

describe("formatWindowTitle", () => {
  it("prefixes the active count, plain name when idle", () => {
    expect(formatWindowTitle(0, "FluxDL")).toBe("FluxDL");
    expect(formatWindowTitle(3, "FluxDL")).toBe("(3) FluxDL");
    expect(formatWindowTitle(-2, "FluxDL")).toBe("FluxDL");
    expect(formatWindowTitle(Number.NaN, "FluxDL")).toBe("FluxDL");
  });
});

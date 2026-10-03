import { describe, expect, it } from "vitest";
import { chunkDestinations, deriveMissingIds } from "./health.js";
import type { DownloadJob } from "./types.js";

function record(id: string, destination: string | null): DownloadJob {
  return {
    id,
    url: "https://example.com/a",
    title: "A",
    preset: { kind: "video", videoPreset: "720", audioPreset: "MP3", rawFormat: null },
    outputDir: "C:\\Vids",
    status: "done",
    progress: 100,
    speed: null,
    eta: null,
    downloadedBytes: 1,
    totalBytes: 1,
    stage: "done",
    error: null,
    createdAt: 1,
    attempts: 0,
    nextRetryAt: null,
    destination,
  };
}

describe("deriveMissingIds", () => {
  it("flags only checked-and-missing destinations", () => {
    const records = [
      record("a", "C:\\Vids\\a.mp4"),
      record("b", "C:\\Vids\\b.mp4"),
      record("c", null),
    ];
    const missing = deriveMissingIds(
      records,
      new Map([
        ["C:\\Vids\\a.mp4", true],
        ["C:\\Vids\\b.mp4", false],
      ]),
    );
    expect([...missing]).toEqual(["b"]);
  });

  it("ignores unchecked destinations", () => {
    expect(deriveMissingIds([record("a", "C:\\Vids\\a.mp4")], new Map()).size).toBe(0);
  });
});

describe("chunkDestinations", () => {
  it("dedupes and chunks", () => {
    const records = [
      record("a", "C:\\1.mp4"),
      record("b", "C:\\1.mp4"),
      record("c", "C:\\2.mp4"),
      record("d", null),
    ];
    expect(chunkDestinations(records, 40)).toEqual([["C:\\1.mp4", "C:\\2.mp4"]]);
    expect(chunkDestinations(records, 1)).toEqual([["C:\\1.mp4"], ["C:\\2.mp4"]]);
    expect(chunkDestinations([], 40)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { exportBackup, parseBackup } from "./backup.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import type { DownloadJob } from "./types.js";

function job(over: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "j1",
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

describe("backup", () => {
  it("round-trips settings, queue and history", () => {
    const text = exportBackup(DEFAULT_SETTINGS, [job()], [job({ id: "h1", status: "done" })]);
    const parsed = parseBackup(text);
    expect(parsed.queue).toHaveLength(1);
    expect(parsed.history).toHaveLength(1);
    expect(parsed.dropped).toBe(0);
    expect(parsed.settings.concurrency).toBe(DEFAULT_SETTINGS.concurrency);
  });

  it("re-queues in-flight jobs and drops garbage", () => {
    const text = exportBackup(
      DEFAULT_SETTINGS,
      [job({ status: "downloading", speed: "1M/s" }), { nope: 1 } as never],
      [],
    );
    const parsed = parseBackup(text);
    expect(parsed.queue).toHaveLength(1);
    expect(parsed.queue[0]?.status).toBe("queued");
    expect(parsed.queue[0]?.speed).toBeNull();
    expect(parsed.dropped).toBe(1);
  });

  it("rejects non-backup files loudly", () => {
    expect(() => parseBackup("not json")).toThrow(/backup/);
    expect(() => parseBackup(`{"app":"Other"}`)).toThrow(/backup/);
  });
});

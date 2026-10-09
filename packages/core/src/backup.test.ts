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

  it("carries the watchlist and strips secrets on export", () => {
    const withSecrets = {
      ...DEFAULT_SETTINGS,
      proxy: "http://user:pass@host:8080",
      cookiesFile: "C:\\cookies.txt",
      cookiesFromBrowser: "chrome",
    };
    const text = exportBackup(withSecrets, [], [], [
      {
        url: "https://www.youtube.com/@x/videos",
        title: "x",
        lastVideoId: null,
        lastCheckedAt: null,
        mode: "auto",
        folder: null,
        preset: null,
        engine: null,
        intervalMin: 30,
        paused: false,
        failCount: 0,
        autoDisabled: false,
      },
    ]);
    const raw = JSON.parse(text) as Record<string, unknown>;
    expect(raw["redacted"]).toEqual(["proxy", "cookiesFile", "cookiesFromBrowser"]);
    const payload = raw["settings"] as Record<string, unknown>;
    expect(payload["proxy"]).toBeNull();
    expect(payload["cookiesFile"]).toBeNull();
    expect(payload["cookiesFromBrowser"]).toBeNull();
    const parsed = parseBackup(text);
    expect(parsed.watchlist).toHaveLength(1);
    expect(parsed.watchlist[0]).toMatchObject({ mode: "auto", intervalMin: 30 });
    expect(parsed.settings.proxy).toBeNull();
    // Old backups without a watchlist still load.
    const legacy = parseBackup(`{"app":"FluxDL","version":1,"settings":{},"queue":[],"history":[]}`);
    expect(legacy.watchlist).toEqual([]);
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

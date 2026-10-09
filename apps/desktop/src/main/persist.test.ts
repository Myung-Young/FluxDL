import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendHistoryToDisk,
  clearHistoryOnDisk,
  consumeRecoveryNotices,
  isDownloadJob,
  loadHistoryFromDisk,
  loadQueueFromDisk,
  loadSettingsFromDisk,
  loadWatchlistFromDisk,
  removeHistoryFromDisk,
  pruneHistoryText,
  restoreHistoryToDisk,
  saveQueueToDisk,
  saveSettingsToDisk,
  saveWatchlistToDisk,
  updateHistoryOnDisk,
} from "./persist.js";
import type { DownloadJob } from "@grabber/core/types.js";

function dir(suffix: string): string {
  const base = mkdtempSync(join(tmpdir(), `grabber-persist-${suffix}-`));
  return join(base, "my data münchen 輸入");
}

function job(id: string): DownloadJob {
  return {
    id,
    url: "https://youtu.be/aqz-KE-bpKQ",
    title: `Video ${id}`,
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
    destination: null,
  };
}

describe("persist", () => {
  it("round-trips settings and sanitizes bad values", () => {
    const d = dir("settings");
    expect(loadSettingsFromDisk(d).concurrency).toBe(2);
    const saved = saveSettingsToDisk(d, { concurrency: 5, theme: "ember" });
    expect(saved.concurrency).toBe(5);
    expect(loadSettingsFromDisk(d).theme).toBe("ember");
    expect(saveSettingsToDisk(d, { concurrency: 99 }).concurrency).toBe(5);
  });

  it("quarantines corrupt stores and reports them for the UI notice", async () => {
    consumeRecoveryNotices();
    const d = dir("quarantine");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "grabber-settings.json"), "{not json");
    writeFileSync(join(d, "queue.json"), "[{bad");
    writeFileSync(join(d, "watchlist.json"), "{nope");
    expect(loadSettingsFromDisk(d).concurrency).toBe(2);
    expect(await loadQueueFromDisk(d)).toEqual([]);
    expect(await loadWatchlistFromDisk(d)).toEqual([]);
    // Evidence preserved next to the reset files.
    const leftovers = (await import("node:fs")).readdirSync(d);
    expect(leftovers.filter((f) => f.includes(".corrupt-"))).toHaveLength(3);
    const notices = consumeRecoveryNotices();
    expect(notices.map((n) => n.kind).sort()).toEqual(["queue", "settings", "watchlist"]);
    expect(notices.every((n) => typeof n.backup === "string")).toBe(true);
    // Drained: second consume is empty.
    expect(consumeRecoveryNotices()).toEqual([]);
  });

  it("round-trips the queue snapshot, even with spaces/unicode dirs", async () => {
    const d = dir("queue");
    expect(await loadQueueFromDisk(d)).toEqual([]);
    await saveQueueToDisk(d, [job("a"), { ...job("b"), status: "downloading" }]);
    const loaded = await loadQueueFromDisk(d);
    expect(loaded.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("returns [] for corrupt queue snapshots", async () => {
    const d = dir("queuebad");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "queue.json"), "[{bad");
    expect(await loadQueueFromDisk(d)).toEqual([]);
    writeFileSync(join(d, "queue.json"), JSON.stringify([{ nope: 1 }]));
    expect(await loadQueueFromDisk(d)).toEqual([]);
  });

  it("appends/loads/removes/clears JSONL history, skipping bad lines", async () => {
    const d = dir("hist");
    await appendHistoryToDisk(d, job("a"));
    await appendHistoryToDisk(d, { ...job("b"), status: "error", error: "x" });
    mkdirSync(d, { recursive: true });
    const { appendFileSync } = await import("node:fs");
    appendFileSync(join(d, "history.jsonl"), "not-json\n");
    expect((await loadHistoryFromDisk(d)).map((j) => j.id)).toEqual(["a", "b"]);
    await removeHistoryFromDisk(d, "a");
    expect((await loadHistoryFromDisk(d)).map((j) => j.id)).toEqual(["b"]);
    await clearHistoryOnDisk(d);
    expect(await loadHistoryFromDisk(d)).toEqual([]);
  });

  it("replaces one history record in place (file-deleted marks)", async () => {
    const d = dir("histupd");
    await appendHistoryToDisk(d, job("a"));
    await appendHistoryToDisk(d, job("b"));
    await updateHistoryOnDisk(d, { ...job("a"), fileDeleted: true });
    const loaded = await loadHistoryFromDisk(d);
    expect(loaded.map((j) => j.id)).toEqual(["a", "b"]);
    expect(loaded[0]?.fileDeleted).toBe(true);
    expect(loaded[1]?.fileDeleted).toBeUndefined();
  });

  it("trims history to the keep-last-N setting on append", async () => {
    const d = dir("histtrim");
    saveSettingsToDisk(d, { historyLimit: 10 });
    for (let i = 0; i < 15; i += 1) {
      await appendHistoryToDisk(d, job(`j${String(i)}`));
    }
    const loaded = await loadHistoryFromDisk(d);
    expect(loaded).toHaveLength(10);
    expect(loaded[0]?.id).toBe("j5");
    expect(loaded[9]?.id).toBe("j14");
  });

  it("surfaces disk/IO failures instead of silently dropping data", async () => {    await expect(saveQueueToDisk("C:\\bad\0path", [job("a")])).rejects.toThrow();
    await expect(appendHistoryToDisk("C:\\bad\0path", job("a"))).rejects.toThrow();
  });

  it("validates jobs strictly", () => {
    expect(isDownloadJob(job("x"))).toBe(true);
    expect(isDownloadJob(null)).toBe(false);
    expect(isDownloadJob({ id: "x" })).toBe(false);
    expect(isDownloadJob({ ...job("x"), status: "flying" })).toBe(false);
  });

  it("rejects a non-finite timestamp (it crashes the diagnostics report)", () => {
    expect(isDownloadJob({ ...job("x"), createdAt: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isDownloadJob({ ...job("x"), createdAt: Number.NaN })).toBe(false);
    expect(isDownloadJob({ ...job("x"), attempts: Number.NaN })).toBe(false);
  });

  it("pruneHistoryText only rewrites when over the limit", () => {
    const two = '{"a":1}\n{"b":2}\n';
    expect(pruneHistoryText(two, 10)).toBeNull();
    expect(pruneHistoryText(two, 2)).toBeNull();
    expect(pruneHistoryText('{"a":1}\n\n{"b":2}\n{"c":3}\n', 2)).toBe('{"b":2}\n{"c":3}\n');
    // A nonsense limit falls back to the 500 default rather than dropping all.
    expect(pruneHistoryText(two, 0)).toBeNull();
    expect(pruneHistoryText(two, Number.NaN)).toBeNull();
  });

  it("restoreHistoryToDisk replaces the whole history in one write", async () => {
    // v1.7.2: backup restore used to clear-then-append, so a failure mid-loop
    // destroyed the existing history and still reported success.
    const d = dir("histrestore");
    await appendHistoryToDisk(d, job("old-1"));
    await appendHistoryToDisk(d, job("old-2"));
    await restoreHistoryToDisk(d, [job("new-1"), job("new-2"), job("new-3")]);
    expect((await loadHistoryFromDisk(d)).map((j) => j.id)).toEqual([
      "new-1",
      "new-2",
      "new-3",
    ]);
    // Invalid rows are dropped, never written.
    await restoreHistoryToDisk(d, [{ nope: true } as never]);
    expect(await loadHistoryFromDisk(d)).toEqual([]);
    // No temp file left behind.
    expect(existsSync(join(d, "history.jsonl.tmp"))).toBe(false);
  });

  it("a restored history keeps the keep-last-N prune honest", async () => {
    const d = dir("histrestore2");
    saveSettingsToDisk(d, { historyLimit: 10 });
    await restoreHistoryToDisk(
      d,
      Array.from({ length: 25 }, (_, i) => job(`r${String(i)}`)),
    );
    for (let i = 0; i < 3; i += 1) {
      await appendHistoryToDisk(d, job(`post${String(i)}`));
    }
    const loaded = await loadHistoryFromDisk(d);
    expect(loaded).toHaveLength(10);
    expect(loaded[9]?.id).toBe("post2");
  });
});

/**
 * Settings persistence without electron-store (D94).
 *
 * The bug these guard: the main bundle is CommonJS, electron-store v11 is
 * ESM-only, so `new Store()` threw "Store is not a constructor" and every
 * settings write failed *silently* in the packaged app. These tests assert the
 * file actually lands on disk, because "the merge returned an object" was
 * never the failing part.
 */
describe("settings persistence (no electron-store)", () => {
  const FILE = "grabber-settings.json";

  it("creates the file on first save", () => {
    const d = dir("first-save");
    expect(existsSync(join(d, FILE))).toBe(false);
    saveSettingsToDisk(d, { concurrency: 4 });
    expect(existsSync(join(d, FILE))).toBe(true);
    const raw = JSON.parse(readFileSync(join(d, FILE), "utf8")) as Record<string, unknown>;
    expect(raw["concurrency"]).toBe(4);
  });

  it("merges patches instead of replacing the whole object", () => {
    const d = dir("merge-patch");
    saveSettingsToDisk(d, { theme: "paper" });
    saveSettingsToDisk(d, { concurrency: 3 });
    const loaded = loadSettingsFromDisk(d);
    expect(loaded.theme).toBe("paper");
    expect(loaded.concurrency).toBe(3);
  });

  it("keeps Windows paths, % and filename templates byte-exact", () => {
    const d = dir("paths");
    const template = "%(title)s [%(id)s].%(ext)s";
    saveSettingsToDisk(d, {
      downloadDir: "C:\\Users\\P\\Videos\\FluxDL",
      filenameTemplate: template,
    });
    const loaded = loadSettingsFromDisk(d);
    expect(loaded.downloadDir).toBe("C:\\Users\\P\\Videos\\FluxDL");
    expect(loaded.filenameTemplate).toBe(template);
    // And the same bytes on disk (no JSON-escaping round trip surprises).
    const raw = JSON.parse(readFileSync(join(d, FILE), "utf8")) as { downloadDir?: string };
    expect(raw.downloadDir).toBe("C:\\Users\\P\\Videos\\FluxDL");
  });

  it("loads a legacy electron-store file and drops unknown keys", () => {
    const d = dir("legacy");
    mkdirSync(d, { recursive: true });
    // electron-store wrote a flat JSON object; extra keys appear over versions.
    writeFileSync(
      join(d, FILE),
      JSON.stringify({ concurrency: 3, theme: "midnight", removedInV14: "gone", __x: 1 }),
      "utf8",
    );
    const loaded = loadSettingsFromDisk(d);
    expect(loaded.concurrency).toBe(3);
    expect(loaded.theme).toBe("midnight");
    expect("removedInV14" in loaded).toBe(false);
  });

  it("writes atomically and leaves no temp file behind", () => {
    const d = dir("atomic");
    saveSettingsToDisk(d, { concurrency: 5 });
    expect(existsSync(join(d, "grabber-settings.json.tmp"))).toBe(false);
    expect(existsSync(join(d, FILE))).toBe(true);
  });

  it("recovers from a settings file containing a JSON array or null", () => {
    for (const junk of ["[]", "null", '"text"', "123"]) {
      const d = dir(`junk-${junk.replace(/\W/g, "")}`);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, FILE), junk, "utf8");
      expect(loadSettingsFromDisk(d).concurrency).toBe(2);
    }
  });

  it("keeps working when the userData dir has spaces and unicode", () => {
    const d = dir("unicode");
    saveSettingsToDisk(d, { proxy: "http://127.0.0.1:8080" });
    expect(loadSettingsFromDisk(d).proxy).toBe("http://127.0.0.1:8080");
  });

  it("rejects a non-object patch loudly instead of silently ignoring it", () => {
    const d = dir("bad-patch");
    expect(() => saveSettingsToDisk(d, null as never)).toThrow();
    expect(() => saveSettingsToDisk(d, [] as never)).toThrow();
  });
});

describe("watchlist persistence (A6)", () => {
  it("round-trips channels and sanitizes on load", async () => {
    const d = dir("watchlist");
    expect(await loadWatchlistFromDisk(d)).toEqual([]);
    await saveWatchlistToDisk(d, [
      {
        url: "https://example.com/c1",
        title: "C1",
        lastVideoId: "v1",
        lastCheckedAt: 7,
        mode: "notify",
        folder: null,
        preset: null,
        engine: null,
        intervalMin: 60,
        paused: false,
        failCount: 0,
        autoDisabled: false,
      },
    ]);
    const loaded = await loadWatchlistFromDisk(d);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ title: "C1", lastVideoId: "v1" });
    // Legacy rows without subscription fields migrate with safe defaults.
    writeFileSync(join(d, "watchlist.json"), `[{"url": "https://example.com/c2"}]`, "utf8");
    const migrated = await loadWatchlistFromDisk(d);
    expect(migrated[0]).toMatchObject({ mode: "notify", intervalMin: 60, paused: false });
    // Garbage on disk never throws and never survives.
    writeFileSync(join(d, "watchlist.json"), `[{"nope": true}]`, "utf8");
    expect(await loadWatchlistFromDisk(d)).toEqual([]);
  });
});

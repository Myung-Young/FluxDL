import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendHistoryToDisk,
  clearHistoryOnDisk,
  isDownloadJob,
  loadHistoryFromDisk,
  loadQueueFromDisk,
  loadSettingsFromDisk,
  removeHistoryFromDisk,
  saveQueueToDisk,
  saveSettingsToDisk,
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

  it("falls back to defaults on corrupt settings files", () => {
    const d = dir("corrupt");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "grabber-settings.json"), "{not json");
    expect(loadSettingsFromDisk(d).concurrency).toBe(2);
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
});

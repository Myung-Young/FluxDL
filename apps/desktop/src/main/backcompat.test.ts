import { describe, expect, it } from "vitest";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETTINGS, mergeSettings } from "@grabber/core/settings.js";
import {
  loadHistoryFromDisk,
  loadQueueFromDisk,
  loadSettingsFromDisk,
  saveQueueToDisk,
  saveSettingsToDisk,
  updateHistoryOnDisk,
} from "./persist.js";
import type { DownloadJob } from "@grabber/core/types.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "fixtures",
  "v1.0",
);

/**
 * Back-compat contract (rule 2): real v1.0 files must load unchanged.
 * Every new field stays optional with a default through mergeSettings/loaders.
 */
describe("v1.0 fixtures load unchanged", () => {
  it("settings fixture merges through sanitizing defaults", () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, "settings.json"), "utf8")) as unknown;
    expect(raw).toBeTypeOf("object");
    const merged = mergeSettings(
      DEFAULT_SETTINGS,
      raw as Partial<typeof DEFAULT_SETTINGS>,
    );
    expect(merged.downloadDir).toBe("C:\\Users\\P\\Videos\\FluxDL");
    expect(merged.concurrency).toBe(2);
    expect(merged.theme).toBe("obsidian");
    // New fields are absent in v1.0 files and arrive via defaults.
    expect(merged.codecPreference).toBe("auto");
  });

  it("queue + history fixtures load from disk byte-identical in shape", async () => {
    for (const name of ["settings.json", "queue.json", "history.jsonl"]) {
      expect(existsSync(join(FIXTURES, name))).toBe(true);
    }
    const dir = mkdtempSync(join(tmpdir(), "fluxdl-r0-"));
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(FIXTURES, "queue.json"), join(dir, "queue.json"));
    copyFileSync(join(FIXTURES, "history.jsonl"), join(dir, "history.jsonl"));
    // electron-store file name for settings.
    copyFileSync(join(FIXTURES, "settings.json"), join(dir, "grabber-settings.json"));

    const queue = await loadQueueFromDisk(dir);
    expect(queue).toHaveLength(2);
    expect(queue[0]?.status).toBe("queued");
    expect(queue[1]?.status).toBe("downloading");

    const history = await loadHistoryFromDisk(dir);
    expect(history).toHaveLength(2);
    expect(history[0]?.status).toBe("done");
    expect(history[1]?.status).toBe("error");

    const settings = loadSettingsFromDisk(dir);
    expect(settings.downloadDir).toBe("C:\\Users\\P\\Videos\\FluxDL");
    expect(settings.mergeContainer).toBe("mp4");
  });
});

/**
 * v1.4 upgrade test (M4.8). The fixtures carry fields the v1.0 tests never
 * asserted, and v1.4 added optional fields of its own — so this pins the whole
 * round trip: load the real v1.0 files, keep every value, gain sane defaults,
 * write them back out, and reload without drift.
 */
describe("v1.0 -> v1.4 upgrade", () => {
  function stage(): string {
    const dir = mkdtempSync(join(tmpdir(), "fluxdl-upgrade-"));
    copyFileSync(join(FIXTURES, "queue.json"), join(dir, "queue.json"));
    copyFileSync(join(FIXTURES, "history.jsonl"), join(dir, "history.jsonl"));
    copyFileSync(join(FIXTURES, "settings.json"), join(dir, "grabber-settings.json"));
    return dir;
  }

  it("keeps every field the v1.0 queue fixture actually recorded", async () => {
    const dir = stage();
    try {
      const queue = await loadQueueFromDisk(dir);
      expect(queue).toHaveLength(2);

      const queued = queue[0];
      expect(queued?.status).toBe("queued");
      expect(queued?.preset).toEqual({
        kind: "video",
        videoPreset: "1080",
        audioPreset: "MP3",
        rawFormat: null,
      });
      expect(queued?.progress).toBe(0);
      expect(queued?.speed).toBeNull();
      expect(queued?.eta).toBeNull();
      expect(queued?.totalBytes).toBeNull();
      expect(queued?.destination).toBeNull();
      expect(queued?.attempts).toBe(0);

      // Fractional progress + a .part destination + an audio preset: the three
      // shapes most likely to be mangled by a migration.
      const downloading = queue[1];
      expect(downloading?.status).toBe("downloading");
      expect(downloading?.progress).toBe(37.5);
      expect(downloading?.speed).toBe("1.2MiB/s");
      expect(downloading?.eta).toBe("00:42");
      expect(downloading?.downloadedBytes).toBe(1048576);
      expect(downloading?.totalBytes).toBe(2796202);
      expect(downloading?.destination?.endsWith(".mp4.part")).toBe(true);
      expect(downloading?.preset.kind).toBe("audio");
      expect(downloading?.attempts).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps completed bytes and the backoff state in history", async () => {
    const dir = stage();
    try {
      const history = await loadHistoryFromDisk(dir);

      const done = history[0];
      expect(done?.status).toBe("done");
      expect(done?.progress).toBe(100);
      expect(done?.totalBytes).toBe(1583767);
      expect(done?.downloadedBytes).toBe(1583767);
      expect(done?.destination).toContain("Big Buck Bunny");
      expect(done?.preset.videoPreset).toBe("720");

      const failed = history[1];
      expect(failed?.status).toBe("error");
      expect(failed?.attempts).toBe(3);
      expect(failed?.nextRetryAt).toBe(1759192816000);
      expect(failed?.error).toContain("Network error");
      expect(failed?.preset.kind).toBe("audio");
      expect(failed?.preset.audioPreset).toBe("Opus");
      expect(failed?.destination).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves v1.4-only fields absent rather than inventing values", async () => {
    const dir = stage();
    try {
      const history = await loadHistoryFromDisk(dir);
      for (const record of history) {
        // Stats fields (M4.5) must stay undefined so the UI can say "unknown".
        expect(record.finishedAt).toBeUndefined();
        expect(record.uploader).toBeUndefined();
        expect(record.durationSec).toBeUndefined();
        // Live/chapter/metadata flags (M4.1-M4.3).
        expect(record.liveStatus).toBeUndefined();
        expect(record.splitChapters).toBeUndefined();
        expect(record.audioMetadata).toBeUndefined();
        expect(record.fileDeleted).toBeUndefined();
        expect(record.errorCategory).toBeUndefined();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("survives a write-back + reload with no drift (queue and history)", async () => {
    const dir = stage();
    try {
      const queue = await loadQueueFromDisk(dir);
      await saveQueueToDisk(dir, queue);
      const reloadedQueue = await loadQueueFromDisk(dir);
      expect(reloadedQueue).toEqual(queue);

      const history = await loadHistoryFromDisk(dir);
      await updateHistoryOnDisk(dir, { ...(history[0] as DownloadJob), fileDeleted: true });
      const reloadedHistory = await loadHistoryFromDisk(dir);
      expect(reloadedHistory).toHaveLength(2);
      expect(reloadedHistory[0]?.fileDeleted).toBe(true);
      expect(reloadedHistory[1]).toEqual(history[1]);
      // Nothing was lost or reordered by the rewrite.
      expect(reloadedHistory.map((h) => h.id)).toEqual(history.map((h) => h.id));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("settings round-trip: v1.0 file -> v1.4 defaults -> saved -> reloaded", () => {
    const dir = stage();
    try {
      const merged = loadSettingsFromDisk(dir);
      expect(merged.downloadDir).toBe("C:\\Users\\P\\Videos\\FluxDL");
      // Defaults for everything added since v1.0.
      expect(merged.density).toBe("comfortable");
      expect(merged.language).toBe("auto");
      expect(merged.historyLimit).toBe(500);
      expect(merged.skipArchived).toBe(true);
      expect(merged.thumbnailAccent).toBe(true);
      expect(merged.defaultPreset.kind).toBe("video");
      expect(merged.onboardingDone).toBe(false);

      saveSettingsToDisk(dir, { ...merged, theme: "paper", historyLimit: 250 });
      const reloaded = loadSettingsFromDisk(dir);
      expect(reloaded.theme).toBe("paper");
      expect(reloaded.historyLimit).toBe(250);
      expect(reloaded.downloadDir).toBe("C:\\Users\\P\\Videos\\FluxDL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a v1.0-shaped file that is missing required fields", async () => {
    const dir = stage();
    try {
      const good = await loadQueueFromDisk(dir);
      expect(good).toHaveLength(2);
      await writeFile(join(dir, "queue.json"), JSON.stringify([{ id: "x" }]), "utf8");
      expect(await loadQueueFromDisk(dir)).toEqual([]);
      await writeFile(join(dir, "queue.json"), "{ not json", "utf8");
      expect(await loadQueueFromDisk(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads the v1.0 fixtures from a path containing spaces (installer default)", async () => {
    const base = mkdtempSync(join(tmpdir(), "fluxdl-upgrade-"));
    const dir = join(base, "Programs", "FluxDL Data");
    mkdirSync(dir, { recursive: true });
    try {
      copyFileSync(join(FIXTURES, "queue.json"), join(dir, "queue.json"));
      copyFileSync(join(FIXTURES, "history.jsonl"), join(dir, "history.jsonl"));
      copyFileSync(join(FIXTURES, "settings.json"), join(dir, "grabber-settings.json"));
      expect(await loadQueueFromDisk(dir)).toHaveLength(2);
      expect(await loadHistoryFromDisk(dir)).toHaveLength(2);
      expect(loadSettingsFromDisk(dir).mergeContainer).toBe("mp4");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

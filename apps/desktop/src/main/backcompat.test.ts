import { describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETTINGS, mergeSettings } from "@grabber/core/settings.js";
import {
  loadHistoryFromDisk,
  loadQueueFromDisk,
  loadSettingsFromDisk,
} from "./persist.js";

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
    // Unknown future keys never leak through; missing future keys get defaults.
    expect("codecPreference" in merged).toBe(false);
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

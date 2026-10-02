import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopEngine, archivePathFor, isAllowedPath } from "./desktopEngine.js";
import { appendHistoryToDisk, saveSettingsToDisk } from "./persist.js";
import type { DownloadJob } from "@grabber/core/types.js";

function dir(suffix: string): string {
  return mkdtempSync(join(tmpdir(), `fluxdl-trust-${suffix}-`));
}

function historyJob(destination: string): DownloadJob {
  return {
    id: "h1",
    url: "https://example.com/v",
    title: "V",
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

describe("isAllowedPath (renderer trust boundary)", () => {
  it("allows files inside the download dir, rejects escapes", async () => {
    const d = dir("roots");
    const downloads = join(d, "My Videos");
    mkdirSync(downloads, { recursive: true });
    saveSettingsToDisk(d, { downloadDir: downloads });
    expect(await isAllowedPath(d, join(d, "os-downloads"), [], join(downloads, "a.mp4"))).toBe(
      true,
    );
    expect(await isAllowedPath(d, join(d, "os-downloads"), [], join(d, "evil.mp4"))).toBe(false);
    expect(
      await isAllowedPath(d, join(d, "os-downloads"), [], join(downloads, "..", "evil.mp4")),
    ).toBe(false);
    expect(await isAllowedPath(d, join(d, "os-downloads"), [], "")).toBe(false);
    // Case-insensitive roots on Windows.
    expect(await isAllowedPath(d, join(d, "os-downloads"), [], join(downloads.toUpperCase(), "A.MP4"))).toBe(
      true,
    );
  });

  it("allows known active/history destinations outside the roots", async () => {
    const d = dir("known");
    const outside = join(d, "elsewhere", "v.mp4");
    mkdirSync(join(d, "elsewhere"), { recursive: true });
    writeFileSync(outside, "x");
    await appendHistoryToDisk(d, historyJob(outside));
    expect(await isAllowedPath(d, join(d, "dl"), [], outside)).toBe(true);
    expect(await isAllowedPath(d, join(d, "dl"), [outside], join(d, "nope.mp4"))).toBe(false);
    expect(await isAllowedPath(d, join(d, "dl"), [outside], outside)).toBe(true);
  });

  it("archive path lives in userData", () => {
    expect(archivePathFor("C:\\Data")).toBe(join("C:\\Data", "archive.txt"));
  });

  it("trashFile rejects paths outside the allowed roots (never reaches shell)", async () => {
    const d = dir("trash");
    const engine = new DesktopEngine({
      userDataDir: d,
      bundledBinDir: join(d, "bundled-missing"),
      appVersion: "0.0.0-test",
      defaultOutputDir: join(d, "dl"),
      broadcast: () => undefined,
      onAggregate: () => undefined,
    });
    await expect(engine.trashFile(join(d, "..", "evil.mp4"))).rejects.toThrow(/outside/);
    await expect(engine.trashFile("")).rejects.toThrow();
  });
});

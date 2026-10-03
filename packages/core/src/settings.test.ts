import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings.js";

describe("mergeSettings", () => {
  it("clamps concurrency to 1-5 and keeps the rest", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { concurrency: 99 }).concurrency).toBe(5);
    expect(mergeSettings(DEFAULT_SETTINGS, { concurrency: 0 }).concurrency).toBe(1);
    expect(mergeSettings(DEFAULT_SETTINGS, {}).concurrency).toBe(2);
  });

  it("sanitizes enums, strings, and booleans without throwing", () => {
    const m = mergeSettings(DEFAULT_SETTINGS, {
      theme: "neon" as never,
      postDownloadAction: "explode" as never,
      filenameTemplate: "   ",
      speedLimit: "  4.2M  ",
      proxy: "",
      embedThumbnail: "yes" as never,
    });
    expect(m.theme).toBe("obsidian");
    expect(m.postDownloadAction).toBe("none");
    expect(m.filenameTemplate).toBe(DEFAULT_SETTINGS.filenameTemplate);
    expect(m.speedLimit).toBe("4.2M");
    expect(m.proxy).toBeNull();
    expect(m.embedThumbnail).toBe(false);
  });
  it("defaults codec/archived preferences and sanitizes them", () => {    expect(DEFAULT_SETTINGS.codecPreference).toBe("auto");
    expect(DEFAULT_SETTINGS.skipArchived).toBe(true);
    const m = mergeSettings(DEFAULT_SETTINGS, {
      codecPreference: "vorbis" as never,
      skipArchived: "yes" as never,
    });
    expect(m.codecPreference).toBe("auto");
    expect(m.skipArchived).toBe(true);
    expect(mergeSettings(DEFAULT_SETTINGS, { skipArchived: false }).skipArchived).toBe(false);
  });

  it("preserves untouched fields and downloadDir verbatim", () => {
    const m = mergeSettings(DEFAULT_SETTINGS, {
      downloadDir: "C:\\My Videos\\münchen",
      subtitles: true,
    });
    expect(m.downloadDir).toBe("C:\\My Videos\\münchen");
    expect(m.subtitles).toBe(true);
    expect(m.mergeContainer).toBe("mp4");
  });

  it("clamps the analyze timeout to 10–300 seconds", () => {
    expect(DEFAULT_SETTINGS.analyzeTimeoutSec).toBe(60);
    expect(mergeSettings(DEFAULT_SETTINGS, { analyzeTimeoutSec: 5 }).analyzeTimeoutSec).toBe(10);
    expect(mergeSettings(DEFAULT_SETTINGS, { analyzeTimeoutSec: 999 }).analyzeTimeoutSec).toBe(
      300,
    );
    expect(
      mergeSettings(DEFAULT_SETTINGS, { analyzeTimeoutSec: Number.NaN }).analyzeTimeoutSec,
    ).toBe(60);
  });

  it("defaults comfortable density and sanitizes it", () => {    expect(DEFAULT_SETTINGS.density).toBe("comfortable");
    expect(DEFAULT_SETTINGS.thumbnailAccent).toBe(true);
    expect(DEFAULT_SETTINGS.accentOverride).toBeNull();
    expect(mergeSettings(DEFAULT_SETTINGS, { density: "compact" }).density).toBe("compact");
    expect(mergeSettings(DEFAULT_SETTINGS, { density: "cozy" as never }).density).toBe(
      "comfortable",
    );
    expect(mergeSettings(DEFAULT_SETTINGS, { accentOverride: "#818CF8" }).accentOverride).toBe(
      "#818cf8",
    );
    expect(mergeSettings(DEFAULT_SETTINGS, { accentOverride: "red" }).accentOverride).toBeNull();
  });

  it("defaults auto language and sanitizes it", () => {
    expect(DEFAULT_SETTINGS.language).toBe("auto");
    expect(mergeSettings(DEFAULT_SETTINGS, { language: "ms" }).language).toBe("ms");
    expect(mergeSettings(DEFAULT_SETTINGS, { language: "fr" as never }).language).toBe("auto");
  });
});

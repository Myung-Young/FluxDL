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

  it("preserves untouched fields and downloadDir verbatim", () => {
    const m = mergeSettings(DEFAULT_SETTINGS, {
      downloadDir: "C:\\My Videos\\münchen",
      subtitles: true,
    });
    expect(m.downloadDir).toBe("C:\\My Videos\\münchen");
    expect(m.subtitles).toBe(true);
    expect(m.mergeContainer).toBe("mp4");
  });
});

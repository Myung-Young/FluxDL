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

  it("defaults history keep-last-N and clamps it", () => {
    expect(DEFAULT_SETTINGS.historyLimit).toBe(500);
    expect(mergeSettings(DEFAULT_SETTINGS, { historyLimit: 50 }).historyLimit).toBe(50);
    expect(mergeSettings(DEFAULT_SETTINGS, { historyLimit: 5 }).historyLimit).toBe(10);
    expect(mergeSettings(DEFAULT_SETTINGS, { historyLimit: 99999 }).historyLimit).toBe(5000);
  });

  it("pins the settings shape so mocks cannot drift silently (M3.3)", () => {
    // When this fails, update the mirrors too:
    // apps/desktop/e2e/smoke.e2e.ts installMock settings + any fake engines.
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([
      "accentOverride",
      "analyzeTimeoutSec",
      "autoCheckUpdate",
      "closeBehavior",
      "codecPreference",
      "concurrency",
      "cookiesFile",
      "cookiesFromBrowser",
      "defaultPreset",
      "density",
      "downloadDir",
      "embedMetadata",
      "embedSubs",
      "embedThumbnail",
      "filenameTemplate",
      "historyLimit",
      "includeAutoSubs",
      "language",
      "mergeContainer",
      "minimizeToTray",
      "onboardingDone",
      "playlistSubfolder",
      "postDownloadAction",
      "proxy",
      "skipArchived",
      "speedLimit",
      "sponsorBlock",
      "subtitleLangs",
      "subtitles",
      "theme",
      "thumbnailAccent",
    ]);
  });

  it("defaults window behavior and auto-subs, sanitizes them", () => {
    expect(DEFAULT_SETTINGS.closeBehavior).toBe("quit");
    expect(DEFAULT_SETTINGS.minimizeToTray).toBe(false);
    expect(DEFAULT_SETTINGS.includeAutoSubs).toBe(true);
    const m = mergeSettings(DEFAULT_SETTINGS, {
      closeBehavior: "explode" as never,
      minimizeToTray: "yes" as never,
      includeAutoSubs: "yes" as never,
    });
    expect(m.closeBehavior).toBe("quit");
    expect(m.minimizeToTray).toBe(false);
    expect(m.includeAutoSubs).toBe(true);
    expect(mergeSettings(DEFAULT_SETTINGS, { closeBehavior: "tray" }).closeBehavior).toBe(
      "tray",
    );
    expect(
      mergeSettings(DEFAULT_SETTINGS, { minimizeToTray: true }).minimizeToTray,
    ).toBe(true);
    expect(
      mergeSettings(DEFAULT_SETTINGS, { includeAutoSubs: false }).includeAutoSubs,
    ).toBe(false);
  });
});

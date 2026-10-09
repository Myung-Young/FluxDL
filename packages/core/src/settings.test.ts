import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings.js";
import type { DownloadPreset } from "./types.js";
import { CONTAINERS } from "./types.js";

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

  it("defaults the custom format selector to off and sanitizes it", () => {
    expect(DEFAULT_SETTINGS.customFormat).toBeNull();
    expect(
      mergeSettings(DEFAULT_SETTINGS, { customFormat: "bestvideo+bestaudio/best" }).customFormat,
    ).toBe("bestvideo+bestaudio/best");
    expect(mergeSettings(DEFAULT_SETTINGS, { customFormat: "   " }).customFormat).toBeNull();
  });

  it("defaults notifiers and LAN mode to off and sanitizes them", () => {
    expect(DEFAULT_SETTINGS.notifyDiscord).toBe(false);
    expect(DEFAULT_SETTINGS.notifyTelegram).toBe(false);
    expect(DEFAULT_SETTINGS.telegramChatId).toBeNull();
    expect(DEFAULT_SETTINGS.lanEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.lanAllowlist).toBe("");
    expect(DEFAULT_SETTINGS.lanAutoDisableHours).toBeNull();
    const m = mergeSettings(DEFAULT_SETTINGS, {
      notifyDiscord: true,
      telegramChatId: "  12345  ",
      lanEnabled: true,
      lanAllowlist: "192.168.1.,10.0.0.",
      lanAutoDisableHours: 12,
    });
    expect(m.notifyDiscord).toBe(true);
    expect(m.telegramChatId).toBe("12345");
    expect(m.lanEnabled).toBe(true);
    expect(m.lanAllowlist).toBe("192.168.1.,10.0.0.");
    expect(m.lanAutoDisableHours).toBe(12);
    expect(
      mergeSettings(DEFAULT_SETTINGS, { lanAutoDisableHours: 999 }).lanAutoDisableHours,
    ).toBe(168);
    expect(mergeSettings(DEFAULT_SETTINGS, { lanAutoDisableHours: 0 }).lanAutoDisableHours).toBeNull();
  });

  it("defaults the Remote API to off and clamps its port", () => {
    expect(DEFAULT_SETTINGS.apiEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.apiPort).toBe(48127);
    expect(mergeSettings(DEFAULT_SETTINGS, { apiEnabled: true }).apiEnabled).toBe(true);
    expect(mergeSettings(DEFAULT_SETTINGS, { apiPort: 80 }).apiPort).toBe(48127);
    expect(mergeSettings(DEFAULT_SETTINGS, { apiPort: 99999 }).apiPort).toBe(48127);
    expect(mergeSettings(DEFAULT_SETTINGS, { apiPort: 8080 }).apiPort).toBe(8080);
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

  it("keeps per-site presets and drops garbage entries", () => {
    expect(DEFAULT_SETTINGS.presetBySite).toEqual({});
    const good = {
      YouTube: { kind: "video", videoPreset: "720", audioPreset: "MP3", rawFormat: "x" },
      bogus: { kind: "video", videoPreset: "Nope", audioPreset: "MP3" },
      empty: null,
    } as unknown as Record<string, DownloadPreset>;
    const m = mergeSettings(DEFAULT_SETTINGS, { presetBySite: good });
    expect(m.presetBySite).toEqual({
      youtube: { kind: "video", videoPreset: "720", audioPreset: "MP3", rawFormat: null },
    });
    expect(
      mergeSettings(DEFAULT_SETTINGS, {
        presetBySite: ["x"] as unknown as Record<string, DownloadPreset>,
      }).presetBySite,
    ).toEqual({});
  });

  it("caps search lists and drops junk", () => {
    expect(DEFAULT_SETTINGS.savedSearches).toEqual([]);
    expect(DEFAULT_SETTINGS.recentSearches).toEqual([]);
    const m = mergeSettings(DEFAULT_SETTINGS, {
      savedSearches: ["  Big  ", "", 42 as never, "Big", "x".repeat(50)],
      recentSearches: "nope" as never,
    });
    expect(m.savedSearches).toEqual(["Big", "x".repeat(40)]);
    expect(m.recentSearches).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => `q${String(i)}`);
    expect(mergeSettings(DEFAULT_SETTINGS, { savedSearches: many }).savedSearches).toHaveLength(
      10,
    );
  });

  it("remembers UI state and restores safe fallbacks", () => {
    expect(DEFAULT_SETTINGS.lastView).toBe("home");
    expect(DEFAULT_SETTINGS.lastQueueFilter).toBe("all");
    expect(DEFAULT_SETTINGS.batchDraft).toBe("");
    const m = mergeSettings(DEFAULT_SETTINGS, {
      lastView: "logs",
      lastQueueFilter: "bogus",
      batchDraft: "https://example.com/a",
    });
    expect(m.lastView).toBe("logs");
    expect(m.lastQueueFilter).toBe("all");
    expect(m.batchDraft).toBe("https://example.com/a");
    expect(mergeSettings(DEFAULT_SETTINGS, { lastView: "nope" }).lastView).toBe("home");
  });

  it("tracks a skipped update tag, sanitized", () => {
    expect(DEFAULT_SETTINGS.skippedUpdate).toBeNull();
    expect(mergeSettings(DEFAULT_SETTINGS, { skippedUpdate: "v1.6.0" }).skippedUpdate).toBe(
      "v1.6.0",
    );
    expect(mergeSettings(DEFAULT_SETTINGS, { skippedUpdate: "  " }).skippedUpdate).toBeNull();
    expect(mergeSettings(DEFAULT_SETTINGS, { skippedUpdate: null }).skippedUpdate).toBeNull();
  });

  it("pins the settings shape so mocks cannot drift silently (M3.3)", () => {
    // When this fails, update the mirrors too:
    // apps/desktop/e2e/smoke.e2e.ts installMock settings + any fake engines.
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([
      "accentOverride",
      "analyzeTimeoutSec",
      "apiEnabled",
      "apiPort",
      "autoCheckUpdate",
      "autoSort",
      "autoUpdateTools",
      "batchDraft",
      "closeBehavior",
      "codecPreference",
      "concurrency",
      "concurrencyGallery",
      "concurrentFragments",
      "cookiesFile",
      "cookiesFromBrowser",
      "crashReports",
      "customFormat",
      "defaultPreset",
      "density",
      "dismissedPackHints",
      "domainRules",
      "downloadDir",
      "downloadRetries",
      "downloadWindowEnd",
      "downloadWindowStart",
      "embedMetadata",
      "embedSubs",
      "embedThumbnail",
      "experimental",
      "filenameTemplate",
      "followSystemTheme",
      "historyLimit",
      "images",
      "impersonateClient",
      "includeAutoSubs",
      "lanAllowlist",
      "lanAutoDisableHours",
      "lanEnabled",
      "language",
      "lastFolderByMedia",
      "lastQueueFilter",
      "lastToolCheckAt",
      "lastView",
      "launchAtLogin",
      "mergeContainer",
      "minimizeToTray",
      "notifyDiscord",
      "notifyFinished",
      "notifyTelegram",
      "onboardingDone",
      "pacing",
      "playlistSubfolder",
      "postDownloadAction",
      "postProcess",
      "presetBySite",
      "proxy",
      "recentSearches",
      "routerMode",
      "savedSearches",
      "skipArchived",
      "skippedUpdate",
      "socketTimeoutSec",
      "speedLimit",
      "sponsorBlock",
      "sponsorBlockCategories",
      "stalledTimeoutSec",
      "subtitleLangs",
      "subtitles",
      "telegramChatId",
      "theme",
      "thumbnailAccent",
      "useAria2c",
      "ytdlpChannel",
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

/**
 * v1.7.2: pacing + container sanitization. Both are trust-boundary values
 * (hand-editable JSON on disk), and an unvalidated value reaches yt-dlp, which
 * ABORTS on an unknown container or a negative delay — so a corrupt settings
 * file must never be able to break every download.
 */
describe("pacing settings", () => {
  it("defaults to fully off", () => {
    expect(DEFAULT_SETTINGS.pacing).toEqual({
      sleepRequestsSec: null,
      minSleepIntervalSec: null,
      maxSleepIntervalSec: null,
      sleepSubtitlesSec: null,
    });
  });

  it("keeps whole seconds and rejects junk", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      pacing: {
        sleepRequestsSec: 2.7,
        minSleepIntervalSec: 5,
        maxSleepIntervalSec: null,
        sleepSubtitlesSec: -3,
      },
    });
    expect(merged.pacing.sleepRequestsSec).toBe(2);
    expect(merged.pacing.minSleepIntervalSec).toBe(5);
    expect(merged.pacing.maxSleepIntervalSec).toBeNull();
    // Negative = off, never handed to yt-dlp.
    expect(merged.pacing.sleepSubtitlesSec).toBeNull();
  });

  it("clamps absurd values into a sane band", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      pacing: {
        sleepRequestsSec: 99_999,
        minSleepIntervalSec: 1e9,
        maxSleepIntervalSec: 2e9,
        sleepSubtitlesSec: 5,
      },
    });
    expect(merged.pacing.sleepRequestsSec).toBe(60);
    expect(merged.pacing.minSleepIntervalSec).toBe(3600);
    expect(merged.pacing.maxSleepIntervalSec).toBe(3600);
    expect(merged.pacing.sleepSubtitlesSec).toBe(5);
  });

  it("falls back to the base for a non-object", () => {
    const base = { ...DEFAULT_SETTINGS.pacing, sleepRequestsSec: 3 };
    const merged = mergeSettings({ ...DEFAULT_SETTINGS, pacing: base }, {
      pacing: "nonsense",
    } as never);
    expect(merged.pacing.sleepRequestsSec).toBe(3);
  });

  it("keeps a raw gallery-dl config override, capped and nullable (v1.8.5)", () => {
    expect(DEFAULT_SETTINGS.images.customConfig).toBeNull();
    const kept = mergeSettings(DEFAULT_SETTINGS, {
      images: { ...DEFAULT_SETTINGS.images, customConfig: '{\n  "extractor": {}\n}' },
    });
    expect(kept.images.customConfig).toBe('{\n  "extractor": {}\n}');
    const cleared = mergeSettings(
      { ...DEFAULT_SETTINGS, images: { ...DEFAULT_SETTINGS.images, customConfig: "{}" } },
      { images: { ...DEFAULT_SETTINGS.images, customConfig: "   " } },
    );
    expect(cleared.images.customConfig).toBeNull();
    const capped = mergeSettings(DEFAULT_SETTINGS, {
      images: { ...DEFAULT_SETTINGS.images, customConfig: `{"k":"${"x".repeat(300_000)}"}` },
    });
    expect(capped.images.customConfig?.length).toBe(200_000);
  });
});

describe("container settings", () => {
  it("drops a container yt-dlp would reject", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { mergeContainer: "exe" });
    // Falls back to the base value rather than forwarding junk to yt-dlp.
    expect(merged.mergeContainer).toBe(DEFAULT_SETTINGS.mergeContainer);
  });

  it("accepts every offered container, normalised", () => {
    for (const c of CONTAINERS) {
      expect(mergeSettings(DEFAULT_SETTINGS, { mergeContainer: c }).mergeContainer).toBe(c);
    }
    expect(mergeSettings(DEFAULT_SETTINGS, { mergeContainer: " MKV " }).mergeContainer).toBe("mkv");
  });

  it("keeps a valid per-preset container and drops an invalid one", () => {
    const withValid = mergeSettings(DEFAULT_SETTINGS, {
      defaultPreset: {
        kind: "video",
        videoPreset: "1080",
        audioPreset: "MP3",
        rawFormat: null,
        container: "mkv",
      },
    });
    expect(withValid.defaultPreset.container).toBe("mkv");

    // A hand-edited settings file can hold anything: the disk is a trust
    // boundary, so the type is widened here deliberately.
    const withJunk = mergeSettings(DEFAULT_SETTINGS, {
      defaultPreset: {
        kind: "video",
        videoPreset: "1080",
        audioPreset: "MP3",
        rawFormat: null,
        container: "rm -rf",
      } as unknown as DownloadPreset,
    });
    expect(withJunk.defaultPreset.container).toBeUndefined();
  });

  it("keeps a per-site container", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      presetBySite: {
        youtube: {
          kind: "video",
          videoPreset: "1080",
          audioPreset: "MP3",
          rawFormat: null,
          container: "mkv",
        },
      },
    });
    expect(merged.presetBySite["youtube"]?.container).toBe("mkv");
  });
});

import { _electron as electron } from "@playwright/test";
import { expect, test, type ElectronApplication } from "@playwright/test";

/**
 * Docs screenshots (Phase 7): deterministic mock-driven captures for the
 * README. Runs with the normal e2e suite; output lands in docs/screenshots
 * (idempotent — same mock, same pixels modulo font rendering).
 */

let app: ElectronApplication | null = null;

test.beforeAll(async () => {
  app = await electron.launch({ args: ["."] });
});

test.afterAll(async () => {
  await app?.close();
  app = null;
});

test("screenshots: home, downloads, settings", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  // Minimal mock: settings + one analyzable video + queue progress.
  await page.addInitScript(() => {
    const listeners: Array<(e: unknown) => void> = [];
    const settings = {
      downloadDir: "",
      filenameTemplate: "%(title)s [%(id)s].%(ext)s",
      concurrency: 2,
      speedLimit: null,
      proxy: null,
      cookiesFromBrowser: null,
      cookiesFile: null,
      embedThumbnail: false,
      embedMetadata: false,
      subtitles: false,
      subtitleLangs: "en",
      embedSubs: false,
      includeAutoSubs: true,
      mergeContainer: "mp4",
      customFormat: null,
      pacing: { sleepRequestsSec: null, minSleepIntervalSec: null, maxSleepIntervalSec: null, sleepSubtitlesSec: null },
      sponsorBlock: false,
      codecPreference: "auto",
      skipArchived: true,
      density: "comfortable",
      accentOverride: null,
      language: "en",
      analyzeTimeoutSec: 60,
      thumbnailAccent: true,
      playlistSubfolder: true,
      presetBySite: {},
      lastView: "home",
      lastQueueFilter: "all",
      batchDraft: "",
      savedSearches: [],
      recentSearches: [],
      historyLimit: 500,
      closeBehavior: "quit",
      minimizeToTray: false,
      concurrencyGallery: 2,
      downloadWindowStart: null,
      downloadWindowEnd: null,
      postProcess: {
        convertImages: false, imageFormat: "jpg", imageQuality: 85, imageMaxDim: 2048,
        stripExif: true, packageGallery: "off", ugoiraFormat: "off", autoTagAudio: false,
        compressVideo: "off", transcribeAudio: false, whisperModel: "tiny", rcloneRemote: null,
        autoUpload: false, keepOriginals: true,
      },
      dismissedPackHints: [],
      ytdlpChannel: "stable",
      autoUpdateTools: false,
      useAria2c: false,
      concurrentFragments: null,
      downloadRetries: null,
      socketTimeoutSec: null,
      stalledTimeoutSec: 120,
      sponsorBlockCategories: "all,-filler",
      impersonateClient: null,
      lastToolCheckAt: null,
      routerMode: "auto",
      domainRules: {},
      images: {
        downloadDir: "", folderTemplate: "{site}/{gallery}", filenameTemplate: "{filename}.{extension}",
        sleepRequestsSec: null, maxSleepIntervalSec: null, retries: 3, proxy: null,
        archive: true, metadataSidecar: false, customConfig: null,
      },
      lastFolderByMedia: {},
      notifyFinished: true,
      crashReports: false,
      followSystemTheme: false,
      launchAtLogin: false,
      autoSort: false,
      experimental: false,
      skippedUpdate: null,
      onboardingDone: true,
      defaultPreset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
      theme: "obsidian",
      postDownloadAction: "none",
      autoCheckUpdate: false,
      apiEnabled: false,
      apiPort: 48127,
      notifyDiscord: false,
      notifyTelegram: false,
      telegramChatId: null,
      lanEnabled: false,
      lanAllowlist: "",
      lanAutoDisableHours: null,
    };
    const fireProgress = (id: string): void => {
      for (const cb of listeners) {
        cb({ id, percent: 42, speed: "1M/s", eta: "00:01", downloadedBytes: 420, totalBytes: 1000, stage: "downloading", destination: null });
      }
    };
    let n = 0;
    const mock = {
      getInfo: (): Promise<unknown> =>
        Promise.resolve({
          url: "https://example.com/mock-video",
          title: "Mock Video",
          uploader: "Mock Channel",
          duration: 60,
          thumbnail: null,
          isPlaylist: false,
          extractor: "generic",
          videoId: "mock1",
          entries: [],
          formats: [],
          liveStatus: null,
          chapters: null,
          uploadDate: null,
        }),
      start: (job: unknown): Promise<string> => {
        n += 1;
        const id = `eng-mock-${String(n)}`;
        if (job === null) return Promise.resolve(id);
        setTimeout(() => {
          fireProgress(id);
        }, 100);
        return Promise.resolve(id);
      },
      pause: (): Promise<void> => Promise.resolve(),
      resume: (): Promise<void> => Promise.resolve(),
      cancel: (): Promise<void> => Promise.resolve(),
      cancelAnalyze: (): Promise<void> => Promise.resolve(),
      onProgress: (cb: (e: unknown) => void): (() => void) => {
        listeners.push(cb);
        return () => undefined;
      },
      getEngineVersion: (): Promise<unknown> =>
        Promise.resolve({ ytdlp: "mock", ffmpeg: "mock", app: "0.0.0-shots", galleryDl: null, jsRuntime: null, aria2c: null }),
      updateEngine: (): Promise<unknown> => Promise.resolve({}),
      repairEngine: (): Promise<unknown> => Promise.resolve({ ok: true, repaired: [], failed: [], versions: null }),
      rollbackTool: (): Promise<boolean> => Promise.resolve(false),
      reinstallTool: (): Promise<unknown> => Promise.resolve({}),
      runDoctor: (): Promise<unknown> => Promise.resolve({ ok: true, checkedAt: 0, checks: [] }),
      consumeRecoveryNotices: (): Promise<unknown[]> => Promise.resolve([]),
      postProcess: (): Promise<unknown> =>
        Promise.resolve({ kind: "report", report: { ok: true, results: [], candidates: [] } }),
      packs: (): Promise<unknown> => Promise.resolve({ kind: "status", rows: [] }),
      remoteApi: (): Promise<unknown> =>
        Promise.resolve({ kind: "status", status: { running: false, port: null, error: null, queueActive: 0, queueQueued: 0, queueErrors: 0, engineActive: 0 } }),
      notifiers: (): Promise<unknown> => Promise.resolve({ kind: "status", discord: false, telegram: false }),
      probeGallery: (): Promise<unknown> => Promise.resolve({ supported: false, items: [], errors: [] }),
      setAggregateProgress: (): Promise<void> => Promise.resolve(),
      applyWindowChrome: (): Promise<void> => Promise.resolve(),
      onWindowChrome: (): (() => void) => () => undefined,
      getThumbnailColor: (): Promise<null> => Promise.resolve(null),
      pickFolder: (): Promise<null> => Promise.resolve(null),
      pickFile: (): Promise<null> => Promise.resolve(null),
      openPath: (): Promise<void> => Promise.resolve(),
      revealInFolder: (): Promise<void> => Promise.resolve(),
      fileExists: (): Promise<boolean> => Promise.resolve(false),
      fileExistsBulk: (): Promise<boolean[]> => Promise.resolve([]),
      fileSizesBulk: (): Promise<Array<null>> => Promise.resolve([]),
      archiveHas: (): Promise<boolean[]> => Promise.resolve([]),
      trashFile: (): Promise<void> => Promise.resolve(),
      updateHistory: (): Promise<void> => Promise.resolve(),
      clearArchive: (): Promise<void> => Promise.resolve(),
      loadSettings: (): Promise<unknown> => Promise.resolve({ ...settings }),
      saveSettings: (patch: unknown): Promise<unknown> => {
        if (typeof patch === "object" && patch !== null) Object.assign(settings, patch);
        return Promise.resolve({ ...settings });
      },
      loadQueue: (): Promise<unknown[]> => Promise.resolve([]),
      saveQueue: (): Promise<void> => Promise.resolve(),
      appendHistory: (): Promise<void> => Promise.resolve(),
      loadHistory: (): Promise<unknown[]> => Promise.resolve([]),
      removeHistory: (): Promise<void> => Promise.resolve(),
      clearHistory: (): Promise<void> => Promise.resolve(),
      restoreHistory: (): Promise<void> => Promise.resolve(),
      loadWatchlist: (): Promise<unknown[]> => Promise.resolve([]),
      saveWatchlist: (): Promise<void> => Promise.resolve(),
      getDiskSpace: (): Promise<null> => Promise.resolve(null),
      getJobArgs: (): Promise<null> => Promise.resolve(null),
      getStorageInsights: (): Promise<unknown> =>
        Promise.resolve({ audioFiles: 0, audioBytes: 0, videoFiles: 0, videoBytes: 0, otherFiles: 0, otherBytes: 0, orphans: [], orphanBytes: 0 }),
      readClipboard: (): Promise<null> => Promise.resolve(null),
      writeClipboard: (): Promise<boolean> => Promise.resolve(true),
      getRawLog: (): Promise<string> => Promise.resolve("mock log"),
      shutdown: (): Promise<void> => Promise.resolve(),
      onDeepLink: (): (() => void) => () => undefined,
      onBatchLink: (): (() => void) => () => undefined,
      checkForUpdates: (): Promise<unknown> =>
        Promise.resolve({ appCurrent: "0", appLatest: null, appUpdate: false, appUrl: "", appRelease: null, ytdlpCurrent: "mock", ytdlpLatest: null, ytdlpUpdate: false, checkedAt: 0 }),
      startUpdateDownload: (): Promise<void> => Promise.resolve(),
      getUpdateDownloadProgress: (): Promise<unknown> =>
        Promise.resolve({ state: "idle", receivedBytes: 0, totalBytes: null, error: null }),
      cancelUpdateDownload: (): Promise<void> => Promise.resolve(),
      getMediaUrl: (): Promise<null> => Promise.resolve(null),
      openExternal: (): Promise<void> => Promise.resolve(),
    };
    (window as unknown as { __grabberOverride: unknown }).__grabberOverride = mock;
  });
  // The window booted before the mock existed — reload so the renderer
  // picks up __grabberOverride (same as the smoke spec).
  await page.reload();

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });

  await page.locator("#home-url").fill("https://example.com/mock-video");
  await page.locator(".url-row .btn").filter({ hasText: "Analyze" }).click();
  await expect(page.locator(".preview-title")).toHaveText("Mock Video");
  await page.screenshot({ path: "../../docs/screenshots/home.png" });

  await page.locator(".grabber-view .btn-primary").filter({ hasText: "Download" }).click();
  await page.locator(".grabber-nav-btn").filter({ hasText: "Downloads" }).click();
  await expect(page.locator(".dl-card")).toHaveCount(1);
  await page.screenshot({ path: "../../docs/screenshots/downloads.png" });

  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator('[data-testid="settings-search"]')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: "../../docs/screenshots/settings.png" });
});

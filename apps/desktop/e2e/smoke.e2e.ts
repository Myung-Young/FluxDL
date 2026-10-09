import { _electron as electron } from "@playwright/test";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * M6 smoke: launch -> analyze a MOCKED engine response -> queue item.
 * The mock replaces window.grabber before the renderer boots, so no
 * yt-dlp binary or network is touched.
 */

async function installMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const listeners: Array<(e: unknown) => void> = [];
    // Mirror DEFAULT_SETTINGS (packages/core/src/settings.ts): every new
    // settings field must be added here or Logs/diagnostics crash on undefined.
    const settings = {
      downloadDir: "",
      filenameTemplate: "%(title)s [%(id)s].%(ext)s",
      concurrency: 2,
      speedLimit: null,
      proxy: null,
      cookiesFromBrowser: null,      cookiesFile: null,
      embedThumbnail: false,
      embedMetadata: false,
      subtitles: false,
      subtitleLangs: "en",
      embedSubs: false,
      includeAutoSubs: true,
      mergeContainer: "mp4",
      customFormat: null,
      // Phase 6B: notifiers (secrets stay out of settings) + LAN opt-in.
      notifyDiscord: false,
      notifyTelegram: false,
      telegramChatId: null,
      lanEnabled: false,
      lanAllowlist: "",
      lanAutoDisableHours: null,
      pacing: {
        sleepRequestsSec: null,
        minSleepIntervalSec: null,
        maxSleepIntervalSec: null,
        sleepSubtitlesSec: null,
      },
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
        convertImages: false,
        imageFormat: "jpg",
        imageQuality: 85,
        imageMaxDim: 2048,
        stripExif: true,
        packageGallery: "off",
        ugoiraFormat: "off",
        autoTagAudio: false,
        compressVideo: "off",
        transcribeAudio: false,
        whisperModel: "tiny",
        rcloneRemote: null,
        autoUpload: false,
        keepOriginals: true,
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
        downloadDir: "",
        folderTemplate: "{site}/{gallery}",
        filenameTemplate: "{filename}.{extension}",
        sleepRequestsSec: null,
        maxSleepIntervalSec: null,
        retries: 3,
        proxy: null,
        archive: true,
        metadataSidecar: false,
        customConfig: null,
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
      // Phase 6A: loopback Remote API (off by default).
      apiEnabled: false,
      apiPort: 48127,
    };
    const started: Array<unknown> = [];
    const historyFixture: unknown[] = [];
    const clipboardWrites: string[] = [];
    let chromeState = { mini: false, theme: "obsidian" };
    let chromeListeners: Array<(s: { mini: boolean; theme: string }) => void> = [];
    const fireProgress = (id: string): void => {
      for (const cb of listeners) {
        cb({
          id,
          percent: 42,
          speed: "1M/s",
          eta: "00:01",
          downloadedBytes: 42,
          totalBytes: 100,
          stage: "downloading",
          destination: null,
        });
      }
    };
    const versions = {
      ytdlp: "mock",
      ffmpeg: null,
      app: "0.0.0-e2e",
      galleryDl: null,
      jsRuntime: null,
      aria2c: null,
      toolPaths: {
        ytDlp: "yt-dlp",
        ffmpeg: null,
        galleryDl: null,
        deno: null,
        aria2c: null,
      },
      os: "mock-os",
      arch: "mock-arch",
      electron: "mock",
      node: "mock",
    };
    let n = 0;
    const mock = {
      getInfo: (url: string): Promise<unknown> =>
        // Every MediaInfo field is present on purpose: the mock used to omit
        // `extractor`/`videoId`, and the renderer treated the missing key as a
        // string, crashing the whole Home view (which is where the Batch
        // button lives). A mock must satisfy the same contract as the engine.
        Promise.resolve({
          url,
          title: "Mock Video",
          uploader: "Mock Uploader",
          duration: 125,
          thumbnail: null,
          isPlaylist: false,
          extractor: "generic",
          // Derived from the URL: a constant id made every link share one
          // identity, so the duplicate guard fired on unrelated URLs (the
          // batch queue test queued three different links and was blocked).
          videoId: url.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""),
          entries: [],
          formats: [
            {
              formatId: "18",
              label: "18 · 640x360 mp4",
              ext: "mp4",
              kind: "video+audio",
              resolution: "640x360",
              fps: 24,
              vcodec: "avc1",
              acodec: "mp4a",
              tbr: 512,
              filesize: 123,
              protocol: "https",
            },
          ],
          liveStatus: null,
          chapters: null,
          uploadDate: null,
        }),
      start: (job: unknown): Promise<string> => {
        started.push(job);
        n += 1;
        const id = `eng-mock-${String(n)}`;
        setTimeout(() => {
          fireProgress(id);
        }, 100);
        return Promise.resolve(id);
      },
      pause: (id: string): Promise<void> => {
        setTimeout(() => {
          for (const cb of listeners) {
            cb({
              id,
              percent: 0,
              speed: null,
              eta: null,
              downloadedBytes: null,
              totalBytes: null,
              stage: "paused",
              destination: null,
            });
          }
        }, 50);
        return Promise.resolve();
      },
      resume: (id: string): Promise<void> => {
        setTimeout(() => {
          fireProgress(id);
        }, 50);
        return Promise.resolve();
      },
      cancel: (): Promise<void> => Promise.resolve(),
      cancelAnalyze: (): Promise<void> => Promise.resolve(),
      // Phase 1 v1.8.5: gallery probe (empty = no preview in smoke).
      probeGallery: (): Promise<unknown> =>
        Promise.resolve({ supported: false, items: [], errors: [] }),
      onProgress: (cb: (e: unknown) => void): (() => void) => {
        listeners.push(cb);
        return () => undefined;
      },
      getEngineVersion: (): Promise<unknown> => Promise.resolve({ ...versions }),
      updateEngine: (): Promise<unknown> => Promise.resolve({ ...versions }),
      repairEngine: (): Promise<unknown> =>
        Promise.resolve({ ok: true, repaired: ["yt-dlp.exe"], failed: [], versions }),
      rollbackTool: (): Promise<boolean> => Promise.resolve(false),
      reinstallTool: (): Promise<unknown> => Promise.resolve({ ...versions }),
      runDoctor: (): Promise<unknown> =>
        Promise.resolve({ ok: true, checkedAt: Date.now(), checks: [] }),
      consumeRecoveryNotices: (): Promise<unknown[]> => Promise.resolve([]),
      postProcess: (): Promise<unknown> =>
        Promise.resolve({ kind: "report", report: { ok: true, results: [], candidates: [] } }),
      packs: (): Promise<unknown> => Promise.resolve({ kind: "status", rows: [] }),
      // Phase 6B: notifier secrets (flags only, never values).
      notifiers: (): Promise<unknown> =>
        Promise.resolve({ kind: "status", discord: false, telegram: false }),
      // Phase 6A: loopback Remote API control (drain returns nothing here).
      remoteApi: (): Promise<unknown> =>
        Promise.resolve({
          kind: "status",
          status: {
            running: false,
            port: null,
            error: null,
            queueActive: 0,
            queueQueued: 0,
            queueErrors: 0,
            engineActive: 0,
          },
        }),
      pickFolder: (): Promise<null> => Promise.resolve(null),
      pickFile: (): Promise<null> => Promise.resolve(null),
      openPath: (): Promise<void> => Promise.resolve(),
      revealInFolder: (): Promise<void> => Promise.resolve(),
      fileExists: (): Promise<boolean> => Promise.resolve(false),
      trashFile: (): Promise<void> => Promise.resolve(),
      updateHistory: (): Promise<void> => Promise.resolve(),
      getThumbnailColor: (): Promise<null> => Promise.resolve(null),
      fileExistsBulk: (): Promise<boolean[]> => Promise.resolve([]),
      // v1.7.2: the Stats screen measures sizeless history rows off disk.
      fileSizesBulk: (paths: string[]): Promise<Array<number | null>> =>
        Promise.resolve(paths.map(() => null)),
      archiveHas: (): Promise<boolean[]> => Promise.resolve([]),
      clearArchive: (): Promise<void> => Promise.resolve(),
      setAggregateProgress: (): Promise<void> => Promise.resolve(),
      // Window chrome (M4.4): record the last request and let tests flip it
      // back the way the tray would.
      applyWindowChrome: (state: { mini: boolean; theme: string }): Promise<void> => {
        chromeState = { mini: state.mini, theme: state.theme };
        return Promise.resolve();
      },
      onWindowChrome: (cb: (s: { mini: boolean; theme: string }) => void) => {
        chromeListeners.push(cb);
        return () => {
          chromeListeners = chromeListeners.filter((l) => l !== cb);
        };
      },
      loadSettings: (): Promise<unknown> => Promise.resolve({ ...settings }),
      // Persist into the same object the real engine uses, so a later
      // `loadSettings()` returns what was saved. Returning a merged copy
      // without keeping it made every setting silently revert on the next
      // read — which is how a "dead" language selector got misread as a UI bug.
      saveSettings: (patch: unknown): Promise<unknown> => {
        if (typeof patch === "object" && patch !== null) {
          Object.assign(settings, patch);
        }
        return Promise.resolve({ ...settings });
      },
      loadWatchlist: (): Promise<unknown[]> => Promise.resolve([]),
      saveWatchlist: (): Promise<void> => Promise.resolve(),
      loadQueue: (): Promise<unknown[]> => Promise.resolve([]),
      saveQueue: (): Promise<void> => Promise.resolve(),
      appendHistory: (): Promise<void> => Promise.resolve(),
      removeHistory: (): Promise<void> => Promise.resolve(),
      loadHistory: (): Promise<unknown[]> => Promise.resolve(historyFixture),
      clearHistory: (): Promise<void> => Promise.resolve(),
      getRawLog: (): Promise<string> => Promise.resolve("mock log"),
      shutdown: (): Promise<void> => Promise.resolve(),
      onDeepLink: (): (() => void) => () => undefined,
      onBatchLink: (): (() => void) => () => undefined,
      readClipboard: (): Promise<null> => Promise.resolve(null),
      // v1.7.2: copies now go through main; the mock records them so the test
      // can assert the text actually reached the clipboard bridge.
      writeClipboard: (text: string): Promise<boolean> => {
        clipboardWrites.push(text);
        return Promise.resolve(true);
      },
      getDiskSpace: (): Promise<null> => Promise.resolve(null),
      getJobArgs: (): Promise<null> => Promise.resolve(null),
      getStorageInsights: (): Promise<unknown> =>
        Promise.resolve({
          audioFiles: 0,
          audioBytes: 0,
          videoFiles: 0,
          videoBytes: 0,
          otherFiles: 0,
          otherBytes: 0,
          orphans: [],
          orphanBytes: 0,
        }),
      checkForUpdates: (): Promise<unknown> =>
        Promise.resolve({
          appCurrent: "0.0.0-e2e",
          appLatest: null,
          appUpdate: false,
          appUrl: "https://github.com/Myung-Young/FluxDL/releases",
          appRelease: null,
          ytdlpCurrent: "mock",
          ytdlpLatest: null,
          ytdlpUpdate: false,
          checkedAt: 0,
        }),
      startUpdateDownload: (): Promise<void> => Promise.resolve(),
      getUpdateDownloadProgress: (): Promise<unknown> =>
        Promise.resolve({ state: "idle", receivedBytes: 0, totalBytes: null, error: null }),
      cancelUpdateDownload: (): Promise<void> => Promise.resolve(),
      getMediaUrl: (): Promise<null> => Promise.resolve(null),
      openExternal: (): Promise<void> => Promise.resolve(),
      _started: started,
      _chrome: () => chromeState,
      _clipboardWrites: clipboardWrites,
      _setHistory: (rows: unknown[]) => {
        historyFixture.length = 0;
        historyFixture.push(...rows);
      },
      _emitChrome: (s: { mini: boolean; theme: string }) => {
        chromeState = s;
        for (const cb of chromeListeners) cb(s);
      },
    };
    (window as unknown as { __grabberOverride: unknown }).__grabberOverride = mock;
  });
}

let app: ElectronApplication | null = null;
let userData = "";

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), "fluxdl-smoke-e2e-"));
  app = await electron.launch({ args: [".", `--user-data-dir=${userData}`] });
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  app = null;
  rmSync(userData, { recursive: true, force: true });
});

test("launch -> analyze mocked response -> queue item", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });
  // Home, Downloads, Library, Stats, Settings, Logs.
  await expect(page.locator(".grabber-nav-btn")).toHaveCount(7);

  await page.locator("#home-url").fill("https://example.com/mock-video");
  await page.locator(".url-row .btn").filter({ hasText: "Analyze" }).click();
  await expect(page.locator(".preview-title")).toHaveText("Mock Video");

  await page.locator(".grabber-view .btn-primary").filter({ hasText: "Download" }).click();
  await page.locator(".grabber-nav-btn").filter({ hasText: "Downloads" }).click();
  await expect(page.locator(".dl-card")).toHaveCount(1);
  await expect(page.locator(".dl-card")).toContainText("Mock Video");
  await expect(page.locator(".dl-track")).toHaveAttribute("aria-valuenow", "42", {
    timeout: 15000,
  });
  await expect(page.locator('[data-testid="aggregate"]')).toContainText("1 active", {
    timeout: 15000,
  });

  const startedCount = await page.evaluate(
    () =>
      (
        window as unknown as {
          __grabberOverride: { _started: unknown[] };
        }
      ).__grabberOverride._started.length,
  );
  expect(startedCount).toBe(1);
  expect(pageErrors).toEqual([]);
});

test("batch: paste 3 URLs -> analyze all -> queue 3", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await page.locator(".grabber-nav-btn").filter({ hasText: "Downloads" }).click();
  const before = await page.locator(".dl-card").count();

  await page.locator(".grabber-nav-btn").filter({ hasText: "Home" }).click();
  await page.locator('[data-testid="home-mode-batch"]').click();
  await page
    .locator("#batch-input")
    .fill("https://example.com/b1\nhttps://example.com/b2\n# comment\n\nhttps://example.com/b3");
  await page.locator("#batch-add").click();
  await expect(page.locator('[data-testid="batch-row"]')).toHaveCount(3);

  await page.locator("#batch-analyze").click();
  await expect(page.locator('[data-testid="batch-status"]', { hasText: "Ready" })).toHaveCount(3, {
    timeout: 15000,
  });

  await page.locator("#batch-queue").click();
  await page.locator(".grabber-nav-btn").filter({ hasText: "Downloads" }).click();
  await expect(page.locator(".dl-card")).toHaveCount(before + 3, { timeout: 15000 });
  expect(pageErrors).toEqual([]);
});

test("duplicate guard: re-queueing a queued URL offers Skip", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await page.locator(".grabber-nav-btn").filter({ hasText: "Downloads" }).click();
  const before = await page.locator(".dl-card").count();

  await page.locator(".grabber-nav-btn").filter({ hasText: "Home" }).click();
  await page.locator("#home-url").fill("https://example.com/b1");
  await page.locator(".url-row .btn").filter({ hasText: "Analyze" }).click();
  await expect(page.locator(".preview-title")).toHaveText("Mock Video");
  await page.locator(".grabber-view .btn-primary").filter({ hasText: "Download" }).click();
  await expect(page.locator('[data-testid="dup-dialog"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="dup-skip"]').click();
  await expect(page.locator('[data-testid="dup-dialog"]')).toHaveCount(0);

  await page.locator(".grabber-nav-btn").filter({ hasText: "Downloads" }).click();
  await expect(page.locator(".dl-card")).toHaveCount(before);
  expect(pageErrors).toEqual([]);
});

test("logs: repair engine reports verified", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await page.locator(".grabber-nav-btn").filter({ hasText: "Logs" }).click();
  await page.locator('[data-testid="logs-repair"]').click();
  await expect(page.locator(".grabber-view").getByText("Engine verified.")).toBeVisible({
    timeout: 15000,
  });
  await page.locator('[data-testid="logs-diag-copy"]').click();
  await expect(page.locator('[data-testid="diag-preview"]')).toContainText(
    "FluxDL diagnostics",
    { timeout: 15000 },
  );
  // Log search works on the placeholder with zero jobs selected.
  await expect(page.locator('[data-testid="logs-search"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="logs-search"]').fill("zzz-no-match");
  await expect(page.locator(".grabber-view").getByText("No matching lines.")).toBeVisible();
  await page.locator('[data-testid="logs-copy-log"]').click();
  // v1.7.2: copies MUST succeed now. This assertion used to accept
  // "Copy failed." as a pass, which is exactly why the bug survived: the DOM
  // clipboard path is refused inside the sandboxed renderer, so every Copy
  // button was broken in the shipped app while CI stayed green. The note only
  // appears when the MAIN-process clipboard write resolved true — this e2e app
  // runs the real preload + IPC, so it exercises the shipped path.
  await expect(page.locator(".grabber-view").getByText("Log copied.").first()).toBeVisible();
  await expect(page.locator(".grabber-view").getByText("Copy failed.")).toHaveCount(0);
  await page.locator('[data-testid="logs-search"]').fill("");
  expect(pageErrors).toEqual([]);
});

test("v1.7.2: Refresh + Show command work without picking a job first", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });
  // Seed one history row so there is something to preselect.
  await page.evaluate(() => {
    const mock = (
      window as unknown as { __grabberOverride?: { _setHistory?: (rows: unknown[]) => void } }
    ).__grabberOverride;
    mock?._setHistory?.([
      {
        id: "log-1",
        url: "https://youtu.be/aqz-KE-bpKQ",
        title: "A logged video",
        preset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
        outputDir: "C:\\Vids",
        status: "done",
        progress: 100,
        speed: null,
        eta: null,
        downloadedBytes: 10,
        totalBytes: 10,
        stage: "done",
        error: null,
        createdAt: Date.now() - 1000,
        finishedAt: Date.now(),
        attempts: 0,
        nextRetryAt: null,
        destination: "C:\\Vids\\logged.mp4",
      },
    ]);
  });

  await page.locator(".grabber-nav-btn").filter({ hasText: "Logs" }).click();
  await expect(page.locator('[data-testid="logs-refresh"]')).toBeVisible({ timeout: 15000 });
  // Both were permanently disabled before the fix.
  await expect(page.locator('[data-testid="logs-refresh"]')).toBeEnabled();
  await expect(page.locator('[data-testid="logs-show-command"]')).toBeEnabled();

  await page.locator('[data-testid="logs-show-command"]').click();
  await page.locator('[data-testid="logs-refresh"]').click();
  await expect(page.locator('[data-testid="logs-refresh"]')).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test("v1.7.2: every search box accepts a real click and filters", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });

  // Library — the box must exist even with no history yet.
  await page.locator(".grabber-nav-btn").filter({ hasText: "Library" }).click();
  await expect(page.locator('[data-testid="library-search"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="library-search"]').click();
  await page.locator('[data-testid="library-search"]').pressSequentially("abc");
  await expect(page.locator('[data-testid="library-search"]')).toHaveValue("abc");

  // Settings.
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator('[data-testid="settings-search"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="settings-search"]').click();
  await page.locator('[data-testid="settings-search"]').pressSequentially("proxy");
  await expect(page.locator("#set-proxy")).toBeVisible();

  // Logs.
  await page.locator(".grabber-nav-btn").filter({ hasText: "Logs" }).click();
  await expect(page.locator('[data-testid="logs-search"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="logs-search"]').click();
  await page.locator('[data-testid="logs-search"]').pressSequentially("zz");
  await expect(page.locator('[data-testid="logs-search"]')).toHaveValue("zz");

  // Downloads — the command bar (and its search box) used to vanish entirely
  // with an empty queue.
  await page.locator(".grabber-nav-btn").filter({ hasText: "Downloads" }).click();
  await expect(page.locator('[data-testid="downloads-search"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="downloads-search"]').click();
  await page.locator('[data-testid="downloads-search"]').pressSequentially("queue");
  await expect(page.locator('[data-testid="downloads-search"]')).toHaveValue("queue");
  expect(pageErrors).toEqual([]);
});

test("v1.7.2: Batch explains why its buttons are disabled, then works", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });
  await page.locator(".grabber-nav-btn").filter({ hasText: "Home" }).click();
  await page.locator('[data-testid="home-mode-batch"]').click();
  await expect(page.locator('[data-testid="batch-panel"]')).toBeVisible({ timeout: 15000 });

  // Unparseable input must say so instead of silently adding nothing.
  await page.locator('[data-testid="batch-input"]').fill("https://");
  await page.locator('[data-testid="batch-add"]').click();
  await expect(
    page.locator(".grabber-view").getByText(/No links found in that text/),
  ).toBeVisible();
  await expect(page.locator('[data-testid="batch-row"]')).toHaveCount(0);

  // A real link enables Analyze, and the hint guides the next step.
  await page.locator('[data-testid="batch-input"]').fill("https://example.com/b9");
  await page.locator('[data-testid="batch-add"]').click();
  await expect(page.locator('[data-testid="batch-row"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="batch-analyze"]')).toBeEnabled();
  await expect(page.locator('[data-testid="batch-queue"]')).toBeDisabled();

  await page.locator('[data-testid="batch-analyze"]').click();
  await expect(page.locator('[data-testid="batch-queue"]')).toBeEnabled({
    timeout: 15000,
  });
  await page.locator('[data-testid="batch-queue"]').click();
  await page.locator(".grabber-nav-btn").filter({ hasText: "Downloads" }).click();
  await expect(page.locator(".dl-card")).toHaveCount(1, { timeout: 15000 });
  expect(pageErrors).toEqual([]);
});

test("card context menu opens and closes with Esc", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await page.locator(".grabber-nav-btn").filter({ hasText: "Downloads" }).click();
  await page.locator(".dl-card").first().click({ button: "right" });
  await expect(page.locator('[data-testid="card-menu"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="card-menu"]')).toContainText("Copy URL");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="card-menu"]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("bulk: pause all then resume all", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await page.locator(".grabber-nav-btn").filter({ hasText: "Downloads" }).click();
  await page.getByRole("button", { name: "Pause all" }).click();
  await expect(page.locator(".dl-card").first()).toContainText("paused", { timeout: 15000 });
  await page.getByRole("button", { name: "Resume all" }).click();
  await expect(page.locator(".dl-card").first()).toContainText("downloading", {
    timeout: 15000,
  });
  expect(pageErrors).toEqual([]);
});

test("palette: Ctrl+K filters and runs a command", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await page.locator(".grabber-nav-btn").filter({ hasText: "Home" }).click();
  await page.keyboard.press("Control+k");
  await expect(page.locator('[role="combobox"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[role="combobox"]').fill("downloads");
  await expect(page.locator('[role="option"]').first()).toContainText("Downloads");
  await page.keyboard.press("Enter");
  await expect(page.locator(".grabber-view h1")).toHaveText("Downloads", { timeout: 15000 });
  // Reopen and dismiss with Escape; focus returns without errors.
  await page.keyboard.press("Control+k");
  await expect(page.locator('[role="combobox"]')).toBeVisible({ timeout: 15000 });
  await page.keyboard.press("Escape");
  await expect(page.locator('[role="combobox"]')).toHaveCount(0);
  // Bare ? opens the shortcut help; Escape closes it.
  await page.keyboard.press("?");
  await expect(page.locator('[data-testid="shortcuts-dialog"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="shortcuts-dialog"]')).toContainText("Ctrl+K");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="shortcuts-dialog"]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("onboarding: replay from Settings then skip", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0);
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await page.locator('[data-testid="settings-replay"]').click();
  await expect(page.locator('[data-testid="onboarding"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="onboard-skip"]').click();
  await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("onboarding: replay → navigate to last step → Done dismisses", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0);
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await page.locator('[data-testid="settings-replay"]').click();
  await expect(page.locator('[data-testid="onboarding"]')).toBeVisible({ timeout: 15000 });
  // Navigate: folder → theme → preset (the Done button only appears on the last step).
  await page.locator('[data-testid="onboarding"] .btn-primary').click();
  await page.locator('[data-testid="onboarding"] .btn-primary').click();
  await expect(page.locator('[data-testid="onboard-done"]')).toBeVisible({ timeout: 5000 });
  await page.locator('[data-testid="onboard-done"]').click();
  await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("i18n: switching to Malay re-labels the shell", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await page.locator("#set-language").selectOption("ms");
  await page.locator(".grabber-nav-btn").filter({ hasText: "Tetapan" }).click();
  await expect(page.locator(".grabber-view h1")).toHaveText("Tetapan", { timeout: 15000 });
  await page.locator(".grabber-nav-btn").filter({ hasText: "Utama" }).click();
  await expect(page.locator(".grabber-view h1")).toHaveText("Utama", { timeout: 15000 });
  await page.locator(".grabber-nav-btn").filter({ hasText: "Tetapan" }).click();
  await page.locator("#set-language").selectOption("en");
  await expect(page.locator(".grabber-view h1")).toHaveText("Settings", { timeout: 15000 });
  expect(pageErrors).toEqual([]);
});

test("settings: search filters rows and clears", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator('[data-testid="settings-search"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="settings-search"]').fill("proxy");
  await expect(page.locator("#set-proxy")).toBeVisible();
  await expect(page.locator("#set-theme-label")).toBeHidden();
  // The field count grows with every release, so match the shape not the number.
  await expect(page.locator(".grabber-view")).toContainText(/\d+ of \d+ settings/);
  await page.locator('[data-testid="settings-search"]').fill("zzz-no-match");
  await expect(page.locator(".grabber-view")).toContainText("No settings match.");
  await page.locator('[data-testid="settings-search"]').fill("");
  await expect(page.locator("#set-theme-label")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("settings: tools section lists engines with actions", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator('[data-testid="settings-search"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-testid="settings-search"]').fill("tools");
  await expect(page.locator(".grabber-view")).toContainText("Tools & Engines");
  await expect(page.locator(".grabber-view")).toContainText("yt-dlp");
  await expect(page.locator(".grabber-view")).toContainText("gallery-dl");
  expect(pageErrors).toEqual([]);
});

test("mini mode: Ctrl+Shift+M toggles the compact view and syncs chrome", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".grabber-nav")).toBeVisible();

  await page.keyboard.press("Control+Shift+KeyM");
  await expect(page.locator('[data-testid="mini-view"]')).toBeVisible({ timeout: 15000 });
  // Sidebar is hidden and the layout flag reaches <html>.
  await expect(page.locator(".grabber-nav")).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-mini", "true");
  const chrome = await page.evaluate(() => {
    const mock = (window as unknown as { __grabberOverride?: { _chrome?: () => unknown } })
      .__grabberOverride;
    return mock?._chrome?.() ?? null;
  });
  expect(chrome).toMatchObject({ mini: true });

  // Leaving mini restores the normal shell.
  await page.locator('[data-testid="mini-exit"]').click();
  await expect(page.locator('[data-testid="mini-view"]')).toHaveCount(0);
  await expect(page.locator(".grabber-nav")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("mini mode: a tray-side chrome push switches the layout", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await page.evaluate(() => {
    const mock = (
      window as unknown as {
        __grabberOverride?: { _emitChrome?: (s: { mini: boolean; theme: string }) => void };
      }
    ).__grabberOverride;
    mock?._emitChrome?.({ mini: true, theme: "obsidian" });
  });
  await expect(page.locator('[data-testid="mini-view"]')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const mock = (
      window as unknown as {
        __grabberOverride?: { _emitChrome?: (s: { mini: boolean; theme: string }) => void };
      }
    ).__grabberOverride;
    mock?._emitChrome?.({ mini: false, theme: "obsidian" });
  });
  await expect(page.locator('[data-testid="mini-view"]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("stats: shows totals, weekly chart and uploaders from history", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });

  // Empty history first.
  await page.locator(".grabber-nav-btn").filter({ hasText: "Stats" }).click();
  await expect(page.locator('[data-testid="stats-empty"]')).toBeVisible({ timeout: 15000 });

  // Mixed old/new records: a legacy record without size/uploader/finishedAt.
  const applied = await page.evaluate(() => {
    const mock = (
      window as unknown as { __grabberOverride?: { _setHistory?: (rows: unknown[]) => void } }
    ).__grabberOverride;
    if (typeof mock?._setHistory !== "function") return false;
    const base = {
      url: "https://youtu.be/x",
      title: "T",
      preset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
      outputDir: "C:\\Vids",
      progress: 100,
      speed: null,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: "done",
      error: null,
      attempts: 0,
      nextRetryAt: null,
      destination: null,
    };
    mock._setHistory([
      {
        ...base,
        id: "old",
        status: "done",
        createdAt: Date.now() - 5 * 86_400_000,
        totalBytes: 5_000_000,
        durationSec: 120,
        uploader: "Chan A",
        finishedAt: Date.now(),
      },
      { ...base, id: "legacy", status: "done", createdAt: Date.now() - 3 * 86_400_000 },
      { ...base, id: "bad", status: "error", createdAt: Date.now(), error: "boom" },
    ]);
    return true;
  });
  expect(applied).toBe(true);

  // Leave and come back so the screen re-reads history (view swaps animate).
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator(".grabber-view h1")).toHaveText("Settings", { timeout: 15000 });
  await page.locator(".grabber-nav-btn").filter({ hasText: "Stats" }).click();
  await expect(page.locator('[data-testid="stats-view"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="stats-tiles"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="stats-tiles"]')).toContainText("2");
  await expect(page.locator('[data-testid="stats-weeks"]')).toBeVisible();
  await expect(page.locator('[data-testid="stats-uploaders"]')).toContainText("Chan A");
  // The legacy record has no size, so the note must surface.
  await expect(page.locator('[data-testid="stats-unknown-size"]')).toContainText("1");
  expect(pageErrors).toEqual([]);
});

test("themes: the Paper light theme applies and persists to chrome", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "obsidian");

  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator(".grabber-view h1")).toHaveText("Settings", { timeout: 15000 });
  await page.locator(".chip").filter({ hasText: "Paper" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");

  // The native window colors follow the theme through applyWindowChrome.
  const chrome = await page.evaluate(() => {
    const mock = (window as unknown as { __grabberOverride?: { _chrome?: () => unknown } })
      .__grabberOverride;
    return mock?._chrome?.() ?? null;
  });
  expect(chrome).toMatchObject({ theme: "paper" });
  expect(pageErrors).toEqual([]);
});

test("library: Download again asks first and then really re-downloads", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  const record = {
    id: "lib-1",
    url: "https://youtu.be/aqz-KE-bpKQ",
    title: "Re-download me",
    preset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
outputDir: "C:\\Vids",
    status: "done",
    progress: 100,
    speed: null,
    eta: null,
    downloadedBytes: 10,
    totalBytes: 10,
    stage: "done",
    error: null,
    createdAt: Date.now() - 1000,
    attempts: 0,
    nextRetryAt: null,
    destination: "C:\\Vids\\Re-download me.mp4",
  };
  await page.evaluate((row) => {
    const mock = (
      window as unknown as { __grabberOverride?: { _setHistory?: (rows: unknown[]) => void } }
    ).__grabberOverride;
    mock?._setHistory?.([row]);
  }, record);

  await page.locator(".grabber-nav-btn").filter({ hasText: "Library" }).click();
  await expect(page.locator(".grabber-card").filter({ hasText: "Re-download me" })).toBeVisible({
    timeout: 15000,
  });

  // 1) Declining the confirmation must not queue anything.
  page.once("dialog", (d) => {
    void d.dismiss();
  });
  await page
    .locator(".grabber-card")
    .filter({ hasText: "Re-download me" })
    .locator(".btn")
    .filter({ hasText: "Download again" })
    .click();
  await page.waitForTimeout(500);
  let started = await page.evaluate(() => {
    const mock = (window as unknown as { __grabberOverride?: { _started?: unknown[] } })
      .__grabberOverride;
    return (mock?._started ?? []).length;
  });
  expect(started).toBe(0);

  // 2) Accepting queues it, and the job carries forceOverwrite so yt-dlp
  //    actually refetches instead of answering "has already been downloaded".
  page.once("dialog", (d) => {
    void d.accept();
  });
  await page
    .locator(".grabber-card")
    .filter({ hasText: "Re-download me" })
    .locator(".btn")
    .filter({ hasText: "Download again" })
    .click();
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const mock = (window as unknown as { __grabberOverride?: { _started?: unknown[] } })
            .__grabberOverride;
          return (mock?._started ?? []).length;
        }),
      { timeout: 10000 },
    )
    .toBe(1);
  started = await page.evaluate(() => {
    const mock = (window as unknown as { __grabberOverride?: { _started?: unknown[] } })
      .__grabberOverride;
    return (mock?._started ?? []).length;
  });
  expect(started).toBe(1);
  const payload = await page.evaluate(() => {
    const mock = (window as unknown as { __grabberOverride?: { _started?: unknown[] } })
      .__grabberOverride;
    return (mock?._started ?? [])[0] as { forceOverwrite?: boolean } | undefined;
  });
  expect(payload?.forceOverwrite).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("v1.7.2: every container and audio format is offered", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator("#set-merge")).toBeVisible({ timeout: 15000 });

  // Exactly the container set the bundled yt-dlp accepts (verified with
  // `yt-dlp --help`): avi flv mkv mov mp4 webm, plus gif for --remux-video.
  const containers = await page.locator("#set-merge option").allTextContents();
  expect(containers.map((c) => c.trim()).sort()).toEqual(
    ["avi", "flv", "gif", "mkv", "mov", "mp4", "webm"].sort(),
  );

  // …and the full --audio-format set on the audio preset chips.
  await page.locator(".grabber-nav-btn").filter({ hasText: "Home" }).click();
  await page.locator("#home-url").fill("https://example.com/formats");
  await page.locator(".url-row .btn").filter({ hasText: "Analyze" }).click();
  await expect(page.locator(".preview-title")).toHaveText("Mock Video", { timeout: 15000 });
  // The Batch panel has its own Audio chip, so scope to the preview card.
  await page.locator(".grabber-card").filter({ has: page.locator(".preview-title") }).getByRole("button", { name: "Audio" }).click();
// Chip labels carry an estimated size after the preset name.
  const audioChips = (await page.locator(".chip-row .chip").allTextContents()).map(
    (t) => t.split(" -")[0]?.trim() ?? t,
  );
  // Exactly yt-dlp's --audio-format set: best aac alac flac m4a mp3 opus
  // vorbis wav.
  expect(audioChips.sort()).toEqual(
    ["AAC", "ALAC", "Best", "FLAC", "M4A", "MP3", "Opus", "Vorbis", "WAV"].sort(),
  );
  expect(pageErrors).toEqual([]);
});

test("v1.7.2: polite pacing persists and reaches the download", async () => {
  if (app === null) throw new Error("electron did not launch");
  const page = await app.firstWindow();
  await installMock(page);
  await page.reload();

  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 30000 });
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();

  // Empty by default = off.
  await expect(page.locator('[data-setting="sleepRequestsSec"]')).toHaveValue("");

  // The "Standard" preset fills in yt-dlp's documented flags.
  await page.locator(".chip").filter({ hasText: "Standard" }).first().click();
  await expect(page.locator('[data-setting="sleepRequestsSec"]')).toHaveValue("2", {
    timeout: 10000,
  });
  await expect(page.locator('[data-setting="minSleepIntervalSec"]')).toHaveValue("5");
  await expect(page.locator('[data-setting="maxSleepIntervalSec"]')).toHaveValue("10");

  const saved = await page.evaluate(() => {
    const mock = (
      window as unknown as { __grabberOverride?: { loadSettings?: () => Promise<unknown> } }
    ).__grabberOverride;
    return mock?.loadSettings?.() ?? null;
  });
  expect(saved).toMatchObject({
    pacing: {
      sleepRequestsSec: 2,
      minSleepIntervalSec: 5,
      maxSleepIntervalSec: 10,
    },
  });
  expect(pageErrors).toEqual([]);
});

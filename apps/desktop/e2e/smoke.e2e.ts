import { _electron as electron } from "@playwright/test";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

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
      cookiesFromBrowser: null,
      cookiesFile: null,
      embedThumbnail: false,
      embedMetadata: false,
      subtitles: false,
      subtitleLangs: "en",
      embedSubs: false,
      includeAutoSubs: true,
      mergeContainer: "mp4",
      sponsorBlock: false,
      codecPreference: "auto",
      skipArchived: true,
      density: "comfortable",
      accentOverride: null,
      language: "en",
      analyzeTimeoutSec: 60,
      thumbnailAccent: true,
      playlistSubfolder: true,
      historyLimit: 500,
      closeBehavior: "tray",
      minimizeToTray: false,
      onboardingDone: true,
      defaultPreset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
      theme: "obsidian",
      postDownloadAction: "none",
      autoCheckUpdate: false,
    };
    const started: Array<unknown> = [];
    const historyFixture: unknown[] = [];
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
    const versions = { ytdlp: "mock", ffmpeg: null, app: "0.0.0-e2e" };
    let n = 0;
    const mock = {
      getInfo: (url: string): Promise<unknown> =>
        Promise.resolve({
          url,
          title: "Mock Video",
          uploader: "Mock Uploader",
          duration: 125,
          thumbnail: null,
          isPlaylist: false,
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
      onProgress: (cb: (e: unknown) => void): (() => void) => {
        listeners.push(cb);
        return () => undefined;
      },
      getEngineVersion: (): Promise<unknown> => Promise.resolve({ ...versions }),
      updateEngine: (): Promise<unknown> => Promise.resolve({ ...versions }),
      repairEngine: (): Promise<unknown> =>
        Promise.resolve({ ok: true, repaired: ["yt-dlp.exe"], failed: [], versions }),
      pickFolder: (): Promise<null> => Promise.resolve(null),
      pickFile: (): Promise<null> => Promise.resolve(null),
      openPath: (): Promise<void> => Promise.resolve(),
      revealInFolder: (): Promise<void> => Promise.resolve(),
      fileExists: (): Promise<boolean> => Promise.resolve(false),
      trashFile: (): Promise<void> => Promise.resolve(),
      updateHistory: (): Promise<void> => Promise.resolve(),
      getThumbnailColor: (): Promise<null> => Promise.resolve(null),
      fileExistsBulk: (): Promise<boolean[]> => Promise.resolve([]),
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
      saveSettings: (patch: unknown): Promise<unknown> => {
        if (typeof patch === "object" && patch !== null) {
          return Promise.resolve({ ...settings, ...patch });
        }
        return Promise.resolve({ ...settings });
      },
      loadQueue: (): Promise<unknown[]> => Promise.resolve([]),
      saveQueue: (): Promise<void> => Promise.resolve(),
      appendHistory: (): Promise<void> => Promise.resolve(),
      loadHistory: (): Promise<unknown[]> => Promise.resolve(historyFixture),
      removeHistory: (): Promise<void> => Promise.resolve(),
      clearHistory: (): Promise<void> => Promise.resolve(),
      getRawLog: (): Promise<string> => Promise.resolve("mock log"),
      shutdown: (): Promise<void> => Promise.resolve(),
      onDeepLink: (): (() => void) => () => undefined,
      checkForUpdates: (): Promise<unknown> =>
        Promise.resolve({
          appCurrent: "0.0.0-e2e",
          appLatest: null,
          appUpdate: false,
          appUrl: "https://github.com/Myung-Young/FluxDL/releases",
          ytdlpCurrent: "mock",
          ytdlpLatest: null,
          ytdlpUpdate: false,
          checkedAt: 0,
        }),
      getMediaUrl: (): Promise<null> => Promise.resolve(null),
      openExternal: (): Promise<void> => Promise.resolve(),
      _started: started,
      _chrome: () => chromeState,
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

test.beforeAll(async () => {
  app = await electron.launch({ args: ["."] });
});

test.afterAll(async () => {
  await app?.close();
  app = null;
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
  await expect(page.locator(".grabber-nav-btn")).toHaveCount(6);

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
  // Headless clipboard permission varies: either note proves the button ran.
  // Scoped to the log card (the diagnostics card shows its own copy note).
  await expect(
    page.locator(".grabber-view").getByText(/Log copied\.|Copy failed\./).first(),
  ).toBeVisible();
  await page.locator('[data-testid="logs-search"]').fill("");
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
  await expect(page.locator(".grabber-view")).toContainText("of 20 settings");
  await page.locator('[data-testid="settings-search"]').fill("zzz-no-match");
  await expect(page.locator(".grabber-view")).toContainText("No settings match.");
  await page.locator('[data-testid="settings-search"]').fill("");
  await expect(page.locator("#set-theme-label")).toBeVisible();
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

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
    const settings = {
      downloadDir: "",
      filenameTemplate: "%(title)s [%(id)s].%(ext)s",
      concurrency: 2,
      speedLimit: null,
      proxy: null,
      cookiesFromBrowser: null,
      embedThumbnail: false,
      embedMetadata: false,
      subtitles: false,
      subtitleLangs: "en",
      embedSubs: false,
      mergeContainer: "mp4",
      sponsorBlock: false,
      theme: "obsidian",
      postDownloadAction: "none",
      autoCheckUpdate: false,
    };
    const started: Array<unknown> = [];
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
        const id = "eng-mock-1";
        setTimeout(() => {
          fireProgress(id);
        }, 100);
        return Promise.resolve(id);
      },
      pause: (): Promise<void> => Promise.resolve(),
      resume: (): Promise<void> => Promise.resolve(),
      cancel: (): Promise<void> => Promise.resolve(),
      onProgress: (cb: (e: unknown) => void): (() => void) => {
        listeners.push(cb);
        return () => undefined;
      },
      getEngineVersion: (): Promise<unknown> => Promise.resolve({ ...versions }),
      updateEngine: (): Promise<unknown> => Promise.resolve({ ...versions }),
      pickFolder: (): Promise<null> => Promise.resolve(null),
      openPath: (): Promise<void> => Promise.resolve(),
      revealInFolder: (): Promise<void> => Promise.resolve(),
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
      loadHistory: (): Promise<unknown[]> => Promise.resolve([]),
      removeHistory: (): Promise<void> => Promise.resolve(),
      clearHistory: (): Promise<void> => Promise.resolve(),
      getRawLog: (): Promise<string> => Promise.resolve("mock log"),
      _started: started,
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
  await expect(page.locator(".grabber-nav-btn")).toHaveCount(5);

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

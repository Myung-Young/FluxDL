import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { _electron as electron } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Settings persistence against the REAL engine (no `__grabberOverride`).
 *
 * This file exists because a bug shipped undetected for five releases: the
 * main bundle is CommonJS, electron-store v11 is ESM-only, so every
 * `saveSettings` threw "Store is not a constructor" — and the UI swallowed
 * the rejection. Unit tests passed (vitest loads ESM natively) and the mock
 * e2e passed (it mocks `saveSettings`). Only a real run with a real disk
 * could catch it. Never mock persistence here (D94).
 */
// Playwright runs with cwd = apps/desktop (playwright.config.ts lives there).
const APP_DIR = process.cwd();

let app: ElectronApplication | null = null;
let page: Page | null = null;
let userData = "";
const errors: string[] = [];

function settingsFile(): string {
  return join(userData, "grabber-settings.json");
}

function readSettings(): Record<string, unknown> | null {
  const file = settingsFile();
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), "fluxdl-settings-e2e-"));
  app = await electron.launch({
    args: ["." , `--user-data-dir=${userData}`],
    cwd: APP_DIR,
  });
  page = await app.firstWindow();
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${String(err)}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 60000 });
  // Dismiss first-run onboarding so the shell is interactive.
  const skip = page.locator('[data-testid="onboard-skip"]');
  if ((await skip.count()) > 0) await skip.click();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  app = null;
  page = null;
  rmSync(userData, { recursive: true, force: true });
});

test("a checkbox toggle is written to disk and survives a reload", async () => {
  if (page === null) throw new Error("app did not launch");
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator(".grabber-view h1")).toHaveText("Settings", { timeout: 20000 });

  // Address the toggle by its SETTING KEY, not by position: the rows are
  // regrouped and reordered with every release, which is what silently broke
  // this test before (it was asserting `embedThumbnail` while clicking the
  // first checkbox, which is now a subtitle toggle).
  const first = page.locator('input[data-setting="embedThumbnail"]');
  await expect(first).toBeVisible({ timeout: 15000 });
  const before = await first.isChecked();
  await first.click();
  await expect(first).toBeChecked({ timeout: 10000 });
  await expect
    .poll(() => readSettings()?.["embedThumbnail"], { timeout: 10000 })
    .toBe(!before);

  // The value must come back from disk on a fresh renderer.
  await page.reload();
  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 60000 });
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator(".grabber-view h1")).toHaveText("Settings", { timeout: 20000 });
  await expect(page.locator('input[data-setting="embedThumbnail"]')).toBeChecked({
    timeout: 15000,
  });
});

test("select and text inputs persist to disk", async () => {
  if (page === null) throw new Error("app did not launch");
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator(".grabber-view h1")).toHaveText("Settings", { timeout: 20000 });

  await page.locator("#set-merge").selectOption("mkv");
  await expect.poll(() => readSettings()?.["mergeContainer"], { timeout: 10000 }).toBe("mkv");

  await page.locator("#set-proxy").fill("http://127.0.0.1:9");
  await page.locator("#set-proxy").blur();
  await expect.poll(() => readSettings()?.["proxy"], { timeout: 10000 }).toBe("http://127.0.0.1:9");

  await page.locator("#set-language").selectOption("ms");
  await expect.poll(() => readSettings()?.["language"], { timeout: 10000 }).toBe("ms");
  // Back to English so the remaining assertions can find nav labels.
  await page.locator("#set-language").selectOption("en");
  await expect.poll(() => readSettings()?.["language"], { timeout: 10000 }).toBe("en");
});

test("choosing a theme persists and survives a reload", async () => {
  if (page === null) throw new Error("app did not launch");
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator(".grabber-view h1")).toHaveText("Settings", { timeout: 20000 });
  await page.locator(".chip").filter({ hasText: "Paper" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper", { timeout: 10000 });
  await expect.poll(() => readSettings()?.["theme"], { timeout: 10000 }).toBe("paper");

  await page.reload();
  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 60000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper", { timeout: 15000 });
  // Leave the machine on the default theme for later runs.
  await page.locator(".grabber-dot").first().click();
  await expect.poll(() => readSettings()?.["theme"], { timeout: 10000 }).toBe("obsidian");
});

test("settings survive a full app restart", async () => {
  if (app === null || page === null) throw new Error("app did not launch");
  await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
  await expect(page.locator(".grabber-view h1")).toHaveText("Settings", { timeout: 20000 });
  await page.locator("#set-merge").selectOption("webm");
  await expect.poll(() => readSettings()?.["mergeContainer"], { timeout: 10000 }).toBe("webm");

  await app.close();
  app = await electron.launch({ args: ["." , `--user-data-dir=${userData}`], cwd: APP_DIR });
  page = await app.firstWindow();
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${String(err)}`);
  });
  await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 60000 });
  const loaded = await page.evaluate(async () => {
    const api = (window as unknown as { grabber?: { loadSettings(): Promise<unknown> } }).grabber;
    return (await api?.loadSettings()) as { mergeContainer?: string } | undefined;
  });
  expect(loaded?.mergeContainer).toBe("webm");
  expect(errors).toEqual([]);
});
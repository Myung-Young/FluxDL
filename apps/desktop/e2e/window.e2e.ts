import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { _electron as electron } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Window geometry against the REAL main process (no `__grabberOverride`).
 *
 * The reported bug: moving the window and then changing ANY setting snapped it
 * back to the middle of the screen. The cause was in the main process
 * (`applyChrome` re-centred on every apply, and the renderer re-applies chrome
 * on every theme change), so only a real BrowserWindow can prove the fix — a
 * mocked engine never touches it.
 */

const APP_DIR = process.cwd();

let app: ElectronApplication | null = null;
let page: Page | null = null;
let userData = "";

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function stateFile(): string {
  return join(userData, "window-state.json");
}

function readState(): Record<string, unknown> | null {
  if (!existsSync(stateFile())) return null;
  return JSON.parse(readFileSync(stateFile(), "utf8")) as Record<string, unknown>;
}

async function bounds(): Promise<Bounds | null> {
  if (app === null) return null;
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w === undefined ? null : w.getBounds();
  });
}

async function moveTo(x: number, y: number): Promise<void> {
  if (app === null) throw new Error("app is not running");
  await app.evaluate(
    ({ BrowserWindow }, pos) => {
      BrowserWindow.getAllWindows()[0]?.setBounds({ x: pos.x, y: pos.y });
    },
    { x, y },
  );
}

test.describe("window geometry (real BrowserWindow)", () => {
  test.beforeAll(async () => {
    userData = mkdtempSync(join(tmpdir(), "fluxdl-window-e2e-"));
    writeFileSync(
      join(userData, "grabber-settings.json"),
      JSON.stringify({ onboardingDone: true }),
    );
    app = await electron.launch({
      args: [".", `--user-data-dir=${userData}`],
      cwd: APP_DIR,
    });
    page = await app.firstWindow();
    await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 60000 });
    const skip = page.locator('[data-testid="onboard-skip"]');
    if ((await skip.count()) > 0) await skip.click();
  });

  test.afterAll(async () => {
    await app?.close().catch(() => undefined);
    app = null;
    page = null;
    rmSync(userData, { recursive: true, force: true });
  });

  test("changing settings does not move the window", async () => {
    if (app === null || page === null) throw new Error("app did not launch");
    const start = await bounds();
    expect(start).not.toBeNull();

    // Park the window somewhere specific.
    const target = { x: (start?.x ?? 0) + 40, y: (start?.y ?? 0) + 30 };
    await moveTo(target.x, target.y);
    await page.waitForTimeout(700);
    const parked = await bounds();
    expect(parked?.x).toBe(target.x);
    expect(parked?.y).toBe(target.y);

    // The reported repro: move the window, then touch settings.
    await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
    await expect(page.locator(".grabber-view h1")).toHaveText("Settings", { timeout: 20000 });
    const toggle = page.locator('input[data-setting="notifyFinished"]');
    await expect(toggle).toBeVisible({ timeout: 15000 });
    await toggle.click();
    await page.waitForTimeout(900);

    const after = await bounds();
    expect(after?.x).toBe(target.x);
    expect(after?.y).toBe(target.y);

    // …and the theme follow toggle, which DOES flow into window chrome.
    const follow = page.locator('input[data-setting="followSystemTheme"]');
    await follow.click();
    await page.waitForTimeout(900);
    const afterFollow = await bounds();
    expect(afterFollow?.x).toBe(target.x);
    expect(afterFollow?.y).toBe(target.y);
    // Put it back: with it on, the effective theme follows the OS and the
    // explicit-theme assertions below would not hold.
    await follow.click();
    await page.waitForTimeout(500);
  });

  test("switching the theme does not move the window", async () => {
    if (app === null || page === null) throw new Error("app did not launch");
    await page.locator(".grabber-nav-btn").filter({ hasText: "Settings" }).click();
    await expect(page.locator(".grabber-view h1")).toHaveText("Settings", { timeout: 20000 });
    const before = await bounds();

    // Every theme change re-applies chrome — the exact trigger for the bug.
    await page.locator(".chip").filter({ hasText: "Ember" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "ember", { timeout: 15000 });
    await page.locator(".chip").filter({ hasText: "Obsidian" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "obsidian", { timeout: 15000 });
    await page.waitForTimeout(700);

    const after = await bounds();
    expect(after?.x).toBe(before?.x);
    expect(after?.y).toBe(before?.y);
  });

  test("the placement is persisted and restored on the next launch", async () => {
    if (app === null || page === null) throw new Error("app did not launch");
    const start = await bounds();
    const target = { x: (start?.x ?? 0) - 60, y: (start?.y ?? 0) + 45 };
    await moveTo(target.x, target.y);
    // The debounced `move` handler persists the settled position.
    await page.waitForTimeout(1200);

    const state = readState();
    expect(state?.["normalX"]).toBe(target.x);
    expect(state?.["normalY"]).toBe(target.y);

    await app.close();
    app = null;
    page = null;

    // Relaunch with the same userData: the window must come back where it was.
    app = await electron.launch({
      args: [".", `--user-data-dir=${userData}`],
      cwd: APP_DIR,
    });
    page = await app.firstWindow();
    await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 60000 });
    const skip = page.locator('[data-testid="onboard-skip"]');
    if ((await skip.count()) > 0) await skip.click();

    const restored = await bounds();
    expect(restored?.x).toBe(target.x);
    expect(restored?.y).toBe(target.y);
  });

  test("a remembered spot on a disconnected display falls back to centring", async () => {
    if (app === null) throw new Error("app did not launch");
    // Write an off-screen position, as if a second monitor had been unplugged.
    writeFileSync(
      stateFile(),
      `${JSON.stringify({
        mini: false,
        theme: "obsidian",
        miniX: null,
        miniY: null,
        normalX: 99_000,
        normalY: 99_000,
      })}\n`,
      "utf8",
    );
    await app.close();
    app = null;
    page = null;

    app = await electron.launch({
      args: [".", `--user-data-dir=${userData}`],
      cwd: APP_DIR,
    });
    page = await app.firstWindow();
    await expect(page.locator('[data-testid="grabber-shell"]')).toBeVisible({ timeout: 60000 });

    const restored = await bounds();
    expect(restored).not.toBeNull();
    // Not the 99_000 we wrote, and centred on the primary display instead.
    expect(restored?.x).not.toBe(99_000);
    expect(restored?.y).not.toBe(99_000);
    const expected = await app.evaluate(({ screen, BrowserWindow }) => {
      const area = screen.getPrimaryDisplay().workArea;
      const w = BrowserWindow.getAllWindows()[0]?.getSize();
      const width = w?.[0] ?? area.width;
      const height = w?.[1] ?? area.height;
      return {
        x: width >= area.width ? area.x : area.x + Math.round((area.width - width) / 2),
        y: height >= area.height ? area.y : area.y + Math.round((area.height - height) / 2),
      };
    });
    expect(restored?.x).toBe(expected.x);
    expect(restored?.y).toBe(expected.y);
  });
});
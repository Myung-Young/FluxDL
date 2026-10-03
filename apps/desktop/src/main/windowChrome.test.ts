import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WINDOW_STATE,
  colorsFor,
  loadWindowState,
  resolveBounds,
  sanitizeWindowState,
  saveWindowState,
} from "./windowChrome.js";
import { NORMAL_BOUNDS } from "@grabber/core/window.js";

/**
 * M4.4/M4.6: window geometry + persistence. The BrowserWindow itself is not
 * constructed here (no Electron in vitest), so the pure parts are pinned here
 * and the live window behaviour is covered by the Playwright smoke test.
 */
function dir(): string {
  return mkdtempSync(join(tmpdir(), "fluxdl-chrome-"));
}

describe("sanitizeWindowState", () => {
  it("falls back to defaults for junk", () => {
    for (const bad of [null, undefined, 5, "x", []]) {
      expect(sanitizeWindowState(bad)).toEqual(DEFAULT_WINDOW_STATE);
    }
  });

  it("keeps only positive finite numbers", () => {
    const state = sanitizeWindowState({
      mini: true,
      theme: "paper",
      normalWidth: 1200,
      normalHeight: -5,
      miniX: Number.NaN,
      miniY: 40.6,
    });
    expect(state.mini).toBe(true);
    expect(state.theme).toBe("paper");
    expect(state.normalWidth).toBe(1200);
    expect(state.normalHeight).toBeNull();
    expect(state.miniX).toBeNull();
    expect(state.miniY).toBe(41);
  });

  it("rejects unknown themes (renderer is untrusted)", () => {
    expect(sanitizeWindowState({ theme: "../../evil" }).theme).toBe("obsidian");
    expect(sanitizeWindowState({ theme: "midnight" }).theme).toBe("midnight");
  });

  it("treats a non-boolean mini flag as false", () => {
    expect(sanitizeWindowState({ mini: "yes" }).mini).toBe(false);
  });
});

describe("colorsFor", () => {
  it("maps every known theme to native window colors", () => {
    for (const theme of ["obsidian", "midnight", "ember", "paper"]) {
      const colors = colorsFor(theme);
      expect(colors.bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(colors.fg).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("falls back to obsidian for unknown themes", () => {
    expect(colorsFor("nope")).toEqual(colorsFor("obsidian"));
  });
});

describe("resolveBounds", () => {
  it("uses the compact size when entering mini mode", () => {
    const r = resolveBounds(DEFAULT_WINDOW_STATE, true);
    expect(r).toEqual({ width: 360, height: 520, stored: false });
  });

  it("restores the remembered normal size when leaving", () => {
    const r = resolveBounds({ ...DEFAULT_WINDOW_STATE, normalWidth: 1440, normalHeight: 900 }, false);
    expect(r).toEqual({ width: 1440, height: 900, stored: false });
  });

  it("falls back to the app default when nothing was remembered", () => {
    expect(resolveBounds(DEFAULT_WINDOW_STATE, false)).toEqual({
      width: NORMAL_BOUNDS.width,
      height: NORMAL_BOUNDS.height,
      stored: false,
    });
  });

  it("reuses a stored mini position on re-entry", () => {
    const r = resolveBounds({ ...DEFAULT_WINDOW_STATE, miniX: 100, miniY: 120 }, true);
    expect(r.stored).toBe(true);
  });
});

describe("window state persistence", () => {
  it("round-trips through userData", async () => {
    const base = dir();
    try {
      const state = { ...DEFAULT_WINDOW_STATE, mini: true, theme: "paper", normalWidth: 1300 };
      await saveWindowState(base, state);
      expect(await loadWindowState(base)).toEqual(state);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("returns defaults for a missing or corrupt file", async () => {
    const base = dir();
    try {
      expect(await loadWindowState(base)).toEqual(DEFAULT_WINDOW_STATE);
      writeFileSync(join(base, "window-state.json"), "{not json", "utf8");
      expect(await loadWindowState(base)).toEqual(DEFAULT_WINDOW_STATE);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("creates the directory when it is missing", async () => {
    const base = join(dir(), "nested", "deep");
    try {
      await saveWindowState(base, DEFAULT_WINDOW_STATE);
      expect(await loadWindowState(base)).toEqual(DEFAULT_WINDOW_STATE);
    } finally {
      rmSync(join(base, ".."), { recursive: true, force: true });
    }
  });

  it("does not throw when the target is unusable", async () => {
    const base = dir();
    try {
      mkdirSync(base, { recursive: true });
      await expect(saveWindowState("C:\\bad\0path", DEFAULT_WINDOW_STATE)).resolves.toBeUndefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
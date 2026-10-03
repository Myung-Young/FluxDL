import type { BrowserWindow } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WindowChromeState } from "@grabber/core/engine.js";
import { boundsFor, MINI_HEIGHT, MINI_WIDTH, NORMAL_BOUNDS } from "@grabber/core/window.js";

/**
 * Window chrome (M4.4 mini mode, M4.6 theme colors) — main process only.
 *
 * Geometry lives here, not in AppSettings: window bounds are not user
 * preferences, and keeping them out of the settings shape means the pinned
 * settings test and the e2e mock cannot drift (D83). State is persisted in
 * `<userData>/window-state.json`.
 */
const STATE_FILE = "window-state.json";

/** Native colors per theme; mirrors tokens.css bg-0 / fg-0. */
const THEME_COLORS: Readonly<Record<string, { bg: string; fg: string }>> = {
  obsidian: { bg: "#0a0a0b", fg: "#f4f4f5" },
  midnight: { bg: "#07070f", fg: "#eef0ff" },
  ember: { bg: "#0e0805", fg: "#fff4e8" },
  paper: { bg: "#faf9f6", fg: "#1c1b19" },
};

const FALLBACK_COLORS = THEME_COLORS["obsidian"] ?? { bg: "#0a0a0b", fg: "#f4f4f5" };

export interface WindowState {
  readonly mini: boolean;
  readonly theme: string;
  /** Restored normal-mode size (null = use the default). */
  readonly normalWidth: number | null;
  readonly normalHeight: number | null;
  readonly miniX: number | null;
  readonly miniY: number | null;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  mini: false,
  theme: "obsidian",
  normalWidth: null,
  normalHeight: null,
  miniX: null,
  miniY: null,
};

/** Colors for a theme name, falling back to obsidian for unknown values. */
export function colorsFor(theme: string): { bg: string; fg: string } {
  return THEME_COLORS[theme] ?? FALLBACK_COLORS;
}

/** Sanitize a persisted state file (never trust disk content). */
export function sanitizeWindowState(raw: unknown): WindowState {
  if (typeof raw !== "object" || raw === null) return DEFAULT_WINDOW_STATE;
  const rec = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const theme = typeof rec["theme"] === "string" ? rec["theme"] : DEFAULT_WINDOW_STATE.theme;
  return {
    mini: rec["mini"] === true,
    theme: colorsFor(theme) === FALLBACK_COLORS && theme !== "obsidian" ? "obsidian" : theme,
    normalWidth: num(rec["normalWidth"]),
    normalHeight: num(rec["normalHeight"]),
    miniX: num(rec["miniX"]),
    miniY: num(rec["miniY"]),
  };
}

export async function loadWindowState(userDataDir: string): Promise<WindowState> {
  try {
    const text = await readFile(join(userDataDir, STATE_FILE), "utf8");
    return sanitizeWindowState(JSON.parse(text));
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

export async function saveWindowState(userDataDir: string, state: WindowState): Promise<void> {
  const file = join(userDataDir, STATE_FILE);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(state)}\n`, "utf8");
  } catch {
    // Best effort: a missing bounds file only costs a default window size.
  }
}

/** Pure geometry for a mode change. */
export interface ResolvedBounds {
  readonly width: number;
  readonly height: number;
  /** True when a stored mini position should be reused. */
  readonly stored: boolean;
}

export function resolveBounds(state: WindowState, next: boolean): ResolvedBounds {
  if (next) {
    const size = boundsFor(true);
    return {
      width: Math.max(size.width, MINI_WIDTH),
      height: Math.max(size.height, MINI_HEIGHT),
      stored: state.miniX !== null && state.miniY !== null,
    };
  }
  return {
    width: state.normalWidth ?? NORMAL_BOUNDS.width,
    height: state.normalHeight ?? NORMAL_BOUNDS.height,
    stored: false,
  };
}

/** Apply chrome to a live window (always-on-top + size + native colors). */
export async function applyChrome(
  win: BrowserWindow | null,
  userDataDir: string,
  state: WindowState,
  next: boolean,
): Promise<WindowState> {
  const target = resolveBounds(state, next);
  let miniX = state.miniX;
  let miniY = state.miniY;
  if (win !== null && !win.isDestroyed()) {
    win.setAlwaysOnTop(next, "floating");
    if (next) {
      // Center on the current window so the compact view appears in place.
      const size = win.getSize();
      const pos = win.getPosition();
      const w = size[0] ?? NORMAL_BOUNDS.width;
      const h = size[1] ?? NORMAL_BOUNDS.height;
      miniX = target.stored ? (state.miniX ?? 0) : Math.max(0, (pos[0] ?? 0) + Math.round((w - target.width) / 2));
      miniY = target.stored ? (state.miniY ?? 0) : Math.max(0, (pos[1] ?? 0) + Math.round((h - target.height) / 2));
      win.setBounds({ x: miniX, y: miniY, width: target.width, height: target.height });
    } else {
      // Omitted x/y keep the current position.
      win.setBounds({ width: target.width, height: target.height });
    }
    win.setMinimumSize(next ? MINI_WIDTH : 720, next ? MINI_HEIGHT : 480);
    const colors = colorsFor(state.theme);
    try {
      win.setBackgroundColor(colors.bg);
      // Windows-only overlay; no-op elsewhere.
      win.setTitleBarOverlay({ color: colors.bg, symbolColor: colors.fg, height: 44 });
    } catch {
      // Older Electron / unsupported platform: CSS still themes the frame.
    }
  }
  const saved: WindowState = { ...state, mini: next, miniX, miniY };
  await saveWindowState(userDataDir, saved);
  return saved;
}

/** Remember the normal-mode size so leaving mini mode restores it. */
export function rememberNormalSize(state: WindowState, win: BrowserWindow | null): WindowState {
  if (!state.mini || win === null || win.isDestroyed()) return state;
  const size = win.getSize();
  const width = size[0];
  const height = size[1];
  if (width === undefined || height === undefined) return state;
  return { ...state, normalWidth: width, normalHeight: height };
}

export interface WindowChromeController {
  /** Apply renderer-requested chrome (mini toggle, theme colors). */
  readonly apply: (next: WindowChromeState) => Promise<void>;
  /** Subscribe to chrome changes (the tray toggles mini from main). */
  readonly subscribe: (cb: (state: WindowChromeState) => void) => () => void;
  /** Current persisted state (for boot). */
  readonly current: () => WindowState;
}

/**
 * Main-process chrome controller: holds the authoritative WindowState,
 * applies it to the live window, persists it, and notifies listeners so the
 * renderer (and tray checkbox) stay in sync.
 */
export function createWindowChrome(deps: {
  readonly userDataDir: string;
  readonly getWindow: () => BrowserWindow | null;
}): WindowChromeController {
  const listeners = new Set<(state: WindowChromeState) => void>();
  let state: WindowState = DEFAULT_WINDOW_STATE;
  void loadWindowState(deps.userDataDir).then((loaded) => {
    state = loaded;
  });

  const notify = (): void => {
    const payload: WindowChromeState = { mini: state.mini, theme: state.theme };
    for (const cb of listeners) cb(payload);
  };

  return {
    apply: async (next) => {
      const win = deps.getWindow();
      const theme = next.theme;
      state = rememberNormalSize(state, win);
      state = await applyChrome(win, deps.userDataDir, { ...state, theme }, next.mini);
      notify();
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    current: () => state,
  };
}
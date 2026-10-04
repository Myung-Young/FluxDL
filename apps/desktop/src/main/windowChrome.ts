import type { BrowserWindow } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { screen } from "electron";
import type { WindowChromeState } from "@grabber/core/engine.js";
import { boundsFor, centerIn, fitToWorkArea, MINI_HEIGHT, MINI_WIDTH, NORMAL_BOUNDS } from "@grabber/core/window.js";

/**
 * Window chrome (M4.4 mini mode, M4.6 theme colors) — main process only.
 *
 * Geometry lives here, not in AppSettings: window bounds are not user
 * preferences, and keeping them out of the settings shape means the pinned
 * settings test and the e2e mock cannot drift (D83). State is persisted in
 * `<userData>/window-state.json`.
 *
 * D127: the window is FIXED. Each mode has exactly one size (1180x820 normal,
 * 360x520 mini, both clamped to the work area) and minimum == maximum, so the
 * user cannot resize, maximize or fullscreen it. Nothing about the old size is
 * remembered any more — a remembered size could resurrect a pre-fixed window
 * (the D122 class of bug) and break the one-size guarantee.
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
  readonly miniX: number | null;
  readonly miniY: number | null;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  mini: false,
  theme: "obsidian",
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
    // Stored mini position only (a remembered normal size is never trusted:
    // the window is fixed now, see the module note).
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

/**
 * The one size for a mode, clamped to the display work area (D127).
 *
 * Normal mode is always `NORMAL_BOUNDS`: there is no remembered size to fall
 * back to, so a stale `window-state.json` from a pre-fixed build can no longer
 * restore an arbitrary window size.
 */
export function resolveBounds(state: WindowState, next: boolean): ResolvedBounds {
  if (next) {
    return {
      width: Math.max(boundsFor(true).width, MINI_WIDTH),
      height: Math.max(boundsFor(true).height, MINI_HEIGHT),
      stored: state.miniX !== null && state.miniY !== null,
    };
  }
  return {
    width: NORMAL_BOUNDS.width,
    height: NORMAL_BOUNDS.height,
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
    // The fixed size, shrunk only if the display is smaller than it (a fixed
    // window can never be adjusted by the user). Minimum and maximum are both
    // set to exactly that: a second lock behind `resizable: false`, and the
    // one that does the work if that flag is ever dropped. Order still matters
    // (D124): the minimum goes first, otherwise Windows keeps the old frame
    // around the new, smaller layout. Note that under `resizable: false`
    // Windows ignores the tracking, so the setBounds below is what actually
    // sizes the window — it always passes the fixed size.
    const workArea = screen.getDisplayMatching(win.getBounds()).workArea;
    const fixed = fitToWorkArea(target, workArea);
    win.setMinimumSize(fixed.width, fixed.height);
    win.setMaximumSize(fixed.width, fixed.height);
    if (next) {
      // Center on the current window so the compact view appears in place.
      // No clamping to 0: a monitor to the left of the primary one has
      // negative coordinates and those positions are legitimate (D133).
      const size = win.getSize();
      const pos = win.getPosition();
      const w = size[0] ?? NORMAL_BOUNDS.width;
      const h = size[1] ?? NORMAL_BOUNDS.height;
      miniX = target.stored
        ? (state.miniX ?? 0)
        : (pos[0] ?? 0) + Math.round((w - fixed.width) / 2);
      miniY = target.stored
        ? (state.miniY ?? 0)
        : (pos[1] ?? 0) + Math.round((h - fixed.height) / 2);
      win.setBounds({ x: miniX, y: miniY, width: fixed.width, height: fixed.height });
    } else {
      // Re-center on the display it came from: leaving mini would otherwise
      // leave the full window at the compact window's top-left corner.
      const origin = centerIn(workArea, fixed);
      win.setBounds({ x: origin.x, y: origin.y, width: fixed.width, height: fixed.height });
    }
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


export interface WindowChromeController {
  /** Apply renderer-requested chrome (mini toggle, theme colors). */
  readonly apply: (next: WindowChromeState) => Promise<void>;
  /** Subscribe to chrome changes (the tray toggles mini from main). */
  readonly subscribe: (cb: (state: WindowChromeState) => void) => () => void;
  /** Current persisted state (for boot). */
  readonly current: () => WindowState;
  /** Resolve once the persisted state has been read (idempotent). */
  readonly ready: () => Promise<WindowState>;
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
  // The boot sequence awaits this so the window is created with the right
  // colors instead of flashing the default dark chrome (M4.6 light theme).
  const loaded = loadWindowState(deps.userDataDir).then((value) => {
    state = value;
    return value;
  });

  const notify = (): void => {
    const payload: WindowChromeState = { mini: state.mini, theme: state.theme };
    for (const cb of listeners) cb(payload);
  };

  return {
    apply: async (next) => {
      const win = deps.getWindow();
      const theme = next.theme;
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
    ready: () => loaded,
  };
}
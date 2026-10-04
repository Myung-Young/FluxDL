import type { DownloadJob } from "./types.js";

/**
 * Mini mode (M4.4) — pure window-state helpers.
 *
 * Mini mode is the SAME window, not a second one: `QueueController` lives in
 * the renderer, so a second window would duplicate queue state and fight over
 * the single engine (D83). Instead the renderer toggles a flag that drives a
 * `[data-mini]` layout, while the main process owns the window geometry
 * (always-on-top, size, restore) and persists it outside AppSettings so the
 * settings shape and the e2e mock cannot drift.
 *
 * The window is FIXED (D127): both modes are exactly one size, never
 * resizable and never maximizable. No minimum bounds exist any more, and no
 * remembered "normal" size is restored — see `fitToWorkArea` for the only
 * reason a fixed size is ever reduced.
 */

/** Compact window size (spec: ~360x520). */
export const MINI_WIDTH = 360;
export const MINI_HEIGHT = 520;

/** The one normal-mode size (D127: fixed window, slightly roomier than 1120x760). */
export const NORMAL_BOUNDS: Readonly<{ width: number; height: number }> = {
  width: 1180,
  height: 820,
};

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Breathing room kept between a fixed window and the screen edges. */
export const WORK_AREA_MARGIN = 40;

/**
 * Shrink a fixed size so it always fits the display work area (D127).
 *
 * The window cannot be resized by the user, so a size larger than the screen
 * would be permanently unreachable — the title bar or the bottom row would sit
 * off-screen. Real cases: a 1366x768 laptop (728px of work area) and a 1920x1080
 * panel at 150% scaling (1280x720 DIP). The result is still exactly one size:
 * it just shrinks to fit instead of overflowing. Never grows.
 */
export function fitToWorkArea(
  size: WindowSize,
  workArea: WindowSize,
  margin: number = WORK_AREA_MARGIN,
): WindowSize {
  const gap = Math.max(0, Math.round(margin)) * 2;
  const width = Math.max(1, Math.min(size.width, Math.floor(workArea.width - gap)));
  const height = Math.max(1, Math.min(size.height, Math.floor(workArea.height - gap)));
  return { width, height };
}

/**
 * Top-left that centers `size` inside `workArea`.
 *
 * A work area can have a negative origin (a monitor to the left of the
 * primary one), so the result may be negative — that is a real on-screen
 * position, not an error. Only two rules apply: never overflow the far edge,
 * and pin to the origin when the window is as large as the display, so the
 * title bar stays reachable.
 */
export function centerIn(workArea: Rect, size: WindowSize): { x: number; y: number } {
  const axis = (origin: number, extent: number, length: number): number =>
    length >= extent ? origin : origin + Math.round((extent - length) / 2);
  return {
    x: axis(workArea.x, workArea.width, size.width),
    y: axis(workArea.y, workArea.height, size.height),
  };
}

export interface WindowChromeState {
  readonly mini: boolean;
  /** Native titlebar/window colors must follow the light theme (M4.6). */
  readonly theme: string;
}

export function chromeState(mini: boolean, theme: string): WindowChromeState {
  return { mini, theme };
}

/** Size to apply for a mode. Pure so the main process can be tested. */
export function boundsFor(mini: boolean): Readonly<{ width: number; height: number }> {
  return mini ? { width: MINI_WIDTH, height: MINI_HEIGHT } : NORMAL_BOUNDS;
}

export interface MiniSummary {
  readonly active: number;
  readonly total: number;
  readonly hasWork: boolean;
}

/**
 * What the compact window shows instead of the sidebar: the jobs that are
 * still running plus the queue totals. Terminal jobs are hidden (they live in
 * Downloads/Library) so the list stays short.
 */
export function miniSummary(jobs: readonly DownloadJob[]): MiniSummary {
  let active = 0;
  for (const job of jobs) {
    if (job.status === "downloading" || job.status === "processing" || job.status === "analyzing") {
      active += 1;
    }
  }
  return { active, total: jobs.length, hasWork: jobs.length > 0 };
}

/** Compact-mode rows: active work first, then queued, then paused. */
export function miniRows(jobs: readonly DownloadJob[]): readonly DownloadJob[] {
  const rank = (job: DownloadJob): number => {
    switch (job.status) {
      case "downloading":
      case "processing":
        return 0;
      case "analyzing":
        return 1;
      case "queued":
        return 2;
      case "paused":
        return 3;
      default:
        return 4;
    }
  };
  return [...jobs]
    .filter((job) => rank(job) < 4)
    .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
}
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
 */

/** Compact window size (spec: ~360x520). */
export const MINI_WIDTH = 360;
export const MINI_HEIGHT = 520;

/** Below this width the full layout stops being usable. */
export const MINI_MIN_WIDTH = 320;
export const MINI_MIN_HEIGHT = 420;

/** Bounds restored when leaving mini mode (the app's normal default). */
export const NORMAL_BOUNDS: Readonly<{ width: number; height: number }> = {
  width: 1120,
  height: 760,
};

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
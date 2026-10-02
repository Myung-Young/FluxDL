/**
 * Windows taskbar progress + tray tooltip (M1.5). The renderer sends a
 * throttled aggregate; main combines it with window-local flags (error
 * until focus, finished-while-hidden overlay dot). The mode resolver is
 * pure and unit-tested; `main/index.ts` owns the Electron objects.
 */

export type TaskbarMode = "none" | "normal" | "indeterminate" | "error";

export interface TaskbarInput {
  readonly active: number;
  readonly percent: number | null;
}

export interface TaskbarFlags {
  readonly error: boolean;
  readonly finishedHidden: boolean;
}

export interface TaskbarCommand {
  readonly mode: TaskbarMode;
  readonly value: number;
  readonly overlay: boolean;
  readonly tooltip: string;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function resolveTaskbarCommand(
  state: TaskbarInput,
  flags: TaskbarFlags,
  tooltip: string,
): TaskbarCommand {
  const overlay = flags.finishedHidden;
  if (state.active <= 0 && !flags.error) {
    return { mode: "none", value: 0, overlay, tooltip };
  }
  if (flags.error) {
    return {
      mode: "error",
      value: state.percent !== null ? clamp01(state.percent / 100) : 0,
      overlay,
      tooltip,
    };
  }
  if (state.percent !== null) {
    return { mode: "normal", value: clamp01(state.percent / 100), overlay, tooltip };
  }
  return { mode: "indeterminate", value: 0, overlay, tooltip };
}

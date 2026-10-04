/**
 * Global shortcut matching (pure). Wiring lives in Shell:
 * - Ctrl/Cmd+V pastes + analyzes when focus is NOT in an editable field.
 * - Ctrl/Cmd+, opens Settings.
 * - Ctrl/Cmd+K opens the command palette (never inside editable fields).
 * - Ctrl/Cmd+Shift+M toggles mini mode (M4.4).
 * - Ctrl/Cmd+1..6 jumps to Home/Downloads/Library/Stats/Settings/Logs.
 * - ? opens the shortcut help dialog (never inside editable fields).
 */

export interface KeyCombo {
  readonly key: string;
  readonly ctrlOrCmd: boolean;
  readonly shift: boolean;
}

export function comboFromEvent(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): KeyCombo {
  return {
    key: e.key.toLowerCase(),
    ctrlOrCmd: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
  };
}

export function isPasteAnalyze(combo: KeyCombo): boolean {
  return combo.ctrlOrCmd && !combo.shift && combo.key === "v";
}

export function isOpenSettings(combo: KeyCombo): boolean {
  return combo.ctrlOrCmd && !combo.shift && combo.key === ",";
}

export function isCommandPalette(combo: KeyCombo): boolean {
  return combo.ctrlOrCmd && !combo.shift && combo.key === "k";
}

/** Ctrl/Cmd+Shift+M toggles mini mode (M4.4). */
export function isMiniMode(combo: KeyCombo): boolean {
  return combo.ctrlOrCmd && combo.shift && combo.key === "m";
}

/** Bare ? (Shift+/ on most layouts, so shift is ignored here). */
export function isShortcutHelp(combo: KeyCombo): boolean {
  return !combo.ctrlOrCmd && combo.key === "?";
}

/** View order for Ctrl/Cmd+1..6 (must match the Shell nav order). */
export const NAV_VIEWS = ["home", "downloads", "library", "stats", "settings", "logs"] as const;

export type NavView = (typeof NAV_VIEWS)[number];

/**
 * Ctrl/Cmd+1..6 view jump (no shift). Returns the view index, or null.
 * Works from anywhere except editable fields (digits may be typed there).
 */
export function navIndexFor(combo: KeyCombo): number | null {
  if (!combo.ctrlOrCmd || combo.shift) return null;
  if (!/^[1-6]$/.test(combo.key)) return null;
  return Number(combo.key) - 1;
}

export function isEditableTarget(target: unknown): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  const el = target.closest(
    "input, textarea, select, [contenteditable='true'], [contenteditable='']",
  );
  return el !== null;
}

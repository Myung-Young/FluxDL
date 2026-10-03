/**
 * Global shortcut matching (pure). Wiring lives in Shell:
 * - Ctrl/Cmd+V pastes + analyzes when focus is NOT in an editable field.
 * - Ctrl/Cmd+, opens Settings.
 * - Ctrl/Cmd+K opens the command palette (never inside editable fields).
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

export function isEditableTarget(target: unknown): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  const el = target.closest(
    "input, textarea, select, [contenteditable='true'], [contenteditable='']",
  );
  return el !== null;
}

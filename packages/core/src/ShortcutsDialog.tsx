import { useEffect, useRef } from "react";
import type { Strings } from "./strings.js";

export interface ShortcutRow {
  readonly keys: string;
  readonly label: string;
}

/** Pure row table (tested); rendering adds the dialog chrome. */
export function shortcutRows(strings: Strings): readonly ShortcutRow[] {
  return [
    { keys: "Ctrl+V", label: strings.shortcuts.paste },
    { keys: "Ctrl+K", label: strings.shortcuts.palette },
    { keys: "Ctrl+,", label: strings.shortcuts.settings },
    { keys: "Ctrl+Shift+M", label: strings.shortcuts.miniMode },
    { keys: "?", label: strings.shortcuts.help },
    { keys: "Esc", label: strings.shortcuts.dismiss },
  ];
}

export interface ShortcutsDialogProps {
  readonly strings: Strings;
  readonly onClose: () => void;
}

/**
 * Shortcut help dialog (M3.5). role=dialog with a focus trap, Esc/outside
 * close, and focus restore — the same pattern as the duplicate-guard dialog.
 */
export function ShortcutsDialog({ strings, onClose }: ShortcutsDialogProps): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const lastFocus = useRef<Element | null>(null);

  useEffect(() => {
    lastFocus.current = document.activeElement;
    const box = boxRef.current;
    const focusables = (): HTMLButtonElement[] =>
      box === null
        ? []
        : Array.from(box.querySelectorAll<HTMLButtonElement>("button")).filter(
            (b) => !b.disabled,
          );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const back = lastFocus.current;
      if (back instanceof HTMLElement) back.focus();
    };
  }, [onClose]);

  return (
    <div
      className="grabber-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        className="grabber-card"
        role="dialog"
        aria-modal="true"
        aria-label={strings.shortcuts.title}
        data-testid="shortcuts-dialog"
      >
        <h2>{strings.shortcuts.title}</h2>
        <ul className="shortcut-list">
          {shortcutRows(strings).map((row) => (
            <li key={row.keys} className="shortcut-row">
              <kbd>{row.keys}</kbd>
              <span>{row.label}</span>
            </li>
          ))}
        </ul>
        <div className="chip-row">
          <button type="button" className="btn" onClick={onClose}>
            {strings.shortcuts.close}
          </button>
        </div>
      </div>
    </div>
  );
}

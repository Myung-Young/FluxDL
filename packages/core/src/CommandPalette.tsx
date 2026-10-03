import { useEffect, useMemo, useRef, useState } from "react";
import type { Strings } from "./strings.js";
import { useStrings } from "./locale.js";
import { staggerIn } from "./motion.js";
import {
  BUILTIN_COMMANDS,
  availableCommands,
  rankCommands,
  type CommandContext,
  type CommandDef,
} from "./commands.js";

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly context: CommandContext;
  readonly onClose: () => void;
}

/**
 * Command palette (M2.1): ARIA combobox/listbox, arrow keys + Enter/Esc,
 * fuzzy filter with recency boost, focus trap + restore, staggered list
 * entrance (reduced-motion safe).
 */
export function CommandPalette({ open, context, onClose }: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState<string>("");
  const [active, setActive] = useState<number>(0);
  const [usage, setUsage] = useState<ReadonlyMap<string, number>>(new Map());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const lastFocus = useRef<Element | null>(null);
  const S: Strings = useStrings(context.settings);

  const available = useMemo(
    () => availableCommands(BUILTIN_COMMANDS, context),
    [context],
  );

  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const def of available) {
      const text = (S.commands as Record<string, string>)[def.labelKey];
      out[def.id] = text ?? def.id;
    }
    return out;
  }, [available, S]);

  const ranked = useMemo(
    () => rankCommands(available, labels, query, usage),
    [available, labels, query, usage],
  );

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
    if (listRef.current !== null) staggerIn(listRef.current, "[role='option']");
    return () => {
      const back = lastFocus.current;
      if (back instanceof HTMLElement) back.focus();
    };
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const run = (def: CommandDef): void => {
    setUsage((prev) => {
      const next = new Map(prev);
      next.set(def.id, (next.get(def.id) ?? 0) + 1);
      return next;
    });
    onClose();
    try {
      const result = def.run(context);
      if (result instanceof Promise) {
        result.catch(() => undefined);
      }
    } catch {
      // Command failures surface via their own toasts.
    }
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (ranked.length === 0) return;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + dir + ranked.length) % ranked.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = ranked[active];
      if (pick !== undefined) run(pick.def);
      return;
    }
    if (e.key === "Tab") {
      // Trap focus inside the palette.
      const box = (e.target as Element).closest(".grabber-modal");
      if (box === null) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>("input, button"));
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
    }
  };

  return (
    <div className="grabber-modal" onPointerDown={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="grabber-card" role="dialog" aria-modal="true" aria-label={S.commands.title}>
        <input
          ref={inputRef}
          className="input"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-autocomplete="list"
          aria-label={S.commands.title}
          placeholder={S.commands.placeholder}
          value={query}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        {ranked.length === 0 ? (
          <p className="hint">{S.commands.empty}</p>
        ) : (
          <ul id="cmd-list" ref={listRef} role="listbox" className="entries">
            {ranked.map(({ def }, i) => (
              <li
                key={def.id}
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                className="format-row cmd-option"
                onPointerDown={(e) => {
                  e.preventDefault();
                  run(def);
                }}
              >
                <span>{labels[def.id]}</span>
                {def.hint !== undefined && <span className="muted">{def.hint}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

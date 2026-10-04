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
import { describeIntent, parseIntent, runIntent, type Intent } from "./intent.js";
import { fuzzyRank } from "./fuzzy.js";
import type { DownloadJob } from "./types.js";

interface PaletteRow {
  readonly key: string;
  readonly label: string;
  readonly sub: string | null;
  readonly run: () => void;
}

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

  // Unified content search (B2): matching queue jobs + history entries ride
  // along below the smart row, jumping straight to their views.
  const [hist, setHist] = useState<readonly DownloadJob[]>([]);
  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
    if (listRef.current !== null) staggerIn(listRef.current, "[role='option']");
    context.engine
      .loadHistory()
      .then((h) => {
        setHist(h.slice(-200));
      })
      .catch(() => undefined);
    return () => {
      const back = lastFocus.current;
      if (back instanceof HTMLElement) back.focus();
    };
  }, [open, context.engine]);

  const intent: Intent | null = useMemo(() => parseIntent(query), [query]);

  const intentLabel = (i: Intent): string => {
    const d = describeIntent(i);
    switch (d.key) {
      case "pauseAll":
        return S.downloads.pauseAll;
      case "resumeAll":
        return S.downloads.resumeAll;
      case "retryAll":
        return S.downloads.retryAll;
      case "clearFinished":
        return S.downloads.clearFinished;
      case "go": {
        const titles: Record<string, string> = {
          home: S.home.title,
          downloads: S.downloads.title,
          library: S.library.title,
          stats: S.stats.title,
          settings: S.settings.title,
          logs: S.logs.title,
          changelog: S.changelog.title,
        };
        return titles[d.view] ?? d.view;
      }
      case "theme":
        return S.settings.themes[d.theme];
      case "throttle":
        return d.limit === null ? S.downloads.throttleUnlimited : `${d.limit}/s`;
      case "analyze":
        return d.url;
    }
  };

  const rows: readonly PaletteRow[] = useMemo(() => {
    const out: PaletteRow[] = [];
    if (intent !== null) {
      out.push({
        key: "smart",
        label: `${S.commands.smartAction}: ${intentLabel(intent)}`,
        sub: null,
        run: () => {
          runIntent(context, intent);
        },
      });
    }
    const q = query.trim();
    if (q.length > 0) {
      const jobs = context.jobs
        .map((j) => ({ j, s: fuzzyRank(`${j.title} ${j.url}`, q) }))
        .filter((r): r is { j: DownloadJob; s: number } => r.s !== null)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);
      for (const { j } of jobs) {
        out.push({
          key: `job:${j.id}`,
          label: j.title,
          sub: `${S.downloads.title} · ${j.status}`,
          run: () => {
            context.navigate("downloads");
          },
        });
      }
      const past = hist
        .map((j) => ({ j, s: fuzzyRank(`${j.title} ${j.url}`, q) }))
        .filter((r): r is { j: DownloadJob; s: number } => r.s !== null)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);
      for (const { j } of past) {
        out.push({
          key: `hist:${j.id}`,
          label: j.title,
          sub: S.library.title,
          run: () => {
            context.navigate("library");
          },
        });
      }
    }
    return out;
    // intentLabel closes over S/context — recompute with the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, query, context, hist, S]);

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

  const runRow = (row: PaletteRow): void => {
    onClose();
    try {
      row.run();
    } catch {
      // Row actions never throw into the render loop.
    }
  };

  const total = rows.length + ranked.length;

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (total === 0) return;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + dir + total) % total);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (active < rows.length) {
        const pick = rows[active];
        if (pick !== undefined) runRow(pick);
      } else {
        const pick = ranked[active - rows.length];
        if (pick !== undefined) run(pick.def);
      }
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
          aria-keyshortcuts="Control+k"
          placeholder={S.commands.placeholder}
          value={query}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        {total === 0 ? (
          <p className="hint" role="status">
            {S.commands.empty}
          </p>
        ) : (
          <ul id="cmd-list" ref={listRef} role="listbox" className="entries">
            {rows.map((row, i) => (
              <li
                key={row.key}
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                className="format-row cmd-option"
                onPointerDown={(e) => {
                  e.preventDefault();
                  runRow(row);
                }}
              >
                <span>{row.label}</span>
                {row.sub !== null && <span className="muted">{row.sub}</span>}
              </li>
            ))}
            {ranked.map(({ def }, i) => (
              <li
                key={def.id}
                role="option"
                aria-selected={i + rows.length === active}
                data-active={i + rows.length === active}
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

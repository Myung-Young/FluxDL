import { useEffect, useRef, useState } from "react";

export interface MenuItemDef {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly children?: readonly MenuItemDef[];
  readonly run?: () => void;
}

export interface ContextMenuProps {
  readonly label: string;
  readonly items: readonly MenuItemDef[];
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
}

interface VisibleItem {
  readonly def: MenuItemDef;
  readonly parent: MenuItemDef | null;
}

const MENU_WIDTH = 260;

/**
 * Core-rendered themed context menu (M1.6). role=menu, arrow/Home/End keys,
 * Right expands / Left collapses one level, Esc closes, focus restored.
 * Animate opacity only (no layout animation; reduced-motion safe by default).
 */
export function ContextMenu({ label, items, x, y, onClose }: ContextMenuProps): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastFocus = useRef<Element | null>(null);
  const closeRef = useRef<() => void>(() => undefined);
  closeRef.current = () => {
    onClose();
  };

  const visible: VisibleItem[] = [];
  for (const def of items) {
    visible.push({ def, parent: null });
    if (expanded === def.id && def.children !== undefined) {
      for (const child of def.children) visible.push({ def: child, parent: def });
    }
  }

  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    lastFocus.current = document.activeElement;
    buttons.current[0]?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (expanded !== null) setExpanded(null);
        else closeRef.current();
        return;
      }
      const idx = buttons.current.findIndex((b) => b === document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const next = (idx + dir + buttons.current.length) % buttons.current.length;
        buttons.current[next]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        buttons.current[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        buttons.current[buttons.current.length - 1]?.focus();
      }
    };
    const onPointer = (e: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      const back = lastFocus.current;
      if (back instanceof HTMLElement) back.focus();
    };
  }, [expanded]);

  useEffect(() => {
    if (expanded === null) return;
    const firstChild = buttons.current.find(
      (b) => b?.dataset["parent"] === expanded,
    );
    firstChild?.focus();
  }, [expanded]);

  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - items.length * 36 - 40));

  return (
    <div
      ref={rootRef}
      className="grabber-menu"
      role="menu"
      aria-label={label}
      data-testid="card-menu"
      style={{ left, top, width: MENU_WIDTH }}
    >
      {visible.map(({ def, parent }, i) => (
        <button
          key={def.id}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          type="button"
          role="menuitem"
          data-parent={parent?.id ?? ""}
          disabled={def.disabled === true}
          aria-haspopup={def.children !== undefined ? "true" : undefined}
          aria-expanded={
            def.children !== undefined ? expanded === def.id : undefined
          }
          className={parent !== null ? "grabber-menu-item grabber-menu-child" : "grabber-menu-item"}
          onClick={() => {
            if (def.children !== undefined) {
              setExpanded(expanded === def.id ? null : def.id);
              return;
            }
            def.run?.();
            closeRef.current();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" && def.children !== undefined) {
              e.preventDefault();
              setExpanded(def.id);
            } else if (e.key === "ArrowLeft" && parent !== null) {
              e.preventDefault();
              setExpanded(null);
            }
          }}
        >
          <span>{def.label}</span>
          {def.children !== undefined && (
            <span aria-hidden="true">{expanded === def.id ? "▾" : "▸"}</span>
          )}
        </button>
      ))}
    </div>
  );
}

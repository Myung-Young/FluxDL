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
  // v1.7.2: where to put focus when a submenu collapses. Left used to jump to
  // the very top of the menu instead of back to the item that opened it.
  const restoreId = useRef<string | null>(null);

  // Only LIVE buttons: the ref array keeps its high-water length (React calls
  // the ref callbacks with null when a submenu unmounts), so using `.length`
  // as the arrow-key modulus made ArrowDown land on a null slot and silently
  // do nothing — focus got stuck instead of wrapping.
  const liveButtons = (): HTMLButtonElement[] =>
    buttons.current.filter((b): b is HTMLButtonElement => b !== null);

  useEffect(() => {
    lastFocus.current = document.activeElement;
    liveButtons()[0]?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (expanded !== null) setExpanded(null);
        else closeRef.current();
        return;
      }
      const items = liveButtons();
      if (items.length === 0) return;
      const idx = items.findIndex((b) => b === document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        items[(idx + dir + items.length) % items.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1]?.focus();
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
      if (back instanceof HTMLElement) back.focus({ preventScroll: true });
    };
  }, [expanded]);

  useEffect(() => {
    if (expanded !== null) {
      const firstChild = liveButtons().find((b) => b.dataset["parent"] === expanded);
      firstChild?.focus();
      return;
    }
    const back = restoreId.current;
    restoreId.current = null;
    if (back === null) return;
    liveButtons()
      .find((b) => b.dataset["id"] === back)
      ?.focus();
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
          data-id={def.id}
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
              // Collapse back onto the item that opened this submenu.
              restoreId.current = parent.id;
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

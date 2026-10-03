import { useState } from "react";

/**
 * Minimal virtualized list (M2.7/M2.9): fixed row height, absolute rows,
 * overscan. Used when lists can exceed ~200 rows.
 */

export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan: number,
): { start: number; end: number } {
  if (total <= 0 || rowHeight <= 0 || viewportHeight <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  return { start: Math.min(start, end), end };
}

export interface VirtualListProps<T> {
  readonly items: readonly T[];
  readonly rowHeight: number;
  readonly height: number;
  readonly overscan?: number;
  readonly ariaLabel: string;
  readonly keyOf: (item: T) => string;
  readonly renderRow: (item: T, index: number) => React.ReactNode;
}

export function VirtualList<T>({
  items,
  rowHeight,
  height,
  overscan = 3,
  ariaLabel,
  keyOf,
  renderRow,
}: VirtualListProps<T>): React.JSX.Element {
  const [scrollTop, setScrollTop] = useState<number>(0);
  const { start, end } = visibleRange(scrollTop, height, rowHeight, items.length, overscan);
  return (
    <div
      className="virt-list"
      role="list"
      aria-label={ariaLabel}
      style={{ height, overflowY: "auto" }}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
      }}
    >
      <div style={{ height: items.length * rowHeight, position: "relative" }}>
        {items.slice(start, end).map((item, i) => (
          <div
            key={keyOf(item)}
            role="listitem"
            style={{
              position: "absolute",
              top: (start + i) * rowHeight,
              left: 0,
              right: 0,
              height: rowHeight,
              overflow: "hidden",
            }}
          >
            {renderRow(item, start + i)}
          </div>
        ))}
      </div>
    </div>
  );
}

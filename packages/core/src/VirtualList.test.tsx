import { describe, expect, it } from "vitest";
import { visibleRange } from "./VirtualList.js";

describe("visibleRange", () => {
  it("windows the visible slice with overscan", () => {
    expect(visibleRange(0, 400, 40, 500, 3)).toEqual({ start: 0, end: 13 });
    expect(visibleRange(200, 400, 40, 500, 3)).toEqual({ start: 2, end: 18 });
    // Clamped at the tail.
    expect(visibleRange(20000, 400, 40, 500, 3)).toEqual({ start: 497, end: 500 });
  });

  it("handles empty and degenerate inputs", () => {
    expect(visibleRange(0, 400, 40, 0, 3)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(0, 0, 40, 500, 3)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(-50, 400, 40, 500, 3)).toEqual({ start: 0, end: 12 });
  });
});

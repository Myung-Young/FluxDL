import { afterEach, describe, expect, it, vi } from "vitest";
import { flipShift, prefersReducedMotion } from "./motion.js";

function stubMatchMedia(matches: boolean): void {
  const g = globalThis as unknown as { window?: unknown };
  g.window = {
    matchMedia: vi.fn(() => ({ matches })),
  };
}

afterEach(() => {
  const g = globalThis as unknown as { window?: unknown };
  delete g.window;
  vi.restoreAllMocks();
});

describe("prefersReducedMotion", () => {
  it("defaults to reduced motion without a window (SSR-safe)", () => {
    expect(prefersReducedMotion()).toBe(true);
  });

  it("mirrors the media query when available", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("flipShift is a safe no-op under reduced motion", () => {
    expect(prefersReducedMotion()).toBe(true);
    const el = { style: {} } as unknown as Element;
    expect(() => {
      flipShift(el, 42);
    }).not.toThrow();
    expect(() => {
      flipShift(el, 0);
    }).not.toThrow();
  });
});

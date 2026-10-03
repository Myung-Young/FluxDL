import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  deriveAccent,
  deriveAccentScale,
  dominantColor,
  hexToRgb,
  hslToRgb,
  rgbToHex,
  rgbToHsl,
  type Rgb,
} from "./color.js";
const DARK_GROUNDS = ["#121214", "#0a0a0b"];

function solid(rgb: Rgb, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(rgb.r, rgb.g, rgb.b);
  return out;
}

describe("dominantColor", () => {
  it("finds the majority colour on synthetic bitmaps", () => {
    const red = { r: 255, g: 0, b: 0 };
    const blue = { r: 0, g: 0, b: 255 };
    const pixels = [...solid(red, 700), ...solid(blue, 300)];
    const dom = dominantColor(pixels);
    expect(dom?.r).toBeGreaterThan(200);
    expect(dom?.b).toBeLessThan(80);
  });

  it("averages a uniform field and rejects empties", () => {
    expect(dominantColor(solid({ r: 10, g: 20, b: 30 }, 64))).toEqual({
      r: 10,
      g: 20,
      b: 30,
    });
    expect(dominantColor([])).toBeNull();
  });
});

describe("contrast", () => {
  it("matches known ratios and round-trips hex", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#121214", "#121214")).toBeCloseTo(1, 2);
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#121214")).toEqual({ r: 18, g: 18, b: 20 });
    expect(hexToRgb("nope")).toBeNull();
    expect(rgbToHex({ r: 18, g: 18, b: 20 })).toBe("#121214");
    const hsl = rgbToHsl({ r: 255, g: 0, b: 0 });
    expect(hsl.s).toBeCloseTo(1, 2);
    expect(hslToRgb({ h: 0, s: 0, l: 0.5 })).toEqual({ r: 128, g: 128, b: 128 });
  });

  it("deriveAccent keeps >= 4.5:1 on the dark grounds", () => {
    const inputs: Rgb[] = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 128, g: 128, b: 128 },
      { r: 255, g: 220, b: 0 },
      { r: 20, g: 120, b: 200 },
      { r: 200, g: 80, b: 160 },
    ];
    for (const rgb of inputs) {
      const hex = deriveAccent(rgb, DARK_GROUNDS);
      for (const ground of DARK_GROUNDS) {
        expect(contrastRatio(hex, ground)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("deriveAccent saturates grays instead of returning gray", () => {
    const hex = deriveAccent({ r: 128, g: 128, b: 128 }, DARK_GROUNDS);
    const { s } = rgbToHsl(hexToRgb(hex) ?? { r: 0, g: 0, b: 0 });
    expect(s).toBeGreaterThan(0.3);
  });
});

describe("deriveAccentScale", () => {
  it("builds a full scale with enforced on-accent contrast", () => {
    const scale = deriveAccentScale("#818cf8");
    expect(scale).not.toBeNull();
    expect(scale?.adjusted).toBe(false);
    expect(scale?.warning).toBe(false);
    expect(scale?.ghost).toMatch(/^#[0-9a-f]{8}$/);
    expect(scale?.hover).not.toBe(scale?.base);
    expect(scale?.active).not.toBe(scale?.base);
    expect(contrastRatio(scale?.onAccent ?? "#fff", scale?.base ?? "#000")).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("auto-adjusts low-contrast colours and flags the hopeless ones", () => {
    const mid = deriveAccentScale("#767676");
    expect(mid).not.toBeNull();
    expect(contrastRatio(mid?.onAccent ?? "#fff", mid?.base ?? "#000")).toBeGreaterThanOrEqual(
      4.5,
    );
    // Property: every curated swatch either passes or warns.
    const swatches = ["#818cf8", "#fb923c", "#e4e4e7", "#34d399", "#38bdf8", "#f472b6", "#facc15", "#a78bfa"];
    for (const hex of swatches) {
      const scale = deriveAccentScale(hex);
      expect(scale).not.toBeNull();
      const ratio = contrastRatio(scale?.onAccent ?? "#fff", scale?.base ?? "#000");
      expect(ratio >= 4.5 || scale?.warning === true).toBe(true);
    }
  });

  it("rejects invalid input", () => {
    expect(deriveAccentScale("nope")).toBeNull();
    expect(deriveAccentScale("#12")).toBeNull();
    expect(deriveAccentScale("")).toBeNull();
    expect(deriveAccentScale("#gggggg")).toBeNull();
  });
});

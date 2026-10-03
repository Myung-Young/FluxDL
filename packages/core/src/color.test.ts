import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  deriveAccent,
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

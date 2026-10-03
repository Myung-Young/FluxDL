/**
 * Colour utilities (M2.4 dynamic accent, M2.6 accent picker). Pure, no DOM.
 * Median-cut dominant colour, WCAG contrast, and accent derivation that
 * guarantees >= 4.5:1 against the given grounds where achievable.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function clamp255(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (m === null) return null;
  const h = m[1] ?? "";
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex(rgb: Rgb): string {
  const p = (n: number): string => clamp255(n).toString(16).padStart(2, "0");
  return `#${p(rgb.r)}${p(rgb.g)}${p(rgb.b)}`;
}

export interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

export function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

export function hslToRgb(hsl: Hsl): Rgb {
  const { h, s, l } = hsl;
  if (s === 0) {
    const v = clamp255(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue = ((h % 1) + 1) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    const tt = ((t % 1) + 1) % 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: clamp255(channel(hue + 1 / 3) * 255),
    g: clamp255(channel(hue) * 255),
    b: clamp255(channel(hue - 1 / 3) * 255),
  };
}

function linearize(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * linearize(rgb.r) + 0.7152 * linearize(rgb.g) + 0.0722 * linearize(rgb.b)
  );
}

/** WCAG contrast ratio between two hex colours (1..21). */
export function contrastRatio(aHex: string, bHex: string): number {
  const a = hexToRgb(aHex);
  const b = hexToRgb(bHex);
  if (a === null || b === null) return 1;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Dominant colour of flat RGB triplets via small median-cut (depth 3).
 * Main feeds opaque pixels only (BGRA->RGB, alpha<128 skipped).
 */
export function dominantColor(rgb: ArrayLike<number>): Rgb | null {
  const count = Math.floor(rgb.length / 3);
  if (count === 0) return null;
  const stride = Math.max(1, Math.floor(count / 2048));
  let boxes: number[][] = [];
  const seed: number[] = [];
  for (let i = 0; i < count; i += stride) seed.push(i);
  boxes.push(seed);
  for (let depth = 0; depth < 3; depth += 1) {
    const next: number[][] = [];
    let split = false;
    for (const box of boxes) {
      if (box.length < 2) {
        next.push(box);
        continue;
      }
      const mins = [255, 255, 255];
      const maxs = [0, 0, 0];
      for (const idx of box) {
        for (let c = 0; c < 3; c += 1) {
          const v = rgb[idx * 3 + c] ?? 0;
          if (v < (mins[c] ?? 255)) mins[c] = v;
          if (v > (maxs[c] ?? 0)) maxs[c] = v;
        }
      }
      let channel = 0;
      let widest = -1;
      for (let c = 0; c < 3; c += 1) {
        const w = (maxs[c] ?? 0) - (mins[c] ?? 0);
        if (w > widest) {
          widest = w;
          channel = c;
        }
      }
      if (widest <= 0) {
        next.push(box);
        continue;
      }
      const sorted = [...box].sort((x, y) => (rgb[x * 3 + channel] ?? 0) - (rgb[y * 3 + channel] ?? 0));
      const mid = Math.floor(sorted.length / 2);
      next.push(sorted.slice(0, mid), sorted.slice(mid));
      split = true;
    }
    boxes = next;
    if (!split) break;
  }
  let best: number[] = boxes[0] ?? [];
  for (const box of boxes) {
    if (box.length > best.length) best = box;
  }
  if (best.length === 0) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const idx of best) {
    r += rgb[idx * 3] ?? 0;
    g += rgb[idx * 3 + 1] ?? 0;
    b += rgb[idx * 3 + 2] ?? 0;
  }
  return {
    r: Math.round(r / best.length),
    g: Math.round(g / best.length),
    b: Math.round(b / best.length),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function minContrast(hex: string, grounds: readonly string[]): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const ground of grounds) {
    const ratio = contrastRatio(hex, ground);
    if (ratio < worst) worst = ratio;
  }
  return worst;
}

/**
 * Derive a card accent from a thumbnail colour: clamp saturation, then scan
 * lightness for the variant closest to the source that still reaches 4.5:1
 * against every ground (best effort when unreachable).
 */
export function deriveAccent(rgb: Rgb, grounds: readonly string[]): string {  const { h, s, l } = rgbToHsl(rgb);
  const sat = clamp(s, 0.35, 0.8);
  const origL = clamp(l, 0.45, 0.65);
  let bestHex = rgbToHex(hslToRgb({ h, s: sat, l: origL }));
  let bestDist = Number.POSITIVE_INFINITY;
  let fallbackHex = bestHex;
  let fallbackScore = minContrast(bestHex, grounds);
  for (let li = 30; li <= 80; li += 1) {
    const light = li / 100;
    const hex = rgbToHex(hslToRgb({ h, s: sat, l: light }));
    const score = minContrast(hex, grounds);
    if (score > fallbackScore) {
      fallbackScore = score;
      fallbackHex = hex;
    }
    if (score >= 4.5) {
      const dist = Math.abs(light - origL);
      if (dist < bestDist) {
        bestDist = dist;
        bestHex = hex;
      }
    }
  }
  return bestDist === Number.POSITIVE_INFINITY ? fallbackHex : bestHex;
}

export interface AccentScale {
  readonly base: string;
  readonly hover: string;
  readonly active: string;
  /** Base at ~15% alpha for ghost fills (hex with alpha). */
  readonly ghost: string;
  /** Text colour for use on the accent (contrast-enforced). */
  readonly onAccent: string;
  /** True when the base lightness was auto-adjusted for contrast. */
  readonly adjusted: boolean;
  /** True when on-accent contrast is still below 4.5:1 after adjustment. */
  readonly warning: boolean;
}

function shiftLightness(hsl: Hsl, delta: number): Hsl {
  return { h: hsl.h, s: hsl.s, l: clamp(hsl.l + delta, 0, 1) };
}

/**
 * Build a full accent scale from a user hex colour. The on-accent text
 * colour (white/black, whichever contrasts more) is enforced to 4.5:1 by
 * shifting the base lightness away from the text; `warning` flags colours
 * that still fail. Returns null for invalid input.
 */
export function deriveAccentScale(hex: string): AccentScale | null {
  const parsed = hexToRgb(hex);
  if (parsed === null) return null;
  const start = rgbToHsl(parsed);
  const whiteOnStart = contrastRatio("#ffffff", rgbToHex(parsed));
  const blackOnStart = contrastRatio("#000000", rgbToHex(parsed));
  const text: "#ffffff" | "#000000" = whiteOnStart >= blackOnStart ? "#ffffff" : "#000000";
  const finish = (hsl: Hsl, wasAdjusted: boolean): AccentScale => {
    const base = rgbToHex(hslToRgb(hsl));
    return {
      base,
      hover: rgbToHex(hslToRgb(shiftLightness(hsl, 0.07))),
      active: rgbToHex(hslToRgb(shiftLightness(hsl, -0.07))),
      ghost: `${base}26`,
      onAccent: text,
      adjusted: wasAdjusted,
      warning: contrastRatio(text, base) < 4.5,
    };
  };
  if (Math.max(whiteOnStart, blackOnStart) >= 4.5) {
    return finish(start, false);
  }
  // Move away from the text colour: darken under white text, lighten under black.
  const direction = text === "#ffffff" ? -1 : 1;
  let hsl = { ...start, l: clamp(start.l, 0.12, 0.88) };
  for (let i = 0; i < 40; i += 1) {
    if (contrastRatio(text, rgbToHex(hslToRgb(hsl))) >= 4.5) break;
    const next = clamp(hsl.l + direction * 0.02, 0.05, 0.95);
    if (next === hsl.l) break;
    hsl = { ...hsl, l: next };
  }
  return finish(hsl, true);
}

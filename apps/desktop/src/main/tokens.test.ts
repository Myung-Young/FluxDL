import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contrastRatio } from "@grabber/core/color.js";
import { THEME_NAMES } from "@grabber/core/themes.js";

/**
 * M4.6: every theme's token pairs are contrast-tested.
 *
 * This test lives in the desktop package on purpose — core tests cannot read
 * files (eslint `no-restricted-imports` bans `node:fs` there), and the
 * alternative (a TS palette duplicated from tokens.css) is exactly the drift
 * this milestone exists to remove. tokens.css stays the single source of
 * truth; this test reads it.
 */
const CSS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "packages",
  "core",
  "src",
  "tokens.css",
);

const css = readFileSync(CSS_PATH, "utf8");

/** Parse `--token: value;` declarations per theme block. */
function palette(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`missing theme block: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const m = /^\s*(--[a-z0-9-]+):\s*(.+);\s*$/.exec(line);
    if (m !== null && m[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2].trim();
  }
  return out;
}

/** Only plain hex tokens can be contrast-checked (skip rgb()/rgba/shadows). */
function hex(p: Record<string, string>, token: string): string {
  const v = p[token];
  if (v === undefined) throw new Error(`missing token ${token}`);
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`token ${token} is not a hex color: ${v}`);
  return v;
}

/** Text pairs must clear WCAG AA (4.5:1); body text gets a 7:1 target. */
const TEXT_PAIRS: readonly (readonly [string, string, number])[] = [
  ["--fg-0", "--bg-0", 4.5],
  ["--fg-0", "--bg-1", 7],
  ["--fg-0", "--bg-2", 4.5],
  ["--fg-0", "--bg-3", 4.5],
  ["--fg-1", "--bg-0", 4.5],
  ["--fg-1", "--bg-1", 4.5],
  ["--fg-1", "--bg-2", 4.5],
  ["--fg-2", "--bg-1", 4.5],
  ["--fg-2", "--bg-2", 4.5],
  ["--accent-fg", "--accent", 4.5],
  ["--danger", "--bg-0", 4.5],
  ["--danger", "--bg-1", 4.5],
  ["--success", "--bg-0", 4.5],
  ["--success", "--bg-1", 4.5],
  ["--warning", "--bg-0", 4.5],
  ["--warning", "--bg-1", 4.5],
];

/** Separators are decorative: visible, but not text. */
const DECOR_PAIRS: readonly (readonly [string, string, number])[] = [
  ["--border", "--bg-1", 1.5],
  ["--border", "--bg-0", 1.4],
  ["--border-soft", "--bg-1", 1.2],
];

const REQUIRED_TOKENS = [
  "--bg-0",
  "--bg-1",
  "--bg-2",
  "--bg-3",
  "--fg-0",
  "--fg-1",
  "--fg-2",
  "--accent",
  "--accent-fg",
  "--accent-soft",
  "--border",
  "--border-soft",
  "--danger",
  "--success",
  "--warning",
  "--shadow-1",
  "--shadow-2",
] as const;

describe("theme tokens (tokens.css)", () => {
  it("ships the Paper theme plus the three originals", () => {
    expect([...THEME_NAMES]).toEqual(["obsidian", "midnight", "ember", "paper"]);
  });

  for (const theme of THEME_NAMES) {
    describe(theme, () => {
      const p = palette(`[data-theme="${theme}"]`);

      it("defines every token the app consumes", () => {
        for (const token of REQUIRED_TOKENS) {
          expect(p[token], `${theme} ${token}`).toBeDefined();
        }
      });

      for (const [fg, bg, min] of TEXT_PAIRS) {
        it(`${fg} on ${bg} >= ${String(min)}:1`, () => {
          const ratio = contrastRatio(hex(p, fg), hex(p, bg));
          expect(ratio, `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
        });
      }

      for (const [fg, bg, min] of DECOR_PAIRS) {
        it(`${fg} on ${bg} >= ${String(min)}:1 (visible separator)`, () => {
          const ratio = contrastRatio(hex(p, fg), hex(p, bg));
          expect(ratio, `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }

  it("keeps obsidian as the :root fallback", () => {
    // The first block is `:root, [data-theme="obsidian"]`; an unknown data-theme
    // must not leave the app unstyled.
    expect(css.trimStart().startsWith(":root,")).toBe(true);
    expect(css.slice(0, 200)).toContain('[data-theme="obsidian"]');
  });

  it("uses a transparent accent-soft, never a solid fill", () => {
    for (const theme of THEME_NAMES) {
      const p = palette(`[data-theme="${theme}"]`);
      expect(p["--accent-soft"], theme).toMatch(/^rgb\(.+\/ 0?\.\d+\)$/);
    }
  });
});

describe("forced colors", () => {
  it("ships a forced-colors pass for Windows High Contrast", () => {
    expect(css).toContain("@media (forced-colors: active)");
  });

  it("maps the key surfaces onto system colors", () => {
    const start = css.indexOf("@media (forced-colors: active)");
    expect(start).toBeGreaterThan(-1);
    // The block is the last one in the file; inner rules nest, so slicing to
    // the next "\n}" would cut the block in half.
    const block = css.slice(start);
    for (const systemColor of ["Canvas", "CanvasText", "Highlight", "ButtonFace", "ButtonText"]) {
      expect(block, systemColor).toContain(systemColor);
    }
  });

  it("keeps progress fills visible in forced colors", () => {
    const start = css.indexOf("@media (forced-colors: active)");
    const block = css.slice(start);
    expect(block).toContain(".dl-fill");
    expect(block).toContain("forced-color-adjust");
  });
});
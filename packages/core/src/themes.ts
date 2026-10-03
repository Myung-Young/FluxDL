import type { ThemeName } from "./types.js";

/**
 * Theme registry (M4.6) — the single list of themes.
 *
 * Before this, the theme names were written out in five places (types,
 * settings sanitizer, Shell titlebar dots, Onboarding, SettingsScreen), so
 * adding a theme meant remembering all five and missing one produced a theme
 * that silently fell back to obsidian. Consumers import this instead.
 *
 * `swatch` is the titlebar dot / picker colour; it is decorative and is not
 * required to meet the text contrast bar (the contrast test in
 * `apps/desktop/src/main/tokens.test.ts` covers the token pairs themselves).
 */
export interface ThemeDef {
  readonly id: ThemeName;
  readonly swatch: string;
}

export const THEMES: readonly ThemeDef[] = [
  { id: "obsidian", swatch: "#3a3a3e" },
  { id: "midnight", swatch: "#818cf8" },
  { id: "ember", swatch: "#fb923c" },
  { id: "paper", swatch: "#1d4ed8" },
];

export const THEME_NAMES: readonly ThemeName[] = THEMES.map((t) => t.id);

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && THEME_NAMES.includes(value as ThemeName);
}

export function themeSwatch(id: ThemeName): string {
  return THEMES.find((t) => t.id === id)?.swatch ?? THEMES[0]?.swatch ?? "#3a3a3e";
}
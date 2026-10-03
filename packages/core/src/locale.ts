import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { Language } from "./types.js";
import type { SettingsStoreState } from "./stores.js";
import { STRINGS, STRINGS_MS, type Strings } from "./strings.js";

/**
 * Locale plumbing (M2.8). strings.ts stays dependency-free (main imports
 * it); reactivity + formatting live here.
 */

export type ActiveLanguage = "en" | "ms";

/** Resolve a language setting (auto reads navigator.language). */
export function resolveLanguage(setting: Language): ActiveLanguage {
  if (setting === "en") return "en";
  if (setting === "ms") return "ms";
  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    return navigator.language.toLowerCase().startsWith("ms") ? "ms" : "en";
  }
  return "en";
}

/** Active dictionary for a settings store (re-renders on language change). */
export function useStrings(settings: StoreApi<SettingsStoreState>): Strings {
  const language = useStore(settings, (s) => s.settings.language);
  const active = resolveLanguage(language);
  return (active === "ms" ? STRINGS_MS : STRINGS) as Strings;
}

/** Intl locale tag for dates/numbers/bytes. */
export function localeTag(lang: ActiveLanguage): string {
  return lang === "ms" ? "ms-MY" : "en";
}

/** Fill {placeholders} in a template (unknown keys pass through). */
export function formatStr(
  template: string,
  vars: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

/**
 * Plural helper. Malay uses the same form (classifiers aside), so `other`
 * doubles as the ms form; English switches on n === 1.
 */
export function plural(
  lang: ActiveLanguage,
  n: number,
  one: string,
  other: string,
): string {
  if (lang === "ms") return other;
  return n === 1 ? one : other;
}

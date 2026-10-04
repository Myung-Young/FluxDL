import type { CommandContext } from "./commands.js";
import type { ThemeName } from "./types.js";
import { THEME_NAMES } from "./themes.js";
import { isValidUrl } from "./url.js";

/**
 * Local natural-language intents for the palette (B5): rule-based,
 * bilingual (EN+MS), fully offline. Anything unrecognized returns null and
 * the palette falls back to command + content search. Never marketed as AI.
 */

export type Intent =
  | { readonly kind: "pauseAll" }
  | { readonly kind: "resumeAll" }
  | { readonly kind: "retryAll" }
  | { readonly kind: "clearFinished" }
  | { readonly kind: "go"; readonly view: "home" | "downloads" | "library" | "stats" | "settings" | "logs" | "changelog" }
  | { readonly kind: "theme"; readonly theme: ThemeName }
  | { readonly kind: "throttle"; readonly limit: string | null }
  | { readonly kind: "analyze"; readonly url: string };

const VIEWS: Readonly<Record<string, Intent & { kind: "go" }>> = {
  home: { kind: "go", view: "home" },
  utama: { kind: "go", view: "home" },
  downloads: { kind: "go", view: "downloads" },
  download: { kind: "go", view: "downloads" },
  "muat turun": { kind: "go", view: "downloads" },
  library: { kind: "go", view: "library" },
  pustaka: { kind: "go", view: "library" },
  stats: { kind: "go", view: "stats" },
  statistik: { kind: "go", view: "stats" },
  settings: { kind: "go", view: "settings" },
  tetapan: { kind: "go", view: "settings" },
  // Specific multi-word keys first: "buka log perubahan" must win over "log".
  changelog: { kind: "go", view: "changelog" },
  perubahan: { kind: "go", view: "changelog" },
  logs: { kind: "go", view: "logs" },
  log: { kind: "go", view: "logs" },
};

export function parseIntent(raw: string): Intent | null {
  const text = raw.trim().toLowerCase();
  if (text.length < 3) return null;
  // URLs keep their original case (video ids are case-sensitive).
  const words = raw.trim().split(/\s+/);

  const has = (...words: readonly string[]): boolean =>
    words.some((w) => text.includes(w));

  if (has("jeda semua", "pause all", "pause everything", "jeda everything")) {
    return { kind: "pauseAll" };
  }
  if (has("sambung semua", "resume all", "resume everything", "lanjut semua")) {
    return { kind: "resumeAll" };
  }
  if (has("cuba semula semua", "retry all", "cuba semua")) return { kind: "retryAll" };
  if (has("clear finished", "padam siap", "padam yang siap", "clear done")) {
    return { kind: "clearFinished" };
  }
  if (has("pergi ke", "go to", "buka", "open ")) {
    for (const [key, intent] of Object.entries(VIEWS)) {
      if (text.includes(key)) return intent;
    }
    return null;
  }
  if (has("tema", "theme")) {
    for (const t of THEME_NAMES) {
      if (text.includes(t)) return { kind: "theme", theme: t };
    }
    return null;
  }
  if (has("laju", "throttle", "speed", "kelajuan")) {
    if (has("tanpa had", "unlimited", "no limit")) return { kind: "throttle", limit: null };
    const m = /(\d+(?:\.\d+)?)\s*m/i.exec(text);
    if (m?.[1] !== undefined) return { kind: "throttle", limit: `${m[1]}M` };
    return null;
  }
  // "mp3 <url>" / "muat turun <url>": route the URL like a paste. The
  // extra shape check matters because isValidUrl is lenient (it accepts
  // bare words like "mp3" that normalize into searches).
  const url = words.find(
    (w) => (w.includes(".") || w.includes("://") || w.includes("/")) && isValidUrl(w),
  );
  if (
    url !== undefined &&
    has("mp3", "m4a", "audio", "muat turun", "download", "analisis", "analyze")
  ) {
    return { kind: "analyze", url };
  }
  return null;
}

/** Human label for the smart row (resolved by the caller into strings). */
export type IntentLabel =
  | { readonly key: "pauseAll" | "resumeAll" | "retryAll" | "clearFinished" }
  | { readonly key: "go"; readonly view: string }
  | { readonly key: "theme"; readonly theme: ThemeName }
  | { readonly key: "throttle"; readonly limit: string | null }
  | { readonly key: "analyze"; readonly url: string };

export function describeIntent(intent: Intent): IntentLabel {
  switch (intent.kind) {
    case "pauseAll":
    case "resumeAll":
    case "retryAll":
    case "clearFinished":
      return { key: intent.kind };
    case "go":
      return { key: "go", view: intent.view };
    case "theme":
      return { key: "theme", theme: intent.theme };
    case "throttle":
      return { key: "throttle", limit: intent.limit };
    case "analyze":
      return { key: "analyze", url: intent.url };
  }
}

/** Run an intent against the live palette context (best-effort, no throws). */
export function runIntent(ctx: CommandContext, intent: Intent): void {
  try {
    const q = ctx.queue.getState();
    switch (intent.kind) {
      case "pauseAll":
        void q.pauseAll().catch(() => undefined);
        return;
      case "resumeAll":
        void q.resumeAll().catch(() => undefined);
        return;
      case "retryAll":
        void q.retryAll().catch(() => undefined);
        return;
      case "clearFinished":
        void q.clearFinished().catch(() => undefined);
        return;
      case "go":
        ctx.navigate(intent.view);
        return;
      case "theme":
        void ctx.settings.getState().save({ theme: intent.theme }).catch(() => undefined);
        return;
      case "throttle":
        void ctx.settings.getState().save({ speedLimit: intent.limit }).catch(() => undefined);
        return;
      case "analyze":
        ctx.pasteAndAnalyze(intent.url);
        return;
    }
  } catch {
    // Palette actions never throw into the render loop.
  }
}

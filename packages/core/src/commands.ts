import type { DownloadEngine } from "./engine.js";
import type { DownloadJob } from "./types.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";
import type { StoreApi } from "zustand";
import { activeCount } from "./queue.js";
import { readClipboardText } from "./clipboard.js";
import { isValidUrl } from "./url.js";

/**
 * Command palette registry (M2.1). Commands are data: id + label key +
 * keywords + availability predicate + runner. Fuzzy scoring and recency
 * live here (pure, tested); rendering lives in CommandPalette.
 */

export type CommandView = "home" | "downloads" | "library" | "settings" | "logs";

export interface CommandContext {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
  readonly jobs: readonly DownloadJob[];
  readonly navigate: (view: CommandView, section?: string) => void;
  readonly pasteAndAnalyze: (url: string) => void;
}

export interface CommandDef {
  readonly id: string;
  /** Key into strings.commands (resolved at render, so i18n just works). */
  readonly labelKey: string;
  readonly hint?: string;
  readonly keywords: readonly string[];
  available(ctx: CommandContext): boolean;
  run(ctx: CommandContext): void | Promise<void>;
}

function toastOk(toast: StoreApi<ToastStoreState>, message: string): void {
  toast.getState().push(message, "success");
}

function toastErr(toast: StoreApi<ToastStoreState>, message: string): void {
  toast.getState().push(message, "error");
}

export const BUILTIN_COMMANDS: readonly CommandDef[] = [
  {
    id: "paste-analyze",
    labelKey: "pasteAnalyze",
    hint: "Ctrl+V",
    keywords: ["paste", "clipboard", "link", "url", "analyze", "tampal", "pautan"],
    available: () => true,
    run: (ctx) => {
      void readClipboardText().then((text) => {
        const first = (text ?? "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .find((s) => s.length > 0);
        if (first !== undefined && isValidUrl(first)) {
          ctx.pasteAndAnalyze(first);
        }
      });
    },
  },
  {
    id: "go-home",
    labelKey: "goHome",
    keywords: ["go", "home", "view", "utama"],
    available: () => true,
    run: (ctx) => {
      ctx.navigate("home");
    },
  },
  {
    id: "go-downloads",
    labelKey: "goDownloads",
    keywords: ["go", "downloads", "queue", "muat", "turun", "baris"],
    available: () => true,
    run: (ctx) => {
      ctx.navigate("downloads");
    },
  },
  {
    id: "go-library",
    labelKey: "goLibrary",
    keywords: ["go", "library", "history", "pustaka", "sejarah"],
    available: () => true,
    run: (ctx) => {
      ctx.navigate("library");
    },
  },
  {
    id: "go-settings",
    labelKey: "goSettings",
    keywords: ["go", "settings", "preferences", "tetapan"],
    available: () => true,
    run: (ctx) => {
      ctx.navigate("settings");
    },
  },
  {
    id: "go-logs",
    labelKey: "goLogs",
    keywords: ["go", "logs", "about", "log", "perihal"],
    available: () => true,
    run: (ctx) => {
      ctx.navigate("logs");
    },
  },
  {
    id: "theme-obsidian",
    labelKey: "themeObsidian",
    keywords: ["theme", "dark", "obsidian", "tema", "gelap"],
    available: (ctx) => ctx.settings.getState().settings.theme !== "obsidian",
    run: (ctx) => {
      void ctx.settings.getState().save({ theme: "obsidian" });
    },
  },
  {
    id: "theme-midnight",
    labelKey: "themeMidnight",
    keywords: ["theme", "blue", "midnight", "tema", "biru"],
    available: (ctx) => ctx.settings.getState().settings.theme !== "midnight",
    run: (ctx) => {
      void ctx.settings.getState().save({ theme: "midnight" });
    },
  },
  {
    id: "theme-ember",
    labelKey: "themeEmber",
    keywords: ["theme", "orange", "ember", "tema", "oren"],
    available: (ctx) => ctx.settings.getState().settings.theme !== "ember",
    run: (ctx) => {
      void ctx.settings.getState().save({ theme: "ember" });
    },
  },
  {
    id: "update-engine",
    labelKey: "updateEngine",
    keywords: ["update", "engine", "yt-dlp", "kemas", "kini", "enjin"],
    available: () => true,
    run: (ctx) => {
      ctx.engine
        .updateEngine()
        .then(() => {
          toastOk(ctx.toast, "Engine updated.");
        })
        .catch((err: unknown) => {
          toastErr(ctx.toast, err instanceof Error ? err.message : "Update failed.");
        });
    },
  },
  {
    id: "open-downloads-folder",
    labelKey: "openDownloadsFolder",
    keywords: ["open", "folder", "downloads", "directory", "buka", "folder"],
    available: (ctx) => ctx.settings.getState().settings.downloadDir.trim().length > 0,
    run: (ctx) => {
      const dir = ctx.settings.getState().settings.downloadDir;
      ctx.engine.openPath(dir).catch((err: unknown) => {
        toastErr(ctx.toast, err instanceof Error ? err.message : "Could not open folder.");
      });
    },
  },
  {
    id: "pause-all",
    labelKey: "pauseAll",
    keywords: ["pause", "all", "stop", "jeda", "semua", "henti"],
    available: (ctx) => activeCount(ctx.jobs) > 0,
    run: (ctx) => {
      void ctx.queue.getState().pauseAll();
    },
  },
  {
    id: "resume-all",
    labelKey: "resumeAll",
    keywords: ["resume", "all", "continue", "sambung", "semua"],
    available: (ctx) => ctx.jobs.some((j) => j.status === "paused"),
    run: (ctx) => {
      void ctx.queue.getState().resumeAll();
    },
  },
  {
    id: "clear-finished",
    labelKey: "clearFinished",
    keywords: ["clear", "finished", "done", "errors", "kosong", "siap"],
    available: (ctx) => ctx.jobs.some((j) => j.status === "error"),
    run: (ctx) => {
      void ctx.queue.getState().clearFinished();
    },
  },
  {
    id: "settings-folder",
    labelKey: "settingsFolder",
    keywords: ["settings", "folder", "download", "directory", "tetapan", "folder"],
    available: () => true,
    run: (ctx) => {
      ctx.navigate("settings", "folder");
    },
  },
  {
    id: "settings-cookies",
    labelKey: "settingsCookies",
    keywords: ["settings", "cookies", "browser", "tetapan", "kuki"],
    available: () => true,
    run: (ctx) => {
      ctx.navigate("settings", "cookies");
    },
  },
  {
    id: "settings-proxy",
    labelKey: "settingsProxy",
    keywords: ["settings", "proxy", "network", "tetapan", "proksi"],
    available: () => true,
    run: (ctx) => {
      ctx.navigate("settings", "proxy");
    },
  },
];

export function availableCommands(
  commands: readonly CommandDef[],
  ctx: CommandContext,
): CommandDef[] {
  return commands.filter((c) => {
    try {
      return c.available(ctx);
    } catch {
      return false;
    }
  });
}

/**
 * Hand-rolled fuzzy scorer: subsequence match with bonuses for prefix,
 * word-start, and consecutive hits, normalized by candidate length.
 * Returns -Infinity for non-matches.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;
  if (t.includes(q)) {
    return 100 - t.indexOf(q) - (t.length - q.length) * 0.5;
  }
  let score = 0;
  let ti = 0;
  let consecutive = 0;
  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi];
    if (ch === undefined) break;
    const found = t.indexOf(ch, ti);
    if (found === -1) return Number.NEGATIVE_INFINITY;
    if (found === ti) consecutive += 1;
    else consecutive = 0;
    if (found === 0) score += 10;
    else if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === "-") score += 5;
    score += 1 + consecutive * 2 - found * 0.1;
    ti = found + 1;
  }
  return score - t.length * 0.2;
}

export interface RankedCommand {
  readonly def: CommandDef;
  readonly score: number;
}

/** Rank available commands by fuzzy score + recency (usage count boost). */
export function rankCommands(
  commands: readonly CommandDef[],
  labels: Readonly<Record<string, string>>,
  query: string,
  usage: ReadonlyMap<string, number>,
): RankedCommand[] {
  const out: RankedCommand[] = [];
  for (const def of commands) {
    const label = labels[def.id] ?? def.id;
    const haystacks = [label, ...def.keywords];
    let best = Number.NEGATIVE_INFINITY;
    for (const hay of haystacks) {
      const s = fuzzyScore(query, hay);
      if (s > best) best = s;
    }
    if (best === Number.NEGATIVE_INFINITY) continue;
    const boost = Math.min(usage.get(def.id) ?? 0, 5) * 4;
    out.push({ def, score: best + boost });
  }
  out.sort((a, b) => b.score - a.score || (a.def.id < b.def.id ? -1 : 1));
  return out;
}


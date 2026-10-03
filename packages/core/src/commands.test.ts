import { describe, expect, it } from "vitest";
import {
  BUILTIN_COMMANDS,
  availableCommands,
  fuzzyScore,
  rankCommands,
  type CommandContext,
} from "./commands.js";
import { comboFromEvent, isCommandPalette } from "./shortcuts.js";
import type { DownloadJob } from "./types.js";

function job(status: DownloadJob["status"]): DownloadJob {
  return {
    id: status,
    url: "https://example.com/a",
    title: "A",
    preset: { kind: "video", videoPreset: "720", audioPreset: "MP3", rawFormat: null },
    outputDir: "C:\\Vids",
    status,
    progress: 0,
    speed: null,
    eta: null,
    downloadedBytes: null,
    totalBytes: null,
    stage: null,
    error: null,
    createdAt: 1,
    attempts: 0,
    nextRetryAt: null,
    destination: null,
  };
}

function ctx(jobs: DownloadJob["status"][] = []): CommandContext {
  const store = (value: unknown) => ({ getState: () => value }) as never;
  return {
    engine: store({}),
    queue: store({ pauseAll: () => Promise.resolve() }),
    settings: store({ settings: { theme: "obsidian", downloadDir: "C:\\Vids" }, save: () => Promise.resolve() }),
    toast: store({ push: () => "" }),
    jobs: jobs.map((s) => job(s)),
    navigate: () => undefined,
    pasteAndAnalyze: () => undefined,
  };
}

describe("fuzzyScore", () => {
  it("prefers exact/prefix matches and rejects non-matches", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    const exact = fuzzyScore("pause", "Pause all downloads");
    const partial = fuzzyScore("ps", "Pause all downloads");
    expect(exact).toBeGreaterThan(partial);
    expect(fuzzyScore("zzz", "Pause all downloads")).toBe(Number.NEGATIVE_INFINITY);
    expect(fuzzyScore("pausd", "Pause all downloads")).toBeGreaterThan(
      Number.NEGATIVE_INFINITY,
    );
  });
});

describe("rankCommands", () => {
  const labels = Object.fromEntries(BUILTIN_COMMANDS.map((c) => [c.id, c.id]));

  it("ranks by label/keywords and boosts recent use", () => {
    const ranked = rankCommands(BUILTIN_COMMANDS, labels, "pause", new Map());
    expect(ranked[0]?.def.id).toBe("pause-all");
    const boosted = rankCommands(
      BUILTIN_COMMANDS,
      labels,
      "go",
      new Map([["go-logs", 3]]),
    );
    expect(boosted[0]?.def.id).toBe("go-logs");
  });

  it("returns everything on empty query", () => {
    expect(rankCommands(BUILTIN_COMMANDS, labels, "", new Map())).toHaveLength(
      BUILTIN_COMMANDS.length,
    );
  });
});

describe("availableCommands", () => {
  it("gates bulk commands by queue context", () => {
    const ids = (c: CommandContext): string[] =>
      availableCommands(BUILTIN_COMMANDS, c).map((d) => d.id);
    expect(ids(ctx([]))).not.toContain("pause-all");
    expect(ids(ctx([]))).not.toContain("resume-all");
    expect(ids(ctx([]))).not.toContain("retry-all");
    expect(ids(ctx([]))).not.toContain("clear-finished");
    expect(ids(ctx(["downloading"]))).toContain("pause-all");
    expect(ids(ctx(["paused"]))).toContain("resume-all");
    expect(ids(ctx(["error"]))).toContain("retry-all");
    expect(ids(ctx(["error"]))).toContain("clear-finished");
    // View/theme/settings commands are always available.
    expect(ids(ctx([]))).toContain("go-home");
    expect(ids(ctx([]))).toContain("theme-ember");
    expect(ids(ctx([]))).toContain("settings-cookies");
  });

  it("never throws availability away on bad context", () => {
    const bad = { ...ctx([]), jobs: null as never };
    expect(() => availableCommands(BUILTIN_COMMANDS, bad)).not.toThrow();
  });
});

describe("isCommandPalette", () => {
  it("matches Ctrl/Cmd+K without shift", () => {
    const combo = (key: string, ctrlKey: boolean, shiftKey: boolean): boolean =>
      isCommandPalette(comboFromEvent({ key, ctrlKey, metaKey: false, shiftKey }));
    expect(combo("k", true, false)).toBe(true);
    expect(combo("K", true, false)).toBe(true);
    expect(combo("k", false, false)).toBe(false);
    expect(combo("k", true, true)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@grabber/core/settings.js";
import type { AppSettings, DownloadJobInput } from "@grabber/core/types.js";
import { makeJob, toStartInput } from "@grabber/core/queue.js";
import { buildStartArgs } from "./jobArgs.js";

/**
 * R1: the job -> argv hop. Before this milestone the live/chapter flags were
 * dropped here (they were only unit-tested inside buildDownloadArgs), so the
 * packaged app never passed them to yt-dlp.
 */
const input: DownloadJobInput = {
  url: "https://youtu.be/aqz-KE-bpKQ",
  title: "Big Buck Bunny",
  preset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
  outputDir: "C:\\Vids",
};

function args(job: DownloadJobInput, settings: Partial<AppSettings> = {}): string[] {
  return buildStartArgs(job, {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    ffmpegDir: null,
    cookiesFile: null,
    archivePath: null,
  });
}

/** Value that follows a flag, or null when the flag is absent. */
function valueOf(argv: readonly string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i === -1 ? null : (argv[i + 1] ?? null);
}

function flagIndex(argv: readonly string[], flag: string): number {
  return argv.indexOf(flag);
}

describe("buildStartArgs", () => {
  it("always passes --continue, --ignore-config and the output template", () => {
    const argv = args(input);
    expect(flagIndex(argv, "--continue")).toBeGreaterThan(-1);
    expect(flagIndex(argv, "--ignore-config")).toBeGreaterThan(-1);
    expect(valueOf(argv, "--output")).toBe("C:\\Vids/%(title)s [%(id)s].%(ext)s");
    expect(argv[argv.length - 1]).toBe("https://youtu.be/aqz-KE-bpKQ");
  });

  it("falls back to the default template when settings hold only whitespace", () => {
    expect(valueOf(args(input, { filenameTemplate: "   " }), "--output")).toBe(
      "C:\\Vids/%(title)s [%(id)s].%(ext)s",
    );
  });

  it("adds --live-from-start and --hls-use-mpegts for a live stream (M4.1, R1)", () => {
    const argv = args(toStartInput(makeJob("j1", { ...input, liveStatus: "is_live", liveFromStart: true }, 1)));
    expect(flagIndex(argv, "--live-from-start")).toBeGreaterThan(-1);
    expect(flagIndex(argv, "--hls-use-mpegts")).toBeGreaterThan(-1);
  });

  it("keeps a recording playable without --live-from-start (mpegts, M4.1)", () => {
    const argv = args(toStartInput(makeJob("j2", { ...input, liveStatus: "is_live" }, 1)));
    expect(flagIndex(argv, "--live-from-start")).toBe(-1);
    expect(flagIndex(argv, "--hls-use-mpegts")).toBeGreaterThan(-1);
  });

  it("adds --wait-for-video for a scheduled stream (M4.1, R1)", () => {
    const argv = args(toStartInput(makeJob("j3", { ...input, liveStatus: "is_upcoming", waitForVideo: true }, 1)));
    expect(valueOf(argv, "--wait-for-video")).toBe("60");
  });

  it("never passes live or mpegts flags for a finished stream (M4.1)", () => {
    const argv = args(toStartInput(makeJob("j4", { ...input, liveStatus: "was_live" }, 1)));
    expect(flagIndex(argv, "--hls-use-mpegts")).toBe(-1);
    expect(flagIndex(argv, "--live-from-start")).toBe(-1);
    expect(flagIndex(argv, "--wait-for-video")).toBe(-1);
  });

  it("adds --split-chapters with a chapter output template (M4.2, R1)", () => {
    const argv = args(toStartInput(makeJob("j5", { ...input, splitChapters: true }, 1)));
    expect(flagIndex(argv, "--split-chapters")).toBeGreaterThan(-1);
    const templates = argv.filter((a) => a.startsWith("C:\\Vids/") || a.startsWith("chapter:"));
    expect(templates.some((t) => t.includes("%(section_title)s"))).toBe(true);
  });

  it("keeps the chapter subdir under the playlist folder (M4.2, R1)", () => {
    const argv = args(
      toStartInput(makeJob("j6", { ...input, splitChapters: true, playlistSubdir: "My List" }, 1)),
    );
    expect(argv.some((a) => a.startsWith("chapter:") && a.includes("/My List/"))).toBe(true);
  });

  it("joins the playlist subdir into the default output template", () => {
    const argv = args(toStartInput(makeJob("j7", { ...input, playlistSubdir: "My List" }, 1)));
    expect(valueOf(argv, "--output")).toBe("C:\\Vids/My List/%(title)s [%(id)s].%(ext)s");
  });

  it("lets a per-job cookie browser override the setting (R1)", () => {
    const withSetting = args(input, { cookiesFromBrowser: "chrome" });
    expect(valueOf(withSetting, "--cookies-from-browser")).toBe("chrome");
    const withOverride = args({ ...input, cookiesFromBrowser: "firefox" });
    expect(valueOf(withOverride, "--cookies-from-browser")).toBe("firefox");
  });

  it("passes the archive path only when the caller resolved one (R1)", () => {
    expect(flagIndex(args(input, { skipArchived: true }), "--download-archive")).toBe(-1);
    const argv = buildStartArgs({ ...input, useArchive: true }, {
      settings: { ...DEFAULT_SETTINGS, skipArchived: true },
      ffmpegDir: null,
      cookiesFile: null,
      archivePath: "C:\\udata\\archive.txt",
    });
    expect(valueOf(argv, "--download-archive")).toBe("C:\\udata\\archive.txt");
  });

  it("switches audio presets to extract-audio with the right codec", () => {
    const argv = args({
      ...input,
      preset: { kind: "audio", videoPreset: "Best", audioPreset: "Opus", rawFormat: null },
    });
    expect(flagIndex(argv, "--extract-audio")).toBeGreaterThan(-1);
    expect(valueOf(argv, "--audio-format")).toBe("opus");
    expect(valueOf(argv, "--format")).toBe("bestaudio/best");
  });

  it("keeps --embed-metadata driven by the setting (M4.3 will force it per job)", () => {
    expect(flagIndex(args(input), "--embed-metadata")).toBe(-1);
    expect(flagIndex(args(input, { embedMetadata: true }), "--embed-metadata")).toBeGreaterThan(-1);
  });
});
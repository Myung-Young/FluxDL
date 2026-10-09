import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@grabber/core/settings.js";
import type { AppSettings, DownloadJobInput } from "@grabber/core/types.js";
import { makeJob, toStartInput } from "@grabber/core/queue.js";
import { buildGalleryDlArgs, buildNm3u8dlArgs, buildStartArgs, buildStreamlinkArgs } from "./jobArgs.js";

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

  it("lets a per-job proxy override the setting (Phase 3, R1)", () => {
    const withSetting = args(input, { proxy: "http://global:8080" });
    expect(valueOf(withSetting, "--proxy")).toBe("http://global:8080");
    const withOverride = args(
      { ...input, proxyOverride: "http://job:9090" },
      { proxy: "http://global:8080" },
    );
    expect(valueOf(withOverride, "--proxy")).toBe("http://job:9090");
    // Empty override falls back to the setting.
    const empty = args({ ...input, proxyOverride: "  " }, { proxy: "http://global:8080" });
    expect(valueOf(empty, "--proxy")).toBe("http://global:8080");
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

  it("pairs --write-auto-subs with --write-subs unless opted out", () => {
    const on = args(input, { subtitles: true });
    expect(flagIndex(on, "--write-subs")).toBeGreaterThan(-1);
    expect(flagIndex(on, "--write-auto-subs")).toBeGreaterThan(-1);
    const off = args(input, { subtitles: true, includeAutoSubs: false });
    expect(flagIndex(off, "--write-subs")).toBeGreaterThan(-1);
    expect(flagIndex(off, "--write-auto-subs")).toBe(-1);
  });

  it("pins --audio-quality 0 for audio presets", () => {
    const argv = args({
      ...input,
      preset: { kind: "audio", videoPreset: "Best", audioPreset: "MP3", rawFormat: null },
    });
    expect(valueOf(argv, "--audio-quality")).toBe("0");
    expect(flagIndex(args(input), "--audio-quality")).toBe(-1);
  });
});

describe("buildGalleryDlArgs", () => {
  it("emits an args array ending with -- <url> (never shell)", () => {
    const argv = buildGalleryDlArgs(input, {
      settings: DEFAULT_SETTINGS,
      configPath: "C:\\data\\gallery-dl.conf.json",
      downloadDir: "C:\\dl\\Images",
      cookiesFile: null,
    });
    expect(argv).toContain("--config");
    expect(argv).toContain("--dest");
    expect(argv.slice(-2)).toEqual(["--", input.url]);
    expect(argv).not.toContain(input.url.replace("https://", ""));
  });

  it("passes retries/proxy/sleep only when set", () => {
    const argv = buildGalleryDlArgs(
      { ...input, engineId: "gallery-dl" },
      {
        settings: {
          ...DEFAULT_SETTINGS,
          images: { ...DEFAULT_SETTINGS.images, retries: 5, proxy: "http://127.0.0.1:8080" },
        },
        configPath: "c",
        downloadDir: "d",
        cookiesFile: "C:\\cookies.txt",
      },
    );
    expect(valueOf(argv, "--retries")).toBe("5");
    expect(valueOf(argv, "--proxy")).toBe("http://127.0.0.1:8080");
    expect(valueOf(argv, "--cookies")).toBe("C:\\cookies.txt");
  });

  it("lets a per-job proxy beat the images/global proxy (Phase 3)", () => {
    const argv = buildGalleryDlArgs(
      { ...input, engineId: "gallery-dl", proxyOverride: "http://job:9090" },
      {
        settings: {
          ...DEFAULT_SETTINGS,
          proxy: "http://global:8080",
          images: { ...DEFAULT_SETTINGS.images, proxy: "http://images:8080" },
        },
        configPath: "c",
        downloadDir: "d",
        cookiesFile: null,
      },
    );
    expect(valueOf(argv, "--proxy")).toBe("http://job:9090");
  });

  it("emits native gallery post-processors only when enabled (Phase 4)", () => {    const off = buildGalleryDlArgs(input, {
      settings: DEFAULT_SETTINGS,
      configPath: "c",
      downloadDir: "d",
      cookiesFile: null,
    });
    expect(off).not.toContain("--zip");
    expect(off).not.toContain("--cbz");
    expect(off).not.toContain("--ugoira");
    const packed = buildGalleryDlArgs(input, {
      settings: {
        ...DEFAULT_SETTINGS,
        postProcess: { ...DEFAULT_SETTINGS.postProcess, packageGallery: "cbz", ugoiraFormat: "mp4" },
      },
      configPath: "c",
      downloadDir: "d",
      cookiesFile: null,
    });
    expect(packed).toContain("--cbz");
    expect(valueOf(packed, "--ugoira")).toBe("mp4");
  });

  it("emits --range for selected-items downloads, dropping junk (v1.8.5)", () => {
    const deps = {
      settings: DEFAULT_SETTINGS,
      configPath: "c",
      downloadDir: "d",
      cookiesFile: null,
    };
    expect(valueOf(buildGalleryDlArgs({ ...input, range: "2-4,7" }, deps), "--range")).toBe(
      "2-4,7",
    );
    expect(flagIndex(buildGalleryDlArgs(input, deps), "--range")).toBe(-1);
    expect(
      flagIndex(buildGalleryDlArgs({ ...input, range: "--config x" }, deps), "--range"),
    ).toBe(-1);
  });
});

describe("pack engine argv (Phase 5)", () => {
  const titled = { ...input, title: 'Big: Buck/Bunny? [x]' };

  it("builds a streamlink best-to-file command with a safe name", () => {
    const { args, destination } = buildStreamlinkArgs(titled, "C:\\Vids");
    expect(args.slice(0, 2)).toEqual([titled.url, "best"]);
    expect(valueOf(args, "-o")).toBe(destination);
    expect(args).toContain("--force");
    expect(destination.endsWith(".ts")).toBe(true);
    const base = destination.split("\\").pop() ?? "";
    expect(base).not.toMatch(/[<>:"/\\|?*]/);
    expect(base).toBe("Big_ Buck_Bunny_ [x].ts");
  });

  it("builds an N_m3u8DL-RE mp4 command with our ffmpeg", () => {
    const { args, destination, tmpDir } = buildNm3u8dlArgs(
      titled,
      "C:\\Vids",
      { ffmpegDir: "C:\\bins" },
      "abc123",
    );
    expect(args[0]).toBe(titled.url);
    expect(valueOf(args, "--save-dir")).toBe("C:\\Vids");
    expect(valueOf(args, "--save-name")).toBe("Big_ Buck_Bunny_ [x]");
    expect(args).toContain("format=mp4");
    expect(args).toContain("--auto-select");
    expect(args).toContain("--del-after-done");
    expect(valueOf(args, "--ffmpeg-binary-path")).toBe("C:\\bins\\ffmpeg.exe");
    expect(tmpDir).toContain(".n-m3u8dl-tmp-abc123");
    expect(destination.endsWith(".mp4")).toBe(true);
  });

  it("omits the ffmpeg path when unavailable", () => {
    const { args } = buildNm3u8dlArgs(input, "C:\\Vids", { ffmpegDir: null }, "z");
    expect(args).not.toContain("--ffmpeg-binary-path");
  });
});
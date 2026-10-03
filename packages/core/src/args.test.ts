import { describe, expect, it } from "vitest";
import {
  buildDownloadArgs,
  buildInfoArgs,
  buildUpdateArgs,
  buildVersionArgs,
  type DownloadArgsInput,
} from "./args.js";

function base(over: Partial<DownloadArgsInput> = {}): DownloadArgsInput {
  return {
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    preset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
    outputDir: "C:\\Users\\P\\Videos\\Grabber",
    filenameTemplate: "%(title)s [%(id)s].%(ext)s",
    ffmpegDir: "C:\\tools\\ffmpeg",
    mergeContainer: "mp4",
    embedThumbnail: false,
    embedMetadata: true,
    writeSubs: false,
    subLangs: "en",
    embedSubs: false,
    sponsorBlock: false,
    speedLimit: null,
    proxy: null,
    cookiesFromBrowser: null,
    cookiesFile: null,
    codecPreference: "auto",
    archivePath: null,
    playlistSubdir: null,
    noPlaylist: true,
    ...over,
  };
}

describe("arg builder", () => {
  it("builds metadata args with dump-single-json + flat-playlist", () => {
    const args = buildInfoArgs("youtu.be/aqz-KE-bpKQ");
    expect(args).toContain("--dump-single-json");
    expect(args).toContain("--flat-playlist");
    expect(args[args.length - 1]?.startsWith("https://")).toBe(true);
  });

  it("builds video args with height filter, merge, and machine progress", () => {
    const args = buildDownloadArgs(base());
    expect(args).toContain("--newline");
    expect(args).toContain("--progress-template");
    expect(args).toContain("--continue");
    expect(args).toContain("--format");
    expect(args.join(" ")).toContain("height<=1080");
    expect(args).toContain("--merge-output-format");
    expect(args).toContain("--no-playlist");
    expect(args).toContain("--no-sponsorblock");
  });

  it("builds audio args with extract-audio", () => {
    const args = buildDownloadArgs(
      base({ preset: { kind: "audio", videoPreset: "Best", audioPreset: "MP3", rawFormat: null } }),
    );
    expect(args).toContain("--extract-audio");
    expect(args).toContain("--audio-format");
    expect(args).toContain("mp3");
  });

  it("rawFormat takes precedence over presets", () => {
    const args = buildDownloadArgs(
      base({
        preset: { kind: "video", videoPreset: "720", audioPreset: "MP3", rawFormat: "bv*+ba/b" },
      }),
    );
    expect(args).toContain("bv*+ba/b");
    expect(args.join(" ")).not.toContain("height<=");
  });

  it("passes through paths with spaces/unicode untouched (args array, no shell)", () => {
    const args = buildDownloadArgs(
      base({
        outputDir: "C:\\Users\\P\\My Videos\\münchen 輸入",
        speedLimit: "4.2M",
        proxy: "socks5://127.0.0.1:1080",
        cookiesFromBrowser: "chrome",
      }),
    );
    expect(args.join("\n")).toContain("My Videos");
    expect(args).toContain("--limit-rate");
    expect(args).toContain("--proxy");
    expect(args).toContain("--cookies-from-browser");
  });

  it("keeps a spaces path as one --output argv with a subfolder (M3.3)", () => {
    const args = buildDownloadArgs(
      base({
        outputDir: "C:\\Users\\P\\My Videos",
        playlistSubdir: "My Playlist",
      }),
    );
    const i = args.indexOf("--output");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toContain("My Videos/My Playlist/");
  });

  it("trims very long filenames for Windows path limits", () => {
    const args = buildDownloadArgs(base());
    const i = args.indexOf("--trim-filenames");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("200");
  });

  it("builds version/update args", () => {
    expect(buildVersionArgs()).toEqual(["--version"]);
    expect(buildUpdateArgs()).toEqual(["--update"]);
  });

  it("passes --ignore-config on every spawn (user yt-dlp configs must not leak in)", () => {
    expect(buildInfoArgs("https://www.youtube.com/watch?v=aqz-KE-bpKQ")).toContain(
      "--ignore-config",
    );
    expect(buildDownloadArgs(base())).toContain("--ignore-config");
  });

  it("omits --format-sort for auto codec preference", () => {
    const args = buildDownloadArgs(base());
    expect(args).not.toContain("--format-sort");
  });

  it("applies codec preference via -S sort (preset x codec matrix)", () => {
    const cases = [
      { videoPreset: "1080", codec: "h264", sort: "vcodec:h264" },
      { videoPreset: "720", codec: "vp9", sort: "vcodec:vp9" },
      { videoPreset: "Best", codec: "av1", sort: "vcodec:av01" },
      { videoPreset: "Compatible", codec: "auto", sort: "vcodec:h264,acodec:aac" },
      { videoPreset: "Compatible", codec: "vp9", sort: "vcodec:h264,acodec:aac" },
    ] as const;
    for (const c of cases) {
      const args = buildDownloadArgs(
        base({
          preset: { kind: "video", videoPreset: c.videoPreset, audioPreset: "MP3", rawFormat: null },
          codecPreference: c.codec,
        }),
      );
      const i = args.indexOf("--format-sort");
      expect(i).toBeGreaterThan(-1);
      expect(args[i + 1]).toBe(c.sort);
    }
  });

  it("Compatible preset caps at 1080p and merges to the configured container", () => {
    const args = buildDownloadArgs(
      base({
        preset: { kind: "video", videoPreset: "Compatible", audioPreset: "MP3", rawFormat: null },
      }),
    );
    expect(args.join(" ")).toContain("height<=1080");
    expect(args).toContain("--merge-output-format");
  });

  it("never sorts audio presets or raw formats", () => {
    const audio = buildDownloadArgs(
      base({
        preset: { kind: "audio", videoPreset: "Best", audioPreset: "MP3", rawFormat: null },
        codecPreference: "h264",
      }),
    );
    expect(audio).not.toContain("--format-sort");
    const raw = buildDownloadArgs(
      base({
        preset: { kind: "video", videoPreset: "720", audioPreset: "MP3", rawFormat: "bv*+ba/b" },
        codecPreference: "h264",
      }),
    );
    expect(raw).not.toContain("--format-sort");
  });

  it("passes --download-archive only when an archive path is set", () => {
    const plain = buildDownloadArgs(base());
    expect(plain).not.toContain("--download-archive");
    const archived = buildDownloadArgs(base({ archivePath: "C:\\Data\\archive.txt" }));
    const i = archived.indexOf("--download-archive");
    expect(i).toBeGreaterThan(-1);
    expect(archived[i + 1]).toBe("C:\\Data\\archive.txt");
  });

  it("passes --cookies file before --cookies-from-browser", () => {
    const args = buildDownloadArgs(
      base({ cookiesFile: "C:\\me\\cookies.txt", cookiesFromBrowser: "firefox" }),
    );
    const i = args.indexOf("--cookies");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("C:\\me\\cookies.txt");
    expect(args.indexOf("--cookies")).toBeLessThan(args.indexOf("--cookies-from-browser"));
  });

  it("nests playlist output in a sanitized subfolder", () => {
    const args = buildDownloadArgs(base({ playlistSubdir: 'Mix: "Best"?' }));
    const i = args.indexOf("--output");
    expect(args[i + 1]).toContain("Mix_ _Best__");
    expect(args.join(" ")).not.toContain("..");
    const flat = buildDownloadArgs(base());
    expect(flat[flat.indexOf("--output") + 1]).toBe(
      "C:\\Users\\P\\Videos\\Grabber/%(title)s [%(id)s].%(ext)s",
    );
  });

  it("adds --live-from-start and --hls-use-mpegts for live streams (M4.1)", () => {
    const args = buildDownloadArgs(base({ liveFromStart: true }));
    expect(args).toContain("--live-from-start");
    expect(args).toContain("--hls-use-mpegts");
  });

  it("adds --wait-for-video for upcoming streams (M4.1)", () => {
    const args = buildDownloadArgs(base({ waitForVideo: true }));
    expect(args).toContain("--wait-for-video");
    expect(args[args.indexOf("--wait-for-video") + 1]).toBe("60");
  });

  it("adds --hls-use-mpegts when liveStatus is is_live (M4.1)", () => {
    const args = buildDownloadArgs(base({ liveStatus: "is_live" }));
    expect(args).toContain("--hls-use-mpegts");
    // Not a live stream — no mpegts unless liveFromStart
    const normalArgs = buildDownloadArgs(base({ liveStatus: "was_live" }));
    expect(normalArgs).not.toContain("--hls-use-mpegts");
  });
});

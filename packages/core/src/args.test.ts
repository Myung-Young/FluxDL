import { describe, expect, it } from "vitest";
import {
  audioFormatOf,
  buildChapterOutputTemplate,
  buildDownloadArgs,
  buildInfoArgs,
  buildUpdateArgs,
  buildVersionArgs,
  mergeContainerOf,
  pacingArgs,
  redactArgs,
  remuxContainerOf,
  type DownloadArgsInput,
} from "./args.js";
import { AUDIO_PRESETS, CONTAINERS } from "./types.js";

function presetOf(audio: DownloadArgsInput["preset"]["audioPreset"] = "MP3"): DownloadArgsInput["preset"] {
  return { kind: "audio", videoPreset: "Best", audioPreset: audio, rawFormat: null };
}

function videoPresetOf(): DownloadArgsInput["preset"] {
  return { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null };
}

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
      base({ preset: presetOf("MP3") }),
    );
    expect(args).toContain("--extract-audio");
    expect(args).toContain("--audio-format");
    expect(args).toContain("mp3");
  });

  it("pins best audio quality for audio presets", () => {
    const args = buildDownloadArgs(
      base({ preset: { kind: "audio", videoPreset: "Best", audioPreset: "MP3", rawFormat: null } }),
    );
    const i = args.indexOf("--audio-quality");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("0");
    // Video presets never carry it.
    expect(buildDownloadArgs(base())).not.toContain("--audio-quality");
  });

  it("fetches auto-generated subs alongside manual subs by default", () => {
    const args = buildDownloadArgs(base({ writeSubs: true, subLangs: "en" }));
    expect(args).toContain("--write-subs");
    expect(args).toContain("--write-auto-subs");
    const off = buildDownloadArgs(base({ writeSubs: true, subLangs: "en", writeAutoSubs: false }));
    expect(off).toContain("--write-subs");
    expect(off).not.toContain("--write-auto-subs");
    // Subs off entirely: neither flag.
    const none = buildDownloadArgs(base());
    expect(none).not.toContain("--write-subs");
    expect(none).not.toContain("--write-auto-subs");
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

  it("builds chapter output template with and without playlist subfolder", () => {
    const flat = buildChapterOutputTemplate("C:\\Users\\P\\Videos\\Grabber", null);
    expect(flat).toBe("C:\\Users\\P\\Videos\\Grabber/%(title)s/%(section_number)03d - %(section_title)s.%(ext)s");

    const nested = buildChapterOutputTemplate("C:\\Users\\P\\Videos\\Grabber", "My Playlist");
    expect(nested).toBe("C:\\Users\\P\\Videos\\Grabber/My Playlist/%(title)s/%(section_number)03d - %(section_title)s.%(ext)s");
  });

  it("adds --split-chapters and chapter output template when splitChapters is enabled (M4.2)", () => {
    const args = buildDownloadArgs(base({ splitChapters: true }));
    expect(args).toContain("--split-chapters");
    const outputIdx = args.lastIndexOf("--output");
    expect(outputIdx).toBeGreaterThan(-1);
    expect(args[outputIdx + 1]).toBe(
      "chapter:C:\\Users\\P\\Videos\\Grabber/%(title)s/%(section_number)03d - %(section_title)s.%(ext)s",
    );
  });

  describe("audio metadata (M4.3)", () => {
    const audio = base({
      preset: { kind: "audio", videoPreset: "Best", audioPreset: "MP3", rawFormat: null },
    });

    function parseValues(args: readonly string[]): string[] {
      return args.filter((a, i) => args[i - 1] === "--parse-metadata");
    }

    it("emits one --parse-metadata pair per non-empty field", () => {
      const args = buildDownloadArgs(
        base({
          preset: audio.preset,
          embedMetadata: false,
          audioMetadata: { title: "T", artist: "A", album: "", year: "2024" },
        }),
      );
      expect(parseValues(args)).toEqual([
        "T~:(?P<meta_title>T)~",
        "A~:(?P<meta_artist>A)~",
        "2024~:(?P<meta_date>2024)~",
      ]);
    });

    it("forces --embed-metadata even when the setting is off", () => {
      const args = buildDownloadArgs(
        base({
          preset: audio.preset,
          embedMetadata: false,
          audioMetadata: { title: "T", artist: "", album: "", year: "" },
        }),
      );
      expect(args).toContain("--embed-metadata");
      expect(args.filter((a) => a === "--embed-metadata")).toHaveLength(1);
    });

    it("adds no flags when the editor was left blank", () => {
      const args = buildDownloadArgs(
        base({
          preset: audio.preset,
          embedMetadata: false,
          audioMetadata: { title: "  ", artist: "", album: "", year: "" },
        }),
      );
      expect(args).not.toContain("--parse-metadata");
      expect(args).not.toContain("--embed-metadata");
    });

    it("adds no flags when there is no metadata at all", () => {
      const args = buildDownloadArgs(base({ preset: audio.preset, embedMetadata: false }));
      expect(args).not.toContain("--parse-metadata");
      expect(args).not.toContain("--embed-metadata");
    });

    it("still honors the setting when no overrides are present", () => {
      expect(buildDownloadArgs(base({ preset: audio.preset, embedMetadata: true }))).toContain(
        "--embed-metadata",
      );
      expect(
        buildDownloadArgs(base({ preset: audio.preset, embedMetadata: false })),
      ).not.toContain("--embed-metadata");
    });

    it("escapes tricky values into injection-safe specs", () => {
      const args = buildDownloadArgs(
        base({
          preset: audio.preset,
          audioMetadata: { title: "50% (Live): AC/DC", artist: "", album: "", year: "" },
        }),
      );
      expect(parseValues(args)).toEqual([
        "50%% (Live)\\: AC/DC~:(?P<meta_title>50% \\(Live\\): AC/DC)~",
      ]);
    });

    it("works alongside extract-audio for audio presets", () => {
      const args = buildDownloadArgs(
        base({
          preset: { kind: "audio", videoPreset: "Best", audioPreset: "FLAC", rawFormat: null },
          audioMetadata: { title: "T", artist: "A", album: "", year: "" },
        }),
      );
      expect(args).toContain("--extract-audio");
      expect(args[args.indexOf("--audio-format") + 1]).toBe("flac");
      expect(args).toContain("--parse-metadata");
    });
  });
});


describe("redactArgs (C6)", () => {
  it("redacts cookie and proxy values, keeps the shape", () => {
    expect(
      redactArgs(["--cookies", "C:\\me\\c.txt", "--proxy", "http://u:p@h", "--format", "best"]),
    ).toEqual(["--cookies", "(redacted)", "--proxy", "(redacted)", "--format", "best"]);
    expect(redactArgs(["--format", "best"])).toEqual(["--format", "best"]);
    expect(redactArgs(["--cookies"])).toEqual(["--cookies"]);
  });
});

describe("forceOverwrite (M4.8)", () => {
  const withFlag = (patch: Partial<DownloadArgsInput>): string[] => buildDownloadArgs(base(patch));

  it("adds --force-overwrites for an explicit re-download", () => {
    const args = withFlag({ forceOverwrite: true });
    expect(args).toContain("--force-overwrites");
  });

  it("never adds it for ordinary downloads", () => {
    expect(withFlag({})).not.toContain("--force-overwrites");
    expect(withFlag({ forceOverwrite: false })).not.toContain("--force-overwrites");
    // exactOptionalPropertyTypes: an explicit undefined is the same as absent.
    expect(withFlag({ forceOverwrite: false })).not.toContain("--force-overwrites");
  });

  it("keeps --continue on normal jobs (resume must still work)", () => {
    expect(withFlag({})).toContain("--continue");
    // --force-overwrites implies --no-continue inside yt-dlp; that is intended
    // for an explicit re-download and must not leak into normal downloads.
    expect(withFlag({ forceOverwrite: true })).toContain("--continue");
  });
});

/**
 * v1.7.2: full format coverage + polite pacing.
 *
 * Every value below was read out of `yt-dlp --help` on the BUNDLED 2026.08.19
 * binary, NOT from memory: `--audio-format` accepts best/aac/alac/flac/m4a/mp3/
 * opus/vorbis/wav, `--merge-output-format` accepts avi/flv/mkv/mov/mp4/webm,
 * and `--remux-video` accepts the video subset plus gif. yt-dlp ABORTS on an
 * unknown value, so a stale setting must never reach the child process.
 */
describe("audio formats cover every yt-dlp --audio-format value", () => {
  const expected: Record<string, string> = {
    MP3: "mp3",
    M4A: "m4a",
    AAC: "aac",
    Opus: "opus",
    Vorbis: "vorbis",
    FLAC: "flac",
    ALAC: "alac",
    WAV: "wav",
  };

  it("maps each preset to its documented value", () => {
    for (const [preset, value] of Object.entries(expected)) {
      expect(audioFormatOf(presetOf(preset as never))).toBe(value);
    }
  });

  it("offers every one of them in the preset list", () => {
    for (const key of Object.keys(expected)) {
      expect(AUDIO_PRESETS).toContain(key);
    }
    expect(AUDIO_PRESETS).toContain("Best");
  });

  it("passes -x with the right --audio-format", () => {
    for (const [preset, value] of Object.entries(expected)) {
      const args = buildDownloadArgs(base({ preset: presetOf(preset as never) }));
      expect(args).toContain("--extract-audio");
      expect(args[args.indexOf("--audio-format") + 1]).toBe(value);
    }
  });

  it("'Best' keeps the source stream: no -x, no re-encode", () => {
    const args = buildDownloadArgs(base({ preset: presetOf("Best") }));
    expect(args).not.toContain("--extract-audio");
    expect(args).not.toContain("--audio-format");
    expect(args).toContain("bestaudio/best");
  });
});

describe("containers cover every yt-dlp remux target", () => {
  it("exposes the verified merge + remux set", () => {
    // merge: avi flv mkv mov mp4 webm. remux adds gif.
    for (const c of ["mp4", "mkv", "webm", "avi", "flv", "mov", "gif"]) {
      expect(CONTAINERS).toContain(c);
    }
    expect(CONTAINERS).toEqual(["mp4", "mkv", "webm", "avi", "flv", "mov", "gif"]);
    // Values this binary rejects must not be offered.
    for (const rejected of ["ogv", "mpg", "mpeg", "ts", "vob", "3gp", "m2ts", "wmv", "f4v"]) {
      expect(CONTAINERS).not.toContain(rejected);
    }
  });

  it("passes both --merge-output-format and --remux-video for a mergeable target", () => {
    expect(mergeContainerOf({ mergeContainer: "mkv", preset: videoPresetOf() })).toBe("mkv");
    expect(remuxContainerOf({ mergeContainer: "mkv", preset: videoPresetOf() })).toBe("mkv");
    const args = buildDownloadArgs(base({ mergeContainer: "mkv" }));
    expect(args[args.indexOf("--merge-output-format") + 1]).toBe("mkv");
    expect(args[args.indexOf("--remux-video") + 1]).toBe("mkv");
  });

  it("gif is remux-only (no --merge-output-format: yt-dlp cannot merge into it)", () => {
    expect(mergeContainerOf({ mergeContainer: "gif", preset: videoPresetOf() })).toBeNull();
    expect(remuxContainerOf({ mergeContainer: "gif", preset: videoPresetOf() })).toBe("gif");
    const args = buildDownloadArgs(base({ mergeContainer: "gif" }));
    expect(args).not.toContain("--merge-output-format");
    expect(args[args.indexOf("--remux-video") + 1]).toBe("gif");
  });

  it("a per-job override beats the global setting", () => {
    const args = buildDownloadArgs(
      base({ mergeContainer: "mp4", preset: { ...videoPresetOf(), container: "mkv" } }),
    );
    expect(args[args.indexOf("--remux-video") + 1]).toBe("mkv");
  });

  it("drops an unknown container instead of aborting the download", () => {
    // yt-dlp exits with an error on an unrecognised value, so a hand-edited
    // settings file must not be able to break every download.
    const args = buildDownloadArgs(base({ mergeContainer: "exe" }));
    expect(args).not.toContain("--merge-output-format");
    expect(args).not.toContain("--remux-video");
  });

  it("never remuxes an audio job", () => {
    const args = buildDownloadArgs(
      base({ preset: { kind: "audio", videoPreset: "Best", audioPreset: "MP3", rawFormat: null } }),
    );
    expect(args).not.toContain("--remux-video");
    expect(args).not.toContain("--merge-output-format");
  });
});

describe("polite pacing", () => {
  it("adds nothing by default (default argv is unchanged)", () => {
    const args = buildDownloadArgs(base());
    for (const flag of [
      "--sleep-requests",
      "--min-sleep-interval",
      "--max-sleep-interval",
      "--sleep-subtitles",
    ]) {
      expect(args).not.toContain(flag);
    }
  });

  it("maps each delay to its documented flag", () => {
    expect(pacingArgs({ sleepRequestsSec: 1 })).toEqual(["--sleep-requests", "1"]);
    expect(pacingArgs({ minSleepIntervalSec: 5 })).toEqual(["--min-sleep-interval", "5"]);
    expect(pacingArgs({ sleepSubtitlesSec: 2 })).toEqual(["--sleep-subtitles", "2"]);
  });

  it("emits max only alongside min (yt-dlp rejects it alone)", () => {
    expect(pacingArgs({ maxSleepIntervalSec: 10 })).toEqual([]);
    expect(pacingArgs({ minSleepIntervalSec: 5, maxSleepIntervalSec: 10 })).toEqual([
      "--min-sleep-interval",
      "5",
      "--max-sleep-interval",
      "10",
    ]);
  });

  it("drops a max below the min (yt-dlp would reject the pair)", () => {
    expect(pacingArgs({ minSleepIntervalSec: 10, maxSleepIntervalSec: 5 })).toEqual([
      "--min-sleep-interval",
      "10",
    ]);
  });

  it("treats off / junk / negative as off instead of passing it on", () => {
    expect(pacingArgs({})).toEqual([]);
    expect(pacingArgs({ sleepRequestsSec: null, minSleepIntervalSec: null })).toEqual([]);
    expect(pacingArgs({ sleepRequestsSec: 0, minSleepIntervalSec: 0 })).toEqual([]);
    expect(pacingArgs({ sleepRequestsSec: -5, minSleepIntervalSec: -1 })).toEqual([]);
    expect(pacingArgs({ sleepRequestsSec: Number.NaN })).toEqual([]);
    expect(pacingArgs({ sleepRequestsSec: Number.POSITIVE_INFINITY })).toEqual([]);
  });

  it("rounds a fractional delay and floors a sub-second minimum", () => {
    expect(pacingArgs({ sleepRequestsSec: 1.9 })).toEqual(["--sleep-requests", "1"]);
    expect(pacingArgs({ minSleepIntervalSec: 0.4 })).toEqual(["--min-sleep-interval", "1"]);
  });

  it("reaches the real argv, last, just before the URL", () => {
    const args = buildDownloadArgs(
      base({ sleepRequestsSec: 2, minSleepIntervalSec: 5, maxSleepIntervalSec: 10 }),
    );
    expect(args).toContain("--sleep-requests");
    expect(args).toContain("--min-sleep-interval");
    expect(args).toContain("--max-sleep-interval");
    // Pacing goes last so the URL stays the final argument.
    expect(args.slice(-7)).toEqual([
      "--sleep-requests",
      "2",
      "--min-sleep-interval",
      "5",
      "--max-sleep-interval",
      "10",
      base().url,
    ]);
  });
});

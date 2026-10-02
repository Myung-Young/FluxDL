import { describe, expect, it } from "vitest";
import {
  estimatePresetSize,
  formatSize,
  parseMediaInfo,
} from "./media.js";
import type { DownloadPreset, MediaInfo } from "./types.js";
import bbbDump from "./bbb-54formats.json";

describe("parseMediaInfo", () => {
  it("maps a single video", () => {
    const info = parseMediaInfo("https://youtu.be/aqz-KE-bpKQ", {
      title: "Big Buck Bunny",
      uploader: "Blender",
      duration: 596,
      thumbnail: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
      formats: [
        {
          format_id: "18",
          ext: "mp4",
          resolution: "640x360",
          vcodec: "avc1",
          acodec: "mp4a",
          fps: 24,
          tbr: 512,
          filesize: 123456,
          protocol: "https",
        },
      ],
    });
    expect(info.isPlaylist).toBe(false);
    expect(info.title).toBe("Big Buck Bunny");
    expect(info.formats).toHaveLength(1);
    expect(info.formats[0]?.kind).toBe("video+audio");
  });

  it("maps a flat playlist", () => {
    const info = parseMediaInfo("https://www.youtube.com/playlist?list=PLx", {
      _type: "playlist",
      title: "Mix",
      entries: [
        { id: "a1", title: "One", webpage_url: "https://youtu.be/a1", duration: 10 },
        { id: "b2", title: "Two", url: "b2" },
      ],
    });
    expect(info.isPlaylist).toBe(true);
    expect(info.entries).toHaveLength(2);
    expect(info.entries[0]?.selected).toBe(true);
    // bare flat-playlist `url` falls back to the source URL
    expect(info.entries[1]?.url).toContain("playlist");
  });

  it("tolerates missing fields and rejects non-objects", () => {
    const info = parseMediaInfo("https://youtu.be/x", {});
    expect(info.title).toBe("Untitled");
    expect(info.entries).toEqual([]);
    expect(info.formats).toEqual([]);
    expect(() => parseMediaInfo("https://youtu.be/x", null)).toThrow();
    expect(() => parseMediaInfo("https://youtu.be/x", [])).toThrow();
  });

  it("classifies storyboard tracks so they never pollute audio picks", () => {
    const info = parseMediaInfo("https://youtu.be/x", {
      formats: [
        { format_id: "sb0", ext: "mhtml", protocol: "mhtml", vcodec: "none", acodec: "none" },
      ],
    });
    expect(info.formats[0]?.kind).toBe("storyboard");
  });
});

function videoPreset(videoPreset: DownloadPreset["videoPreset"]): DownloadPreset {
  return { kind: "video", videoPreset, audioPreset: "MP3", rawFormat: null };
}

describe("estimatePresetSize", () => {
  const bbb: MediaInfo = parseMediaInfo(
    "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    bbbDump,
  );

  it("parses the real 53-format capture", () => {
    expect(bbb.formats).toHaveLength(53);
    expect(bbb.duration).toBe(635);
  });

  it("estimates Compatible (H.264+AAC <=1080p) the same as 1080p+h264", () => {
    const compat = estimatePresetSize(bbb, videoPreset("Compatible"), "auto");
    const h264 = estimatePresetSize(bbb, videoPreset("1080"), "h264");
    expect(compat).not.toBeNull();
    expect(h264).not.toBeNull();
    expect(compat?.bytes).toBeGreaterThan(0);
    expect(compat?.bytes).toBe(h264?.bytes);
  });

  it("estimates audio-only presets from the best audio stream", () => {
    const est = estimatePresetSize(
      bbb,
      { kind: "audio", videoPreset: "Best", audioPreset: "MP3", rawFormat: null },
      "auto",
    );
    expect(est).not.toBeNull();
    expect(est?.bytes).toBeGreaterThan(0);
  });

  it("prefers exact filesize, else falls back to tbr x duration", () => {
    const exact = parseMediaInfo("https://youtu.be/x", {
      duration: 100,
      formats: [
        {
          format_id: "v",
          ext: "mp4",
          vcodec: "avc1",
          acodec: "none",
          width: 640,
          height: 360,
          filesize: 8_000_000,
        },
        {
          format_id: "a",
          ext: "m4a",
          vcodec: "none",
          acodec: "mp4a",
          tbr: 128,
        },
      ],
    });
    const est = estimatePresetSize(exact, videoPreset("480"), "auto");
    // 128 kbps x 100 s = 1_600_000 bytes of audio on top of exact video.
    expect(est).toEqual({ bytes: 9_600_000, approximate: true });

    const tbrOnly = parseMediaInfo("https://youtu.be/x", {
      duration: 100,
      formats: [{ format_id: "v", ext: "mp4", vcodec: "avc1", acodec: "mp4a", tbr: 800 }],
    });
    expect(estimatePresetSize(tbrOnly, videoPreset("Best"), "auto")).toEqual({
      bytes: 10_000_000,
      approximate: true,
    });
  });

  it("returns null when no usable size data exists", () => {
    const empty = parseMediaInfo("https://youtu.be/x", { duration: 100, formats: [] });
    expect(estimatePresetSize(empty, videoPreset("Best"), "auto")).toBeNull();
    const noDuration = parseMediaInfo("https://youtu.be/x", {
      formats: [{ format_id: "v", ext: "mp4", vcodec: "avc1", acodec: "mp4a", tbr: 800 }],
    });
    expect(estimatePresetSize(noDuration, videoPreset("Best"), "auto")).toBeNull();
  });
});

describe("formatSize", () => {
  it("formats bytes for estimate chips", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(999)).toBe("999 B");
    expect(formatSize(1536)).toBe("2 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(1283456789)).toBe("1.2 GB");
    expect(formatSize(Number.NaN)).toBe("-");
    expect(formatSize(-1)).toBe("-");
  });
});

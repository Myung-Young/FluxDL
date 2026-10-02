import { describe, expect, it } from "vitest";
import { parseMediaInfo } from "./media.js";

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
});

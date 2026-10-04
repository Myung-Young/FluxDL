import { describe, expect, it } from "vitest";
import { addWatchChannel, diffWatch, normalizeWatchlist, touchWatch } from "./watchlist.js";
import type { MediaInfo } from "./types.js";

function info(ids: string[]): MediaInfo {
  return {
    url: "https://example.com/channel",
    title: "Channel",
    uploader: null,
    duration: null,
    thumbnail: null,
    isPlaylist: true,
    extractor: "youtube",
    videoId: null,
    entries: ids.map((id) => ({
      id,
      title: `Video ${id}`,
      url: `https://example.com/watch?v=${id}`,
      duration: null,
      thumbnail: null,
      selected: false,
    })),
    formats: [],
  };
}

describe("normalizeWatchlist", () => {
  it("keeps valid rows, dedupes, drops garbage", () => {
    const rows = normalizeWatchlist([
      { url: "https://example.com/c1", title: "C1" },
      { url: "https://example.com/c1" },
      { url: "not a url" },
      null,
      "junk",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "C1", lastVideoId: null, lastCheckedAt: null });
  });

  it("rejects non-arrays and caps at 200", () => {
    expect(normalizeWatchlist(null)).toEqual([]);
    expect(normalizeWatchlist({})).toEqual([]);
  });
});

describe("diffWatch", () => {
  it("baselines on first check without reporting the backlog", () => {
    const d = diffWatch(info(["v3", "v2", "v1"]), null);
    expect(d.fresh).toEqual([]);
    expect(d.baseline).toBe("v3");
    expect(d.isFirstCheck).toBe(true);
  });

  it("reports entries above the baseline", () => {
    const d = diffWatch(info(["v5", "v4", "v3"]), "v3");
    expect(d.fresh.map((e) => e.id)).toEqual(["v5", "v4"]);
    expect(d.baseline).toBe("v5");
  });

  it("reports nothing new when the baseline is still newest", () => {
    const d = diffWatch(info(["v3", "v2"]), "v3");
    expect(d.fresh).toEqual([]);
    expect(d.baseline).toBe("v3");
  });
});

describe("addWatchChannel", () => {
  it("appends normalized rows and ignores dupes", () => {
    const once = addWatchChannel([], "https://example.com/c1", "C1");
    expect(once).toHaveLength(1);
    expect(addWatchChannel(once, "https://example.com/c1", "C1")).toHaveLength(1);
    expect(() => addWatchChannel([], "not a url", "X")).toThrow();
  });
});

describe("touchWatch", () => {
  it("patches the matching channel only", () => {
    const rows = normalizeWatchlist([{ url: "https://example.com/c1" }]);
    const next = touchWatch(rows, "https://example.com/c1", {
      lastVideoId: "v9",
      lastCheckedAt: 123,
    });
    expect(next[0]).toMatchObject({ lastVideoId: "v9", lastCheckedAt: 123 });
  });
});

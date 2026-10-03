import { describe, expect, it } from "vitest";
import { deriveEntryStates, sanitizePlaylistTitle } from "./playlist.js";
import type { DownloadJob, PlaylistEntry } from "./types.js";

function entry(id: string, url: string): PlaylistEntry {
  return { id, title: `Video ${id}`, url, duration: null, thumbnail: null, selected: true };
}

function history(over: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "h1",
    url: "https://example.com/a",
    title: "A",
    preset: { kind: "video", videoPreset: "720", audioPreset: "MP3", rawFormat: null },
    outputDir: "C:\\Vids",
    status: "done",
    progress: 100,
    speed: null,
    eta: null,
    downloadedBytes: 1,
    totalBytes: 1,
    stage: "done",
    error: null,
    createdAt: 1,
    attempts: 0,
    nextRetryAt: null,
    destination: "C:\\Vids\\a.mp4",
    ...over,
  };
}

describe("sanitizePlaylistTitle", () => {
  it("strips illegal Windows characters and caps length", () => {
    expect(sanitizePlaylistTitle('A/B:C*D?E"F<G>H|I')).toBe("A_B_C_D_E_F_G_H_I");
    expect(sanitizePlaylistTitle("Mix...   ")).toBe("Mix");
    expect(sanitizePlaylistTitle("x".repeat(150))).toHaveLength(100);
    expect(sanitizePlaylistTitle("   ")).toBe("playlist");
    expect(sanitizePlaylistTitle("Lagu Terbaik 2026")).toBe("Lagu Terbaik 2026");
  });
});

describe("deriveEntryStates", () => {
  const entries = [
    entry("a", "https://youtu.be/a"),
    entry("b", "https://youtu.be/b"),
    entry("c", "https://youtu.be/c"),
  ];

  it("marks archived entries via extractor::id keys", () => {
    const states = deriveEntryStates(entries, "youtube", new Set(["youtube::a"]), [], new Map());
    expect(states.get("a")).toEqual({ archived: true, exists: false });
    expect(states.get("b")).toEqual({ archived: false, exists: false });
  });

  it("marks disk existence via history destinations", () => {
    const h = history({
      url: "https://youtu.be/b",
      extractor: "youtube",
      videoId: "b",
      destination: "C:\\Vids\\b.mp4",
    });
    const states = deriveEntryStates(
      entries,
      "youtube",
      new Set(),
      [h],
      new Map([["C:\\Vids\\b.mp4", true]]),
    );
    expect(states.get("b")).toEqual({ archived: false, exists: true });
    expect(states.get("c")).toEqual({ archived: false, exists: false });
  });

  it("falls back to raw URL match for legacy records", () => {
    const h = history({ url: "https://youtu.be/c", destination: "C:\\Vids\\c.mp4" });
    const states = deriveEntryStates(
      entries,
      null,
      new Set(),
      [h],
      new Map([["C:\\Vids\\c.mp4", true]]),
    );
    expect(states.get("c")?.exists).toBe(true);
  });
});

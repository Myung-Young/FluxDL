import { describe, expect, it } from "vitest";
import {
  autoSortSubdir,
  episodeSeasonFolder,
  hasMojibake,
  isExecutablePath,
  isMediaFile,
  pickFallbackFile,
} from "./destination.js";

describe("destination recovery", () => {
  it("detects mojibake replacement chars", () => {
    expect(hasMojibake("C:\\Vids\\m�nchen [abc].mp4")).toBe(true);
    expect(hasMojibake("C:\\Vids\\normal [abc].mp4")).toBe(false);
  });

  it("filters to media extensions", () => {
    expect(isMediaFile("a.mp4")).toBe(true);
    expect(isMediaFile("a.MKV")).toBe(true);
    expect(isMediaFile("a.txt")).toBe(false);
    expect(isMediaFile("a")).toBe(false);
    expect(isExecutablePath("C:\\Vids\\setup.EXE")).toBe(true);
    expect(isExecutablePath("run.bat")).toBe(true);
    expect(isExecutablePath("movie.mp4")).toBe(false);
    expect(isExecutablePath("notes.txt")).toBe(false);
    expect(episodeSeasonFolder("Show S01E02")).toBe("Season 01");
    expect(episodeSeasonFolder("Show 2x14")).toBe("Season 02");
    expect(episodeSeasonFolder("Show Season 3 Finale")).toBe("Season 03");
    expect(episodeSeasonFolder("Just a vlog")).toBeNull();
    expect(autoSortSubdir("audio", "Song")).toBe("Music");
    expect(autoSortSubdir("video", "Vlog")).toBe("Videos");
    expect(autoSortSubdir("video", "Show S01E02")).toBe("Videos/Season 01");
  });

  it("prefers bracketed video id matches", () => {
    const files = [
      { name: "other [zzz].mp4", mtimeMs: 2000 },
      { name: "title [abc123].mp4", mtimeMs: 1000 },
    ];
    expect(pickFallbackFile("abc123", files, 3000)).toBe("title [abc123].mp4");
  });

  it("falls back to bare id then most recent", () => {
    const files = [{ name: "abc123 - clip.webm", mtimeMs: 1000 }];
    expect(pickFallbackFile("abc123", files, 2000)).toBe("abc123 - clip.webm");
  });

  it("picks the newest recent media file without an id", () => {
    const now = 10_000;
    const files = [
      { name: "old.mp4", mtimeMs: 1000 },
      { name: "new.mp4", mtimeMs: 9000 },
      { name: "note.txt", mtimeMs: 9500 },
    ];
    expect(pickFallbackFile(null, files, now)).toBe("new.mp4");
  });

  it("returns null when nothing is fresh", () => {
    const files = [{ name: "old.mp4", mtimeMs: 0 }];
    expect(pickFallbackFile(null, files, 10 * 60 * 1000)).toBeNull();
    expect(pickFallbackFile("zzz", [], 1000)).toBeNull();
  });
});

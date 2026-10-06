import { describe, expect, it } from "vitest";
import {
  autoSortSubdir,
  episodeSeasonFolder,
  hasMojibake,
  mediaGroup,
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

/**
 * v1.7.2: a finished file must be recognised in EVERY container yt-dlp can
 * produce. `isMediaFile` gates the Library preview, the open/reveal buttons,
 * storage insights and chapter-folder sizing — an unrecognised extension meant
 * a downloaded file showed as "Missing" even though it was right there.
 */
describe("recognises every yt-dlp output container", () => {
  const VIDEO = [
    "clip.mp4",
    "clip.m4v",
    "clip.webm",
    "clip.mkv",
    "clip.flv",
    "clip.f4v",
    "clip.f4a",
    "clip.f4b",
    "clip.f4p",
    "clip.3gp",
    "clip.3g2",
    "clip.avi",
    "clip.mov",
    "clip.qt",
    "clip.ts",
    "clip.m2ts",
    "clip.mts",
    "clip.tsv",
    "clip.mpg",
    "clip.mpeg",
    "clip.m2v",
    "clip.vob",
    "clip.ogv",
    "clip.wmv",
    "clip.asf",
    "clip.gif",
  ];
  const AUDIO = [
    "song.m4a",
    "song.m4b",
    "song.aac",
    "song.webm",
    "song.mp3",
    "song.flac",
    "song.opus",
    "song.ogg",
    "song.oga",
    "song.wav",
    "song.alac",
    "song.wma",
    "song.mka",
    "song.aiff",
    "song.aif",
    "song.amr",
    "song.ac3",
    "song.eac3",
    "song.dts",
  ];
  const MANIFESTS = ["live.m3u8", "dash.mpd", "live.ism", "live.isml", "hds.f4m"];

  it("treats every video container as media", () => {
    for (const name of VIDEO) expect(isMediaFile(name)).toBe(true);
  });

  it("treats every audio container as media", () => {
    for (const name of AUDIO) expect(isMediaFile(name)).toBe(true);
  });

  it("treats a live-stream manifest as media (it is a real output)", () => {
    for (const name of MANIFESTS) expect(isMediaFile(name)).toBe(true);
  });

  it("still rejects non-media (the executable guard depends on it)", () => {
    for (const name of ["run.exe", "notes.txt", "movie.part", "movie.ytdl", "archive.zip", ""]) {
      expect(isMediaFile(name)).toBe(false);
    }
  });

  it("groups audio and video correctly for the storage card", () => {
    expect(mediaGroup("song.flac")).toBe("audio");
    expect(mediaGroup("song.mka")).toBe("audio");
    expect(mediaGroup("clip.mkv")).toBe("video");
    expect(mediaGroup("clip.m2ts")).toBe("video");
    // Manifests are tiny pointers: counting them as media skews the totals.
    expect(mediaGroup("live.m3u8")).toBeNull();
    expect(mediaGroup("notes.txt")).toBeNull();
  });

  it("matches case-insensitively (Windows paths are not case-sensitive)", () => {
    expect(isMediaFile("SONG.FLAC")).toBe(true);
    expect(mediaGroup("CLIP.MKV")).toBe("video");
    expect(mediaGroup("SONG.OPUS")).toBe("audio");
  });
});

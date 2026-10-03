import { describe, expect, it } from "vitest";
import {
  buildParseMetadataArg,
  buildParseMetadataArgs,
  defaultAudioMetadata,
  hasAudioMetadata,
  isAudioMetadata,
  isAudioPreset,
  normalizeAudioMetadata,
  type AudioMetadata,
} from "./metadata.js";

const meta = (patch: Partial<AudioMetadata> = {}): AudioMetadata => ({
  title: "Title",
  artist: "Artist",
  album: "Album",
  year: "2024",
  ...patch,
});

describe("buildParseMetadataArg", () => {
  /**
   * The four traps found by probing the real binary (D80b). Each one silently
   * produced a wrong tag rather than an error, so each gets a test.
   */
  it("escapes every literal colon so the FROM:TO split stays put", () => {
    expect(buildParseMetadataArg("title", "AC/DC: Live")).toBe(
      "AC/DC\\: Live~:(?P<meta_title>AC/DC: Live)~",
    );
    expect(buildParseMetadataArg("album", "Hits: 2024")).toBe(
      "Hits\\: 2024~:(?P<meta_album>Hits: 2024)~",
    );
  });

  it("doubles percent signs so the output template keeps them literal", () => {
    expect(buildParseMetadataArg("title", "100% Pure")).toBe(
      "100%% Pure~:(?P<meta_title>100% Pure)~",
    );
  });

  it("neutralizes a %(field)s injection attempt", () => {
    // Unescaped, %(title)s would expand to the real video title.
    expect(buildParseMetadataArg("title", "50%(title)s")).toBe(
      "50%%(title)s~:(?P<meta_title>50%\\(title\\)s)~",
    );
  });

  it("keeps a single-word value out of the bare-field-name branch", () => {
    // "Hello" alone is read as a field reference and resolves to "NA".
    expect(buildParseMetadataArg("title", "Hello")).toBe("Hello~:(?P<meta_title>Hello)~");
  });

  it("survives a trailing backslash (FROM:TO would otherwise not split)", () => {
    expect(buildParseMetadataArg("title", "trailing \\")).toBe(
      "trailing \\~:(?P<meta_title>trailing \\\\)~",
    );
  });

  it("round-trips a backslash immediately before a colon", () => {
    expect(buildParseMetadataArg("album", "C:\\Music\\Alb:um")).toBe(
      "C\\:\\Music\\Alb\\:um~:(?P<meta_album>C:\\\\Music\\\\Alb:um)~",
    );
  });

  it("escapes regex metacharacters on the TO side", () => {
    expect(buildParseMetadataArg("title", "a[b]{2}(c|d)^$e.f*g+h?i")).toBe(
      "a[b]{2}(c|d)^$e.f*g+h?i~:(?P<meta_title>a\\[b\\]\\{2\\}\\(c\\|d\\)\\^\\$e\\.f\\*g\\+h\\?i)~",
    );
  });

  it("leaves quotes and unicode untouched", () => {
    expect(buildParseMetadataArg("artist", 'Say "hi" — 日本語 🎵')).toBe(
      'Say "hi" — 日本語 🎵~:(?P<meta_artist>Say "hi" — 日本語 🎵)~',
    );
  });

  it("maps each field to its yt-dlp meta_ name", () => {
    expect(buildParseMetadataArg("artist", "A")).toContain("(?P<meta_artist>A)");
    expect(buildParseMetadataArg("album", "A")).toContain("(?P<meta_album>A)");
    expect(buildParseMetadataArg("date", "2024")).toContain("(?P<meta_date>2024)");
  });

  it("trims and skips empty values (an empty tag is worse than none)", () => {
    expect(buildParseMetadataArg("title", "   ")).toBeNull();
    expect(buildParseMetadataArg("title", "")).toBeNull();
    expect(buildParseMetadataArg("title", "  padded  ")).toBe(
      "padded~:(?P<meta_title>padded)~",
    );
  });
});

describe("buildParseMetadataArgs", () => {
  it("emits only non-empty fields in a stable order", () => {
    expect(buildParseMetadataArgs(meta())).toEqual([
      "Title~:(?P<meta_title>Title)~",
      "Artist~:(?P<meta_artist>Artist)~",
      "Album~:(?P<meta_album>Album)~",
      "2024~:(?P<meta_date>2024)~",
    ]);
    expect(buildParseMetadataArgs(meta({ album: "", year: "" }))).toEqual([
      "Title~:(?P<meta_title>Title)~",
      "Artist~:(?P<meta_artist>Artist)~",
    ]);
  });

  it("returns nothing for null or an all-blank metadata", () => {
    expect(buildParseMetadataArgs(null)).toEqual([]);
    expect(buildParseMetadataArgs(meta({ title: "", artist: "", album: "", year: "" }))).toEqual([]);
    expect(hasAudioMetadata(null)).toBe(false);
    expect(hasAudioMetadata(meta())).toBe(true);
  });

  it("never emits a FROM that is a bare identifier", () => {
    for (const value of ["Hello", "Live", "x", "_y", "A1"]) {
      const arg = buildParseMetadataArg("title", value);
      expect(arg).not.toBeNull();
      const from = (arg ?? "").split(":")[0] ?? "";
      expect(from.endsWith("~")).toBe(true);
      expect(from).not.toMatch(/^[A-Za-z_]+$/);
    }
  });
});

describe("normalizeAudioMetadata", () => {
  it("rebuilds the payload from primitives (renderer is untrusted)", () => {
    expect(
      normalizeAudioMetadata({
        title: " T ",
        artist: "A",
        album: { evil: true },
        year: 1999,
      }),
    ).toEqual({ title: "T", artist: "A", album: "", year: "" });
  });

  it("rejects non-objects", () => {
    for (const bad of [null, undefined, "x", 5, [], true]) {
      expect(normalizeAudioMetadata(bad)).toBeNull();
      expect(isAudioMetadata(bad)).toBe(false);
    }
  });

  it("treats an all-blank payload as no metadata", () => {
    expect(isAudioMetadata({ title: "", artist: "", album: "", year: "" })).toBe(false);
    expect(isAudioMetadata({ title: "T" })).toBe(true);
  });
});

describe("defaultAudioMetadata", () => {
  it("splits an 'Artist - Title' heuristic", () => {
    expect(defaultAudioMetadata({ title: "Bohemian Rhapsody - Remastered", uploader: "Queen" })).toEqual({
      title: "Remastered",
      artist: "Bohemian Rhapsody",
      album: "Queen",
      year: "",
    });
  });

  it("keeps the whole title when there is no separator", () => {
    expect(defaultAudioMetadata({ title: "Hello", uploader: "Some Channel", uploadDate: "20191109" })).toEqual({
      title: "Hello",
      artist: "Some Channel",
      album: "Some Channel",
      year: "2019",
    });
  });

  it("handles en/em dashes and missing uploader", () => {
    expect(defaultAudioMetadata({ title: "Artist – Song", uploader: null })).toEqual({
      title: "Song",
      artist: "Artist",
      album: "",
      year: "",
    });
    expect(defaultAudioMetadata({ title: "Artist — Song", uploader: null }).title).toBe("Song");
  });

  it("only reads a 4-digit year", () => {
    expect(defaultAudioMetadata({ title: "T", uploader: null, uploadDate: "19" }).year).toBe("");
    expect(defaultAudioMetadata({ title: "T", uploader: null, uploadDate: null }).year).toBe("");
    expect(defaultAudioMetadata({ title: "T", uploader: null, uploadDate: "20240131" }).year).toBe("2024");
  });
});

describe("isAudioPreset", () => {
  it("is true for audio presets and false when a raw format overrides", () => {
    expect(isAudioPreset({ kind: "audio", rawFormat: null })).toBe(true);
    expect(isAudioPreset({ kind: "video", rawFormat: null })).toBe(false);
    expect(isAudioPreset({ kind: "audio", rawFormat: "  " })).toBe(true);
    expect(isAudioPreset({ kind: "audio", rawFormat: "bestaudio" })).toBe(false);
  });
});
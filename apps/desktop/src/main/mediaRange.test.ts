import { describe, expect, it } from "vitest";
import { contentRange, parseByteRange } from "./mediaRange.js";

/**
 * v1.7.2: the media:// protocol must speak HTTP byte ranges, otherwise
 * Chromium treats the resource as non-seekable and every preview shows 0:00.
 */
describe("parseByteRange", () => {
  const size = 1000;

  it("answers a request without a Range header with the whole file", () => {
    expect(parseByteRange(null, size)).toEqual({ kind: "all" });
    expect(parseByteRange(undefined, size)).toEqual({ kind: "all" });
    expect(parseByteRange("", size)).toEqual({ kind: "all" });
  });

  it("parses an explicit window", () => {
    expect(parseByteRange("bytes=0-99", size)).toEqual({
      kind: "bytes",
      start: 0,
      end: 99,
    });
    expect(parseByteRange("bytes=500-", size)).toEqual({
      kind: "bytes",
      start: 500,
      end: 999,
    });
  });

  it("parses the suffix form (last N bytes)", () => {
    expect(parseByteRange("bytes=-100", size)).toEqual({
      kind: "bytes",
      start: 900,
      end: 999,
    });
    // A suffix longer than the file is the whole file.
    expect(parseByteRange("bytes=-5000", size)).toEqual({
      kind: "bytes",
      start: 0,
      end: 999,
    });
  });

  it("clamps an end past the last byte", () => {
    expect(parseByteRange("bytes=900-99999", size)).toEqual({
      kind: "bytes",
      start: 900,
      end: 999,
    });
  });

  it("serves only the first window of a multi-range request", () => {
    expect(parseByteRange("bytes=0-9,20-29", size)).toEqual({
      kind: "bytes",
      start: 0,
      end: 9,
    });
  });

  it("is case- and space-insensitive", () => {
    expect(parseByteRange("  BYTES = 0 - 9 ", size)).toEqual({
      kind: "bytes",
      start: 0,
      end: 9,
    });
  });

  it("reports unsatisfiable for a start past the end", () => {
    expect(parseByteRange("bytes=1000-", size)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=5000-6000", size)).toEqual({ kind: "unsatisfiable" });
  });

  it("reports unsatisfiable for a malformed window", () => {
    expect(parseByteRange("bytes=abc-def", size)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=90-10", size)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=-0", size)).toEqual({ kind: "unsatisfiable" });
    expect(parseByteRange("bytes=", size)).toEqual({ kind: "all" });
    expect(parseByteRange("bytes=12", size)).toEqual({ kind: "unsatisfiable" });
  });

  it("reports unsatisfiable for an empty resource", () => {
    expect(parseByteRange("bytes=0-10", 0)).toEqual({ kind: "unsatisfiable" });
    // …but a headerless request still gets the (empty) 200 body.
    expect(parseByteRange(null, 0)).toEqual({ kind: "all" });
  });

  it("ignores units it does not implement", () => {
    expect(parseByteRange("items=0-9", size)).toEqual({ kind: "all" });
    expect(parseByteRange("nonsense", size)).toEqual({ kind: "all" });
  });
});

describe("contentRange", () => {
  it("formats the 206 header", () => {
    expect(contentRange(0, 99, 1000)).toBe("bytes 0-99/1000");
    expect(contentRange(900, 999, 1000)).toBe("bytes 900-999/1000");
  });
});
import { describe, expect, it } from "vitest";
import { assertThumbnailUrl, bgraToRgb } from "./thumbnail.js";

describe("thumbnail guards", () => {
  it("accepts https only", () => {
    expect(assertThumbnailUrl("https://i.ytimg.com/vi/x/hqdefault.jpg")).toContain("https://");
    expect(() => assertThumbnailUrl("http://example.com/a.png")).toThrow();
    expect(() => assertThumbnailUrl("file:///etc/passwd")).toThrow();
    expect(() => assertThumbnailUrl("not a url")).toThrow();
    expect(() => assertThumbnailUrl("")).toThrow();
  });

  it("converts BGRA bitmap bytes to RGB triplets, skipping translucent pixels", () => {
    // Red opaque, green opaque, blue translucent.
    const bgra = Buffer.from([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 64]);
    expect(bgraToRgb(bgra)).toEqual([255, 0, 0, 0, 255, 0]);
    expect(bgraToRgb(Buffer.alloc(0))).toEqual([]);
    expect(bgraToRgb(Buffer.from([1, 2, 3]))).toEqual([]);
  });
});

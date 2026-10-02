import { describe, expect, it } from "vitest";
import { isValidUrl, normalizeUrl, UrlValidationError } from "./url.js";

describe("normalizeUrl", () => {
  it("trims and keeps valid https URLs", () => {
    expect(normalizeUrl("  https://www.youtube.com/watch?v=aqz-KE-bpKQ  ")).toBe(
      "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    );
  });

  it("adds https when the scheme is missing", () => {
    expect(normalizeUrl("youtu.be/aqz-KE-bpKQ")).toBe("https://youtu.be/aqz-KE-bpKQ");
  });

  it("rejects empty, non-URLs, and non-http schemes", () => {
    expect(() => normalizeUrl("")).toThrow(UrlValidationError);
    expect(() => normalizeUrl("not a url")).toThrow(UrlValidationError);
    expect(() => normalizeUrl("ftp://example.com/file")).toThrow(UrlValidationError);
    expect(() => normalizeUrl("javascript:alert(1)")).toThrow(UrlValidationError);
    expect(() => normalizeUrl("file:///C:/video.mp4")).toThrow(UrlValidationError);
  });

  it("handles unicode domains and paths with spaces", () => {
    const out = normalizeUrl("  youtube.com/watch?v=aqz-KE-bpKQ  ");
    expect(out.startsWith("https://")).toBe(true);
    expect(isValidUrl("https://münchen.example/输入 test")).toBe(true);
    expect(isValidUrl("")).toBe(false);
  });
});

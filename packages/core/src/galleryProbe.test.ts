import { describe, expect, it } from "vitest";
import {
  GALLERY_PROBE_MAX_ITEMS,
  PROBE_CACHE_TTL_MS,
  buildProbeArgs,
  cleanGalleryRange,
  createProbeCache,
  galleryStderrErrors,
  isUnsupportedUrlMessage,
  parseGalleryProbeJson,
  rangeForIndices,
} from "./galleryProbe.js";
import probeFile from "./gallery-probe-file.json";
import probeFlickr from "./gallery-probe-flickr.json";
import probeError from "./gallery-probe-error.json";

describe("galleryProbe", () => {
  it("parses a single-file probe (live Commons capture)", () => {
    const parsed = parseGalleryProbeJson(JSON.stringify(probeFile));
    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toHaveLength(1);
    const first = parsed.items[0];
    expect(first?.url).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    expect(first).toMatchObject({
      filename: "Albert Einstein Head",
      width: 3250,
      height: 4333,
      extension: "jpg",
      sizeBytes: 2309396,
    });
  });

  it("parses a multi-item probe (live Flickr capture)", () => {
    const parsed = parseGalleryProbeJson(JSON.stringify(probeFlickr));
    expect(parsed.items).toHaveLength(3);
    for (const item of parsed.items) {
      expect(item.url).toMatch(/^https:\/\/live\.staticflickr\.com\//);
      expect(item.extension).toBe("jpg");
    }
  });

  it("surfaces [-1] failure tuples as errors (live timeout capture)", () => {
    const parsed = parseGalleryProbeJson(JSON.stringify(probeError));
    expect(parsed.items).toEqual([]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatch(/timed out/i);
  });

  it("never throws on garbage", () => {
    expect(parseGalleryProbeJson("")).toEqual({ items: [], errors: ["probe returned no data"] });
    expect(parseGalleryProbeJson("not json")).toEqual({
      items: [],
      errors: ["probe returned no data"],
    });
    expect(parseGalleryProbeJson("[not json]")).toEqual({
      items: [],
      errors: ["probe returned unreadable data"],
    });
    expect(parseGalleryProbeJson('{"not":"an array"}')).toEqual({
      items: [],
      errors: ["probe returned no data"],
    });
    // Warning preamble around the payload still parses.
    const wrapped = `verifying stuff\n${JSON.stringify(probeFile)}\ndone`;
    expect(parseGalleryProbeJson(wrapped).items).toHaveLength(1);
  });

  it("skips malformed tuples and caps items", () => {
    const tuples: unknown[] = [[2, { category: "x" }], [3, "ftp://evil/x"], [3, 42], ["3", "https://a.example/"]];
    const parsed = parseGalleryProbeJson(JSON.stringify(tuples));
    expect(parsed).toEqual({ items: [], errors: [] });
    const many: unknown[] = [];
    for (let i = 0; i < GALLERY_PROBE_MAX_ITEMS + 10; i += 1) {
      many.push([3, `https://a.example/${String(i)}.jpg`, { filename: `f${String(i)}` }]);
    }
    expect(parseGalleryProbeJson(JSON.stringify(many)).items).toHaveLength(GALLERY_PROBE_MAX_ITEMS);
  });

  it("reads stderr error lines, ignoring info noise", () => {
    const stderr = [
      "[flickr][info] Retrieving public API key",
      "[gallery-dl][error] Unsupported URL 'https://example.com/x'",
      "plain noise",
      "",
    ].join("\n");
    expect(galleryStderrErrors(stderr)).toEqual(["Unsupported URL 'https://example.com/x'"]);
    expect(galleryStderrErrors("nothing here\n")).toEqual([]);
  });

  it("recognizes the unsupported-URL marker", () => {
    expect(isUnsupportedUrlMessage("Unsupported URL 'https://example.com/'")).toBe(true);
    expect(isUnsupportedUrlMessage("HttpError: timed out")).toBe(false);
  });

  it("builds a verified probe argv", () => {
    expect(buildProbeArgs({ configPath: "C:\\u\\g.conf", count: 50, url: "https://x.example/" })).toEqual([
      "--config",
      "C:\\u\\g.conf",
      "-j",
      "--range",
      "1-50",
      "--",
      "https://x.example/",
    ]);
    expect(buildProbeArgs({ configPath: "c", count: 999, url: "u" })[4]).toBe("1-50");
    expect(buildProbeArgs({ configPath: "c", count: 0, url: "u" })[4]).toBe("1-1");
  });

  it("caches probe outcomes with TTL", () => {
    let t = 0;
    const cache = createProbeCache(PROBE_CACHE_TTL_MS, { now: () => t });
    expect(cache.get("Example.COM")).toBeUndefined();
    cache.set("Example.COM", "gallery-dl");
    expect(cache.get("example.com")).toBe("gallery-dl");
    cache.set("example.com", null);
    expect(cache.get("example.com")).toBeNull();
    t = PROBE_CACHE_TTL_MS + 1;
    expect(cache.get("example.com")).toBeUndefined();
  });

  it("validates --range selectors", () => {
    expect(cleanGalleryRange("2-4,7")).toBe("2-4,7");
    expect(cleanGalleryRange("5")).toBe("5");
    expect(cleanGalleryRange("1:24:3")).toBe("1:24:3");
    expect(cleanGalleryRange("--config x")).toBeNull();
    expect(cleanGalleryRange("abc")).toBeNull();
    expect(cleanGalleryRange("")).toBeNull();
    expect(cleanGalleryRange(null)).toBeNull();
  });

  it("compresses indices into --range selectors", () => {
    expect(rangeForIndices([2, 3, 4, 7])).toBe("2-4,7");
    expect(rangeForIndices([5])).toBe("5");
    expect(rangeForIndices([7, 2, 2, 3])).toBe("2-3,7");
    expect(rangeForIndices([])).toBeNull();
    expect(rangeForIndices([0, -3])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  buildGalleryDlConfig,
  resolveGalleryConfigText,
  validateGalleryConfigJson,
} from "./galleryConfig.js";
import { DEFAULT_SETTINGS } from "./settings.js";

describe("galleryConfig", () => {
  it("builds a managed config from defaults", () => {
    const out = buildGalleryDlConfig({
      images: DEFAULT_SETTINGS.images,
      cookiesFile: null,
      downloadRoot: "C:\\dl",
    });
    expect(out.config["metadata"]).toBe(false);
    const fluxdl = out.config["fluxdl"] as { managed: boolean };
    expect(fluxdl.managed).toBe(true);
    expect(() => {
      JSON.parse(out.text);
    }).not.toThrow();
  });

  it("injects proxy/cookies/sleep when set", () => {
    const out = buildGalleryDlConfig({
      images: {
        ...DEFAULT_SETTINGS.images,
        proxy: "http://127.0.0.1:8080",
        sleepRequestsSec: 2,
        maxSleepIntervalSec: 5,
        metadataSidecar: true,
      },
      cookiesFile: "C:\\cookies.txt",
      downloadRoot: "C:\\dl",
    });
    const extractor = out.config["extractor"] as Record<string, unknown>;
    expect(extractor["proxy"]).toBe("http://127.0.0.1:8080");
    expect(extractor["cookies"]).toBe("C:\\cookies.txt");
    expect(out.config["metadata"]).toBe(true);
  });

  it("validates raw JSON", () => {
    expect(validateGalleryConfigJson('{"a":1}')).toEqual({ ok: true });
    expect(validateGalleryConfigJson("nope").ok).toBe(false);
    expect(validateGalleryConfigJson("[]").ok).toBe(false);
  });

  it("points the archive at a real absolute path (v1.8.0)", () => {
    // A literal "<download-root>" placeholder shipped once and nothing ever
    // substituted it, so the archive silently never engaged.
    const out = buildGalleryDlConfig({
      images: DEFAULT_SETTINGS.images,
      cookiesFile: null,
      downloadRoot: "C:\\dl",
    });
    expect(out.config["archive"]).toBe("C:\\dl/gallery-dl-archive.sqlite3");
    const off = buildGalleryDlConfig({
      images: { ...DEFAULT_SETTINGS.images, archive: false },
      cookiesFile: null,
      downloadRoot: "C:\\dl",
    });
    expect(off.config["archive"]).toBeNull();
  });

  it("prefers a valid raw override, falls back when invalid (v1.8.5)", () => {    const base = { images: DEFAULT_SETTINGS.images, cookiesFile: null, downloadRoot: "C:\\dl" };
    expect(
      resolveGalleryConfigText({ ...base, images: { ...base.images, customConfig: null } }),
    ).toBe(buildGalleryDlConfig(base).text);
    const custom = '{\n  "extractor": {}\n}';
    expect(
      resolveGalleryConfigText({ ...base, images: { ...base.images, customConfig: custom } }),
    ).toBe(custom);
    // A stale/bad saved value never reaches the binary.
    expect(
      resolveGalleryConfigText({ ...base, images: { ...base.images, customConfig: "nope" } }),
    ).toBe(buildGalleryDlConfig(base).text);
  });
});

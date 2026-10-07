import { describe, expect, it } from "vitest";
import { buildGalleryDlConfig, validateGalleryConfigJson } from "./galleryConfig.js";
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
});

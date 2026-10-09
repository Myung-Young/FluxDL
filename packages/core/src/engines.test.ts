import { describe, expect, it } from "vitest";
import { BUILTIN_ENGINE_RULES, domainOf, engineLabel, resolveEngine } from "./engines.js";

describe("engines router", () => {
  it("pins per mode", () => {
    expect(resolveEngine({ url: "https://x.com/a", mode: "video" }).engine).toBe("yt-dlp");
    expect(resolveEngine({ url: "https://x.com/a", mode: "images" }).engine).toBe("gallery-dl");
  });

  it("parses hosts safely", () => {
    expect(domainOf("https://Commons.Wikimedia.org/x")).toBe("commons.wikimedia.org");
    expect(domainOf("not a url !!!")).toBe(null);
    expect(domainOf("ftp://example.com/x")).toBe(null);
  });

  it("routes image hosts to gallery-dl", () => {
    const r = resolveEngine({ url: "https://www.flickr.com/photos/x", mode: "auto" });
    expect(r.engine).toBe("gallery-dl");
    expect(r.reason).toBe("builtin-rule");
  });

  it("keeps mixed sites on yt-dlp by default", () => {
    const r = resolveEngine({ url: "https://x.com/i/status/1", mode: "auto" });
    // No builtin hit and no probe cache → needs-probe (caller probes, yt-dlp first).
    expect(r.reason).toBe("needs-probe");
    expect(BUILTIN_ENGINE_RULES.some((b) => b.domain === "x.com")).toBe(false);
  });

  it("honours user rules over builtin", () => {
    const r = resolveEngine({
      url: "https://flickr.com/x",
      mode: "auto",
      userRules: { "flickr.com": "yt-dlp" },
    });
    expect(r.engine).toBe("yt-dlp");
    expect(r.reason).toBe("user-rule");
  });

  it("suffix-matches subdomains", () => {
    const r = resolveEngine({
      url: "https://m.imgur.com/gallery/x",
      mode: "auto",
    });
    expect(r.engine).toBe("gallery-dl");
  });

  it("uses probe cache, unsupported when null", () => {
    expect(
      resolveEngine({ url: "https://example.com/x", mode: "auto", probeCache: {} }).reason,
    ).toBe("needs-probe");
    expect(
      resolveEngine({
        url: "https://example.com/x",
        mode: "auto",
        probeCache: { "example.com": "gallery-dl" },
      }).engine,
    ).toBe("gallery-dl");
    expect(
      resolveEngine({
        url: "https://example.com/x",
        mode: "auto",
        probeCache: { "example.com": null },
      }).reason,
    ).toBe("unsupported");
  });

  it("labels engines for badges", () => {
    expect(engineLabel("gallery-dl")).toBe("Images");
    expect(engineLabel("yt-dlp")).toBe("Video");
    expect(engineLabel(null)).toBe("Video");
  });
});

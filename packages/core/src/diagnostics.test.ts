import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings.js";
import {
  baseName,
  buildDiagnostics,
  redactProxyCredentials,
  redactUrlSecrets,
  redactUserPaths,
  stripUrls,
  type DiagnosticsData,
} from "./diagnostics.js";

function data(over: Partial<DiagnosticsData> = {}): DiagnosticsData {
  return {
    versions: { ytdlp: "2026.08.19", ffmpeg: "7.1", app: "1.1.0" },
    settings: DEFAULT_SETTINGS,
    errorEvents: [],
    logTail: null,
    logJobTitle: null,
    includeUrls: false,
    ...over,
  };
}

describe("diagnostics redaction", () => {
  it("strips proxy credentials but keeps plain hosts", () => {
    expect(redactProxyCredentials("http://user:pass@host:8080/x")).toBe("http://***@host:8080/x");
    expect(redactProxyCredentials("socks5://127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
  });

  it("masks secret URL params (token, sig, key, …)", () => {
    const masked = redactUrlSecrets(
      "https://example.com/v?token=abc123&sig=dead&key=K&page=2",
    );
    expect(masked).toBe("https://example.com/v?token=***&sig=***&key=***&page=2");
  });

  it("hides Windows usernames and home dirs", () => {
    expect(redactUserPaths("C:\\Users\\P\\Videos\\a.mp4")).toBe("C:\\Users\\***\\Videos\\a.mp4");
    expect(redactUserPaths("/home/alice/dl")).toBe("/home/***/dl");
    expect(redactUserPaths("C:\\Videos\\a.mp4")).toBe("C:\\Videos\\a.mp4");
  });

  it("reduces cookie file paths to the basename (never contents)", () => {
    expect(baseName("C:\\Users\\P\\secrets\\cookies.txt")).toBe("cookies.txt");
    expect(baseName("/home/alice/cookies.txt")).toBe("cookies.txt");
  });

  it("excludes URLs by default but includes them on toggle (secrets still masked)", () => {
    const tail = "GET https://example.com/v?token=abc&page=1 and https://cdn.example/x.mp4";
    const hidden = buildDiagnostics(data({ logTail: tail, logJobTitle: "V" }));
    expect(hidden).not.toContain("https://");
    expect(hidden).toContain("[url]");
    const shown = buildDiagnostics(data({ logTail: tail, logJobTitle: "V", includeUrls: true }));
    expect(shown).toContain("https://example.com/v?token=***&page=1");
    expect(shown).not.toContain("token=abc");
  });

  it("redacts a nasty settings + error report end to end", () => {
    const text = buildDiagnostics(
      data({
        settings: {
          ...DEFAULT_SETTINGS,
          downloadDir: "C:\\Users\\P\\Videos",
          proxy: "http://user:s3cret@proxy:8080",
          cookiesFile: "C:\\Users\\P\\cookies.txt",
        },
        errorEvents: [
          { at: 0, category: "network", message: "proxy http://user:s3cret@proxy:8080 failed" },
        ],
        logTail: "user at C:\\Users\\P done",
      }),
    );
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("C:\\Users\\P\\");
    expect(text).toContain("cookiesFile: cookies.txt");
    expect(text).toContain("FluxDL diagnostics");
    expect(stripUrls("see https://example.com/a and http://b.org/c")).toBe("see [url] and [url]");
  });
});

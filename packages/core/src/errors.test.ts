import { describe, expect, it } from "vitest";
import { mapDownloadError } from "./errors.js";

describe("mapDownloadError", () => {
  it.each([
    ["ERROR: ffmpeg not found", "ffmpeg-missing"],
    ["Video unavailable in your country (geo blocked)", "geo-blocked"],
    ["ERROR: Private video. Sign in if you've been granted access", "private"],
    ["Sign in to confirm your age", "age-gated"],
    ["ERROR: [Errno 28] No space left on device", "disk-full"],
    ["URLError: <urlopen error [Errno 11001] getaddrinfo failed>", "network"],
    ["HTTP Error 429: Too Many Requests", "rate-limited"],
    ["ERROR: Unsupported URL: https://example.com", "unsupported-url"],
    // Captured from yt-dlp 2026.08.19 with an unreachable proxy:
    [
      "ERROR: [youtube] aqz-KE-bpKQ: Unable to download API page: ('Unable to connect to proxy', NewConnectionError(\"HTTPSConnection(host='127.0.0.1', port=9): Failed to establish a new connection\"))",
      "network",
    ],
    ["Something totally new broke", "unknown"],
    ["", "unknown"],
  ] as const)("maps %s -> %s", (raw, category) => {
    const m = mapDownloadError(raw);
    expect(m.category).toBe(category);
    expect(m.raw).toBe(raw);
  });

  it("suggests cookies only for age-gated", () => {
    expect(mapDownloadError("confirm your age").suggestCookies).toBe(true);
    expect(mapDownloadError("private video").suggestCookies).toBe(false);
    expect(mapDownloadError("geo blocked").suggestCookies).toBe(false);
  });
});

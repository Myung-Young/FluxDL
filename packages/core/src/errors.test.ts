import { describe, expect, it } from "vitest";
import { actionsFor, mapDownloadError } from "./errors.js";

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

describe("actionable errors (M1.4)", () => {
  it.each([
    // Captured live: yt-dlp 2026.08.19, Chrome locked by a running instance.
    [
      "ERROR: Could not copy Chrome cookie database. See  https://github.com/yt-dlp/yt-dlp/issues/7271  for more info",
      "cookie-unavailable",
    ],
    // Captured live: Firefox not installed.
    [
      "ERROR: could not find firefox cookies database in 'C:\\Users\\P\\AppData\\Roaming\\Mozilla\\Firefox\\Profiles'",
      "cookie-unavailable",
    ],
    // Captured live: bogus --cookies-from-browser value.
    [
      'yt-dlp.exe: error: unsupported browser specified for cookies: "wateringcan". Supported browsers are: brave, chrome, chromium, edge, firefox, opera, safari, vivaldi, whale',
      "cookie-unavailable",
    ],
    // Extractor breakage + stale-client 403s -> update-and-retry.
    ["ERROR: [youtube] x: Signature extraction failed: some pattern", "extractor-failed"],
    ["ERROR: [youtube] x: HTTP Error 403: Forbidden", "extractor-failed"],
    ["ERROR: [twitch] x: Unable to extract video data", "extractor-failed"],
    // Corrupt/missing engine binary -> repair.
    ["C:\\app\\yt-dlp.exe is not a valid Win32 application.", "engine-broken"],
    ["spawn C:\\app\\yt-dlp.exe ENOENT", "engine-broken"],
  ] as const)("maps %s -> %s", (raw, category) => {
    const m = mapDownloadError(raw);
    expect(m.category).toBe(category);
    expect(m.actions.length).toBeGreaterThan(0);
  });

  it("routes cookie failures to the cookie picker + settings", () => {
    const ids = mapDownloadError("Could not copy Chrome cookie database").actions.map((a) => a.id);
    expect(ids).toContain("cookies-once");
    expect(ids).toContain("cookies-always");
    expect(ids).toContain("settings");
  });

  it("routes extractor failures to update-and-retry", () => {
    const ids = mapDownloadError("HTTP Error 403: Forbidden").actions.map((a) => a.id);
    expect(ids[0]).toBe("update-retry");
  });

  it("routes disk-full to the folder picker and ffmpeg loss to repair", () => {
    expect(mapDownloadError("No space left on device").actions[0]?.id).toBe("folder");
    expect(mapDownloadError("ffmpeg not found").actions[0]?.id).toBe("repair");
  });

  it("actionsFor falls back to retry+logs for unknown categories", () => {
    expect(actionsFor(undefined).map((a) => a.id)).toEqual(["retry", "logs"]);
    expect(actionsFor("network").map((a) => a.id)).toEqual(["retry", "logs"]);
  });
});

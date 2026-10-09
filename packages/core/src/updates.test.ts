import { describe, expect, it } from "vitest";
import {
  APP_ISSUES_URL,
  APP_RELEASES_URL,
  buildIssueUrl,
  isAllowedExternalUrl,
  isNewerVersion,
  latestTagFromRelease,
  parseReleasePayload,
  pickPortableAsset,
  pickSetupAsset,
} from "./updates.js";

describe("isNewerVersion", () => {
  it("detects a newer release", () => {
    expect(isNewerVersion("1.3.0", "1.5.0")).toBe(true);
    expect(isNewerVersion("1.4.1", "1.4.2")).toBe(true);
    expect(isNewerVersion("1.4.1", "v1.5.0")).toBe(true);
  });

  it("stays quiet when current or newer", () => {
    expect(isNewerVersion("1.5.0", "1.5.0")).toBe(false);
    expect(isNewerVersion("1.5.0", "1.4.0")).toBe(false);
    expect(isNewerVersion("1.5.0", null)).toBe(false);
  });

  it("never fires on unparseable versions", () => {
    expect(isNewerVersion("unknown", "1.5.0")).toBe(false);
    expect(isNewerVersion("0.0.0-e2e", "1.5.0")).toBe(false);
    expect(isNewerVersion("1.5.0", "nightly")).toBe(false);
  });
});

describe("isAllowedExternalUrl", () => {
  it("allows only the project Releases page", () => {
    expect(isAllowedExternalUrl(APP_RELEASES_URL)).toBe(true);
    expect(isAllowedExternalUrl(`${APP_RELEASES_URL}/tag/v1.5.0`)).toBe(true);
    expect(isAllowedExternalUrl("https://github.com/Myung-Young/FluxDL")).toBe(false);
    expect(isAllowedExternalUrl("https://evil.com")).toBe(false);
    expect(isAllowedExternalUrl("https://github.com/Myung-Young/FluxDL/releases-evil")).toBe(
      false,
    );
  });

  it("allows the prefilled new-issue form and nothing around it", () => {
    expect(isAllowedExternalUrl(`${APP_ISSUES_URL}/new`)).toBe(true);
    const prefilled = buildIssueUrl("1.8.0", "win32 10.0.26100");
    expect(prefilled.startsWith(`${APP_ISSUES_URL}/new?`)).toBe(true);
    expect(isAllowedExternalUrl(prefilled)).toBe(true);
    expect(prefilled.length).toBeLessThan(1500);
    expect(isAllowedExternalUrl(`${APP_ISSUES_URL}/new-evil`)).toBe(false);
    expect(isAllowedExternalUrl(`${APP_ISSUES_URL}/123`)).toBe(false);
    expect(isAllowedExternalUrl("https://github.com/Myung-Young/FluxDLa/issues/new")).toBe(false);
  });
});

describe("parseReleasePayload", () => {
  const payload = {
    tag_name: "v1.6.0",
    published_at: "2026-10-04T12:00:00Z",
    body: "Big release notes",
    assets: [
      { name: "FluxDL-Setup-1.6.0.exe", size: 198000000, browser_download_url: "https://github.com/x/setup.exe" },
      { name: "FluxDL-Portable-1.6.0.exe", size: 197000000, browser_download_url: "https://github.com/x/portable.exe" },
      { name: "notes.txt", size: 10, browser_download_url: "https://github.com/x/notes.txt" },
      { name: "broken", size: -5, browser_download_url: "https://github.com/x/broken" },
    ],
  };

  it("reads tag, date, notes and valid assets", () => {
    const parsed = parseReleasePayload(payload);
    expect(parsed?.tag).toBe("v1.6.0");
    expect(parsed?.publishedAt).toBe("2026-10-04T12:00:00Z");
    expect(parsed?.body).toBe("Big release notes");
    expect(parsed?.assets).toHaveLength(3);
  });

  it("picks installer vs portable assets", () => {
    const parsed = parseReleasePayload(payload);
    expect(parsed === null).toBe(false);
    if (parsed === null) return;
    expect(pickSetupAsset(parsed.assets)?.name).toBe("FluxDL-Setup-1.6.0.exe");
    expect(pickPortableAsset(parsed.assets)?.name).toBe("FluxDL-Portable-1.6.0.exe");
    expect(pickSetupAsset([])).toBeNull();
  });

  it("returns null on garbage", () => {
    expect(parseReleasePayload(null)).toBeNull();
    expect(parseReleasePayload({})).toBeNull();
    expect(parseReleasePayload({ tag_name: "  " })).toBeNull();
  });
});

describe("latestTagFromRelease", () => {
  it("reads tag_name, null otherwise", () => {
    expect(latestTagFromRelease({ tag_name: "v1.5.0" })).toBe("v1.5.0");
    expect(latestTagFromRelease({})).toBeNull();
    expect(latestTagFromRelease(null)).toBeNull();
    expect(latestTagFromRelease("v1.5.0")).toBeNull();
  });
});

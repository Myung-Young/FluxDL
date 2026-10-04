import { describe, expect, it } from "vitest";
import {
  APP_RELEASES_URL,
  isAllowedExternalUrl,
  isNewerVersion,
  latestTagFromRelease,
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
});

describe("latestTagFromRelease", () => {
  it("reads tag_name, null otherwise", () => {
    expect(latestTagFromRelease({ tag_name: "v1.5.0" })).toBe("v1.5.0");
    expect(latestTagFromRelease({})).toBeNull();
    expect(latestTagFromRelease(null)).toBeNull();
    expect(latestTagFromRelease("v1.5.0")).toBeNull();
  });
});

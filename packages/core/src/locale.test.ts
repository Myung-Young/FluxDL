import { describe, expect, it } from "vitest";
import { formatStr, localeTag, plural, resolveLanguage } from "./locale.js";
import { STRINGS, STRINGS_MS } from "./strings.js";

function keysOf(value: unknown, prefix: string, out: string[]): void {
  if (typeof value === "string") {
    out.push(prefix);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      keysOf(v, prefix.length > 0 ? `${prefix}.${k}` : k, out);
    }
  }
}

describe("locale parity", () => {
  it("ms covers every en key", () => {
    const en: string[] = [];
    const ms: string[] = [];
    keysOf(STRINGS, "", en);
    keysOf(STRINGS_MS, "", ms);
    expect(en.length).toBeGreaterThan(100);
    expect(ms).toEqual(en);
  });
});

describe("resolveLanguage", () => {
  it("honours explicit settings and falls back to en without navigator", () => {
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage("ms")).toBe("ms");
    expect(resolveLanguage("auto")).toBe("en");
  });
});

describe("formatStr", () => {
  it("interpolates {vars} and keeps unknown keys", () => {
    expect(formatStr(STRINGS.home.queuedToast, { count: 3 })).toBe("Queued 3.");
    expect(formatStr("a {x} b {y}", { x: 1 })).toBe("a 1 b {y}");
  });
});

describe("plural", () => {
  it("switches in English, stays flat in Malay", () => {
    expect(plural("en", 1, "one file", "many files")).toBe("one file");
    expect(plural("en", 2, "one file", "many files")).toBe("many files");
    expect(plural("ms", 1, "1 fail", "2 fail")).toBe("2 fail");
  });
});

describe("localeTag", () => {
  it("maps to Intl tags", () => {
    expect(localeTag("en")).toBe("en");
    expect(localeTag("ms")).toBe("ms-MY");
  });
});

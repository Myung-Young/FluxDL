import { describe, expect, it } from "vitest";
import { filterSettingIds, matchSettingField } from "./settingsFilter.js";

const PROXY = { id: "set-proxy", label: "Proksi" };
const THEME = { id: "set-theme", label: "Tema", keywords: ["theme"] };
const FIELDS = [PROXY, THEME];

describe("settingsFilter", () => {
  it("matches everything on empty query", () => {
    expect(filterSettingIds(FIELDS, "")).toEqual(["set-proxy", "set-theme"]);
    expect(filterSettingIds(FIELDS, "   ")).toEqual(["set-proxy", "set-theme"]);
  });

  it("matches case-insensitively across label, id, and keywords", () => {
    expect(matchSettingField(PROXY, "PROKSI")).toBe(true);
    expect(matchSettingField(PROXY, "proxy")).toBe(true);
    expect(matchSettingField(THEME, "theme")).toBe(true);
    expect(matchSettingField(THEME, "tema theme")).toBe(true);
  });

  it("requires every word and returns no ids without a hit", () => {
    expect(matchSettingField(PROXY, "proxy cookies")).toBe(false);
    expect(filterSettingIds(FIELDS, "zzz")).toEqual([]);
  });
});

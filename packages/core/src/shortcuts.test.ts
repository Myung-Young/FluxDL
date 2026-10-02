import { describe, expect, it } from "vitest";
import { comboFromEvent, isEditableTarget, isOpenSettings, isPasteAnalyze } from "./shortcuts.js";

describe("shortcuts", () => {
  it("matches Ctrl+V and Ctrl+, (either modifier, no shift)", () => {
    expect(
      isPasteAnalyze(comboFromEvent({ key: "v", ctrlKey: true, metaKey: false, shiftKey: false })),
    ).toBe(true);
    expect(
      isPasteAnalyze(comboFromEvent({ key: "V", ctrlKey: false, metaKey: true, shiftKey: false })),
    ).toBe(true);
    expect(
      isPasteAnalyze(comboFromEvent({ key: "v", ctrlKey: true, metaKey: false, shiftKey: true })),
    ).toBe(false);
    expect(
      isPasteAnalyze(comboFromEvent({ key: "c", ctrlKey: true, metaKey: false, shiftKey: false })),
    ).toBe(false);
    expect(
      isOpenSettings(comboFromEvent({ key: ",", ctrlKey: true, metaKey: false, shiftKey: false })),
    ).toBe(true);
    expect(
      isOpenSettings(comboFromEvent({ key: ".", ctrlKey: true, metaKey: false, shiftKey: false })),
    ).toBe(false);
  });

  it("detects editable targets safely outside a DOM", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });
});

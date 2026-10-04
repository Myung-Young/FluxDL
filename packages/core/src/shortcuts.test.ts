import { describe, expect, it } from "vitest";
import {
  comboFromEvent,
  isEditableTarget,
  isOpenSettings,
  isPasteAnalyze,
  isShortcutHelp,
  navIndexFor,
} from "./shortcuts.js";

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

  it("matches Ctrl+1..6 view jumps, rejecting shift and out-of-range digits", () => {
    expect(
      navIndexFor(comboFromEvent({ key: "1", ctrlKey: true, metaKey: false, shiftKey: false })),
    ).toBe(0);
    expect(
      navIndexFor(comboFromEvent({ key: "6", ctrlKey: false, metaKey: true, shiftKey: false })),
    ).toBe(5);
    expect(
      navIndexFor(comboFromEvent({ key: "7", ctrlKey: true, metaKey: false, shiftKey: false })),
    ).toBeNull();
    expect(
      navIndexFor(comboFromEvent({ key: "2", ctrlKey: true, metaKey: false, shiftKey: true })),
    ).toBeNull();
    expect(
      navIndexFor(comboFromEvent({ key: "2", ctrlKey: false, metaKey: false, shiftKey: false })),
    ).toBeNull();
  });

  it("matches bare ? for shortcut help, ignoring shift, blocking modifiers", () => {
    expect(
      isShortcutHelp(comboFromEvent({ key: "?", ctrlKey: false, metaKey: false, shiftKey: true })),
    ).toBe(true);
    expect(
      isShortcutHelp(comboFromEvent({ key: "?", ctrlKey: false, metaKey: false, shiftKey: false })),
    ).toBe(true);
    expect(
      isShortcutHelp(comboFromEvent({ key: "?", ctrlKey: true, metaKey: false, shiftKey: false })),
    ).toBe(false);
    expect(
      isShortcutHelp(comboFromEvent({ key: "/", ctrlKey: false, metaKey: false, shiftKey: false })),
    ).toBe(false);
  });
});

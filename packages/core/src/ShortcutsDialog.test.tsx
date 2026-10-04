import { describe, expect, it } from "vitest";
import { shortcutRows } from "./ShortcutsDialog.js";
import { STRINGS, STRINGS_MS } from "./strings.js";

describe("shortcutRows", () => {
  it("lists seven rows with stable key hints in both languages", () => {
    for (const dict of [STRINGS, STRINGS_MS]) {
      const rows = shortcutRows(dict as typeof STRINGS);
      expect(rows.map((r) => r.keys)).toEqual(["Ctrl+V", "Ctrl+K", "Ctrl+,", "Ctrl+Shift+M", "Ctrl+1…6", "?", "Esc"]);
      for (const row of rows) expect(row.label.length).toBeGreaterThan(2);
    }
  });
});

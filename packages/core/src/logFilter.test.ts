import { describe, expect, it } from "vitest";
import { countLogMatches, filterLogLines, isErrorLine } from "./logFilter.js";

const LOG = [
  "[download] 42% of 10MiB at 1MiB/s",
  "ERROR: unable to extract video data",
  "WARNING: retrying after failure",
  "[Merger] Merging formats",
].join("\n");

describe("logFilter", () => {
  it("returns every line on empty query without the flag", () => {
    expect(filterLogLines(LOG, "", false)).toHaveLength(4);
    expect(filterLogLines(LOG, "   ", false)).toHaveLength(4);
  });

  it("matches case-insensitively with multi-word AND", () => {
    expect(filterLogLines(LOG, "merger merging", false)).toEqual(["[Merger] Merging formats"]);
    expect(filterLogLines(LOG, "download merger", false)).toEqual([]);
  });

  it("flags error lines and filters to them", () => {
    expect(isErrorLine("ERROR: boom")).toBe(true);
    expect(isErrorLine("WARNING: slow")).toBe(true);
    expect(isErrorLine("[download] 42%")).toBe(false);
    expect(filterLogLines(LOG, "", true)).toHaveLength(2);
    expect(countLogMatches(LOG, "warn", true)).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  applyGalleryFileEvent,
  emptyGalleryProgress,
  parseGalleryDlLine,
  splitGalleryChunk,
} from "./galleryProgress.js";

describe("galleryProgress", () => {
  it("parses real 1.32.15 output: bare path = saved, # path = skipped", () => {
    // Live captures (2026-10-09): fresh download prints the bare absolute
    // path; a re-run over existing files prints `# <path>`.
    expect(
      parseGalleryDlLine(
        "C:\\Users\\P\\AppData\\Local\\Temp\\opencode\\gdldl\\wikimediacommons\\File_Albert_Einstein_Head.jpg\\Albert Einstein Head (51f46ff9).jpg",
      ),
    ).toEqual({
      path: "C:\\Users\\P\\AppData\\Local\\Temp\\opencode\\gdldl\\wikimediacommons\\File_Albert_Einstein_Head.jpg\\Albert Einstein Head (51f46ff9).jpg",
      status: "downloaded",
    });
    expect(parseGalleryDlLine("# C:\\dl\\b.jpg")).toEqual({
      path: "C:\\dl\\b.jpg",
      status: "skipped",
    });
    expect(parseGalleryDlLine("/home/u/dl/a.png")).toEqual({
      path: "/home/u/dl/a.png",
      status: "downloaded",
    });
  });

  it("ignores diagnostics, simulate lines, and noise", () => {
    // `--simulate` prints `# <bare name>` — no download happened, so it
    // must not count as skipped.
    expect(parseGalleryDlLine("# Albert Einstein Head (51f46ff9).jpg")).toBe(null);
    expect(parseGalleryDlLine("[flickr][info] Retrieving public API key")).toBe(null);
    expect(parseGalleryDlLine("[gallery-dl][error] Unsupported URL 'https://x.example/'")).toBe(null);
    expect(parseGalleryDlLine("some warning")).toBe(null);
    expect(parseGalleryDlLine("")).toBe(null);
    // Extensionless / relative lines are never files.
    expect(parseGalleryDlLine("README")).toBe(null);
    expect(parseGalleryDlLine("relative\\name.jpg")).toBe(null);
  });

  it("accumulates counters", () => {
    let s = emptyGalleryProgress();
    s = applyGalleryFileEvent(s, { path: "a", status: "downloaded" });
    s = applyGalleryFileEvent(s, { path: "b", status: "skipped" });
    s = applyGalleryFileEvent(s, { path: null, status: "failed" });
    expect(s).toEqual({ downloaded: 1, skipped: 1, failed: 1, total: null, lastFile: "b" });
  });

  it("splits CRLF and partial chunks", () => {
    const first = splitGalleryChunk("C:\\dl\\a.jpg\r\nC:\\dl\\b", "");
    expect(first.lines).toEqual(["C:\\dl\\a.jpg\r"]);
    const second = splitGalleryChunk(".jpg\n", first.rest);
    expect(second.lines).toEqual(["C:\\dl\\b.jpg"]);
    expect(second.rest).toBe("");
  });
});

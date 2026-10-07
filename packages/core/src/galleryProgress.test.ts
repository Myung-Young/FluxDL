import { describe, expect, it } from "vitest";
import {
  applyGalleryFileEvent,
  emptyGalleryProgress,
  parseGalleryDlLine,
  parseGalleryTotal,
  splitGalleryChunk,
} from "./galleryProgress.js";

describe("galleryProgress", () => {
  it("parses save/skip/error lines", () => {
    expect(parseGalleryDlLine("[gallery-dl] save C:\\dl\\a.jpg")).toEqual({
      path: "C:\\dl\\a.jpg",
      status: "downloaded",
    });
    expect(parseGalleryDlLine("[gallery-dl] skip C:\\dl\\b.jpg (exists)")).toEqual({
      path: "C:\\dl\\b.jpg",
      status: "skipped",
    });
    expect(parseGalleryDlLine("[gallery-dl] error: boom")).toEqual({ path: "boom", status: "failed" });
    expect(parseGalleryDlLine("some warning")).toBe(null);
  });

  it("accumulates counters", () => {
    let s = emptyGalleryProgress();
    s = applyGalleryFileEvent(s, { path: "a", status: "downloaded" });
    s = applyGalleryFileEvent(s, { path: "b", status: "skipped" });
    s = applyGalleryFileEvent(s, { path: null, status: "failed" });
    expect(s).toEqual({ downloaded: 1, skipped: 1, failed: 1, total: null, lastFile: "b" });
  });

  it("splits CRLF and partial chunks", () => {
    const first = splitGalleryChunk("[gallery-dl] save a.jpg\r\n[gallery-dl] sa", "");
    expect(first.lines).toEqual(["[gallery-dl] save a.jpg\r"]);
    const second = splitGalleryChunk("ve b.jpg\n", first.rest);
    expect(second.lines).toEqual(["[gallery-dl] save b.jpg"]);
    expect(second.rest).toBe("");
  });

  it("parses totals conservatively", () => {
    expect(parseGalleryTotal("# 42")).toBe(42);
    expect(parseGalleryTotal("# 9999999")).toBe(null);
    expect(parseGalleryTotal("hello")).toBe(null);
  });
});

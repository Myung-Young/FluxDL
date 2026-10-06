import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SIZED_FILES, outputBytes } from "./outputSize.js";

/**
 * v1.7.2: the Stats "total size" tile reads these bytes, so they have to be
 * the real size of the finished output (yt-dlp's progress line only knows the
 * pre-merge byte count, and often reports no total at all).
 */
function dir(): string {
  return mkdtempSync(join(tmpdir(), "fluxdl-size-"));
}

describe("outputBytes", () => {
  it("returns the exact size of a finished file", () => {
    const base = dir();
    try {
      const file = join(base, "clip.mp4");
      writeFileSync(file, Buffer.alloc(4096, 1));
      expect(outputBytes(file)).toBe(4096);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("sums the media files of a chapter folder", () => {
    const base = dir();
    try {
      mkdirSync(join(base, "Show [abc]"));
      writeFileSync(join(base, "Show [abc]", "01.mp4"), Buffer.alloc(100, 1));
      writeFileSync(join(base, "Show [abc]", "02.mp4"), Buffer.alloc(200, 1));
      // Non-media files in the folder are ignored.
      writeFileSync(join(base, "Show [abc]", "notes.txt"), Buffer.alloc(9999, 1));
      expect(outputBytes(join(base, "Show [abc]"))).toBe(300);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("caps the folder scan", () => {
    const base = dir();
    try {
      const folder = join(base, "big");
      mkdirSync(folder);
      for (let i = 0; i < MAX_SIZED_FILES + 5; i += 1) {
        writeFileSync(join(folder, `p${String(i)}.mp3`), Buffer.alloc(10, 1));
      }
      expect(outputBytes(folder)).toBe(MAX_SIZED_FILES * 10);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("returns null instead of guessing when there is nothing to measure", () => {
    const base = dir();
    try {
      expect(outputBytes(null)).toBeNull();
      expect(outputBytes("")).toBeNull();
      expect(outputBytes(join(base, "missing.mp4"))).toBeNull();
      // An empty folder has no size to report; 0 would read as "empty file".
      mkdirSync(join(base, "empty"));
      expect(outputBytes(join(base, "empty"))).toBeNull();
      writeFileSync(join(base, "zero.mp3"), Buffer.alloc(0));
      expect(outputBytes(join(base, "zero.mp3"))).toBeNull();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
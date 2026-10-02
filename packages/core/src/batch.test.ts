import { describe, expect, it } from "vitest";
import {
  MAX_BATCH_LINES,
  addBatchEntries,
  expandPlaylistEntry,
  parseBatchText,
  removeBatchEntry,
  retryBatchEntries,
  updateBatchEntry,
  type BatchEntry,
} from "./batch.js";
import type { MediaInfo } from "./types.js";

function entry(over: Partial<BatchEntry> = {}): BatchEntry {
  return {
    key: "https://example.com/a",
    input: "https://example.com/a",
    url: "https://example.com/a",
    status: "pending",
    error: null,
    info: null,
    preset: null,
    ...over,
  };
}

describe("parseBatchText", () => {
  it("splits CRLF, strips BOM, skips blanks and # comments, dedupes", () => {
    const parsed = parseBatchText(
      "﻿https://example.com/a\r\n\r\n# a comment\nhttps://example.com/b\nhttps://example.com/a \n   \nnot a url",
    );
    expect(parsed.valid.map((v) => v.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.invalid).toHaveLength(1);
    expect(parsed.invalid[0]?.input).toBe("not a url");
    expect(parsed.truncated).toBe(false);
  });

  it("rejects junk schemes and bare words", () => {
    const parsed = parseBatchText("javascript:alert(1)\nfile:///etc/passwd\nhello world");
    expect(parsed.valid).toEqual([]);
    expect(parsed.invalid).toHaveLength(3);
  });

  it("caps at 500 lines and reports truncation", () => {
    const lines = Array.from({ length: MAX_BATCH_LINES + 50 }, (_, i) => `https://example.com/${String(i)}`);
    const parsed = parseBatchText(lines.join("\n"));
    expect(parsed.valid).toHaveLength(MAX_BATCH_LINES);
    expect(parsed.truncated).toBe(true);
  });
});

describe("batch state machine", () => {
  it("adds entries without duplicating existing keys", () => {
    const base = [entry()];
    const next = addBatchEntries(base, [
      { input: "a", url: "https://example.com/a" },
      { input: "b", url: "https://example.com/b" },
    ]);
    expect(next.map((e) => e.key)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(next[1]?.status).toBe("pending");
  });

  it("updates, retries, and removes rows", () => {
    const base = [entry(), entry({ key: "https://example.com/b", url: "https://example.com/b" })];
    const analyzing = updateBatchEntry(base, "https://example.com/a", { status: "analyzing" });
    expect(analyzing[0]?.status).toBe("analyzing");
    expect(analyzing[1]?.status).toBe("pending");

    const failed = updateBatchEntry(analyzing, "https://example.com/a", {
      status: "failed",
      error: "boom",
    });
    const retried = retryBatchEntries(failed);
    expect(retried[0]).toMatchObject({ status: "pending", error: null });

    const removed = removeBatchEntry(retried, "https://example.com/a");
    expect(removed.map((e) => e.key)).toEqual(["https://example.com/b"]);

    // unknown keys pass through untouched
    expect(updateBatchEntry(base, "https://example.com/zzz", { status: "ready" })).toEqual(base);
  });

  it("expands a ready playlist row into one pending row per entry", () => {
    const info: MediaInfo = {
      url: "https://example.com/list",
      title: "List",
      uploader: null,
      duration: null,
      thumbnail: null,
      isPlaylist: true,
      extractor: null,
      videoId: null,
      entries: [
        {
          id: "a",
          title: "A",
          url: "https://example.com/a",
          duration: null,
          thumbnail: null,
          selected: true,
        },
        {
          id: "b",
          title: "B",
          url: "https://example.com/b",
          duration: null,
          thumbnail: null,
          selected: true,
        },
      ],
      formats: [],
    };
    const base = [
      entry({ key: "https://example.com/list", url: "https://example.com/list", status: "ready", info }),
    ];
    const expanded = expandPlaylistEntry(base, "https://example.com/list");
    expect(expanded.map((e) => e.key)).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(expanded.every((e) => e.status === "pending")).toBe(true);

    // non-playlist rows pass through
    const single = [entry({ status: "ready", info: { ...info, isPlaylist: false, entries: [] } })];
    expect(expandPlaylistEntry(single, single[0]?.key ?? "")).toEqual(single);
  });
});

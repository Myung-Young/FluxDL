import { describe, expect, it } from "vitest";
import { menuItemsFor } from "./menu.js";

describe("menuItemsFor", () => {
  it("always offers Copy URL; file actions need a destination", () => {
    expect(menuItemsFor("queued", false)).toEqual(["copy-url", "remove"]);
    expect(menuItemsFor("queued", true)).toContain("copy-path");
  });

  it("offers open/reveal/delete for finished records", () => {
    expect(menuItemsFor("done", true)).toEqual([
      "copy-url",
      "copy-path",
      "open",
      "reveal",
      "delete-file",
      "post-run",
      "post-transcribe",
      "post-upload",
      "media-info",
    ]);
  });

  it("offers retry-with-preset + remove for failed jobs", () => {
    expect(menuItemsFor("error", true)).toEqual([
      "copy-url",
      "copy-path",
      "open",
      "reveal",
      "retry-preset",
      "remove",
      "delete-file",
      "media-info",
    ]);    expect(menuItemsFor("cancelled", false)).toEqual(["copy-url", "retry-preset", "remove"]);
  });

  it("offers reprocess (not plain run) for pipeline failures", () => {
    expect(menuItemsFor("postfailed", true)).toContain("post-reprocess");
    expect(menuItemsFor("postfailed", true)).not.toContain("post-run");
    expect(menuItemsFor("postfailed", true)).toContain("media-info");
    expect(menuItemsFor("done", true)).not.toContain("post-reprocess");
  });

  it("never offers remove/delete while actively writing", () => {
    expect(menuItemsFor("downloading", true)).toEqual(["copy-url", "copy-path", "open", "reveal"]);
    expect(menuItemsFor("processing", true)).toEqual(["copy-url", "copy-path", "open", "reveal"]);
    expect(menuItemsFor("paused", true)).toContain("delete-file");
  });

  it("offers move up/down for queued jobs by position", () => {
    expect(menuItemsFor("queued", false)).toEqual(["copy-url", "remove"]);
    expect(menuItemsFor("queued", false, { up: true, down: true })).toEqual([
      "copy-url",
      "move-up",
      "move-down",
      "remove",
    ]);
    expect(menuItemsFor("queued", false, { up: false, down: true })).toEqual([
      "copy-url",
      "move-down",
      "remove",
    ]);
    // Non-queued jobs never get move items, even when flagged.
    expect(menuItemsFor("paused", false, { up: true, down: true })).not.toContain("move-up");
  });
});

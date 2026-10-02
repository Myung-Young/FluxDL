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
    ]);
    expect(menuItemsFor("cancelled", false)).toEqual(["copy-url", "retry-preset", "remove"]);
  });

  it("never offers remove/delete while actively writing", () => {
    expect(menuItemsFor("downloading", true)).toEqual(["copy-url", "copy-path", "open", "reveal"]);
    expect(menuItemsFor("processing", true)).toEqual(["copy-url", "copy-path", "open", "reveal"]);
    expect(menuItemsFor("paused", true)).toContain("delete-file");
  });
});

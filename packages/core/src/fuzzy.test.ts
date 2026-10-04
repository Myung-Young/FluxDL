import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyRank } from "./fuzzy.js";

describe("fuzzyRank", () => {
  it("matches exact substrings with the top score", () => {
    expect(fuzzyRank("Big Buck Bunny", "buck")).not.toBeNull();
    expect(fuzzyRank("Big Buck Bunny", "")).toBe(0);
  });

  it("tolerates typos in longer words", () => {
    // The canonical demo: every word is slightly wrong, still found.
    expect(fuzzyMatch("Big Buck Bunny", "big buk buni")).toBe(true);
    expect(fuzzyMatch("Big Buck Bunny", "bug buny")).toBe(true);
  });

  it("requires short words to match exactly", () => {
    expect(fuzzyMatch("Big Buck Bunny", "mp3")).toBe(false);
    expect(fuzzyMatch("song.mp3", "mp3")).toBe(true);
  });

  it("rejects unrelated queries", () => {
    expect(fuzzyMatch("Big Buck Bunny", "cooking pasta")).toBe(false);
    expect(fuzzyMatch("Big Buck Bunny", "zzz")).toBe(false);
  });

  it("ranks exact hits above typo hits", () => {
    const exact = fuzzyRank("Big Buck Bunny", "bunny") ?? 0;
    const typo = fuzzyRank("Big Buck Bunny", "buni") ?? 0;
    expect(exact).toBeGreaterThan(typo);
  });

  it("requires every query word to match", () => {
    expect(fuzzyMatch("Big Buck Bunny", "big cooking")).toBe(false);
    expect(fuzzyMatch("Big Buck Bunny", "  BIG   bunny  ")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { LruCache } from "./cache.js";

function clock() {
  let now = 1000;
  return {
    now: () => now,
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

describe("LruCache", () => {
  it("hits, misses, and expires by TTL", () => {
    const c = clock();
    const cache = new LruCache<string>(30, 10 * 60 * 1000, c);
    expect(cache.get("a")).toBeNull();
    cache.set("a", "A");
    expect(cache.get("a")).toBe("A");
    c.advance(10 * 60 * 1000);
    expect(cache.get("a")).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("evicts least-recently-used past capacity", () => {
    const c = clock();
    const cache = new LruCache<string>(2, 60_000, c);
    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C");
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
  });

  it("supports bypass via delete/clear", () => {
    const cache = new LruCache<string>(30, 60_000, clock());
    cache.set("a", "A");
    cache.delete("a");
    expect(cache.get("a")).toBeNull();
    cache.set("a", "A");
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

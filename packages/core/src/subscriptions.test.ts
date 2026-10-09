import { describe, expect, it } from "vitest";
import {
  MAX_NEW_PER_CHECK,
  MAX_SUB_FAILURES,
  MIN_SUB_INTERVAL_MIN,
  cleanSubscription,
  dueSubs,
  isSubDue,
  recordSubResult,
  subDelayMs,
} from "./subscriptions.js";
import type { WatchChannel } from "./types.js";

function chan(over: Partial<WatchChannel> = {}): WatchChannel {
  return {
    url: "https://www.youtube.com/@x/videos",
    title: "x",
    lastVideoId: null,
    lastCheckedAt: null,
    mode: "notify",
    folder: null,
    preset: null,
    engine: null,
    intervalMin: 60,
    paused: false,
    failCount: 0,
    autoDisabled: false,
    ...over,
  };
}

describe("subscriptions", () => {
  it("migrates legacy rows with safe defaults", () => {
    const c = cleanSubscription({ url: "https://a", title: "a" });
    expect(c).toMatchObject({ mode: "notify", intervalMin: 60, paused: false, autoDisabled: false });
    expect(cleanSubscription(null)).toBeNull();
    expect(cleanSubscription({ url: 1 })).toBeNull();
  });

  it("clamps the interval at the 30-minute floor", () => {
    expect(cleanSubscription({ url: "https://a", intervalMin: 5 })?.intervalMin).toBe(
      MIN_SUB_INTERVAL_MIN,
    );
    expect(cleanSubscription({ url: "https://a", intervalMin: 120 })?.intervalMin).toBe(120);
  });

  it("never-checked channels are due; paused/disabled never are", () => {
    expect(isSubDue(chan(), 1000)).toBe(true);
    expect(isSubDue(chan({ paused: true }), 1000)).toBe(false);
    expect(isSubDue(chan({ autoDisabled: true }), 1000)).toBe(false);
  });

  it("backs off exponentially on failures", () => {
    expect(subDelayMs(chan({ intervalMin: 30, failCount: 0 }))).toBe(30 * 60_000);
    expect(subDelayMs(chan({ intervalMin: 30, failCount: 1 }))).toBe(60 * 60_000);
    // Capped at x16, not runaway.
    expect(subDelayMs(chan({ intervalMin: 30, failCount: 99 }))).toBe(30 * 60_000 * 16);
    // Not due inside the stretched window (60 min), due just after it.
    const backed = chan({ lastCheckedAt: 0, intervalMin: 30, failCount: 1 });
    expect(isSubDue(backed, 59 * 60_000)).toBe(false);
    expect(isSubDue(backed, 61 * 60_000)).toBe(true);
  });

  it("auto-disables after 5 consecutive failures and resets on success", () => {
    let c = chan({ failCount: MAX_SUB_FAILURES - 1 });
    c = recordSubResult(c, false, 10);
    expect(c.autoDisabled).toBe(true);
    expect(c.failCount).toBe(MAX_SUB_FAILURES);
    c = recordSubResult(c, true, 20);
    expect(c.failCount).toBe(0);
    // Success does not re-enable an auto-disabled sub (explicit re-enable).
    expect(c.autoDisabled).toBe(true);
  });

  it("returns due subs oldest-first", () => {
    const now = 10_000_000;
    const a = chan({ url: "https://a", lastCheckedAt: 100 });
    const b = chan({ url: "https://b", lastCheckedAt: 50 });
    const fresh = chan({ url: "https://c", lastCheckedAt: now - 10 * 60_000 });
    const due = dueSubs([a, fresh, b], now);
    expect(due.map((c) => c.url)).toEqual(["https://b", "https://a"]);
  });

  it("caps new items per check at 50", () => {
    expect(MAX_NEW_PER_CHECK).toBe(50);
  });
});

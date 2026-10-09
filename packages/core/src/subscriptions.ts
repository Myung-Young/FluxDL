import type { DownloadPreset, SubscriptionMode, WatchChannel } from "./types.js";
import { ENGINE_IDS } from "./types.js";
import { SUBSCRIPTION_MODES } from "./types.js";

/**
 * Subscription scheduling (Phase 3, pure). The renderer-side poller calls
 * these; persistence stays main-side (watchlist.json), checking reuses
 * getInfo + diffWatch. No timers here — the hook owns the interval.
 */

/** Minimum check interval: hammering sites gets IPs blocked. */
export const MIN_SUB_INTERVAL_MIN = 30;

/** New items per check above this need explicit confirmation. */
export const MAX_NEW_PER_CHECK = 50;

/** Consecutive failures before a sub auto-disables with a notice. */
export const MAX_SUB_FAILURES = 5;

/** Backoff exponent cap: delay never exceeds interval × 16. */
const MAX_BACKOFF_SHIFT = 4;

export function cleanSubMode(value: unknown): SubscriptionMode {
  return SUBSCRIPTION_MODES.includes(value as SubscriptionMode)
    ? (value as SubscriptionMode)
    : "notify";
}

export function cleanIntervalMin(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(MIN_SUB_INTERVAL_MIN, Math.floor(value));
}

function isPresetLike(value: unknown): value is DownloadPreset {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    (r["kind"] === "video" || r["kind"] === "audio") &&
    typeof r["videoPreset"] === "string" &&
    typeof r["audioPreset"] === "string" &&
    (r["rawFormat"] === null || typeof r["rawFormat"] === "string")
  );
}

/** Defaults for every post-watchlist field (old rows migrate silently). */
export function defaultSubFields(): Pick<
  WatchChannel,
  "mode" | "folder" | "preset" | "engine" | "intervalMin" | "paused" | "failCount" | "autoDisabled"
> {
  return {
    mode: "notify",
    folder: null,
    preset: null,
    engine: null,
    intervalMin: 60,
    paused: false,
    failCount: 0,
    autoDisabled: false,
  };
}

/** Sanitize one raw subscription row (unknown fields fall back, never throw). */
export function cleanSubscription(raw: unknown): WatchChannel | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["url"] !== "string") return null;
  const engineRaw = r["engine"];
  return {
    url: r["url"],
    title: typeof r["title"] === "string" && r["title"].length > 0 ? r["title"] : r["url"],
    lastVideoId: typeof r["lastVideoId"] === "string" ? r["lastVideoId"] : null,
    lastCheckedAt:
      typeof r["lastCheckedAt"] === "number" && Number.isFinite(r["lastCheckedAt"])
        ? r["lastCheckedAt"]
        : null,
    mode: cleanSubMode(r["mode"]),
    folder: typeof r["folder"] === "string" && r["folder"].length > 0 ? r["folder"] : null,
    preset: isPresetLike(r["preset"]) ? r["preset"] : null,
    engine:
      typeof engineRaw === "string" && (ENGINE_IDS as readonly string[]).includes(engineRaw)
        ? (engineRaw as WatchChannel["engine"])
        : null,
    intervalMin: cleanIntervalMin(r["intervalMin"], 60),
    paused: r["paused"] === true,
    failCount:
      typeof r["failCount"] === "number" && Number.isFinite(r["failCount"])
        ? Math.max(0, Math.floor(r["failCount"]))
        : 0,
    autoDisabled: r["autoDisabled"] === true,
  };
}

/**
 * Effective delay before the next check: the interval stretched by
 * consecutive failures (×2 each, capped ×16). Keeps a flaky channel from
 * spinning while never giving up on it entirely (disable needs 5 in a row).
 */
export function subDelayMs(channel: Pick<WatchChannel, "intervalMin" | "failCount">): number {
  const shift = Math.min(MAX_BACKOFF_SHIFT, Math.max(0, channel.failCount));
  return channel.intervalMin * 60_000 * 2 ** shift;
}

/** True when a check is due (never-checked counts as due). */
export function isSubDue(
  channel: Pick<WatchChannel, "lastCheckedAt" | "intervalMin" | "failCount" | "paused" | "autoDisabled">,
  now: number,
): boolean {
  if (channel.paused || channel.autoDisabled) return false;
  if (!Number.isFinite(now)) return false;
  if (channel.lastCheckedAt === null) return true;
  return now - channel.lastCheckedAt >= subDelayMs(channel);
}

/** Channels due for a check right now, oldest first. */
export function dueSubs(channels: readonly WatchChannel[], now: number): WatchChannel[] {
  return channels
    .filter((c) => isSubDue(c, now))
    .sort((a, b) => (a.lastCheckedAt ?? 0) - (b.lastCheckedAt ?? 0));
}

/**
 * Fold a check result back into the channel. Success resets the failure
 * counter; the 5th consecutive failure auto-disables (caller toasts).
 */
export function recordSubResult(channel: WatchChannel, ok: boolean, now: number): WatchChannel {
  if (ok) {
    return { ...channel, lastCheckedAt: now, failCount: 0 };
  }
  const failCount = channel.failCount + 1;
  return {
    ...channel,
    lastCheckedAt: now,
    failCount,
    autoDisabled: failCount >= MAX_SUB_FAILURES ? true : channel.autoDisabled,
  };
}

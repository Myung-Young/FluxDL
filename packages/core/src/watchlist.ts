import type { MediaInfo, PlaylistEntry, WatchChannel } from "./types.js";
import { normalizeUrl } from "./url.js";

/**
 * Watchlist (A6): channels/playlists checked for new uploads. Pure helpers;
 * persistence lives main-side (watchlist.json), checking reuses getInfo.
 */

export function normalizeWatchlist(raw: unknown): WatchChannel[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchChannel[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 200)) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec["url"] !== "string") continue;
    let url = "";
    try {
      url = normalizeUrl(rec["url"]);
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: typeof rec["title"] === "string" && rec["title"].length > 0 ? rec["title"] : url,
      lastVideoId:
        typeof rec["lastVideoId"] === "string" && rec["lastVideoId"].length > 0
          ? rec["lastVideoId"]
          : null,
      lastCheckedAt:
        typeof rec["lastCheckedAt"] === "number" && Number.isFinite(rec["lastCheckedAt"])
          ? rec["lastCheckedAt"]
          : null,
    });
  }
  return out;
}

export interface WatchDiff {
  /** Entries newer than the baseline (empty on first check by design). */
  readonly fresh: readonly PlaylistEntry[];
  /** New baseline: newest entry id, or the old one when nothing arrived. */
  readonly baseline: string | null;
  readonly isFirstCheck: boolean;
}

/**
 * Diff fresh channel entries against the stored baseline. Channel dumps
 * arrive newest-first, so everything above lastVideoId is new. The first
 * check never reports the whole backlog as new — it only sets the baseline.
 */
export function diffWatch(info: MediaInfo, lastVideoId: string | null): WatchDiff {
  const entries = info.isPlaylist ? info.entries : [];
  const newest = entries[0]?.id ?? null;
  if (lastVideoId === null) {
    return { fresh: [], baseline: newest, isFirstCheck: true };
  }
  const fresh: PlaylistEntry[] = [];
  for (const e of entries) {
    if (e.id === lastVideoId) break;
    fresh.push(e);
  }
  return { fresh, baseline: newest ?? lastVideoId, isFirstCheck: false };
}

/** Append a channel (normalized + deduped); throws on invalid URLs. */
export function addWatchChannel(
  channels: readonly WatchChannel[],
  rawUrl: string,
  title: string,
): WatchChannel[] {
  const url = normalizeUrl(rawUrl);
  if (channels.some((c) => c.url === url)) return [...channels];
  return [
    ...channels,
    {
      url,
      title: title.length > 0 ? title : url,
      lastVideoId: null,
      lastCheckedAt: null,
    },
  ];
}

export function touchWatch(
  channels: readonly WatchChannel[],
  url: string,
  patch: Partial<Pick<WatchChannel, "title" | "lastVideoId" | "lastCheckedAt">>,
): WatchChannel[] {
  return channels.map((c) => (c.url === url ? { ...c, ...patch } : c));
}

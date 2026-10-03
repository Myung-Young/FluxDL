import type { DownloadJob, PlaylistEntry } from "./types.js";
import { normalizeUrl } from "./url.js";
import { identityKey } from "./identity.js";

/**
 * Smarter playlists (M2.7). Pure helpers: Windows-safe subfolder names
 * and per-entry downloaded-state derivation (archive keys + history
 * destinations checked main-side in bulk).
 */

/** Windows-safe directory segment (illegal chars, trailing dots, length). */
export function sanitizePlaylistTitle(title: string): string {
  // eslint-disable-next-line no-control-regex -- control chars are illegal in Windows names
  const illegal = /[<>:"/\\|?*\u0000-\u001f]/g;
  const cleaned = title
    .replace(illegal, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  const cut = cleaned.slice(0, 100).trim();
  return cut.length > 0 ? cut : "playlist";
}

export interface EntryState {
  readonly archived: boolean;
  readonly exists: boolean;
}

function safeKey(url: string, extractor: string | null, videoId: string | null): string | null {
  try {
    return identityKey({ url, extractor, videoId });
  } catch {
    return null;
  }
}

/**
 * Derive per-entry state. `archivedKeys` aligns with archiveHas() output
 * (extractor::id keys; URL keys never match the archive file). History
 * matches by identity key first, then raw URL (pre-extractor records).
 */
export function deriveEntryStates(
  entries: readonly PlaylistEntry[],
  parentExtractor: string | null,
  archivedKeys: ReadonlySet<string>,
  historyJobs: readonly DownloadJob[],
  existsByDestination: ReadonlyMap<string, boolean>,
): Map<string, EntryState> {
  const byIdentity = new Map<string, DownloadJob>();
  for (const h of historyJobs) {
    const key = safeKey(h.url, h.extractor ?? null, h.videoId ?? null);
    if (key !== null && !byIdentity.has(key)) byIdentity.set(key, h);
  }
  const out = new Map<string, EntryState>();
  for (const e of entries) {
    const key = safeKey(e.url, parentExtractor, e.id);
    const archived = key !== null && archivedKeys.has(key);
    let hit = key !== null ? byIdentity.get(key) : undefined;
    if (hit === undefined) {
      hit = historyJobs.find((h) => {
        try {
          return normalizeUrl(h.url) === normalizeUrl(e.url);
        } catch {
          return false;
        }
      });
    }
    const dest = hit?.destination ?? null;
    out.set(e.id, {
      archived,
      exists: dest !== null && (existsByDestination.get(dest) ?? false),
    });
  }
  return out;
}

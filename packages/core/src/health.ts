import type { DownloadJob } from "./types.js";

/**
 * Library health (M2.9). Pure missing-file derivation; the screen
 * bulk-checks destinations in chunks via fileExistsBulk and offers
 * Locate (pickFile + updateHistory), Remove, and Re-download.
 */

/** Ids whose destination is known but reported missing. */
export function deriveMissingIds(
  records: readonly DownloadJob[],
  existsByDestination: ReadonlyMap<string, boolean>,
): ReadonlySet<string> {
  const missing = new Set<string>();
  for (const r of records) {
    if (r.destination === null) continue;
    if (existsByDestination.get(r.destination) === false) missing.add(r.id);
  }
  return missing;
}

/** Split destinations into chunks for UI-yielding bulk checks. */
export function chunkDestinations(
  records: readonly DownloadJob[],
  chunkSize: number,
): string[][] {
  const dests = [
    ...new Set(
      records.map((r) => r.destination).filter((d): d is string => d !== null),
    ),
  ];
  const chunks: string[][] = [];
  for (let i = 0; i < dests.length; i += Math.max(1, Math.floor(chunkSize))) {
    chunks.push(dests.slice(i, i + Math.max(1, Math.floor(chunkSize))));
  }
  return chunks;
}

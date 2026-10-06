import type { DownloadJob } from "./types.js";
import { normalizeUrl } from "./url.js";

/**
 * Duplicate guard (M1.3). Identity = extractor+id when known, else the
 * normalized URL. Pure: callers supply queue + history snapshots.
 */

export interface DuplicateTarget {
  readonly url: string;
  readonly extractor: string | null;
  readonly videoId: string | null;
}

/** Stable identity key for one download target. */
export function identityKey(target: DuplicateTarget): string {
  // `typeof` on both fields: these come from the engine / disk, so a missing
  // OR wrongly typed value must degrade to the URL instead of throwing inside
  // the duplicate guard (which would abort an otherwise valid enqueue).
  const extractor =
    typeof target.extractor === "string" ? target.extractor.trim().toLowerCase() : "";
  const videoId = typeof target.videoId === "string" ? target.videoId.trim() : "";
  if (extractor.length > 0 && videoId.length > 0) {
    return `${extractor}::${videoId}`;
  }
  return normalizeUrl(target.url);
}

export type DuplicateScope = "queue" | "history";

export interface DuplicateHit {
  readonly scope: DuplicateScope;
  /** The earlier job (carries createdAt for the "date" line + destination). */
  readonly job: DownloadJob;
}

/**
 * Active queue wins over history. Queue = anything not finished
 * (queued/analyzing/downloading/processing/paused); history holds
 * done/error/cancelled records.
 */
export function findDuplicate(
  target: DuplicateTarget,
  queueJobs: readonly DownloadJob[],
  historyJobs: readonly DownloadJob[],
): DuplicateHit | null {
  let key: string;
  try {
    key = identityKey(target);
  } catch {
    return null;
  }
  for (const job of queueJobs) {
    if (jobKeyOf(job) === key) return { scope: "queue", job };
  }
  for (const job of historyJobs) {
    if (jobKeyOf(job) === key) return { scope: "history", job };
  }
  return null;
}

function jobKeyOf(job: DownloadJob): string | null {
  try {
    return identityKey({
      url: job.url,
      extractor: job.extractor ?? null,
      videoId: job.videoId ?? null,
    });
  } catch {
    return null;
  }
}

export type DuplicateChoice = "skip" | "anyway" | "open";

export interface GuardInput extends DuplicateTarget {
  readonly title: string;
  /** True for playlist entries (eligible for --download-archive). */
  readonly fromPlaylist: boolean;
}

export interface GuardedTarget extends GuardInput {
  /** True when the user chose "Download anyway" (omit --download-archive). */
  readonly forceFresh: boolean;
}

/**
 * Run targets through the guard. `ask` shows the dialog (resolves with the
 * user's choice); `fileExists` checks the earlier destination for the
 * "Open existing file" action. "Open" drops the target (caller opens it).
 */
export async function filterDuplicates(
  targets: readonly GuardInput[],
  opts: {
    readonly queueJobs: readonly DownloadJob[];
    readonly historyJobs: readonly DownloadJob[];
    readonly fileExists: (path: string) => Promise<boolean>;
    readonly onOpen: (path: string) => Promise<void>;
    readonly ask: (hit: DuplicateHit) => Promise<DuplicateChoice>;
  },
): Promise<GuardedTarget[]> {
  const out: GuardedTarget[] = [];
  for (const t of targets) {
    const hit = findDuplicate(t, opts.queueJobs, opts.historyJobs);
    if (hit === null) {
      out.push({ ...t, forceFresh: false });
      continue;
    }
    const dest = hit.job.destination ?? "";
    const exists = dest.length > 0 && (await opts.fileExists(dest));
    const choice = await opts.ask(hit);
    if (choice === "skip") continue;
    if (choice === "open") {
      if (exists) {
        await opts.onOpen(dest);
      }
      continue;
    }
    out.push({ ...t, forceFresh: true });
  }
  return out;
}

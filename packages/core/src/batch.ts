import type { DownloadPreset, MediaInfo } from "./types.js";
import { normalizeUrl } from "./url.js";

/**
 * Batch paste / .txt import (M1.2). Pure parse + state helpers; the
 * concurrency-3 analyze pool lives in `BatchPanel.tsx`. Everything from
 * outside the app is DATA: lines are normalized, never executed.
 */

export const MAX_BATCH_LINES = 500;
export const MAX_BATCH_BYTES = 1024 * 1024;

export type BatchStatus = "pending" | "analyzing" | "ready" | "failed";

export interface BatchParsed {
  readonly input: string;
  readonly url: string;
}

export interface BatchInvalid {
  readonly input: string;
}

export interface BatchParseResult {
  readonly valid: readonly BatchParsed[];
  readonly invalid: readonly BatchInvalid[];
  readonly duplicates: number;
  /** True when the input exceeded MAX_BATCH_LINES and the rest was dropped. */
  readonly truncated: boolean;
}

/**
 * Split pasted/dropped text into URLs: CRLF or LF, leading BOM stripped,
 * blanks and "#" comments skipped, dupes (by normalized URL) dropped.
 * Invalid lines are reported, never thrown.
 */
export function parseBatchText(text: string): BatchParseResult {
  const stripped = text.replace(/^\uFEFF/, "");
  const valid: BatchParsed[] = [];
  const invalid: BatchInvalid[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let truncated = false;
  let counted = 0;
  for (const rawLine of stripped.split(/\r?\n/)) {
    const input = rawLine.trim();
    if (input.length === 0 || input.startsWith("#")) continue;
    if (counted >= MAX_BATCH_LINES) {
      truncated = true;
      break;
    }
    counted += 1;
    let url: string;
    try {
      url = normalizeUrl(input);
    } catch {
      invalid.push({ input });
      continue;
    }
    if (seen.has(url)) {
      duplicates += 1;
      continue;
    }
    seen.add(url);
    valid.push({ input, url });
  }
  return { valid, invalid, duplicates, truncated };
}

export interface BatchEntry {
  /** Normalized URL (deduped, hence unique). Expanded rows suffix "#id". */
  readonly key: string;
  readonly input: string;
  readonly url: string;
  readonly status: BatchStatus;
  readonly error: string | null;
  readonly info: MediaInfo | null;
  /** Per-row preset override; null = use the global preset. */
  readonly preset: DownloadPreset | null;
  /** True for rows expanded from a playlist (archive-eligible). */
  readonly fromPlaylist?: boolean;
}

/** Append parsed lines, skipping URLs already present. */
export function addBatchEntries(
  existing: readonly BatchEntry[],
  parsed: readonly BatchParsed[],
): BatchEntry[] {
  const known = new Set(existing.map((e) => e.key));
  const out = [...existing];
  for (const p of parsed) {
    if (known.has(p.url)) continue;
    known.add(p.url);
    out.push({
      key: p.url,
      input: p.input,
      url: p.url,
      status: "pending",
      error: null,
      info: null,
      preset: null,
    });
  }
  return out;
}

export interface BatchEntryPatch {
  readonly status?: BatchStatus;
  readonly error?: string | null;
  readonly info?: MediaInfo | null;
  readonly preset?: DownloadPreset | null;
}

/** Fold one row update (pure; unknown keys pass through untouched). */
export function updateBatchEntry(
  entries: readonly BatchEntry[],
  key: string,
  patch: BatchEntryPatch,
): BatchEntry[] {
  return entries.map((e) => (e.key === key ? { ...e, ...patch } : e));
}

/** Retry resets failed rows to pending (clears their errors). */
export function retryBatchEntries(entries: readonly BatchEntry[]): BatchEntry[] {
  return entries.map((e) =>
    e.status === "failed" ? { ...e, status: "pending" as const, error: null } : e,
  );
}

export function removeBatchEntry(entries: readonly BatchEntry[], key: string): BatchEntry[] {
  return entries.filter((e) => e.key !== key);
}

/**
 * Replace a ready playlist row with one pending row per entry.
 * Non-playlist rows (or missing info) pass through unchanged.
 */
export function expandPlaylistEntry(
  entries: readonly BatchEntry[],
  key: string,
): BatchEntry[] {
  const out: BatchEntry[] = [];
  for (const e of entries) {
    if (e.key !== key || e.status !== "ready" || e.info === null) {
      out.push(e);
      continue;
    }
    if (!e.info.isPlaylist || e.info.entries.length === 0) {
      out.push(e);
      continue;
    }
    const taken = new Set<string>();
    for (const en of e.info.entries) {
      const rowKey = taken.has(en.url) || en.url === e.url ? `${e.key}#${en.id}` : en.url;
      taken.add(rowKey);
      out.push({
        key: rowKey,
        input: en.title,
        url: en.url,
        status: "pending",
        error: null,
        info: null,
        preset: e.preset,
        fromPlaylist: true,
      });
    }
  }
  return out;
}

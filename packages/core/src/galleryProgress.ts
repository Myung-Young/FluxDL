/**
 * gallery-dl stdout parser (pure). Handles CRLF, partial chunks (caller
 * buffers lines), and UTF-8. No fake percentages: gallery-dl prints per-file
 * progress, so the UI shows counters + indeterminate bar + file list.
 */

export interface GalleryFileEvent {
  /** Absolute or relative output path when known. */
  readonly path: string | null;
  readonly status: "downloaded" | "skipped" | "failed";
}

export interface GalleryProgress {
  readonly downloaded: number;
  readonly skipped: number;
  readonly failed: number;
  readonly total: number | null;
  readonly lastFile: string | null;
}

export function emptyGalleryProgress(): GalleryProgress {
  return { downloaded: 0, skipped: 0, failed: 0, total: null, lastFile: null };
}

const SAVE_RE = /^\[gallery-dl\]\s+save\s+(?<path>.+?)\s*$/i;
const SKIP_RE = /^\[gallery-dl\]\s+skip\s+(?<path>.+?)\s*(?:\(.*\))?\s*$/i;
const FAIL_RE = /^\[gallery-dl\]\s+(?:error|failed|download failed)\s*:?\s*(?<path>.+?)?\s*$/i;
const TOTAL_RE = /^#\s*(?<n>\d+)\s*(?:files?|items?)?\s*$/i;

export function parseGalleryDlLine(line: string): GalleryFileEvent | null {
  const trimmed = line.replace(/\r$/, "").trim();
  if (trimmed.length === 0) return null;
  const save = SAVE_RE.exec(trimmed);
  if (save?.groups !== undefined) {
    const path = (save.groups["path"] ?? "").trim();
    return { path: path.length > 0 ? path : null, status: "downloaded" };
  }
  const skip = SKIP_RE.exec(trimmed);
  if (skip?.groups !== undefined) {
    const path = (skip.groups["path"] ?? "").trim();
    return { path: path.length > 0 ? path : null, status: "skipped" };
  }
  const fail = FAIL_RE.exec(trimmed);
  if (fail !== null && fail.groups !== undefined) {
    const path = (fail.groups["path"] ?? "").trim();
    return { path: path.length > 0 ? path : null, status: "failed" };
  }
  return null;
}

export function applyGalleryFileEvent(
  state: GalleryProgress,
  event: GalleryFileEvent,
): GalleryProgress {
  return {
    downloaded: state.downloaded + (event.status === "downloaded" ? 1 : 0),
    skipped: state.skipped + (event.status === "skipped" ? 1 : 0),
    failed: state.failed + (event.status === "failed" ? 1 : 0),
    total: state.total,
    lastFile: event.path ?? state.lastFile,
  };
}

/** Extract a "# 42" total hint when the tool prints one. */
export function parseGalleryTotal(line: string): number | null {
  const m = TOTAL_RE.exec(line.replace(/\r$/, "").trim());
  if (m?.groups === undefined) return null;
  const n = Number(m.groups["n"]);
  return Number.isFinite(n) && n >= 0 && n <= 100_000 ? n : null;
}

/**
 * Split a raw chunk into complete lines, keeping the remainder.
 * Handles LF, CRLF, and a chunk that ends mid-line.
 */
export function splitGalleryChunk(chunk: string, remainder: string): { lines: string[]; rest: string } {
  const combined = remainder + chunk;
  const parts = combined.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}

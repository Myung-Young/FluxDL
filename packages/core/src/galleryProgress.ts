/**
 * gallery-dl stdout parser (pure). Verified against gallery-dl 1.32.15
 * (live, 2026-10-09):
 *
 * - a saved file prints as a BARE absolute path per line (no prefix);
 * - an archive/exists skip prints `# <absolute path>`;
 * - `--simulate` prints `# <bare filename>` (no download happens);
 * - diagnostics (`[module][info]`, `[gallery-dl][error] …`) go to stderr
 *   but are tolerated here too (ignored, never counted).
 *
 * Callers buffer lines across chunks (splitGalleryChunk); CRLF and UTF-8
 * are handled. No fake percentages: the UI shows counters + indeterminate.
 */

export interface GalleryFileEvent {
  /** Absolute output path when known. */
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

/** Absolute-path test (Windows drive, UNC, or POSIX) — never a bare name. */
function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/");
}

function looksLikeMediaFile(value: string): boolean {
  return /\.[a-z0-9]{2,5}$/i.test(value);
}

export function parseGalleryDlLine(line: string): GalleryFileEvent | null {
  const trimmed = line.replace(/\r$/, "").trim();
  if (trimmed.length === 0) return null;
  // Bracket diagnostics ([module][info]/[gallery-dl][error]) are never files.
  if (trimmed.startsWith("[")) return null;
  if (trimmed.startsWith("#")) {
    // `# <path>` = skipped existing file. A simulate `# <name>` (no
    // download happened) must NOT count — only absolute paths qualify.
    const path = trimmed.slice(1).trim();
    if (path.length > 0 && isAbsolutePath(path) && looksLikeMediaFile(path)) {
      return { path, status: "skipped" };
    }
    return null;
  }
  // A bare absolute file path = one saved download.
  if (isAbsolutePath(trimmed) && looksLikeMediaFile(trimmed)) {
    return { path: trimmed, status: "downloaded" };
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

/**
 * Byte-range parsing for the in-app media protocol (v1.7.2).
 *
 * Pure + RFC 9110 shaped so it can be pinned by unit tests. `<video>` and
 * `<audio>` elements drive Chromium's media stack, which ALWAYS issues
 * `Range` requests and treats a resource without `Accept-Ranges: bytes` as
 * non-seekable. Serving one flat 200 response is why every preview showed
 * `0:00` and could not be scrubbed.
 */

export type ByteRange =
  | { readonly kind: "all" }
  | { readonly kind: "bytes"; readonly start: number; readonly end: number }
  | { readonly kind: "unsatisfiable" };

/**
 * Parse a `Range` header against a known resource size.
 *
 * - No header, or a unit we do not implement -> `all` (a plain 200 body).
 * - `bytes=start-end`, `bytes=start-`, `bytes=-suffix` -> a clamped range.
 * - Anything unsatisfiable (start beyond the end, a 0-length resource) ->
 *   `unsatisfiable`, which the caller answers with 416.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange {
  const total = Number.isFinite(size) && size > 0 ? Math.floor(size) : 0;
  if (typeof header !== "string") return { kind: "all" };
  const raw = header.trim();
  if (raw.length === 0) return { kind: "all" };
  const eq = raw.indexOf("=");
  if (eq <= 0) return { kind: "all" };
  if (raw.slice(0, eq).trim().toLowerCase() !== "bytes") return { kind: "all" };
  // Multi-range requests are legal but every media player only ever needs the
  // first window; serving it whole is a valid (if generous) answer.
  const spec = raw.slice(eq + 1).split(",")[0]?.trim() ?? "";
  if (spec.length === 0) return { kind: "all" };
  const dash = spec.indexOf("-");
  if (dash < 0) return { kind: "unsatisfiable" };
  const startRaw = spec.slice(0, dash).trim();
  const endRaw = spec.slice(dash + 1).trim();
  if (total === 0) return { kind: "unsatisfiable" };
  if (startRaw.length === 0) {
    // Suffix form: the last N bytes.
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    const len = Math.min(Math.floor(suffix), total);
    return { kind: "bytes", start: total - len, end: total - 1 };
  }
  const start = Number(startRaw);
  if (!Number.isFinite(start) || !Number.isInteger(start) || start < 0) {
    return { kind: "unsatisfiable" };
  }
  if (start >= total) return { kind: "unsatisfiable" };
  if (endRaw.length === 0) return { kind: "bytes", start, end: total - 1 };
  const end = Number(endRaw);
  if (!Number.isFinite(end) || !Number.isInteger(end) || end < start) {
    return { kind: "unsatisfiable" };
  }
  return { kind: "bytes", start, end: Math.min(end, total - 1) };
}

/** `Content-Range` value for a 206 answer. */
export function contentRange(start: number, end: number, size: number): string {
  return `bytes ${String(start)}-${String(end)}/${String(size)}`;
}
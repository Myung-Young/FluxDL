import type { ProbeResult } from "./engines.js";

/**
 * gallery-dl `-j` probe parsing (pure, no I/O).
 *
 * Verified against gallery-dl 1.32.15 (live, 2026-10-09 — never from
 * memory): `-j` alone never downloads. Stdout is a JSON array of tuples —
 * `[2, dir-meta]`, `[3, url, file-meta]`, `[-1, {error, message}]` — and
 * diagnostics (`[module][info]`, `[gallery-dl][error] …`) go to stderr.
 * An unhandleable URL exits 64 with `[gallery-dl][error] Unsupported URL`
 * on stderr (exit codes are read main-side; this module only parses text).
 */

export interface GalleryProbeItem {
  readonly url: string;
  readonly filename: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly extension: string | null;
  readonly sizeBytes: number | null;
}

export interface GalleryProbeParsed {
  readonly items: readonly GalleryProbeItem[];
  /** `[-1]` failure messages, capped (partial-gallery failures). */
  readonly errors: readonly string[];
}

/** Preview cap: `--range 1-50` bounds both enumeration and parsing. */
export const GALLERY_PROBE_MAX_ITEMS = 50;
/** stdout ceiling for a probe (50 rich items fit in ~1 MB; margin ×8). */
export const GALLERY_PROBE_MAX_CHARS = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function cleanUrl(value: unknown): string | null {
  const s = cleanString(value);
  if (s === null || s.length > 2048) return null;
  return /^https?:\/\//i.test(s) ? s : null;
}

function cleanDim(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function cleanBytes(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function cleanExt(value: unknown): string | null {
  const s = cleanString(value);
  if (s === null || s.length > 16 || !/^[a-z0-9]+$/i.test(s)) return null;
  return s.toLowerCase();
}

function cleanError(value: unknown): string | null {
  if (isRecord(value)) {
    const message = cleanString(value["message"]) ?? cleanString(value["error"]);
    return message === null ? null : message.slice(0, 300);
  }
  const s = cleanString(value);
  return s === null ? null : s.slice(0, 300);
}

/**
 * Parse `-j` stdout. Never throws: garbage yields empty items plus one
 * error, so the caller can report "couldn't read this gallery" instead of
 * crashing. Input over the char cap is refused outright.
 */
export function parseGalleryProbeJson(stdout: string): GalleryProbeParsed {
  if (stdout.length > GALLERY_PROBE_MAX_CHARS) {
    return { items: [], errors: ["probe output too large"] };
  }
  // Slice the payload envelope like extractJsonPayload: warning preamble
  // must not break metadata probes (same lesson, yt-dlp side).
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    return { items: [], errors: ["probe returned no data"] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1)) as unknown;
  } catch {
    return { items: [], errors: ["probe returned unreadable data"] };
  }
  if (!Array.isArray(parsed)) {
    return { items: [], errors: ["probe returned unreadable data"] };
  }
  const items: GalleryProbeItem[] = [];
  const errors: string[] = [];
  const tuples: unknown[] = parsed;
  for (const rawTuple of tuples) {
    const tuple: unknown = rawTuple;
    if (!Array.isArray(tuple) || tuple.length === 0) continue;
    const kind: unknown = tuple[0];
    if (kind === 3 && items.length < GALLERY_PROBE_MAX_ITEMS) {
      const url = cleanUrl(tuple[1]);
      if (url === null) continue;
      const meta: unknown = tuple[2];
      const rec = isRecord(meta) ? meta : null;
      items.push({
        url,
        filename: rec === null ? null : cleanString(rec["filename"]),
        width: rec === null ? null : cleanDim(rec["width"]),
        height: rec === null ? null : cleanDim(rec["height"]),
        extension: rec === null ? null : cleanExt(rec["extension"]),
        sizeBytes: rec === null ? null : cleanBytes(rec["size"]),
      });
    } else if (kind === -1 && errors.length < 3) {
      const message = cleanError(tuple[1]);
      if (message !== null) errors.push(message);
    }
    // Type 2 (directory meta) and anything else carry no preview value.
  }
  return { items, errors };
}

const STDERR_ERROR_RE = /^\[gallery-dl\]\[error\]\s*(.+?)\s*$/i;

/**
 * Pull `[gallery-dl][error] …` lines out of stderr (info lines ignored).
 * Capped at 3 × 300 chars — diagnostics, never a log dump.
 */
export function galleryStderrErrors(stderr: string): string[] {
  const out: string[] = [];
  for (const rawLine of stderr.split("\n")) {
    if (out.length >= 3) break;
    const line = rawLine.replace(/\r$/, "").trim();
    const m = STDERR_ERROR_RE.exec(line);
    if (m !== null) {
      const message = (m[1] ?? "").trim().slice(0, 300);
      if (message.length > 0) out.push(message);
    }
  }
  return out;
}

const UNSUPPORTED_RE = /unsupported url/i;

/** True for gallery-dl's "no extractor handles this" marker. */
export function isUnsupportedUrlMessage(message: string): boolean {
  return UNSUPPORTED_RE.test(message);
}

export interface ProbeArgsInput {
  /** App-owned config file (generated from settings). */
  readonly configPath: string;
  /** Item cap (clamped 1–50). */
  readonly count: number;
  readonly url: string;
}

/**
 * Pure `-j` probe argv. Verified flags only (`-j`, `--range`, `--config`
 * all exist in 1.32.15 `--help`); `--` keeps the URL out of flag position.
 */
export function buildProbeArgs(input: ProbeArgsInput): string[] {
  const count = Math.min(
    GALLERY_PROBE_MAX_ITEMS,
    Math.max(1, Math.floor(input.count)),
  );
  return ["--config", input.configPath, "-j", "--range", `1-${String(count)}`, "--", input.url];
}

/**
 * Validate a gallery-dl `--range` selector (`5`, `8-20`, `1:24:3`,
 * comma combos like `1-3,5`). Digits, commas, colons, dashes and spaces
 * only, capped — anything else is dropped, never forwarded.
 */
export function cleanGalleryRange(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().slice(0, 64);
  if (t.length === 0 || !/[\d]/.test(t) || /[^0-9,:\-\s]/.test(t)) return null;
  return t;
}

/**
 * Compress 1-based item indices into a `--range` selector (`[2,3,4,7]` →
 * `"2-4,7"`). Indices are deduped, sorted, and clamped to ≥1.
 */
export function rangeForIndices(indices: readonly number[]): string | null {
  const sorted = [...new Set(indices.map((n) => Math.floor(n)).filter((n) => Number.isFinite(n) && n >= 1))].sort(
    (a, b) => a - b,
  );
  if (sorted.length === 0) return null;
  const parts: string[] = [];
  let runStart = sorted[0] as number;
  let runEnd = runStart;
  for (const n of sorted.slice(1)) {
    if (n === runEnd + 1) {
      runEnd = n;
      continue;
    }
    parts.push(runStart === runEnd ? String(runStart) : `${String(runStart)}-${String(runEnd)}`);
    runStart = n;
    runEnd = n;
  }
  parts.push(runStart === runEnd ? String(runStart) : `${String(runStart)}-${String(runEnd)}`);
  return parts.join(",").slice(0, 64);
}

// ---------------------------------------------------------------------------
// In-memory probe cache (renderer-side; no settings shape churn)
// ---------------------------------------------------------------------------

export interface ProbeCacheClock {
  now(): number;
}

/** 24 h: extractor support rarely changes; a miss just re-probes. */
export const PROBE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Bounded so a long session cannot grow it without limit. */
export const PROBE_CACHE_MAX_HOSTS = 500;

export interface ProbeCache {
  get(host: string): ProbeResult | undefined;
  set(host: string, result: ProbeResult): void;
}

export function createProbeCache(
  ttlMs: number = PROBE_CACHE_TTL_MS,
  clock?: ProbeCacheClock,
): ProbeCache {
  const now = clock !== undefined ? (): number => clock.now() : (): number => Date.now();
  const store = new Map<string, { result: ProbeResult; at: number }>();
  return {
    get(host: string): ProbeResult | undefined {
      const key = host.trim().toLowerCase();
      const entry = store.get(key);
      if (entry === undefined) return undefined;
      if (now() - entry.at > ttlMs) {
        store.delete(key);
        return undefined;
      }
      return entry.result;
    },
    set(host: string, result: ProbeResult): void {
      const key = host.trim().toLowerCase();
      if (key.length === 0 || key.length > 256) return;
      if (store.size >= PROBE_CACHE_MAX_HOSTS && !store.has(key)) {
        const oldest = store.keys().next();
        if (!oldest.done) store.delete(oldest.value);
      }
      store.set(key, { result, at: now() });
    },
  };
}

import { normalizeUrl } from "./url.js";

/**
 * Deep-link + CLI argument handling (pure).
 *
 * FluxDL registers the `fluxdl://` protocol on Windows and also accepts a
 * raw video URL as a CLI argument (`FluxDL.exe <url>`). A second instance
 * never opens its own window (single-instance lock) — it forwards its
 * argument to the running instance instead.
 *
 * Accepted shapes:
 * - `fluxdl://<percent-encoded-target>` (from the protocol handler)
 * - `fluxdl://https://…` (unencoded target, browser-friendly)
 * - a bare `https://…` CLI argument
 *
 * Everything from the OS is DATA: it is normalized/validated, never executed.
 * Returns the normalized target URL, or null when nothing usable is present.
 */

export function parseFluxDlUrl(raw: string): string | null {
  const t = raw.trim().replace(/^["']|["']$/g, "");
  if (t.length === 0) return null;
  let target = t;
  const m = /^fluxdl:\/\/(.*)$/is.exec(t);
  if (m !== null) {
    const inner = (m[1] ?? "").trim();
    if (inner.length === 0) return null;
    try {
      const decoded = decodeURIComponent(inner);
      // decodeURIComponent succeeds on plain URLs too (no-op).
      target = decoded.trim();
    } catch {
      target = inner;
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https?:\/\//i.test(t)) {
    // Some other scheme (file:, electron flags) — not ours.
    return null;
  }
  try {
    return normalizeUrl(target);
  } catch {
    return null;
  }
}

/**
 * Scan Electron's second-instance / boot argv for a deep-link target.
 * Skips the executable path, `--` separators, and `--flag` options
 * (Electron forwards a lot of its own switches in argv).
 */
export function extractDeepLinkTarget(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const t = arg.trim();
    if (t.length === 0 || t === "--" || t.startsWith("--")) continue;
    // Skip the executable itself (.exe path) and bundled .js/.asar paths.
    if (/\.exe"?$/i.test(t) || t.endsWith(".js") || t.endsWith(".asar")) continue;
    const parsed = parseFluxDlUrl(t);
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * URL validation + normalization. Every URL must pass through here
 * before it reaches the engine (core UI and DesktopEngine both use it).
 */

export class UrlValidationError extends Error {
  readonly code = "invalid-url" as const;
  constructor(message: string) {
    super(message);
    this.name = "UrlValidationError";
  }
}

/**
 * Trim, add https:// when the scheme is missing, and require http(s).
 * Returns the normalized URL string. Throws UrlValidationError otherwise.
 *
 * Copy-paste hardening: clipboard text can carry invisible characters
 * (zero-width spaces from share sheets) and wrapping quotes — both are
 * stripped so a freshly-copied YouTube link is never "invalid".
 */
/** Invisible hitchhikers from share sheets (ZWSP/ZWNJ/ZWJ/BOM). */
const INVISIBLE_CHARS: readonly string[] = [0x200b, 0x200c, 0x200d, 0xfeff].map((c) =>
  String.fromCharCode(c),
);

export function normalizeUrl(input: string): string {
  let cleaned = input;
  for (const ch of INVISIBLE_CHARS) cleaned = cleaned.split(ch).join("");
  cleaned = cleaned
    .trim()
    .replace(/^<(.+)>$/, "$1")
    .replace(/^["'“”‘’](.+)["'“”‘’]$/, "$1")
    .trim();
  const trimmed = cleaned;
  if (trimmed.length === 0) {
    throw new UrlValidationError("Enter a link first.");
  }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new UrlValidationError("That link does not look like a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UrlValidationError("Only http(s) links are supported.");
  }
  if (parsed.hostname.length === 0) {
    throw new UrlValidationError("That link does not look like a valid URL.");
  }
  return parsed.toString();
}

export function isValidUrl(input: string): boolean {
  try {
    normalizeUrl(input);
    return true;
  } catch {
    return false;
  }
}

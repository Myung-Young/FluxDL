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
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/^<(.+)>$/, "$1");
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

/**
 * Correlation id for a cancellable analyze call.
 *
 * `crypto.randomUUID` only exists in a secure context with a modern runtime.
 * The analyze flows call it OUTSIDE any try/catch, so a missing implementation
 * used to throw straight out of the click handler: the busy flag reset, no row
 * ever changed status and no error was shown — i.e. "Analyze all does nothing"
 * with a button that looks perfectly alive. This can never throw.
 */
export function newRequestId(): string {
  const c = globalThis.crypto as unknown as { randomUUID?: () => string } | undefined;
  if (c !== undefined && typeof c.randomUUID === "function") {
    try {
      const id = c.randomUUID();
      if (typeof id === "string" && id.length > 0) return id;
    } catch {
      // Fall through to the manual id below.
    }
  }
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
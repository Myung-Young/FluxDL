/**
 * Clipboard read helper (renderer only). Resolves null when the API is
 * missing or permission is denied — never throws.
 */
export function readClipboardText(): Promise<string | null> {
  const nav = navigator as unknown as {
    clipboard?: { readText?: () => Promise<string> };
  };
  const read = nav.clipboard?.readText;
  if (typeof read !== "function") return Promise.resolve(null);
  return read().then(
    (text) => text,
    () => null,
  );
}

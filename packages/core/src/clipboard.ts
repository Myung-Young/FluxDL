/**
 * Clipboard helpers (renderer only). Resolve null/false when the API is
 * missing or permission is denied — never throw.
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

export function writeClipboardText(text: string): Promise<boolean> {
  const nav = navigator as unknown as {
    clipboard?: { writeText?: (value: string) => Promise<void> };
  };
  const write = nav.clipboard?.writeText;
  if (typeof write !== "function") return Promise.resolve(false);
  return write(text).then(
    () => true,
    () => false,
  );
}

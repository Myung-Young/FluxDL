/**
 * Clipboard helpers (renderer only). Resolve null/false when the API is
 * missing or permission is denied — never throw.
 *
 * Read path prefers the main-side Electron clipboard (`window.grabber`):
 * `navigator.clipboard.readText()` inside the sandboxed renderer can be
 * denied, which used to surface as "invalid link" right after copying a
 * perfectly good YouTube URL. The DOM API stays as the fallback (and the
 * only path outside the desktop shell, e.g. unit tests).
 */
export function readClipboardText(): Promise<string | null> {
  try {
    const g = (
      window as unknown as {
        grabber?: { readClipboard?: () => Promise<string | null> };
      }
    ).grabber;
    if (g !== undefined && typeof g.readClipboard === "function") {
      return g.readClipboard().then(
        (text) => text,
        () => readDomClipboard(),
      );
    }
  } catch {
    // Non-browser contexts (unit tests) fall through to the DOM path.
  }
  return readDomClipboard();
}

function readDomClipboard(): Promise<string | null> {
  try {
    const nav = (
      typeof navigator === "undefined"
        ? undefined
        : (navigator as unknown as {
            clipboard?: { readText?: () => Promise<string> };
          })
    );
    const read = nav?.clipboard?.readText;
    if (typeof read !== "function") return Promise.resolve(null);
    return read.call(nav?.clipboard).then(
      (text) => text,
      () => null,
    );
  } catch {
    return Promise.resolve(null);
  }
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

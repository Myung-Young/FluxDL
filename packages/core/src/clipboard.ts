/**
 * Clipboard helpers (renderer only). Resolve null/false when the API is
 * missing or permission is denied — never throw.
 *
 * Both directions go through the main-side Electron clipboard
 * (`window.grabber`) first: `navigator.clipboard` is unreliable inside the
 * sandboxed, isolated renderer on Windows. Reads used to fail that way (which
 * surfaced as "invalid link" right after copying a good YouTube URL) and
 * writes still do (which surfaced as "Copy failed." on every Copy button).
 * The DOM API stays as the fallback and is the only path outside the desktop
 * shell (e.g. unit tests).
 */

interface ClipboardBridge {
  readonly readClipboard?: () => Promise<string | null>;
  readonly writeClipboard?: (text: string) => Promise<boolean>;
}

function bridge(): ClipboardBridge | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return (window as unknown as { grabber?: ClipboardBridge }).grabber;
  } catch {
    return undefined;
  }
}

export function readClipboardText(): Promise<string | null> {
  const g = bridge();
  if (g !== undefined && typeof g.readClipboard === "function") {
    return g.readClipboard().then(
      (text) => text,
      () => readDomClipboard(),
    );
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

/**
 * Copy text to the system clipboard.
 *
 * The main-process path is authoritative: on Windows the DOM
 * `navigator.clipboard.writeText` is denied for a sandboxed renderer, so the
 * fallback is only reached outside the desktop shell or when the bridge
 * itself failed. Resolves false (never rejects) when both paths fail.
 */
export function writeClipboardText(text: string): Promise<boolean> {
  const g = bridge();
  if (g !== undefined && typeof g.writeClipboard === "function") {
    return g.writeClipboard(text).then(
      (ok) => (ok ? true : writeDomClipboard(text)),
      () => writeDomClipboard(text),
    );
  }
  return writeDomClipboard(text);
}

function writeDomClipboard(text: string): Promise<boolean> {
  try {
    const nav =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as unknown as {
            clipboard?: { writeText?: (value: string) => Promise<void> };
          });
    const write = nav?.clipboard?.writeText;
    if (typeof write !== "function") return Promise.resolve(false);
    return write.call(nav?.clipboard, text).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}
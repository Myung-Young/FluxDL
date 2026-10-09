import { afterEach, describe, expect, it } from "vitest";
import { readClipboardText, writeClipboardText } from "./clipboard.js";

/**
 * v1.7.2: the write path used to go straight to `navigator.clipboard`, which
 * the sandboxed Electron renderer refuses, so every "Copy log" / "Copy
 * diagnostics" button reported "Copy failed." The main-side bridge is now the
 * primary path and the DOM API is only a fallback.
 */
interface Bridge {
  readClipboard?: () => Promise<string | null>;
  writeClipboard?: (text: string) => Promise<boolean>;
}

/**
 * The core suite runs in the plain node environment, where `window` does not
 * exist — so the bridge is installed on a stub `window` exactly like the
 * preload does in the real renderer.
 */
function withBridge(bridge: Bridge | undefined, fn: () => Promise<void>): Promise<void> {
  const g = globalThis as unknown as { window?: unknown };
  const had = "window" in g;
  const previous = g.window;
  if (bridge === undefined) delete g.window;
  else g.window = { grabber: bridge };
  return fn().finally(() => {
    if (had) g.window = previous;
    else delete g.window;
  });
}

const domCalls: string[] = [];
const originalNavigatorDesc = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
const globalScope = globalThis as unknown as Record<string, unknown>;
const hadNavigator = globalScope["navigator"] !== undefined;
const initialNav = globalScope["navigator"];
const originalClipboard =
  hadNavigator && typeof initialNav === "object" && initialNav !== null
    ? Object.getOwnPropertyDescriptor(initialNav, "clipboard")
    : undefined;

function stubDomClipboard(writeResult: boolean, readResult: string | null): void {
  if (globalScope["navigator"] === undefined) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: {},
    });
  }
  const currentNav = globalScope["navigator"] as object;
  Object.defineProperty(currentNav, "clipboard", {
    configurable: true,
    value: {
      writeText: (v: string) => {
        domCalls.push(v);
        return writeResult ? Promise.resolve() : Promise.reject(new Error("denied"));
      },
      readText: () =>
        readResult === null ? Promise.reject(new Error("denied")) : Promise.resolve(readResult),
    },
  });
}

function clearDomClipboard(): void {
  if (!hadNavigator) {
    if (originalNavigatorDesc) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDesc);
    } else {
      delete globalScope["navigator"];
    }
    return;
  }
  const currentNav = globalScope["navigator"];
  if (typeof currentNav === "object" && currentNav !== null) {
    if (originalClipboard === undefined) {
      delete (currentNav as Record<string, unknown>)["clipboard"];
      return;
    }
    Object.defineProperty(currentNav, "clipboard", originalClipboard);
  }
}

afterEach(() => {
  domCalls.length = 0;
  clearDomClipboard();
});

describe("writeClipboardText", () => {
  it("uses the main-process bridge first", async () => {
    domCalls.length = 0;
    stubDomClipboard(true, null);
    const seen: string[] = [];
    await withBridge(
      {
        writeClipboard: (text) => {
          seen.push(text);
          return Promise.resolve(true);
        },
      },
      async () => {
        await expect(writeClipboardText("Log copied.")).resolves.toBe(true);
      },
    );
    expect(seen).toEqual(["Log copied."]);
    // The DOM API is not even consulted when main succeeded.
    expect(domCalls).toEqual([]);
  });

  it("falls back to the DOM API when the bridge refuses", async () => {
    domCalls.length = 0;
    stubDomClipboard(true, null);
    await withBridge({ writeClipboard: () => Promise.resolve(false) }, async () => {
      await expect(writeClipboardText("diag")).resolves.toBe(true);
    });
    expect(domCalls).toEqual(["diag"]);
  });

  it("falls back to the DOM API when the bridge throws", async () => {
    domCalls.length = 0;
    stubDomClipboard(true, null);
    await withBridge(
      {
        writeClipboard: () => Promise.reject(new Error("no ipc")),
      },
      async () => {
        await expect(writeClipboardText("diag")).resolves.toBe(true);
      },
    );
    expect(domCalls).toEqual(["diag"]);
  });

  it("resolves false when every path is unavailable (never rejects)", async () => {
    stubDomClipboard(false, null);
    await withBridge({ writeClipboard: () => Promise.resolve(false) }, async () => {
      await expect(writeClipboardText("diag")).resolves.toBe(false);
    });
    await withBridge(undefined, async () => {
      await expect(writeClipboardText("diag")).resolves.toBe(false);
    });
  });

  it("works with no bridge at all (unit-test context)", async () => {
    domCalls.length = 0;
    stubDomClipboard(true, null);
    await withBridge(undefined, async () => {
      await expect(writeClipboardText("plain")).resolves.toBe(true);
    });
    expect(domCalls).toEqual(["plain"]);
  });
});

describe("readClipboardText", () => {
  it("prefers the main-process bridge", async () => {
    stubDomClipboard(true, "from-dom");
    await withBridge({ readClipboard: () => Promise.resolve("from-main") }, async () => {
      await expect(readClipboardText()).resolves.toBe("from-main");
    });
  });

  it("falls back to the DOM API when the bridge fails", async () => {
    stubDomClipboard(true, "from-dom");
    await withBridge(
      { readClipboard: () => Promise.reject(new Error("no ipc")) },
      async () => {
        await expect(readClipboardText()).resolves.toBe("from-dom");
      },
    );
  });

  it("resolves null when nothing is readable", async () => {
    stubDomClipboard(false, null);
    await withBridge(undefined, async () => {
      await expect(readClipboardText()).resolves.toBeNull();
    });
  });
});
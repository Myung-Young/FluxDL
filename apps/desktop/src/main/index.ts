import { app, BrowserWindow, Menu, Tray, nativeImage, protocol, session, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME } from "@grabber/core/branding.js";
import { IPC_CHANNELS } from "@grabber/core/engine.js";
import { STRINGS, STRINGS_MS } from "@grabber/core/strings.js";
import type { AggregateProgressState } from "@grabber/core/engine.js";
import { extractDeepLinkTarget } from "@grabber/core/deeplink.js";
import { ensureUserDataBinary } from "./binaries.js";
import { DesktopEngine } from "./desktopEngine.js";
import { registerEngineIpc } from "./ipc.js";
import { resolveTaskbarCommand } from "./taskbar.js";
import { loadSettingsFromDisk } from "./persist.js";
import { boundsFor } from "@grabber/core/window.js";
import { colorsFor, createWindowChrome } from "./windowChrome.js";

// Native dialogs (window.confirm, showOpenDialog) title themselves with the
// app name. Without this they show the package.json name ("@grabber/desktop")
// instead of FluxDL. Must run before app.whenReady().
app.setName(APP_NAME);

// Single instance: a second launch (shortcut double-click, protocol URL,
// CLI arg) forwards to the running window instead of racing it on
// queue.json / settings.json / binary locks.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/** Deep-link URL captured before the window exists (boot arg / protocol). */
let bootLink: string | null = null;
/** Batch-file text + jump-list intents captured the same way. */
let bootBatch: string | null = null;
const bootMinimized = process.argv.includes("--minimized");
const bootOpenFolder = process.argv.includes("--open-downloads");
try {
  bootLink = extractDeepLinkTarget(process.argv);
} catch {
  bootLink = null;
}
try {
  bootBatch = extractBatchText(process.argv);
} catch {
  bootBatch = null;
}

function focusWindow(): void {
  if (mainWindow === null) {
    void createWindow();
  } else {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
}

/** Route an OS-provided URL to the UI (focus first, never lose it silently). */
function handleDeepLink(url: string): void {
  focusWindow();
  try {
    getEngine().emitDeepLink(url);
  } catch {
    // Engine creation failure is already fatal elsewhere; keep the focus.
  }
}

// Second instance: argv arrives here (Windows/Linux protocol + CLI args,
// jump-list tasks, associated files).
app.on("second-instance", (_event, argv) => {
  if (argv.includes("--open-downloads")) {
    openDownloadsFolder();
    return;
  }
  let batch: string | null = null;
  try {
    batch = extractBatchText(argv);
  } catch {
    batch = null;
  }
  if (batch !== null) {
    handleBatchText(batch);
    return;
  }
  let target: string | null = null;
  try {
    target = extractDeepLinkTarget(argv);
  } catch {
    target = null;
  }
  if (target !== null) handleDeepLink(target);
  else focusWindow();
});

// macOS protocol dispatch.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// macOS file-open (associated .fluxdl files).
app.on("open-file", (event, path) => {
  event.preventDefault();
  let batch: string | null = null;
  try {
    batch = extractBatchText([path]);
  } catch {
    batch = null;
  }
  if (batch !== null) handleBatchText(batch);
  else focusWindow();
});

let mainWindow: BrowserWindow | null = null;
let engine: DesktopEngine | null = null;
let tray: Tray | null = null;
let quitting = false;
/** Mini-mode chrome state (M4.4); owned here, mirrored to the renderer. */
const chrome = createWindowChrome({
  userDataDir: app.getPath("userData"),
  getWindow: () => mainWindow,
});
/** Tray menu handle, so the mini checkbox can follow renderer toggles. */
let trayMenu: Menu | null = null;
const MINI_MENU_ID = "mini-mode";

// Taskbar progress + tray tooltip (M1.5): renderer sends a throttled
// aggregate; error/overlay flags are window-local and clear on show/focus.
let aggState = { active: 0, percent: null as number | null };
let aggTooltip: string = APP_NAME;
let taskError = false;
let finishedHidden = false;
let overlayDot: Electron.NativeImage | null = null;

function overlayIconPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, "icons", "overlay-dot.png");
  return join(__dirname, "../../resources/icons/overlay-dot.png");
}

function taskStrings(): { newDownload: string; newDownloadDesc: string; openFolder: string; openFolderDesc: string } {
  try {
    return app.getLocale().toLowerCase().startsWith("ms") ? STRINGS_MS.tasks : STRINGS.tasks;
  } catch {
    return STRINGS.tasks;
  }
}

/** Windows taskbar Jump List: fresh-download + open-folder tasks (E4). */
function applyJumpList(): void {
  if (process.platform !== "win32") return;
  try {
    const t = taskStrings();
    app.setJumpList([
      {
        type: "tasks",
        items: [
          {
            type: "task",
            program: process.execPath,
            args: "--open-downloads",
            title: t.openFolder,
            description: t.openFolderDesc,
          },
          {
            type: "task",
            program: process.execPath,
            title: t.newDownload,
            description: t.newDownloadDesc,
          },
        ],
      },
    ]);
  } catch {
    // Best effort; a missing list never blocks boot.
  }
}

function openDownloadsFolder(): void {
  let dir = "";
  try {
    const saved = loadSettingsFromDisk(app.getPath("userData")).downloadDir;
    dir = saved.trim().length > 0 ? saved : app.getPath("downloads");
  } catch {
    dir = app.getPath("downloads");
  }
  focusWindow();
  void shell.openPath(dir).catch(() => undefined);
}

/**
 * Batch-file routing (E7): a `.fluxdl` links file opened from Explorer.
 * Capped at 1 MB of text; anything else is ignored (never executed).
 */
function extractBatchText(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const t = arg.trim().replace(/^["']|["']$/g, "");
    if (!/\.fluxdl(\.txt)?$/i.test(t) || !existsSync(t)) continue;
    try {
      if (statSync(t).size > 1024 * 1024) continue;
      const text = readFileSync(t, "utf8");
      if (text.trim().length > 0) return text;
    } catch {
      continue;
    }
  }
  return null;
}

function handleBatchText(text: string): void {
  focusWindow();
  try {
    getEngine().emitBatchLink(text);
  } catch {
    // Engine failure here is fatal elsewhere already.
  }
}

function refreshTaskbar(): void {
  if (mainWindow === null) return;
  // Taskbar badge mirrors the active count (E4).
  try {
    app.setBadgeCount(aggState.active);
  } catch {
    // Cosmetic only.
  }
  const cmd = resolveTaskbarCommand(
    aggState,
    { error: taskError, finishedHidden },
    aggTooltip,
  );
  mainWindow.setProgressBar(cmd.value, { mode: cmd.mode });
  if (cmd.overlay) {
    if (overlayDot === null) overlayDot = nativeImage.createFromPath(overlayIconPath());
    mainWindow.setOverlayIcon(overlayDot.isEmpty() ? null : overlayDot, "Downloads finished");
  } else {
    mainWindow.setOverlayIcon(null, "");
  }
  tray?.setToolTip(cmd.tooltip);
}

function clearTaskbarFlags(): void {
  taskError = false;
  finishedHidden = false;
  refreshTaskbar();
}

function bundledBinDir(): string {
  // Packaged: <resources>/bin (asarUnpack). Dev: apps/desktop/resources/bin.
  if (app.isPackaged) return join(process.resourcesPath, "bin");
  return join(__dirname, "../../resources/bin");
}

function iconPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, "icons", "tray.png");
  return join(__dirname, "../../resources/icons/tray.png");
}

function applyCsp(): void {
  // Belt-and-suspenders for the DOM clipboard path (the primary read path
  // is now main-side, but Ctrl+C / copy buttons still use the DOM API).
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      if (permission === "clipboard-read" || permission === "clipboard-sanitized-write") {
        callback(true);
        return;
      }
      callback(false);
    });
  } catch {
    // Permissions API unavailable — the main-side clipboard still works.
  }
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: media:; media-src 'self' data: media:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
        ],
      },
    });
  });
}

async function createWindow(): Promise<void> {
  // Read the persisted chrome first so a light theme never flashes dark
  // window chrome before the renderer sends its first update (M4.6).
  const state = await chrome.ready();
  const colors = colorsFor(state.theme);
  const size = boundsFor(state.mini);
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    // The layout is designed for the default 1120x760 window; fullscreen
    // maximize is disabled so the UI never stretches past its usable size.
    maximizable: false,
    ...(state.mini ? { alwaysOnTop: true } : {}),
    title: APP_NAME,
    backgroundColor: colors.bg,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: colors.bg,
      symbolColor: colors.fg,
      height: 44,
    },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  // Close behavior is a setting: "tray" hides (downloads continue),
  // "quit" terminates. Minimize-to-tray is a separate opt-in setting.
  win.on("close", (event) => {
    if (quitting) return;
    // Default quit: only an explicit "tray" choice hides the window.
    let behavior = "quit";
    try {
      behavior = loadSettingsFromDisk(app.getPath("userData")).closeBehavior;
    } catch {
      behavior = "quit";
    }
    if (behavior === "quit") {
      // Closing the last window does NOT quit a tray app by itself, so
      // before-quit (graceful teardown) would never run. Drive it here.
      quitting = true;
      event.preventDefault();
      app.quit();
      return;
    }
    event.preventDefault();
    win.hide();
  });
  win.on("minimize", () => {
    let toTray = false;
    try {
      toTray = loadSettingsFromDisk(app.getPath("userData")).minimizeToTray;
    } catch {
      toTray = false;
    }
    if (toTray) win.hide();
  });
  // Error/overlay flags clear when the window is shown again.
  win.on("show", () => {
    clearTaskbarFlags();
  });
  win.on("focus", () => {
    clearTaskbarFlags();
  });

  if (process.env["ELECTRON_RENDERER_URL"] !== undefined) {
    await win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    await win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  // Deliver boot-time links once the renderer can receive them.
  win.webContents.on("did-finish-load", () => {
    if (bootLink !== null) {
      const url = bootLink;
      bootLink = null;
      try {
        getEngine().emitDeepLink(url);
      } catch {
        // Engine failure here is fatal elsewhere already.
      }
    }
    if (bootBatch !== null) {
      const text = bootBatch;
      bootBatch = null;
      try {
        getEngine().emitBatchLink(text);
      } catch {
        // Engine failure here is fatal elsewhere already.
      }
    }
  });
  // Auto-start boots straight into the tray (E5).
  if (bootMinimized) win.hide();
}

function setupTray(): void {
  if (tray !== null) return;
  const image = nativeImage.createFromPath(iconPath());
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip(APP_NAME);
  trayMenu = Menu.buildFromTemplate([
      {
        label: "Show",
        click: () => {
          if (mainWindow === null) {
            void createWindow();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        id: MINI_MENU_ID,
        label: "Mini mode",
        type: "checkbox",
        checked: chrome.current().mini,
        click: (item) => {
          // Tray-driven toggle: apply in main, then push to the renderer so
          // the layout follows (and the checkbox stays in sync).
          void chrome
            .apply({ mini: item.checked, theme: chrome.current().theme })
            .catch(() => undefined);
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]);
  tray.setContextMenu(trayMenu);
  tray.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  // Keep the tray checkbox in sync with renderer-driven toggles.
  chrome.subscribe((state) => {
    const item = trayMenu?.getMenuItemById(MINI_MENU_ID) ?? null;
    if (item !== null) item.checked = state.mini;
  });
}

function getEngine(): DesktopEngine {
  if (engine === null) {
    engine = new DesktopEngine({
      userDataDir: app.getPath("userData"),
      bundledBinDir: bundledBinDir(),
      appVersion: app.getVersion(),
      defaultOutputDir: app.getPath("downloads"),
      broadcastDeepLink: (url) => {
        mainWindow?.webContents.send(IPC_CHANNELS.onDeepLink, url);
      },
      broadcastBatchLink: (text) => {
        mainWindow?.webContents.send(IPC_CHANNELS.onBatchLink, text);
      },
      broadcast: (event) => {
        mainWindow?.webContents.send(IPC_CHANNELS.onProgress, event);
        if (event.stage === "error") taskError = true;
        if (event.stage === "done" && (mainWindow === null || !mainWindow.isVisible())) {
          finishedHidden = true;
        }
        refreshTaskbar();
      },
      onAggregate: (state: AggregateProgressState) => {
        aggState = { active: state.active, percent: state.percent };
        aggTooltip = state.tooltip;
        refreshTaskbar();
      },
      chrome: {
        apply: (state) => chrome.apply(state),
        subscribe: (cb) => chrome.subscribe(cb),
      },
    });
    registerEngineIpc(engine);
    // Mini mode may also be toggled from the tray, so mirror chrome to the UI.
    chrome.subscribe((state) => {
      mainWindow?.webContents.send(IPC_CHANNELS.onWindowChrome, state);
    });
  }
  return engine;
}

/**
 * Update completion note: when the running version differs from the last
 * recorded one, the new version is confirmed alive — so leave the .txt
 * proof in the download folder, then record the marker. First runs and
 * same-version boots only record. Never breaks boot.
 */
function maybeWriteUpdateNote(): void {
  try {
    const userData = app.getPath("userData");
    const marker = join(userData, "last-version.txt");
    const cur = app.getVersion();
    let prev: string | null = null;
    try {
      prev = readFileSync(marker, "utf8").trim() || null;
    } catch {
      prev = null;
    }
    try {
      writeFileSync(marker, `${cur}\n`, "utf8");
    } catch {
      return;
    }
    if (prev === null || prev === cur) return;
    let dir = app.getPath("downloads");
    try {
      const saved = loadSettingsFromDisk(userData).downloadDir;
      if (saved.trim().length > 0) dir = saved;
    } catch {
      // Default stands.
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const body =
      `FluxDL updated to v${cur} on ${stamp}.\n` +
      "The update installed successfully and this version is now running.\n" +
      "See the in-app Changelog tab for what's new.\n";
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `FluxDL-updated-to-${cur}.txt`), body, "utf8");
    } catch {
      // Best effort.
    }
  } catch {
    // Never break boot.
  }
}

void app.whenReady().then(() => {
  applyCsp();
  maybeWriteUpdateNote();
  // In-app preview serves allowlisted download outputs over media://
  // (never file://). Unknown/forbidden paths resolve to HTTP errors.
  protocol.handle("media", async (request) => {
    try {
      const served = await getEngine().serveMediaRequest(request.url);
      if (served === null) return new Response("Forbidden", { status: 403 });
      // Buffer is a Uint8Array at runtime (accepted body); the DOM lib
      // types do not know that, hence the narrow cast (no `any` involved).
      const body = served.body as unknown as BodyInit;
      return new Response(body, {
        headers: { "Content-Type": served.mime },
      });
    } catch {
      return new Response("Internal error", { status: 500 });
    }
  });
  // fluxdl:// protocol (Windows registry). Dev builds skip this so the
  // local electron.exe is not registered as the handler.
  if (app.isPackaged) {
    try {
      app.setAsDefaultProtocolClient("fluxdl");
    } catch {
      // Best effort; protocol links still work via CLI args.
    }
  }
  getEngine();
  setupTray();
  applyJumpList();
  try {
    getEngine().syncLoginSettings();
  } catch {
    // Best effort; the setting itself persists regardless.
  }
  void ensureUserDataBinary(app.getPath("userData"), bundledBinDir()).catch((err: unknown) => {
    // Non-fatal: engine falls back to bundled/PATH copies.
    console.warn("[binaries] userData copy skipped:", err instanceof Error ? err.message : err);
  });
  void createWindow();
  if (bootOpenFolder) openDownloadsFolder();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

// Ghost-tray fix: Windows keeps a dead tray icon painted until the next
// mouse-over when the process exits without destroying it (kill, crash, or
// a quit path that never runs cleanup). Destroying on will-quit covers every
// real exit; nothing can resurrect the icon afterwards.
app.on("will-quit", () => {
  try {
    tray?.destroy();
  } catch {
    // Already gone — nothing to do.
  }
  tray = null;
  trayMenu = null;
});

let shuttingDown = false;
app.on("before-quit", (event) => {
  quitting = true;
  if (shuttingDown) return;
  // Graceful teardown: give yt-dlp/ffmpeg children a moment to die while
  // .part files stay resumable. Never block quit for more than 3 s.
  event.preventDefault();
  void (async () => {
    shuttingDown = true;
    try {
      await Promise.race([
        engine?.shutdown() ?? Promise.resolve(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } finally {
      app.quit();
    }
  })();
});

// Tray owns the lifetime: closing the window hides it (downloads continue).
app.on("window-all-closed", () => {
  if (process.platform === "darwin" && quitting) {
    app.quit();
  }
});

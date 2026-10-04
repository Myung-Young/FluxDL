import { app, BrowserWindow, Menu, Tray, nativeImage, protocol, session } from "electron";
import { join } from "node:path";
import { APP_NAME } from "@grabber/core/branding.js";
import { IPC_CHANNELS } from "@grabber/core/engine.js";
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
try {
  bootLink = extractDeepLinkTarget(process.argv);
} catch {
  bootLink = null;
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

// Second instance: argv arrives here (Windows/Linux protocol + CLI args).
app.on("second-instance", (_event, argv) => {
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

function refreshTaskbar(): void {
  if (mainWindow === null) return;
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
    let behavior = "tray";
    try {
      behavior = loadSettingsFromDisk(app.getPath("userData")).closeBehavior;
    } catch {
      behavior = "tray";
    }
    if (behavior === "quit") {
      quitting = true;
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
  // Deliver a boot-time deep link once the renderer can receive it.
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
  });
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

void app.whenReady().then(() => {
  applyCsp();
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
  void ensureUserDataBinary(app.getPath("userData"), bundledBinDir()).catch((err: unknown) => {
    // Non-fatal: engine falls back to bundled/PATH copies.
    console.warn("[binaries] userData copy skipped:", err instanceof Error ? err.message : err);
  });
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    } else {
      mainWindow?.show();
    }
  });
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

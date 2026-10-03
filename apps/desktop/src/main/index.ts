import { app, BrowserWindow, Menu, Tray, nativeImage, session } from "electron";
import { join } from "node:path";
import { APP_NAME } from "@grabber/core/branding.js";
import { IPC_CHANNELS } from "@grabber/core/engine.js";
import type { AggregateProgressState } from "@grabber/core/engine.js";
import { ensureUserDataBinary } from "./binaries.js";
import { DesktopEngine } from "./desktopEngine.js";
import { registerEngineIpc } from "./ipc.js";
import { resolveTaskbarCommand } from "./taskbar.js";
import { createWindowChrome } from "./windowChrome.js";

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
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
        ],
      },
    });
  });
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    title: APP_NAME,
    backgroundColor: "#0a0a0b",
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0a0a0b",
      symbolColor: "#f4f4f5",
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
  // Keep downloads alive in the tray instead of quitting on close.
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
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

app.on("before-quit", () => {
  quitting = true;
});

// Tray owns the lifetime: closing the window hides it (downloads continue).
app.on("window-all-closed", () => {
  if (process.platform === "darwin" && quitting) {
    app.quit();
  }
});

import { app, BrowserWindow, Menu, Tray, nativeImage, session } from "electron";
import { join } from "node:path";
import { APP_NAME } from "@grabber/core/branding.js";
import { IPC_CHANNELS } from "@grabber/core/engine.js";
import { ensureUserDataBinary } from "./binaries.js";
import { DesktopEngine } from "./desktopEngine.js";
import { registerEngineIpc } from "./ipc.js";

let mainWindow: BrowserWindow | null = null;
let engine: DesktopEngine | null = null;
let tray: Tray | null = null;
let quitting = false;

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
  tray.setContextMenu(
    Menu.buildFromTemplate([
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
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => {
    mainWindow?.show();
    mainWindow?.focus();
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
      },
    });
    registerEngineIpc(engine);
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

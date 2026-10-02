import { app, BrowserWindow, session } from "electron";
import { join } from "node:path";
import { IPC_CHANNELS } from "@grabber/core";
import { ensureUserDataBinary } from "./binaries.js";
import { DesktopEngine } from "./desktopEngine.js";
import { registerEngineIpc } from "./ipc.js";

let mainWindow: BrowserWindow | null = null;
let engine: DesktopEngine | null = null;

function bundledBinDir(): string {
  // Packaged: <resources>/bin (asarUnpack). Dev: apps/desktop/resources/bin.
  if (app.isPackaged) return join(process.resourcesPath, "bin");
  return join(__dirname, "../../resources/bin");
}

function applyCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
        ],
      },
    });
  });
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    backgroundColor: "#0a0a0b",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (process.env["ELECTRON_RENDERER_URL"] !== undefined) {
    await win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    await win.loadFile(join(__dirname, "../renderer/index.html"));
  }
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
  void ensureUserDataBinary(app.getPath("userData"), bundledBinDir()).catch((err: unknown) => {
    // Non-fatal: engine falls back to bundled/PATH copies.
    console.warn("[binaries] userData copy skipped:", err instanceof Error ? err.message : err);
  });
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

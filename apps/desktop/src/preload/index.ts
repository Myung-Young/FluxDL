import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import { IPC_CHANNELS } from "@grabber/core/engine.js";
import type { AppSettings, DownloadJob, DownloadJobInput, MediaInfo } from "@grabber/core/types.js";
import type {
  EngineProgress,
  EngineVersions,
  ProgressCallback,
  Unsubscribe,
} from "@grabber/core/engine.js";

/**
 * Typed preload bridge. Single channel map lives in core (IPC_CHANNELS).
 * Renderer talks to DownloadEngine through `window.grabber` only.
 */
export interface GrabberApi {
  getInfo(url: string): Promise<MediaInfo>;
  start(job: DownloadJobInput): Promise<string>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  onProgress(cb: ProgressCallback): Unsubscribe;
  getEngineVersion(): Promise<EngineVersions>;
  updateEngine(): Promise<EngineVersions>;
  pickFolder(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  revealInFolder(path: string): Promise<void>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  loadQueue(): Promise<DownloadJob[]>;
  saveQueue(jobs: DownloadJob[]): Promise<void>;
  appendHistory(job: DownloadJob): Promise<void>;
  loadHistory(): Promise<DownloadJob[]>;
  removeHistory(id: string): Promise<void>;
  clearHistory(): Promise<void>;
}

const api: GrabberApi = {
  getInfo: (url) => ipcRenderer.invoke(IPC_CHANNELS.getInfo, url) as Promise<MediaInfo>,
  start: (job) => ipcRenderer.invoke(IPC_CHANNELS.start, job) as Promise<string>,
  pause: (id) => ipcRenderer.invoke(IPC_CHANNELS.pause, id) as Promise<void>,
  resume: (id) => ipcRenderer.invoke(IPC_CHANNELS.resume, id) as Promise<void>,
  cancel: (id) => ipcRenderer.invoke(IPC_CHANNELS.cancel, id) as Promise<void>,
  onProgress: (cb) => {
    const listener = (_event: IpcRendererEvent, value: EngineProgress): void => {
      cb(value);
    };
    ipcRenderer.on(IPC_CHANNELS.onProgress, listener);
    const unsubscribe: Unsubscribe = () => {
      ipcRenderer.removeListener(IPC_CHANNELS.onProgress, listener);
    };
    return unsubscribe;
  },
  getEngineVersion: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getEngineVersion) as Promise<EngineVersions>,
  updateEngine: () => ipcRenderer.invoke(IPC_CHANNELS.updateEngine) as Promise<EngineVersions>,
  pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.pickFolder) as Promise<string | null>,
  openPath: (path) => ipcRenderer.invoke(IPC_CHANNELS.openPath, path) as Promise<void>,
  revealInFolder: (path) => ipcRenderer.invoke(IPC_CHANNELS.revealInFolder, path) as Promise<void>,
  loadSettings: () => ipcRenderer.invoke(IPC_CHANNELS.loadSettings) as Promise<AppSettings>,
  saveSettings: (patch) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveSettings, patch) as Promise<AppSettings>,
  loadQueue: () => ipcRenderer.invoke(IPC_CHANNELS.loadQueue) as Promise<DownloadJob[]>,
  saveQueue: (jobs) => ipcRenderer.invoke(IPC_CHANNELS.saveQueue, jobs) as Promise<void>,
  appendHistory: (job) => ipcRenderer.invoke(IPC_CHANNELS.appendHistory, job) as Promise<void>,
  loadHistory: () => ipcRenderer.invoke(IPC_CHANNELS.loadHistory) as Promise<DownloadJob[]>,
  removeHistory: (id) => ipcRenderer.invoke(IPC_CHANNELS.removeHistory, id) as Promise<void>,
  clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.clearHistory) as Promise<void>,
};
contextBridge.exposeInMainWorld("grabber", api);

declare global {
  interface Window {
    readonly grabber: GrabberApi;
  }
}

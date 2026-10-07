import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import { IPC_CHANNELS } from "@grabber/core/engine.js";
import type {
  AppSettings,
  DownloadJob,
  DownloadJobInput,
  MediaInfo,
  WatchChannel,
} from "@grabber/core/types.js";
import type {
  AggregateProgressState,
  DeepLinkCallback,
  DoctorReport,
  EngineProgress,
  EngineVersions,
  GetInfoInit,
  ProgressCallback,
  RepairReport,
  StorageInsights,
  UpdateDownloadProgress,
  ThumbnailColor,
  Unsubscribe,
  UpdateStatus,
  WindowChromeListener,
  WindowChromeState,
} from "@grabber/core/engine.js";

/**
 * Typed preload bridge. Single channel map lives in core (IPC_CHANNELS).
 * Renderer talks to DownloadEngine through `window.grabber` only.
 */
export interface GrabberApi {
  getInfo(url: string, init?: GetInfoInit): Promise<MediaInfo>;
  cancelAnalyze(requestId: string): Promise<void>;
  start(job: DownloadJobInput): Promise<string>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  onProgress(cb: ProgressCallback): Unsubscribe;
  getEngineVersion(): Promise<EngineVersions>;
  updateEngine(): Promise<EngineVersions>;
  repairEngine(): Promise<RepairReport>;
  rollbackTool(toolId: string): Promise<boolean>;
  reinstallTool(toolId: string): Promise<EngineVersions>;
  runDoctor(): Promise<DoctorReport>;
  setAggregateProgress(state: AggregateProgressState): Promise<void>;
  applyWindowChrome(state: WindowChromeState): Promise<void>;
  onWindowChrome(cb: WindowChromeListener): Unsubscribe;
  getThumbnailColor(url: string): Promise<ThumbnailColor | null>;
  pickFolder(): Promise<string | null>;
  pickFile(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  revealInFolder(path: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  fileExistsBulk(paths: string[]): Promise<boolean[]>;
  fileSizesBulk(paths: string[]): Promise<Array<number | null>>;
  archiveHas(keys: string[]): Promise<boolean[]>;
  trashFile(path: string): Promise<void>;
  updateHistory(job: DownloadJob): Promise<void>;
  clearArchive(): Promise<void>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  loadQueue(): Promise<DownloadJob[]>;
  saveQueue(jobs: DownloadJob[]): Promise<void>;
  appendHistory(job: DownloadJob): Promise<void>;
  loadHistory(): Promise<DownloadJob[]>;
  removeHistory(id: string): Promise<void>;
  clearHistory(): Promise<void>;
  restoreHistory(jobs: DownloadJob[]): Promise<void>;
  loadWatchlist(): Promise<WatchChannel[]>;
  saveWatchlist(channels: WatchChannel[]): Promise<void>;
  getDiskSpace(path: string): Promise<{ freeBytes: number } | null>;
  getJobArgs(id: string): Promise<string[] | null>;
  getStorageInsights(): Promise<StorageInsights>;
  getRawLog(id: string): Promise<string | null>;
  onDeepLink(cb: DeepLinkCallback): Unsubscribe;
  onBatchLink(cb: DeepLinkCallback): Unsubscribe;
  readClipboard(): Promise<string | null>;
  writeClipboard(text: string): Promise<boolean>;
  checkForUpdates(force?: boolean): Promise<UpdateStatus>;
  startUpdateDownload(): Promise<void>;
  getUpdateDownloadProgress(): Promise<UpdateDownloadProgress>;
  cancelUpdateDownload(): Promise<void>;
  getMediaUrl(path: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
}

const api: GrabberApi = {
  getInfo: (url, init) =>
    ipcRenderer.invoke(IPC_CHANNELS.getInfo, url, init) as Promise<MediaInfo>,
  cancelAnalyze: (requestId) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelAnalyze, requestId) as Promise<void>,
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
  repairEngine: () => ipcRenderer.invoke(IPC_CHANNELS.repairEngine) as Promise<RepairReport>,
  rollbackTool: (toolId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.rollbackTool, toolId) as Promise<boolean>,
  reinstallTool: (toolId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.reinstallTool, toolId) as Promise<EngineVersions>,
  runDoctor: () => ipcRenderer.invoke(IPC_CHANNELS.runDoctor) as Promise<DoctorReport>,
  setAggregateProgress: (state: AggregateProgressState) =>
    ipcRenderer.invoke(IPC_CHANNELS.setAggregateProgress, state) as Promise<void>,
  applyWindowChrome: (state: WindowChromeState) =>
    ipcRenderer.invoke(IPC_CHANNELS.applyWindowChrome, state) as Promise<void>,
  onWindowChrome: (cb) => {
    const listener = (_event: IpcRendererEvent, value: WindowChromeState): void => {
      cb(value);
    };
    ipcRenderer.on(IPC_CHANNELS.onWindowChrome, listener);
    const unsubscribe: Unsubscribe = () => {
      ipcRenderer.removeListener(IPC_CHANNELS.onWindowChrome, listener);
    };
    return unsubscribe;
  },
  getThumbnailColor: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getThumbnailColor, url) as Promise<ThumbnailColor | null>,
  pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.pickFolder) as Promise<string | null>,
  pickFile: () => ipcRenderer.invoke(IPC_CHANNELS.pickFile) as Promise<string | null>,
  openPath: (path) => ipcRenderer.invoke(IPC_CHANNELS.openPath, path) as Promise<void>,
  revealInFolder: (path) => ipcRenderer.invoke(IPC_CHANNELS.revealInFolder, path) as Promise<void>,
  fileExists: (path) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileExists, path) as Promise<boolean>,
  fileExistsBulk: (paths) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileExistsBulk, paths) as Promise<boolean[]>,
  fileSizesBulk: (paths) =>
    ipcRenderer.invoke(IPC_CHANNELS.fileSizesBulk, paths) as Promise<Array<number | null>>,
  archiveHas: (keys) =>
    ipcRenderer.invoke(IPC_CHANNELS.archiveHas, keys) as Promise<boolean[]>,
  trashFile: (path) => ipcRenderer.invoke(IPC_CHANNELS.trashFile, path) as Promise<void>,
  updateHistory: (job) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateHistory, job) as Promise<void>,
  clearArchive: () => ipcRenderer.invoke(IPC_CHANNELS.clearArchive) as Promise<void>,
  loadSettings: () => ipcRenderer.invoke(IPC_CHANNELS.loadSettings) as Promise<AppSettings>,
  saveSettings: (patch) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveSettings, patch) as Promise<AppSettings>,
  loadQueue: () => ipcRenderer.invoke(IPC_CHANNELS.loadQueue) as Promise<DownloadJob[]>,
  saveQueue: (jobs) => ipcRenderer.invoke(IPC_CHANNELS.saveQueue, jobs) as Promise<void>,
  appendHistory: (job) => ipcRenderer.invoke(IPC_CHANNELS.appendHistory, job) as Promise<void>,
  loadHistory: () => ipcRenderer.invoke(IPC_CHANNELS.loadHistory) as Promise<DownloadJob[]>,
  removeHistory: (id) => ipcRenderer.invoke(IPC_CHANNELS.removeHistory, id) as Promise<void>,
  clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.clearHistory) as Promise<void>,
  restoreHistory: (jobs) =>
    ipcRenderer.invoke(IPC_CHANNELS.restoreHistory, jobs) as Promise<void>,
  loadWatchlist: () =>
    ipcRenderer.invoke(IPC_CHANNELS.loadWatchlist) as Promise<WatchChannel[]>,
  saveWatchlist: (channels) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveWatchlist, channels) as Promise<void>,
  getDiskSpace: (path) =>
    ipcRenderer.invoke(IPC_CHANNELS.getDiskSpace, path) as Promise<{ freeBytes: number } | null>,
  getJobArgs: (id) =>
    ipcRenderer.invoke(IPC_CHANNELS.getJobArgs, id) as Promise<string[] | null>,
  getStorageInsights: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getStorageInsights) as Promise<StorageInsights>,
  readClipboard: () => ipcRenderer.invoke(IPC_CHANNELS.readClipboard) as Promise<string | null>,
  writeClipboard: (text) =>
    ipcRenderer.invoke(IPC_CHANNELS.writeClipboard, text) as Promise<boolean>,
  getRawLog: (id) => ipcRenderer.invoke(IPC_CHANNELS.getRawLog, id) as Promise<string | null>,
  onDeepLink: (cb) => {
    const listener = (_event: IpcRendererEvent, url: string): void => {
      if (typeof url === "string") cb(url);
    };
    ipcRenderer.on(IPC_CHANNELS.onDeepLink, listener);
    const unsubscribe: Unsubscribe = () => {
      ipcRenderer.removeListener(IPC_CHANNELS.onDeepLink, listener);
    };
    return unsubscribe;
  },
  onBatchLink: (cb) => {
    const listener = (_event: IpcRendererEvent, text: string): void => {
      if (typeof text === "string") cb(text);
    };
    ipcRenderer.on(IPC_CHANNELS.onBatchLink, listener);
    const unsubscribe: Unsubscribe = () => {
      ipcRenderer.removeListener(IPC_CHANNELS.onBatchLink, listener);
    };
    return unsubscribe;
  },
  checkForUpdates: (force?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates, force) as Promise<UpdateStatus>,
  startUpdateDownload: () =>
    ipcRenderer.invoke(IPC_CHANNELS.startUpdateDownload) as Promise<void>,
  getUpdateDownloadProgress: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getUpdateDownloadProgress) as Promise<UpdateDownloadProgress>,
  cancelUpdateDownload: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelUpdateDownload) as Promise<void>,
  getMediaUrl: (path) =>
    ipcRenderer.invoke(IPC_CHANNELS.getMediaUrl, path) as Promise<string | null>,
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url) as Promise<void>,
};
contextBridge.exposeInMainWorld("grabber", api);

declare global {
  interface Window {
    readonly grabber: GrabberApi;
  }
}

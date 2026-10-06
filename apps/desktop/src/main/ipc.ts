import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@grabber/core/engine.js";
import { normalizeUrl } from "@grabber/core/url.js";
import type {
  AudioPreset,
  Container,
  DownloadJobInput,
  LiveStatus,
  VideoPreset,
  WatchChannel,
} from "@grabber/core/types.js";
import {
  AUDIO_PRESETS,
  CONTAINERS,
  LIVE_STATUSES,
  VIDEO_PRESETS,
} from "@grabber/core/types.js";
import { isAudioMetadata, normalizeAudioMetadata } from "@grabber/core/metadata.js";
import type { DesktopEngine } from "./desktopEngine.js";
import { isDownloadJob } from "./persist.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseJobInput(raw: unknown): DownloadJobInput {
  if (!isRecord(raw)) throw new Error("Invalid job payload.");
  const urlRaw = asNonEmptyString(raw["url"]);
  const titleRaw = typeof raw["title"] === "string" ? raw["title"] : "";
  const outputDirRaw = typeof raw["outputDir"] === "string" ? raw["outputDir"] : "";
  if (urlRaw === null) throw new Error("Job is missing a URL.");
  const url = normalizeUrl(urlRaw);
  if (!isRecord(raw["preset"])) throw new Error("Job is missing a preset.");  const presetRaw = raw["preset"];
  const kind = presetRaw["kind"];
  const videoPreset = presetRaw["videoPreset"];
  const audioPreset = presetRaw["audioPreset"];
  const rawFormat =
    typeof presetRaw["rawFormat"] === "string" || presetRaw["rawFormat"] === null
      ? presetRaw["rawFormat"]
      : null;
  // v1.7.2: per-job container override. Only values the bundled yt-dlp accepts
  // are forwarded; an unknown one aborts the download, so it is dropped here
  // and the global setting applies instead.
  const containerRaw = presetRaw["container"];
  const containerLower =
    typeof containerRaw === "string" ? containerRaw.trim().toLowerCase() : "";
  const container = CONTAINERS.includes(containerLower as Container)
    ? (containerLower as Container)
    : null;
  if (kind !== "video" && kind !== "audio") throw new Error("Invalid preset kind.");
  if (!VIDEO_PRESETS.includes(videoPreset as VideoPreset)) {
    throw new Error("Invalid video preset.");
  }
  if (!AUDIO_PRESETS.includes(audioPreset as AudioPreset)) {
    throw new Error("Invalid audio preset.");
  }
  const liveRaw = raw["liveStatus"];
  const liveStatus =
    typeof liveRaw === "string" && LIVE_STATUSES.includes(liveRaw as LiveStatus)
      ? (liveRaw as LiveStatus)
      : null;
  return {
    url,
    title: titleRaw,
    preset: {
      kind,
      videoPreset: videoPreset as VideoPreset,
      audioPreset: audioPreset as AudioPreset,
      rawFormat,
      ...(container !== null ? { container } : {}),
    },
    outputDir: outputDirRaw,
    ...(raw["useArchive"] === true ? { useArchive: true as const } : {}),
    ...(typeof raw["extractor"] === "string" && raw["extractor"].length > 0
      ? { extractor: raw["extractor"] }
      : {}),
    ...(typeof raw["videoId"] === "string" && raw["videoId"].length > 0
      ? { videoId: raw["videoId"] }
      : {}),
    ...(typeof raw["cookiesFromBrowser"] === "string" && raw["cookiesFromBrowser"].length > 0
      ? { cookiesFromBrowser: raw["cookiesFromBrowser"] }
      : {}),
    ...(typeof raw["playlistSubdir"] === "string" && raw["playlistSubdir"].length > 0
      ? { playlistSubdir: raw["playlistSubdir"] }
      : {}),
    // Live + chapter flags (M4.1/M4.2). Invalid values are dropped rather
    // than thrown: the UI owns these toggles, and a stale payload must not
    // fail an otherwise valid download.
    ...(liveStatus !== null ? { liveStatus } : {}),
    ...(raw["liveFromStart"] === true ? { liveFromStart: true as const } : {}),
    ...(raw["waitForVideo"] === true ? { waitForVideo: true as const } : {}),
    ...(raw["splitChapters"] === true ? { splitChapters: true as const } : {}),
    ...(raw["forceOverwrite"] === true ? { forceOverwrite: true as const } : {}),
    ...(typeof raw["startAfter"] === "number" && Number.isFinite(raw["startAfter"])
      ? { startAfter: raw["startAfter"] }
      : {}),
    ...(raw["pinned"] === true ? { pinned: true as const } : {}),
    // Audio tag overrides (M4.3): rebuilt from primitives, never trusted.
    ...(isAudioMetadata(raw["audioMetadata"])
      ? { audioMetadata: normalizeAudioMetadata(raw["audioMetadata"]) }
      : {}),
  };
}

/** Wire typed IPC handlers (single channel map from core) to the engine. */
export function registerEngineIpc(engine: DesktopEngine): void {
  ipcMain.handle(IPC_CHANNELS.getInfo, async (_event, rawUrl: unknown, rawInit: unknown) => {
    const urlRaw = asNonEmptyString(rawUrl);
    if (urlRaw === null) throw new Error("Missing URL.");
    let requestId: string | undefined;
    if (isRecord(rawInit) && typeof rawInit["requestId"] === "string") {
      requestId = rawInit["requestId"];
    }
    return engine.getInfo(
      normalizeUrl(urlRaw),
      requestId === undefined ? undefined : { requestId },
    );
  });
  ipcMain.handle(IPC_CHANNELS.cancelAnalyze, async (_event, rawId: unknown) => {
    const id = asNonEmptyString(rawId);
    if (id === null) throw new Error("Missing request id.");
    await engine.cancelAnalyze(id);
  });
  ipcMain.handle(IPC_CHANNELS.start, async (_event, rawJob: unknown) => {
    return engine.start(parseJobInput(rawJob));
  });
  ipcMain.handle(IPC_CHANNELS.pause, async (_event, rawId: unknown) => {
    const id = asNonEmptyString(rawId);
    if (id === null) throw new Error("Missing job id.");
    await engine.pause(id);
  });
  ipcMain.handle(IPC_CHANNELS.resume, async (_event, rawId: unknown) => {
    const id = asNonEmptyString(rawId);
    if (id === null) throw new Error("Missing job id.");
    await engine.resume(id);
  });
  ipcMain.handle(IPC_CHANNELS.cancel, async (_event, rawId: unknown) => {
    const id = asNonEmptyString(rawId);
    if (id === null) throw new Error("Missing job id.");
    await engine.cancel(id);
  });
  ipcMain.handle(IPC_CHANNELS.getEngineVersion, async () => {
    return engine.getEngineVersion();
  });
  ipcMain.handle(IPC_CHANNELS.updateEngine, async () => {
    return engine.updateEngine();
  });
  ipcMain.handle(IPC_CHANNELS.repairEngine, async () => {
    return engine.repairEngine();
  });
  ipcMain.handle(IPC_CHANNELS.setAggregateProgress, async (_event, raw: unknown) => {
    if (!isRecord(raw)) throw new Error("Invalid aggregate state.");
    const active = typeof raw["active"] === "number" ? raw["active"] : 0;
    const percentRaw = raw["percent"];
    const percent = percentRaw === null || typeof percentRaw === "number" ? percentRaw : null;
    const tooltip = typeof raw["tooltip"] === "string" ? raw["tooltip"] : "";
    await engine.setAggregateProgress({ active, percent, tooltip });
  });
  ipcMain.handle(IPC_CHANNELS.applyWindowChrome, async (_event, raw: unknown) => {
    if (!isRecord(raw)) throw new Error("Invalid window chrome state.");
    const theme = typeof raw["theme"] === "string" ? raw["theme"].slice(0, 32) : "obsidian";
    await engine.applyWindowChrome({ mini: raw["mini"] === true, theme });
  });
  ipcMain.handle(IPC_CHANNELS.getThumbnailColor, async (_event, rawUrl: unknown) => {
    const urlRaw = asNonEmptyString(rawUrl);
    if (urlRaw === null) throw new Error("Missing URL.");
    return engine.getThumbnailColor(urlRaw);
  });
  ipcMain.handle(IPC_CHANNELS.pickFolder, async () => {
    return engine.pickFolder();
  });
  ipcMain.handle(IPC_CHANNELS.pickFile, async () => {
    return engine.pickFile();
  });
  ipcMain.handle(IPC_CHANNELS.openPath, async (_event, rawPath: unknown) => {
    const p = asNonEmptyString(rawPath);
    if (p === null) throw new Error("Missing path.");
    await engine.openPath(p);
  });
  ipcMain.handle(IPC_CHANNELS.revealInFolder, async (_event, rawPath: unknown) => {
    const p = asNonEmptyString(rawPath);
    if (p === null) throw new Error("Missing path.");
    await engine.revealInFolder(p);
  });
  ipcMain.handle(IPC_CHANNELS.fileExists, async (_event, rawPath: unknown) => {
    const p = asNonEmptyString(rawPath);
    if (p === null) throw new Error("Missing path.");
    return engine.fileExists(p);
  });
  ipcMain.handle(IPC_CHANNELS.fileExistsBulk, async (_event, rawPaths: unknown) => {
    if (!Array.isArray(rawPaths)) throw new Error("Invalid paths.");
    return engine.fileExistsBulk(rawPaths.filter((p): p is string => typeof p === "string"));
  });
  ipcMain.handle(IPC_CHANNELS.fileSizesBulk, async (_event, rawPaths: unknown) => {
    if (!Array.isArray(rawPaths)) throw new Error("Invalid paths.");
    return engine.fileSizesBulk(rawPaths.filter((p): p is string => typeof p === "string"));
  });
  ipcMain.handle(IPC_CHANNELS.archiveHas, async (_event, rawKeys: unknown) => {
    if (!Array.isArray(rawKeys)) throw new Error("Invalid keys.");
    return engine.archiveHas(rawKeys.filter((k): k is string => typeof k === "string"));
  });
  ipcMain.handle(IPC_CHANNELS.trashFile, async (_event, rawPath: unknown) => {
    const p = asNonEmptyString(rawPath);
    if (p === null) throw new Error("Missing path.");
    await engine.trashFile(p);
  });
  ipcMain.handle(IPC_CHANNELS.updateHistory, async (_event, job: unknown) => {
    if (!isDownloadJob(job)) throw new Error("Invalid history entry.");
    await engine.updateHistory(job);
  });
  ipcMain.handle(IPC_CHANNELS.clearArchive, async () => {
    await engine.clearArchive();
  });
  ipcMain.handle(IPC_CHANNELS.loadSettings, async () => {
    return engine.loadSettings();
  });
  ipcMain.handle(IPC_CHANNELS.saveSettings, async (_event, patch: unknown) => {
    if (!isRecord(patch)) throw new Error("Invalid settings patch.");
    const saved = await engine.saveSettings(patch);
    // Auto-start flips an OS registration, not just a JSON value (E5).
    if ("launchAtLogin" in patch) engine.syncLoginSettings();
    return saved;
  });
  ipcMain.handle(IPC_CHANNELS.loadQueue, async () => {
    return engine.loadQueue();
  });
  ipcMain.handle(IPC_CHANNELS.saveQueue, async (_event, jobs: unknown) => {
    if (!Array.isArray(jobs)) throw new Error("Invalid queue snapshot.");
    await engine.saveQueue(jobs.filter(isDownloadJob));
  });
  ipcMain.handle(IPC_CHANNELS.appendHistory, async (_event, job: unknown) => {
    if (!isDownloadJob(job)) throw new Error("Invalid history entry.");
    await engine.appendHistory(job);
  });
  ipcMain.handle(IPC_CHANNELS.loadHistory, async () => {
    return engine.loadHistory();
  });
  ipcMain.handle(IPC_CHANNELS.removeHistory, async (_event, rawId: unknown) => {
    const id = asNonEmptyString(rawId);
    if (id === null) throw new Error("Missing id.");
    await engine.removeHistory(id);
  });
  ipcMain.handle(IPC_CHANNELS.clearHistory, async () => {
    await engine.clearHistory();
  });
  ipcMain.handle(IPC_CHANNELS.restoreHistory, async (_event, jobs: unknown) => {
    if (!Array.isArray(jobs)) throw new Error("Invalid history snapshot.");
    await engine.restoreHistory(jobs.filter(isDownloadJob));
  });
  ipcMain.handle(IPC_CHANNELS.loadWatchlist, async () => {
    return engine.loadWatchlist();
  });
  ipcMain.handle(IPC_CHANNELS.getDiskSpace, async (_event, rawPath: unknown) => {
    const p = asNonEmptyString(rawPath);
    if (p === null) throw new Error("Missing path.");
    return engine.getDiskSpace(p);
  });
  ipcMain.handle(IPC_CHANNELS.getJobArgs, async (_event, rawId: unknown) => {
    const id = asNonEmptyString(rawId);
    if (id === null) throw new Error("Missing id.");
    return engine.getJobArgs(id);
  });
  ipcMain.handle(IPC_CHANNELS.getStorageInsights, async () => {
    return engine.getStorageInsights();
  });
  ipcMain.handle(IPC_CHANNELS.readClipboard, async () => {
    return engine.readClipboard();
  });
  ipcMain.handle(IPC_CHANNELS.writeClipboard, async (_event, rawText: unknown) => {
    if (typeof rawText !== "string") return false;
    // Clipboard payloads are logs/diagnostics: bounded so a runaway caller
    // cannot pin an unbounded string in the OS clipboard.
    return engine.writeClipboard(rawText.slice(0, 2_000_000));
  });
  ipcMain.handle(IPC_CHANNELS.saveWatchlist, async (_event, raw: unknown) => {
    if (!Array.isArray(raw)) throw new Error("Invalid watchlist.");
    await engine.saveWatchlist(
      raw.filter((c): c is WatchChannel => typeof c === "object" && c !== null),
    );
  });
  ipcMain.handle(IPC_CHANNELS.getRawLog, (_event, rawId: unknown) => {
    const id = asNonEmptyString(rawId);
    if (id === null) throw new Error("Missing id.");
    return engine.getRawLog(id);
  });
  ipcMain.handle(IPC_CHANNELS.checkForUpdates, async (_event, rawForce: unknown) => {
    return engine.checkForUpdates(rawForce === true);
  });
  ipcMain.handle(IPC_CHANNELS.startUpdateDownload, async () => {
    await engine.startUpdateDownload();
  });
  ipcMain.handle(IPC_CHANNELS.getUpdateDownloadProgress, async () => {
    return engine.getUpdateDownloadProgress();
  });
  ipcMain.handle(IPC_CHANNELS.cancelUpdateDownload, async () => {
    await engine.cancelUpdateDownload();
  });
  ipcMain.handle(IPC_CHANNELS.getMediaUrl, async (_event, rawPath: unknown) => {
    const p = asNonEmptyString(rawPath);
    if (p === null) throw new Error("Missing path.");
    return engine.getMediaUrl(p);
  });
  ipcMain.handle(IPC_CHANNELS.openExternal, async (_event, rawUrl: unknown) => {
    const u = asNonEmptyString(rawUrl);
    if (u === null) throw new Error("Missing URL.");
    await engine.openExternal(u);
  });
}

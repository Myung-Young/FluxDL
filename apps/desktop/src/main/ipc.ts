import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@grabber/core/engine.js";
import { normalizeUrl } from "@grabber/core/url.js";
import type { DownloadJobInput } from "@grabber/core/types.js";
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
  if (!isRecord(raw["preset"])) throw new Error("Job is missing a preset.");
  const presetRaw = raw["preset"];
  const kind = presetRaw["kind"];
  const videoPreset = presetRaw["videoPreset"];
  const audioPreset = presetRaw["audioPreset"];
  const rawFormat =
    typeof presetRaw["rawFormat"] === "string" || presetRaw["rawFormat"] === null
      ? presetRaw["rawFormat"]
      : null;
  if (kind !== "video" && kind !== "audio") throw new Error("Invalid preset kind.");
  const validVideo = ["Best", "2160", "1440", "1080", "720", "480"] as const;
  const validAudio = ["MP3", "M4A", "Opus", "FLAC"] as const;
  if (!validVideo.includes(videoPreset as (typeof validVideo)[number])) {
    throw new Error("Invalid video preset.");
  }
  if (!validAudio.includes(audioPreset as (typeof validAudio)[number])) {
    throw new Error("Invalid audio preset.");
  }
  return {
    url,
    title: titleRaw,
    preset: {
      kind,
      videoPreset: videoPreset as (typeof validVideo)[number],
      audioPreset: audioPreset as (typeof validAudio)[number],
      rawFormat,
    },
    outputDir: outputDirRaw,
  };
}

/** Wire typed IPC handlers (single channel map from core) to the engine. */
export function registerEngineIpc(engine: DesktopEngine): void {
  ipcMain.handle(IPC_CHANNELS.getInfo, async (_event, rawUrl: unknown) => {
    const urlRaw = asNonEmptyString(rawUrl);
    if (urlRaw === null) throw new Error("Missing URL.");
    return engine.getInfo(normalizeUrl(urlRaw));
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
  ipcMain.handle(IPC_CHANNELS.pickFolder, async () => {
    return engine.pickFolder();
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
  ipcMain.handle(IPC_CHANNELS.loadSettings, async () => {
    return engine.loadSettings();
  });
  ipcMain.handle(IPC_CHANNELS.saveSettings, async (_event, patch: unknown) => {
    if (!isRecord(patch)) throw new Error("Invalid settings patch.");
    return engine.saveSettings(patch);
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
}

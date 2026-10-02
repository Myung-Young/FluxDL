import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { dialog, shell } from "electron";
import type { AppSettings, DownloadJob, DownloadJobInput, MediaInfo } from "@grabber/core/types.js";
import type {
  DownloadEngine,
  EngineProgress,
  EngineVersions,
  ProgressCallback,
  Unsubscribe,
} from "@grabber/core/engine.js";
import type { ErrorCategory, MappedError } from "@grabber/core/errors.js";
import {
  buildDownloadArgs,
  buildFfmpegVersionArgs,
  buildInfoArgs,
  buildUpdateArgs,
  buildVersionArgs,
} from "@grabber/core/args.js";
import { mapDownloadError } from "@grabber/core/errors.js";
import { normalizeUrl } from "@grabber/core/url.js";
import { parseMediaInfo } from "@grabber/core/media.js";
import { parseProgressLine } from "@grabber/core/progress.js";
import {
  ensureUserDataBinary,
  resolveFfmpegDir,
  resolveFfmpegPath,
  resolveYtDlpPath,
} from "./binaries.js";
import {
  appendHistoryToDisk,
  clearHistoryOnDisk,
  loadHistoryFromDisk,
  loadQueueFromDisk,
  loadSettingsFromDisk,
  removeHistoryFromDisk,
  saveQueueToDisk,
  saveSettingsToDisk,
} from "./persist.js";

export class EngineError extends Error {
  readonly category: ErrorCategory;
  readonly raw: string;
  readonly suggestCookies: boolean;
  constructor(mapped: MappedError) {
    super(mapped.message);
    this.name = "EngineError";
    this.category = mapped.category;
    this.raw = mapped.raw;
    this.suggestCookies = mapped.suggestCookies;
  }
}

export interface DesktopEngineDeps {
  readonly userDataDir: string;
  readonly bundledBinDir: string;
  readonly appVersion: string;
  readonly defaultOutputDir: string;
  readonly broadcast: (event: EngineProgress) => void;
}

type JobState = "running" | "pausing" | "cancelling" | "paused";

interface ActiveJob {
  proc: ChildProcess | null;
  input: DownloadJobInput;
  downloadArgs: string[];
  destination: string | null;
  lastPercent: number;
  rawLog: string;
  state: JobState;
}

const DESTINATION_RE = /\[download\] Destination: (.+)/;
const MERGER_RE = /\[Merger\] Merging formats into "(.+)"/;
const EXTRACT_AUDIO_RE = /\[ExtractAudio\] Destination: (.+)/;
const MAX_LOG_CHARS = 500_000;

function appendLog(log: string, chunk: string): string {
  const next = log + chunk;
  return next.length > MAX_LOG_CHARS ? next.slice(next.length - MAX_LOG_CHARS) : next;
}

function runBinary(
  binary: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    // NEVER shell:true — always an args array.
    const proc = spawn(binary, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", (err: Error) => {
      reject(err);
    });
    proc.on("close", (code: number | null) => {
      resolve({ stdout, stderr, code });
    });
  });
}

/**
 * Desktop DownloadEngine over yt-dlp child processes.
 * Pause = kill, keep .part. Resume = relaunch with --continue.
 * Cancel = kill + best-effort cleanup of destination + .part/.ytdl.
 */
export class DesktopEngine implements DownloadEngine {
  private readonly deps: DesktopEngineDeps;
  private readonly jobs = new Map<string, ActiveJob>();
  private readonly listeners = new Set<ProgressCallback>();
  private readonly finishedLogs = new Map<string, string>();

  constructor(deps: DesktopEngineDeps) {
    this.deps = deps;
  }

  private ytDlp(): string {
    return resolveYtDlpPath(this.deps.userDataDir, this.deps.bundledBinDir);
  }

  private emit(event: EngineProgress): void {
    for (const cb of this.listeners) {
      try {
        cb(event);
      } catch {
        // Listener errors must not break the engine loop.
      }
    }
    try {
      this.deps.broadcast(event);
    } catch {
      // Broadcast failures (no window) are non-fatal.
    }
  }

  /** Raw console access for the Logs screen (M4 wires it to IPC). */
  getRawLog(id: string): Promise<string | null> {
    return Promise.resolve(this.jobs.get(id)?.rawLog ?? this.finishedLogs.get(id) ?? null);
  }

  async getInfo(url: string): Promise<MediaInfo> {
    const normalized = normalizeUrl(url);
    const args = buildInfoArgs(normalized);
    let out: { stdout: string; stderr: string; code: number | null };
    try {
      out = await runBinary(this.ytDlp(), args);
    } catch (err) {
      throw new EngineError(mapDownloadError(err instanceof Error ? err.message : String(err)));
    }
    if (out.code !== 0) {
      throw new EngineError(mapDownloadError(out.stderr));
    }
    let data: unknown;
    try {
      data = JSON.parse(out.stdout) as unknown;
    } catch {
      throw new EngineError(
        mapDownloadError(`Unsupported URL: metadata was not JSON.\n${out.stderr}`),
      );
    }
    try {
      return parseMediaInfo(normalized, data);
    } catch (err) {
      throw new EngineError(
        mapDownloadError(err instanceof Error ? err.message : "Invalid metadata payload."),
      );
    }
  }

  start(job: DownloadJobInput): Promise<string> {
    const normalizedUrl = normalizeUrl(job.url);
    if (job.title.trim().length === 0) {
      throw new EngineError(mapDownloadError("Unsupported URL: missing title."));
    }
    const outputDir = job.outputDir.trim().length > 0 ? job.outputDir : this.deps.defaultOutputDir;
    const input: DownloadJobInput = {
      url: normalizedUrl,
      title: job.title,
      preset: job.preset,
      outputDir,
    };
    const id = randomUUID();
    // User settings live on disk (main side) so every download honors them
    // without widening the DownloadJobInput interface.
    const s = loadSettingsFromDisk(this.deps.userDataDir);
    const args = buildDownloadArgs({
      url: normalizedUrl,
      preset: input.preset,
      outputDir,
      filenameTemplate:
        s.filenameTemplate.trim().length > 0 ? s.filenameTemplate : "%(title)s [%(id)s].%(ext)s",
      ffmpegDir: resolveFfmpegDir(this.deps.bundledBinDir),
      mergeContainer: s.mergeContainer,
      embedThumbnail: s.embedThumbnail,
      embedMetadata: s.embedMetadata,
      writeSubs: s.subtitles,
      subLangs: s.subtitleLangs,
      embedSubs: s.embedSubs,
      sponsorBlock: s.sponsorBlock,
      speedLimit: s.speedLimit,
      proxy: s.proxy,
      cookiesFromBrowser: s.cookiesFromBrowser,
      codecPreference: s.codecPreference,
      noPlaylist: true,
    });
    this.jobs.set(id, {
      proc: null,
      input,
      downloadArgs: args,
      destination: null,
      lastPercent: 0,
      rawLog: "",
      state: "running",
    });
    this.launch(id);
    return Promise.resolve(id);
  }

  private launch(id: string): void {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    // NEVER shell:true — always an args array.
    const proc = spawn(this.ytDlp(), [...job.downloadArgs], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    job.proc = proc;
    job.state = "running";
    let stdoutTail = "";

    const handleLine = (line: string): void => {
      const dest = DESTINATION_RE.exec(line);
      if (dest !== null && dest[1] !== undefined) {
        job.destination = dest[1].trim();
      }
      // Merged / extracted outputs replace the per-stream temp files.
      const merged = MERGER_RE.exec(line) ?? EXTRACT_AUDIO_RE.exec(line);
      if (merged !== null && merged[1] !== undefined) {
        job.destination = merged[1].trim();
      }
      const parsed = parseProgressLine(line);
      if (parsed === null) return;
      job.lastPercent = parsed.percent;
      this.emit({
        id,
        percent: parsed.percent,
        speed: parsed.speed,
        eta: parsed.eta,
        downloadedBytes: parsed.downloadedBytes,
        totalBytes: parsed.totalBytes,
        stage: parsed.stage,
        destination: job.destination,
      });
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      job.rawLog = appendLog(job.rawLog, text);
      stdoutTail += text;
      const lines = stdoutTail.split(/\r?\n/);
      stdoutTail = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      job.rawLog = appendLog(job.rawLog, text);
      for (const line of text.split(/\r?\n/)) handleLine(line);
    });
    proc.on("error", (err: Error) => {
      const current = this.jobs.get(id);
      if (current === undefined) return;
      if (current.state === "pausing" || current.state === "cancelling") return;
      const mapped = mapDownloadError(err.message);
      this.finishWithError(id, mapped);
    });
    proc.on("close", (code: number | null) => {
      const current = this.jobs.get(id);
      if (current === undefined) return;
      if (stdoutTail.trim().length > 0) handleLine(stdoutTail);
      if (current.state === "pausing") {
        current.state = "paused";
        current.proc = null;
        this.emit({
          id,
          percent: current.lastPercent,
          speed: null,
          eta: null,
          downloadedBytes: null,
          totalBytes: null,
          stage: "paused",
          destination: current.destination,
        });
        return;
      }
      if (current.state === "cancelling") {
        void this.cleanupPartFiles(current.destination).finally(() => {
          this.jobs.delete(id);
          this.emit({
            id,
            percent: current.lastPercent,
            speed: null,
            eta: null,
            downloadedBytes: null,
            totalBytes: null,
            stage: "cancelled",
            destination: current.destination,
          });
        });
        return;
      }
      if (code === 0) {
        this.finishedLogs.set(id, current.rawLog);
        this.jobs.delete(id);
        this.emit({
          id,
          percent: 100,
          speed: null,
          eta: null,
          downloadedBytes: null,
          totalBytes: null,
          stage: "done",
          destination: current.destination,
        });
        return;
      }
      this.finishWithError(id, mapDownloadError(current.rawLog));
    });
  }

  private finishWithError(id: string, mapped: MappedError): void {
    const job = this.jobs.get(id);
    this.finishedLogs.set(id, job?.rawLog ?? mapped.raw);
    if (this.finishedLogs.size > 50) {
      const oldest = this.finishedLogs.keys().next();
      if (!oldest.done) this.finishedLogs.delete(oldest.value);
    }
    this.jobs.delete(id);
    this.emit({
      id,
      percent: job?.lastPercent ?? 0,
      speed: null,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: "error",
      destination: job?.destination ?? null,
    });
  }

  private async cleanupPartFiles(destination: string | null): Promise<void> {
    if (destination === null || destination.length === 0) return;
    for (const candidate of [destination, `${destination}.part`, `${destination}.ytdl`]) {
      try {
        await unlink(candidate);
      } catch {
        // Best effort: missing files are fine.
      }
    }
  }

  pause(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job === undefined) throw new Error(`Unknown download: ${id}`);
    if (job.state === "paused") return Promise.resolve();
    job.state = "pausing";
    job.proc?.kill();
    return Promise.resolve();
  }

  resume(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job === undefined) throw new Error(`Unknown download: ${id}`);
    if (job.state === "running") return Promise.resolve();
    job.state = "running";
    this.launch(id);
    return Promise.resolve();
  }

  async cancel(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job === undefined) return;
    if (job.state === "paused" || job.proc === null) {
      await this.cleanupPartFiles(job.destination);
      this.jobs.delete(id);
      this.emit({
        id,
        percent: job.lastPercent,
        speed: null,
        eta: null,
        downloadedBytes: null,
        totalBytes: null,
        stage: "cancelled",
        destination: job.destination,
      });
      return;
    }
    job.state = "cancelling";
    job.proc.kill();
  }

  onProgress(cb: ProgressCallback): Unsubscribe {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  async getEngineVersion(): Promise<EngineVersions> {
    let ytdlp = "unknown";
    try {
      const out = await runBinary(this.ytDlp(), buildVersionArgs());
      if (out.code === 0) ytdlp = out.stdout.trim().split(/\r?\n/)[0] ?? "unknown";
    } catch {
      ytdlp = "unknown";
    }
    let ffmpeg: string | null = null;
    try {
      const out = await runBinary(
        resolveFfmpegPath(this.deps.bundledBinDir),
        buildFfmpegVersionArgs(),
      );
      const first = out.stdout.trim().split(/\r?\n/)[0] ?? "";
      const m = /ffmpeg version (\S+)/.exec(first);
      ffmpeg = m?.[1] ?? (first.length > 0 ? first : null);
    } catch {
      ffmpeg = null;
    }
    return { ytdlp, ffmpeg, app: this.deps.appVersion };
  }

  async updateEngine(): Promise<EngineVersions> {
    const target = await ensureUserDataBinary(this.deps.userDataDir, this.deps.bundledBinDir);
    let out: { stdout: string; stderr: string; code: number | null };
    try {
      out = await runBinary(target, buildUpdateArgs());
    } catch (err) {
      throw new EngineError(mapDownloadError(err instanceof Error ? err.message : String(err)));
    }
    if (out.code !== 0) {
      throw new EngineError(mapDownloadError(`${out.stdout}\n${out.stderr}`));
    }
    return this.getEngineVersion();
  }

  async pickFolder(): Promise<string | null> {
    const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (res.canceled) return null;
    return res.filePaths[0] ?? null;
  }

  async openPath(path: string): Promise<void> {
    if (path.trim().length === 0) throw new Error("Empty path.");
    const err = await shell.openPath(path);
    if (err.length > 0) throw new Error(err);
  }

  revealInFolder(path: string): Promise<void> {
    if (path.trim().length === 0) throw new Error("Empty path.");
    shell.showItemInFolder(path);
    return Promise.resolve();
  }

  loadSettings(): Promise<AppSettings> {
    return Promise.resolve(loadSettingsFromDisk(this.deps.userDataDir));
  }

  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return Promise.resolve(saveSettingsToDisk(this.deps.userDataDir, patch));
  }

  async loadQueue(): Promise<DownloadJob[]> {
    return loadQueueFromDisk(this.deps.userDataDir);
  }

  async saveQueue(jobs: DownloadJob[]): Promise<void> {
    await saveQueueToDisk(this.deps.userDataDir, jobs);
  }

  async appendHistory(job: DownloadJob): Promise<void> {
    await appendHistoryToDisk(this.deps.userDataDir, job);
  }

  async loadHistory(): Promise<DownloadJob[]> {
    return loadHistoryFromDisk(this.deps.userDataDir);
  }

  async removeHistory(id: string): Promise<void> {
    if (id.trim().length === 0) throw new Error("Missing id.");
    await removeHistoryFromDisk(this.deps.userDataDir, id);
  }

  async clearHistory(): Promise<void> {
    await clearHistoryOnDisk(this.deps.userDataDir);
  }
}

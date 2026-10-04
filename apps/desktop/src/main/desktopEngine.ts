import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statfsSync, statSync } from "node:fs";
import { open, readFile, readdir, rm, stat, unlink } from "node:fs/promises";
import { platform as osPlatform, release as osRelease } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { clipboard, dialog, shell, app } from "electron";
import { APP_NAME } from "@grabber/core/branding.js";
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
  DownloadEngine,
  EngineProgress,
  EngineVersions,
  GetInfoInit,
  ProgressCallback,
  RepairReport,
  StorageInsights,
  ThumbnailColor,
  Unsubscribe,
  UpdateDownloadProgress,
  UpdateStatus,
  WindowChromeListener,
  WindowChromeState,
} from "@grabber/core/engine.js";
import {
  APP_API_URL,
  APP_RELEASES_URL,
  YTDLP_API_URL,
  isAllowedExternalUrl,
  isNewerVersion,
  parseReleasePayload,
  pickPortableAsset,
  pickSetupAsset,
  type ParsedRelease,
} from "@grabber/core/updates.js";
import type { ErrorCategory, ErrorLocale, MappedError } from "@grabber/core/errors.js";
import { STRINGS, STRINGS_MS } from "@grabber/core/strings.js";
import {
  buildFfmpegVersionArgs,
  buildInfoArgs,
  buildUpdateArgs,
  buildVersionArgs,
} from "@grabber/core/args.js";
import { toStartInput } from "@grabber/core/queue.js";
import { cancelledMapped, mapDownloadError, timeoutMapped } from "@grabber/core/errors.js";
import { hasMojibake, isExecutablePath, mediaGroup, pickFallbackFile } from "@grabber/core/destination.js";
import { redactArgs } from "@grabber/core/args.js";
import { normalizeUrl } from "@grabber/core/url.js";
import { parseMediaInfo } from "@grabber/core/media.js";
import { parseProgressLine } from "@grabber/core/progress.js";
import {
  ensureUserDataBinary,
  repairBinaries,
  resolveFfmpegDir,
  resolveFfmpegPath,
  resolveYtDlpPath,
} from "./binaries.js";
import {
  appendHistoryToDisk,
  clearHistoryOnDisk,
  isDownloadJob,
  loadHistoryFromDisk,
  loadQueueFromDisk,
  loadSettingsFromDisk,
  loadWatchlistFromDisk,
  removeHistoryFromDisk,
  saveQueueToDisk,
  saveSettingsToDisk,
  saveWatchlistToDisk,
  updateHistoryOnDisk,
} from "./persist.js";
import { thumbnailColor } from "./thumbnail.js";
import { buildStartArgs } from "./jobArgs.js";

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
  /** Main→renderer push for deep-link URLs (second instance/protocol/CLI). */
  readonly broadcastDeepLink: (url: string) => void;
  /** Main→renderer push for .fluxdl batch-file text. */
  readonly broadcastBatchLink: (text: string) => void;
  readonly onAggregate: (state: AggregateProgressState) => void;
  /**
   * Window chrome (M4.4/M4.6). Optional so headless tests can omit it;
   * the desktop app always injects the main-process controller.
   */
  readonly chrome?: {
    readonly apply: (state: WindowChromeState) => Promise<void>;
    readonly subscribe: (cb: WindowChromeListener) => Unsubscribe;
  };
}

type JobState = "running" | "pausing" | "cancelling" | "paused";

interface ActiveJob {
  proc: ChildProcess | null;
  input: DownloadJobInput;
  downloadArgs: string[];
  destination: string | null;
  lastPercent: number | null;
  rawLog: string;
  state: JobState;
}

const DESTINATION_RE = /\[download\] Destination: (.+)/;
const MERGER_RE = /\[Merger\] Merging formats into "(.+)"/;
const EXTRACT_AUDIO_RE = /\[ExtractAudio\] Destination: (.+)/;
const CHAPTER_DEST_RE = /\[SplitChapters\] Chapter \d+; Destination: (.+)/;
const MAX_LOG_CHARS = 500_000;

/** yt-dlp download-archive tracking already-fetched videos (M1.3). */
export const ARCHIVE_FILE = "archive.txt";

export function archivePathFor(userDataDir: string): string {
  return join(userDataDir, ARCHIVE_FILE);
}

function isInsideDir(root: string, candidate: string): boolean {
  // Case-insensitive string math (Windows); absolute `rel` = other drive.
  const rel = relative(root.toLowerCase(), candidate.toLowerCase());
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Kill a child + its whole subtree. `proc.kill()` alone only kills the
 * direct child on Windows, leaving yt-dlp-spawned ffmpeg.exe orphaned
 * (locked .part files + ghost tasks in Task Manager after X/quit).
 * NEVER shell:true — taskkill runs as an args array.
 */
export function killProcessTree(proc: ChildProcess | null): void {
  if (proc === null || proc.killed) return;
  const pid = proc.pid;
  if (pid === undefined) {
    try {
      proc.kill();
    } catch {
      // Best effort.
    }
    return;
  }
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        shell: false,
      });
    } catch {
      // Fall through to proc.kill() below.
    }
  }
  try {
    proc.kill();
  } catch {
    // Best effort; the OS reaps anything left on exit.
  }
}

/**
 * yt-dlp --dump-single-json can print warnings before/after the payload
 * (or mix them into stdout on unusual extractors). Slice from the first
 * `{` to the last `}` so JSON.parse doesn't die on preamble text.
 * Returns null when no object envelope exists.
 */
export function extractJsonPayload(stdout: string): string | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return stdout.slice(start, end + 1);
}

/**
 * Trust boundary (rule 4): the renderer is untrusted, so any path it sends
 * (open/reveal/exists) must resolve inside the download roots or equal a
 * known job/history destination. Everything else is rejected.
 */
export async function isAllowedPath(
  userDataDir: string,
  defaultOutputDir: string,
  activeDestinations: readonly (string | null)[],
  rawPath: string,
): Promise<boolean> {
  if (rawPath.trim().length === 0) return false;
  const candidate = resolve(rawPath);
  const settings = loadSettingsFromDisk(userDataDir);
  const roots: string[] = [];
  if (settings.downloadDir.trim().length > 0) roots.push(resolve(settings.downloadDir));
  if (defaultOutputDir.trim().length > 0) roots.push(resolve(defaultOutputDir));
  for (const root of roots) {
    if (isInsideDir(root, candidate)) return true;
  }
  const known = new Set<string>();
  for (const d of activeDestinations) {
    if (d !== null && d.length > 0) known.add(resolve(d));
  }
  try {
    for (const h of await loadHistoryFromDisk(userDataDir)) {
      if (h.destination !== null && h.destination.length > 0) known.add(resolve(h.destination));
    }
  } catch {
    // History read failure just narrows the allow-list.
  }
  return known.has(candidate);
}

function appendLog(log: string, chunk: string): string {
  const next = log + chunk;
  return next.length > MAX_LOG_CHARS ? next.slice(next.length - MAX_LOG_CHARS) : next;
}

/** Playable preview extensions (audio first, common video second). */
const MEDIA_EXTENSIONS = [
  ".mp3",
  ".m4a",
  ".opus",
  ".ogg",
  ".oga",
  ".wav",
  ".flac",
  ".mp4",
  ".m4v",
  ".webm",
  ".mkv",
] as const;

function mimeFor(lowerPath: string): string | null {
  if (lowerPath.endsWith(".mp3")) return "audio/mpeg";
  if (lowerPath.endsWith(".m4a")) return "audio/mp4";
  if (lowerPath.endsWith(".opus") || lowerPath.endsWith(".ogg") || lowerPath.endsWith(".oga"))
    return "audio/ogg";
  if (lowerPath.endsWith(".wav")) return "audio/wav";
  if (lowerPath.endsWith(".flac")) return "audio/flac";
  if (lowerPath.endsWith(".mp4") || lowerPath.endsWith(".m4v")) return "video/mp4";
  if (lowerPath.endsWith(".webm")) return "video/webm";
  if (lowerPath.endsWith(".mkv")) return "video/x-matroska";
  return null;
}

/** Best-effort GitHub latest-release tag (null on any failure). */
async function fetchLatestTag(apiUrl: string): Promise<string | null> {
  const payload = await fetchReleasePayload(apiUrl);
  return payload === null ? null : payload.tag;
}

/**
 * Best-effort GitHub latest-release payload (null on any failure:
 * offline, rate-limited, malformed). Update checks must never throw
 * for network reasons.
 */
async function fetchReleasePayload(apiUrl: string): Promise<ParsedRelease | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, 8000);
  try {
    const res = await fetch(apiUrl, {
      signal: ctrl.signal,
      headers: { Accept: "application/vnd.github+json", "User-Agent": APP_NAME },
    });
    if (!res.ok) return null;
    return parseReleasePayload((await res.json()) as unknown);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  private readonly finishedArgs = new Map<string, string[]>();

  private rememberFinished(id: string, log: string, argv: string[]): void {
    this.finishedLogs.set(id, log);
    this.finishedArgs.set(id, argv);
    for (const store of [this.finishedLogs, this.finishedArgs] as const) {
      if (store.size > 50) {
        const oldest = store.keys().next();
        if (!oldest.done) store.delete(oldest.value);
      }
    }
  }

  constructor(deps: DesktopEngineDeps) {
    this.deps = deps;
  }

  private ytDlp(): string {
    return resolveYtDlpPath(this.deps.userDataDir, this.deps.bundledBinDir);
  }

  /** Active error locale: explicit setting, else system locale. */
  private errorLang(): ErrorLocale {
    try {
      const lang = loadSettingsFromDisk(this.deps.userDataDir).language;
      if (lang === "en" || lang === "ms") return lang;
    } catch {
      // Fall through to the system locale.
    }
    try {
      if (app.getLocale().toLowerCase().startsWith("ms")) return "ms";
    } catch {
      // Ignore; default below.
    }
    return "en";
  }

  private errorStrings(): typeof STRINGS {
    return this.errorLang() === "ms" ? (STRINGS_MS as typeof STRINGS) : STRINGS;
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

  private readonly analyses = new Map<
    string,
    {
      proc: ChildProcess | null;
      timer: NodeJS.Timeout | null;
      settled: boolean;
      cancelled: boolean;
      timedOut: boolean;
    }
  >();

  /** Raw console access for the Logs screen (M4 wires it to IPC). */
  getRawLog(id: string): Promise<string | null> {
    return Promise.resolve(this.jobs.get(id)?.rawLog ?? this.finishedLogs.get(id) ?? null);
  }

  /** Redacted yt-dlp argv for the Logs "show command" toggle (C6). */
  getJobArgs(id: string): Promise<string[] | null> {
    const argv = this.jobs.get(id)?.downloadArgs ?? this.finishedArgs.get(id) ?? null;
    return Promise.resolve(argv === null ? null : redactArgs(argv));
  }

  /**
   * Storage breakdown of the download folder (F2): capped walk (3 levels,
   * 5000 files), unreadable entries skipped. Orphans are yt-dlp leftovers
   * (.part/.ytdl/.temp) the UI can trash through the normal guard.
   */
  getStorageInsights(): Promise<StorageInsights> {
    const out: {
      audioFiles: number;
      audioBytes: number;
      videoFiles: number;
      videoBytes: number;
      otherFiles: number;
      otherBytes: number;
      orphans: string[];
      orphanBytes: number;
    } = {
      audioFiles: 0,
      audioBytes: 0,
      videoFiles: 0,
      videoBytes: 0,
      otherFiles: 0,
      otherBytes: 0,
      orphans: [],
      orphanBytes: 0,
    };
    let root = "";
    try {
      const saved = loadSettingsFromDisk(this.deps.userDataDir).downloadDir;
      root = saved.trim().length > 0 ? saved : this.deps.defaultOutputDir;
    } catch {
      root = this.deps.defaultOutputDir;
    }
    let seen = 0;
    const walk = (dir: string, depth: number): void => {
      if (depth > 3 || seen > 5000) return;
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        if (name.startsWith(".")) continue;
        const full = join(dir, name);
        let st: { isDirectory(): boolean; isFile(): boolean; size: number };
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          walk(full, depth + 1);
          continue;
        }
        if (!st.isFile()) continue;
        seen += 1;
        if (seen > 5000) return;
        const lower = name.toLowerCase();
        if (lower.endsWith(".part") || lower.endsWith(".ytdl") || lower.endsWith(".temp")) {
          out.orphans.push(full);
          out.orphanBytes += st.size;
          continue;
        }
        const group = mediaGroup(name);
        if (group === "audio") {
          out.audioFiles += 1;
          out.audioBytes += st.size;
        } else if (group === "video") {
          out.videoFiles += 1;
          out.videoBytes += st.size;
        } else {
          out.otherFiles += 1;
          out.otherBytes += st.size;
        }
      }
    };
    try {
      walk(resolve(root), 0);
    } catch {
      // Best effort; partial totals still render.
    }
    return Promise.resolve(out);
  }

  /** System clipboard text via the Electron API (no DOM permission). */
  readClipboard(): Promise<string | null> {
    try {
      const text = clipboard.readText();
      return Promise.resolve(text.length > 0 ? text : null);
    } catch {
      return Promise.resolve(null);
    }
  }

  /** Free space on the path's drive (statfs; null when unknowable). */
  getDiskSpace(path: string): Promise<{ freeBytes: number } | null> {
    try {
      const st = statfsSync(resolve(path));
      const free = st.bfree * st.bsize;
      if (!Number.isFinite(free) || free < 0) return Promise.resolve(null);
      return Promise.resolve({ freeBytes: Math.floor(free) });
    } catch {
      return Promise.resolve(null);
    }
  }

  /**
   * Graceful teardown for before-quit: terminate children but keep .part
   * files (pause semantics, not cancel) so the next boot re-queues and
   * resumes them. Never throws.
   */
  shutdown(): Promise<void> {
    for (const [, entry] of this.analyses) {
      killProcessTree(entry.proc);
      if (entry.timer !== null) clearTimeout(entry.timer);
    }
    this.analyses.clear();
    for (const job of this.jobs.values()) {
      killProcessTree(job.proc);
      job.proc = null;
    }
    return Promise.resolve();
  }

  /** Active download/analyze count for the X-quit confirm dialog. */
  activeCount(): number {
    return this.jobs.size + this.analyses.size;
  }

  private readonly deepListeners = new Set<DeepLinkCallback>();
  private readonly batchListeners = new Set<DeepLinkCallback>();
  private lastUpdate: { at: number; status: UpdateStatus } | null = null;

  onDeepLink(cb: DeepLinkCallback): Unsubscribe {
    this.deepListeners.add(cb);
    return () => {
      this.deepListeners.delete(cb);
    };
  }

  onBatchLink(cb: DeepLinkCallback): Unsubscribe {
    this.batchListeners.add(cb);
    return () => {
      this.batchListeners.delete(cb);
    };
  }

  /** Main calls this when a .fluxdl file arrives (boot, second instance). */
  emitBatchLink(text: string): void {
    for (const cb of this.batchListeners) {
      try {
        cb(text);
      } catch {
        // Listener errors must not break the engine loop.
      }
    }
    try {
      this.deps.broadcastBatchLink(text);
    } catch {
      // Broadcast failures (no window) are non-fatal.
    }
  }

  /**
   * Apply the launch-at-login setting to the OS (E5). Best-effort: the
   * setting itself always persists; a denied registration just skips.
   */
  syncLoginSettings(): void {
    try {
      const on = loadSettingsFromDisk(this.deps.userDataDir).launchAtLogin;
      app.setLoginItemSettings({
        openAtLogin: on,
        path: process.execPath,
        args: on ? ["--minimized"] : [],
      });
    } catch {
      // Best effort; never blocks downloads.
    }
  }

  /** Main calls this when a URL arrives (boot arg, second instance, open-url). */
  emitDeepLink(url: string): void {
    for (const cb of this.deepListeners) {
      try {
        cb(url);
      } catch {
        // Listener errors must not break the engine loop.
      }
    }
    try {
      this.deps.broadcastDeepLink(url);
    } catch {
      // Broadcast failures (no window) are non-fatal.
    }
  }

  /**
   * One best-effort round trip for app + yt-dlp freshness (GitHub Releases
   * API, 8 s timeout each, hourly cache). Offline/malformed responses
   * resolve update=false — they must never break launch. force=true
   * bypasses the cache (the Logs button; launch uses the cache).
   */
  async checkForUpdates(force = false): Promise<UpdateStatus> {
    const now = Date.now();
    if (!force && this.lastUpdate !== null && now - this.lastUpdate.at < 3_600_000) {
      return this.lastUpdate.status;
    }
    const versions = await this.getEngineVersion().catch(() => null);
    const ytdlpCurrent = versions?.ytdlp ?? "unknown";
    const [appRelease, ytdlpLatest] = await Promise.all([
      fetchReleasePayload(APP_API_URL),
      fetchLatestTag(YTDLP_API_URL),
    ]);
    const appLatest = appRelease?.tag ?? null;
    const appUpdate = isNewerVersion(this.deps.appVersion, appLatest);
    const setup = appRelease === null ? null : pickSetupAsset(appRelease.assets);
    const portable = appRelease === null ? null : pickPortableAsset(appRelease.assets);
    const status: UpdateStatus = {
      appCurrent: this.deps.appVersion,
      appLatest,
      appUpdate,
      appUrl: APP_RELEASES_URL,
      appRelease:
        appUpdate && appRelease !== null
          ? {
              tag: appRelease.tag,
              publishedAt: appRelease.publishedAt,
              notes: appRelease.body,
              setupName: setup?.name ?? null,
              setupSize: setup?.sizeBytes ?? null,
              setupUrl: setup?.url ?? null,
              portableName: portable?.name ?? null,
              portableSize: portable?.sizeBytes ?? null,
              portableUrl: portable?.url ?? null,
            }
          : null,
      ytdlpCurrent,
      ytdlpLatest,
      ytdlpUpdate: isNewerVersion(ytdlpCurrent, ytdlpLatest),
      checkedAt: now,
    };
    this.lastUpdate = { at: now, status };
    return status;
  }

  private updateDl: {
    ctrl: AbortController;
    received: number;
    total: number | null;
    state: "downloading" | "done" | "installing" | "error";
    error: string | null;
    dest: string;
    expectedSize: number | null;
  } | null = null;

  /**
   * Download the pending Setup installer in the background (progress via
   * getUpdateDownloadProgress). At 100% the installer launches silently and
   * the app quits — that handoff IS the install step.
   */
  startUpdateDownload(): Promise<void> {
    if (this.updateDl?.state === "downloading") return Promise.resolve();
    const release = this.lastUpdate?.status.appRelease;
    const url = release?.setupUrl ?? null;
    if (release === null || release === undefined || url === null) {
      return Promise.reject(new Error("Check for updates first."));
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return Promise.reject(new Error("The update link is invalid."));
    }
    // Only GitHub-hosted artifacts, never an arbitrary executable URL.
    if (
      parsed.protocol !== "https:" ||
      (!parsed.hostname.endsWith("github.com") &&
        !parsed.hostname.endsWith("githubusercontent.com"))
    ) {
      return Promise.reject(new Error("The update link is not allowed."));
    }
    const safeName =
      (release.setupName ?? "FluxDL-Setup-update.exe").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) ||
      "FluxDL-Setup-update.exe";
    const dir = join(this.deps.userDataDir, "pending-updates");
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      return Promise.reject(new Error("Could not prepare the download folder."));
    }
    const dest = join(dir, safeName);
    const ctrl = new AbortController();
    this.updateDl = {
      ctrl,
      received: 0,
      total: release.setupSize,
      state: "downloading",
      error: null,
      dest,
      expectedSize: release.setupSize,
    };
    void this.runUpdateDownload(url, dest, ctrl);
    return Promise.resolve();
  }

  getUpdateDownloadProgress(): Promise<UpdateDownloadProgress> {
    const dl = this.updateDl;
    if (dl === null) {
      return Promise.resolve({ state: "idle", receivedBytes: 0, totalBytes: null, error: null });
    }
    return Promise.resolve({
      state: dl.state,
      receivedBytes: dl.received,
      totalBytes: dl.total,
      error: dl.error,
    });
  }

  cancelUpdateDownload(): Promise<void> {
    const dl = this.updateDl;
    if (dl === null || dl.state !== "downloading") return Promise.resolve();
    dl.ctrl.abort();
    return Promise.resolve();
  }

  private async runUpdateDownload(url: string, dest: string, ctrl: AbortController): Promise<void> {
    const dl = this.updateDl;
    if (dl === null || dl.ctrl !== ctrl) return;
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: "application/octet-stream", "User-Agent": APP_NAME },
      });
      if (!res.ok || res.body === null) {
        throw new Error(`Download failed (HTTP ${String(res.status)}).`);
      }
      const headerTotal = Number(res.headers.get("content-length") ?? "NaN");
      if (Number.isFinite(headerTotal) && headerTotal > 0) dl.total = Math.floor(headerTotal);
      const fh = await open(dest, "w");
      const reader = res.body.getReader();
      try {
        for (;;) {
          if (ctrl.signal.aborted) throw new DOMException("Cancelled", "AbortError");
          const { done, value } = await reader.read();
          if (done) break;
          await fh.write(value);
          dl.received += value.length;
        }
      } finally {
        await fh.close().catch(() => undefined);
      }
      if (dl.expectedSize !== null && dl.expectedSize > 0) {
        const actual = statSync(dest).size;
        if (actual !== dl.expectedSize) {
          throw new Error("The download was incomplete. Please retry.");
        }
      }
      dl.state = "done";
      // Hand off to the installer: silent NSIS install, then quit so locked
      // files can be replaced. Detached + unref'd, so quitting is safe.
      dl.state = "installing";
      const child = spawn(dest, ["/S"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      child.unref();
      setTimeout(() => {
        try {
          app.quit();
        } catch {
          // Already quitting.
        }
      }, 1200);
    } catch (err) {
      if (this.updateDl !== null && this.updateDl.ctrl === ctrl) {
        if (ctrl.signal.aborted) {
          this.updateDl = null;
          try {
            await rm(dest, { force: true });
          } catch {
            // Best effort.
          }
          return;
        }
        this.updateDl.state = "error";
        this.updateDl.error = err instanceof Error ? err.message : "Download failed.";
      }
    }
  }

  /**
   * Validated `media://` URL for in-app preview, or null. The custom
   * protocol handler (main) serves only these allowlisted paths.
   */
  async getMediaUrl(path: string): Promise<string | null> {
    if (!(await this.isAllowed(path))) return null;
    const lower = path.toLowerCase();
    if (!MEDIA_EXTENSIONS.some((ext) => lower.endsWith(ext))) return null;
    try {
      await stat(resolve(path));
    } catch {
      return null;
    }
    return `media://play/${encodeURIComponent(resolve(path))}`;
  }

  /** Open the Releases page in the OS browser (allowlisted, nothing else). */
  async openExternal(url: string): Promise<void> {
    if (!isAllowedExternalUrl(url)) throw new Error("URL is not allowed.");
    await shell.openExternal(url);
  }

  /**
   * Serve one `media://play/<encoded-abs-path>` request. Returns null when
   * the path fails the trust boundary (the protocol handler turns that
   * into a 403). Main-only helper, not part of the renderer interface.
   */
  async serveMediaRequest(requestUrl: string): Promise<{ body: Buffer; mime: string } | null> {
    const prefix = "media://play/";
    if (!requestUrl.startsWith(prefix)) return null;
    let decoded = "";
    try {
      decoded = decodeURIComponent(requestUrl.slice(prefix.length));
    } catch {
      return null;
    }
    if (!(await this.isAllowed(decoded))) return null;
    const lower = decoded.toLowerCase();
    const mime = mimeFor(lower);
    if (mime === null) return null;
    try {
      return { body: await readFile(decoded), mime };
    } catch {
      return null;
    }
  }

  async getInfo(url: string, init?: GetInfoInit): Promise<MediaInfo> {
    const normalized = normalizeUrl(url);
    const args = buildInfoArgs(normalized);
    const requestId =
      init?.requestId !== undefined && init.requestId.length > 0 ? init.requestId : randomUUID();
    const timeoutSec = loadSettingsFromDisk(this.deps.userDataDir).analyzeTimeoutSec;
    return new Promise<MediaInfo>((resolve, reject) => {
      const entry = {
        proc: null as ChildProcess | null,
        timer: null as NodeJS.Timeout | null,
        settled: false,
        cancelled: false,
        timedOut: false,
      };
      this.analyses.set(requestId, entry);
      const settle = (fn: () => void): void => {
        if (entry.settled) return;
        entry.settled = true;
        if (entry.timer !== null) clearTimeout(entry.timer);
        this.analyses.delete(requestId);
        fn();
      };
      // NEVER shell:true — always an args array.
      const proc = spawn(this.ytDlp(), [...args], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
      entry.proc = proc;
      entry.timer = setTimeout(() => {
        entry.timedOut = true;
        killProcessTree(proc);
      }, timeoutSec * 1000);
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      proc.on("error", (err: Error) => {
        settle(() => {
          reject(
            new EngineError(mapDownloadError(err instanceof Error ? err.message : String(err), this.errorLang())),
          );
        });
      });
      proc.on("close", (code: number | null) => {
        if (entry.cancelled) {
          settle(() => {
            reject(new EngineError(cancelledMapped(this.errorLang())));
          });
          return;
        }
        if (entry.timedOut) {
          settle(() => {
            reject(new EngineError(timeoutMapped(timeoutSec, this.errorLang())));
          });
          return;
        }
        if (code !== 0) {
          settle(() => {
            reject(new EngineError(mapDownloadError(stderr, this.errorLang())));
          });
          return;
        }
        let data: unknown;
        try {
          const payload = extractJsonPayload(stdout);
          if (payload === null) throw new Error("no JSON payload");
          data = JSON.parse(payload) as unknown;
        } catch {
          settle(() => {
            reject(
              new EngineError(
                mapDownloadError(
                  `Unsupported URL: metadata was not JSON.\n${stderr}`,
                  this.errorLang(),
                ),
              ),
            );
          });
          return;
        }
        try {
          const info = parseMediaInfo(normalized, data);
          settle(() => {
            resolve(info);
          });
        } catch (err) {
          settle(() => {
            reject(
              new EngineError(
                mapDownloadError(err instanceof Error ? err.message : "Invalid metadata payload.", this.errorLang()),
              ),
            );
          });
        }
      });
    });
  }

  cancelAnalyze(requestId: string): Promise<void> {
    const entry = this.analyses.get(requestId);
    if (entry === undefined || entry.settled) return Promise.resolve();
    entry.cancelled = true;
    killProcessTree(entry.proc);
    return Promise.resolve();
  }

  start(job: DownloadJobInput): Promise<string> {
    const normalizedUrl = normalizeUrl(job.url);
    if (job.title.trim().length === 0) {
      throw new EngineError(mapDownloadError("Unsupported URL: missing title.", this.errorLang()));
    }
    const outputDir = job.outputDir.trim().length > 0 ? job.outputDir : this.deps.defaultOutputDir;
    const input: DownloadJobInput = { ...toStartInput(job), url: normalizedUrl, outputDir };
    const id = randomUUID();
    // userData must exist before spawning: yt-dlp writes the download archive
    // there directly and fails with ENOENT otherwise. Electron creates it in
    // the real app, but nothing guarantees it for every caller (D95).
    mkdirSync(this.deps.userDataDir, { recursive: true });
    // User settings live on disk (main side) so every download honors them
    // without widening the DownloadJobInput interface.
    const s = loadSettingsFromDisk(this.deps.userDataDir);
    // cookies.txt is validated (must exist) and never copied or logged.
    const cookiesFile =
      s.cookiesFile !== null && s.cookiesFile.trim().length > 0 && existsSync(s.cookiesFile)
        ? s.cookiesFile
        : null;
    const args = buildStartArgs(input, {
      settings: s,
      ffmpegDir: resolveFfmpegDir(this.deps.bundledBinDir),
      cookiesFile,
      archivePath:
        s.skipArchived && input.useArchive === true
          ? archivePathFor(this.deps.userDataDir)
          : null,
    });
    this.jobs.set(id, {
      proc: null,
      input,
      downloadArgs: args,
      destination: null,
      lastPercent: null,
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
      // Chapter splitting (M4.2): chapter files placed in containing folder.
      const chapterDest = CHAPTER_DEST_RE.exec(line);
      if (chapterDest !== null && chapterDest[1] !== undefined) {
        job.destination = dirname(chapterDest[1].trim());
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
      const mapped = mapDownloadError(err.message, this.errorLang());
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
        void (async (): Promise<void> => {
          await this.repairDestination(current).catch(() => undefined);
          this.rememberFinished(id, current.rawLog, current.downloadArgs);
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
        })();
        return;
      }
      this.finishWithError(id, mapDownloadError(current.rawLog, this.errorLang()));
    });
  }

  private finishWithError(id: string, mapped: MappedError): void {
    const job = this.jobs.get(id);
    this.rememberFinished(id, job?.rawLog ?? mapped.raw, job?.downloadArgs ?? []);
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
      errorMessage: mapped.message,
      errorCategory: mapped.category,
    });
  }

  /**
   * Mojibake recovery (M3.1): when yt-dlp reports a destination containing
   * U+FFFD that does not exist on disk, scan the output dir for the most
   * likely real file (video-id match, else newest recent media). Silent
   * no-op otherwise — the Missing badge + Locate still covers the miss.
   */
  private async repairDestination(job: ActiveJob): Promise<void> {
    const dest = job.destination;
    if (dest === null || dest.length === 0 || !hasMojibake(dest)) return;
    try {
      await stat(dest);
      return;
    } catch {
      // Missing — fall through to the directory scan.
    }
    const dir =
      typeof job.input.playlistSubdir === "string" && job.input.playlistSubdir.length > 0
        ? join(job.input.outputDir, job.input.playlistSubdir)
        : job.input.outputDir;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    const entries: { name: string; mtimeMs: number }[] = [];
    for (const name of names.slice(0, 500)) {
      try {
        const st = await stat(join(dir, name));
        if (st.isFile()) entries.push({ name, mtimeMs: st.mtimeMs });
      } catch {
        // Skip unreadable entries.
      }
    }
    const videoId =
      typeof job.input.videoId === "string" && job.input.videoId.length > 0
        ? job.input.videoId
        : null;
    const fallback = pickFallbackFile(videoId, entries, Date.now());
    if (fallback !== null) job.destination = join(dir, fallback);
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
    killProcessTree(job.proc);
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
    killProcessTree(job.proc);
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
    // process.versions is typed string-only; Electron-only keys are absent in plain node.
    const runtime = process.versions as Record<string, string | undefined>;
    return {
      ytdlp,
      ffmpeg,
      app: this.deps.appVersion,
      os: `${osPlatform()} ${osRelease()}`,
      arch: process.arch,
      electron: runtime["electron"] ?? "unknown",
      node: process.version,
    };
  }

  async updateEngine(): Promise<EngineVersions> {
    // Never run -U while downloads are active (kill first would corrupt).
    if (this.jobs.size > 0) {
      throw new Error(this.errorStrings().errors.updateBlockedBusy);
    }
    const target = await ensureUserDataBinary(this.deps.userDataDir, this.deps.bundledBinDir);
    let out: { stdout: string; stderr: string; code: number | null };
    try {
      out = await runBinary(target, buildUpdateArgs());
    } catch (err) {
      throw new EngineError(mapDownloadError(err instanceof Error ? err.message : String(err), this.errorLang()));
    }
    if (out.code !== 0) {
      throw new EngineError(
        mapDownloadError(`${out.stdout}\n${out.stderr}`, this.errorLang()),
      );
    }
    return this.getEngineVersion();
  }

  async repairEngine(): Promise<RepairReport> {
    const { repaired, failed } = await repairBinaries(
      this.deps.userDataDir,
      this.deps.bundledBinDir,
    );
    const versions = await this.getEngineVersion().catch(() => null);
    const ok =
      failed.length === 0 &&
      versions !== null &&
      versions.ytdlp !== "unknown" &&
      versions.ffmpeg !== null;
    return { ok, repaired, failed, versions };
  }

  setAggregateProgress(state: AggregateProgressState): Promise<void> {
    const active = Number.isFinite(state.active) ? Math.max(0, Math.floor(state.active)) : 0;
    const percent =
      state.percent === null || !Number.isFinite(state.percent)
        ? null
        : Math.min(100, Math.max(0, state.percent));
    const tooltip = typeof state.tooltip === "string" ? state.tooltip.slice(0, 200) : APP_NAME;
    this.deps.onAggregate({ active, percent, tooltip });
    return Promise.resolve();
  }

  applyWindowChrome(state: WindowChromeState): Promise<void> {
    return this.deps.chrome?.apply(state) ?? Promise.resolve();
  }

  onWindowChrome(cb: WindowChromeListener): Unsubscribe {
    return this.deps.chrome?.subscribe(cb) ?? (() => undefined);
  }

  getThumbnailColor(url: string): Promise<ThumbnailColor | null> {
    return thumbnailColor(url);
  }

  async pickFolder(): Promise<string | null> {
    const res = await dialog.showOpenDialog({
      title: APP_NAME,
      properties: ["openDirectory"],
    });
    if (res.canceled) return null;
    return res.filePaths[0] ?? null;
  }

  async pickFile(): Promise<string | null> {
    const res = await dialog.showOpenDialog({ title: APP_NAME, properties: ["openFile"] });
    if (res.canceled) return null;
    return res.filePaths[0] ?? null;
  }

  async openPath(path: string): Promise<void> {
    await this.assertAllowed(path);
    // Executables can run code: confirm in the app's own language (C5).
    // One choke point, so every Open button/menu/toast is covered at once.
    if (isExecutablePath(path)) {
      const S = this.errorStrings();
      const base = path.split(/[\\/]/).pop() ?? path;
      const picked = dialog.showMessageBoxSync({
        type: "warning",
        title: APP_NAME,
        message: S.safety.exeMessage.replace("{name}", base),
        buttons: [S.safety.exeOpen, S.safety.exeCancel],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (picked !== 0) return;
    }
    const err = await shell.openPath(path);
    if (err.length > 0) throw new Error(err);
  }

  async revealInFolder(path: string): Promise<void> {
    await this.assertAllowed(path);
    shell.showItemInFolder(path);
  }

  async fileExists(path: string): Promise<boolean> {
    if (!(await this.isAllowed(path))) return false;
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async fileExistsBulk(paths: string[]): Promise<boolean[]> {
    const out: boolean[] = [];
    for (const p of paths.slice(0, 2000)) {
      out.push(typeof p === "string" ? await this.fileExists(p) : false);
    }
    return out;
  }

  async archiveHas(keys: string[]): Promise<boolean[]> {
    const known = await this.readArchiveKeys();
    return keys
      .slice(0, 2000)
      .map((k) => typeof k === "string" && !k.includes("://") && known.has(k.toLowerCase()));
  }

  /** Parse <userData>/archive.txt ("extractor id" lines) into identity keys. */
  private async readArchiveKeys(): Promise<Set<string>> {
    const found = new Set<string>();
    let text = "";
    try {
      text = await readFile(archivePathFor(this.deps.userDataDir), "utf8");
    } catch {
      return found;
    }
    for (const line of text.split(/\r?\n/)) {
      const tokens = line.trim().split(/\s+/).filter((t) => t.length > 0);
      const ext = tokens[0];
      if (ext === undefined || tokens.length < 2) continue;
      found.add(`${ext.toLowerCase()}::${tokens.slice(1).join(" ")}`);
    }
    return found;
  }

  async trashFile(path: string): Promise<void> {
    await this.assertAllowed(path);
    const candidate = resolve(path);
    const settings = loadSettingsFromDisk(this.deps.userDataDir);
    const roots = [
      resolve(this.deps.userDataDir),
      resolve(this.deps.defaultOutputDir),
      ...(settings.downloadDir ? [resolve(settings.downloadDir)] : []),
    ];
    for (const r of roots) {
      if (r.toLowerCase() === candidate.toLowerCase()) {
        throw new Error("Cannot trash root directory.");
      }
    }
    await shell.trashItem(path);
  }

  async updateHistory(job: DownloadJob): Promise<void> {
    if (!isDownloadJob(job)) throw new Error("Invalid history entry.");
    await updateHistoryOnDisk(this.deps.userDataDir, job);
  }

  async clearArchive(): Promise<void> {
    await rm(archivePathFor(this.deps.userDataDir), { force: true });
  }

  private activeDestinations(): (string | null)[] {
    return [...this.jobs.values()].map((j) => j.destination);
  }

  private async isAllowed(path: string): Promise<boolean> {
    return isAllowedPath(
      this.deps.userDataDir,
      this.deps.defaultOutputDir,
      this.activeDestinations(),
      path,
    );
  }

  private async assertAllowed(path: string): Promise<void> {
    if (path.trim().length === 0) throw new Error("Empty path.");
    if (!(await this.isAllowed(path))) {
      throw new Error("Path is outside the download folder.");
    }
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

  async loadWatchlist(): Promise<WatchChannel[]> {
    return loadWatchlistFromDisk(this.deps.userDataDir);
  }

  async saveWatchlist(channels: WatchChannel[]): Promise<void> {
    if (!Array.isArray(channels)) throw new Error("Invalid watchlist.");
    await saveWatchlistToDisk(this.deps.userDataDir, channels);
  }
}

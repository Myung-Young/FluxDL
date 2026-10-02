import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Store from "electron-store";
import type { AppSettings, DownloadJob, JobStatus } from "@grabber/core/types.js";
import { DEFAULT_SETTINGS, mergeSettings } from "@grabber/core/settings.js";

/**
 * File persistence (main process only).
 * - Settings: electron-store (`<userData>/grabber-settings.json`).
 * - Queue snapshot: atomic JSON (`<userData>/queue.json`).
 * - History: JSON-lines (`<userData>/history.jsonl`, corrupt lines skipped).
 * All helpers take an explicit dir so tests can use temp dirs.
 */

const SETTINGS_NAME = "grabber-settings";
const QUEUE_FILE = "queue.json";
const QUEUE_TMP = "queue.json.tmp";
const HISTORY_FILE = "history.jsonl";

const STATUSES: readonly JobStatus[] = [
  "queued",
  "analyzing",
  "downloading",
  "processing",
  "paused",
  "done",
  "error",
  "cancelled",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDownloadJob(value: unknown): value is DownloadJob {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string" || value["id"].length === 0) return false;
  if (typeof value["url"] !== "string" || typeof value["title"] !== "string") return false;
  if (typeof value["outputDir"] !== "string") return false;
  if (typeof value["createdAt"] !== "number") return false;
  if (typeof value["attempts"] !== "number") return false;
  if (!STATUSES.includes(value["status"] as JobStatus)) return false;
  if (!isRecord(value["preset"])) return false;
  const kind = value["preset"]["kind"];
  return kind === "video" || kind === "audio";
}

const settingsStores = new Map<string, Store<AppSettings>>();

function storeFor(userDataDir: string): Store<AppSettings> {
  const existing = settingsStores.get(userDataDir);
  if (existing !== undefined) return existing;
  const store = new Store<AppSettings>({
    cwd: userDataDir,
    name: SETTINGS_NAME,
    defaults: DEFAULT_SETTINGS,
  });
  settingsStores.set(userDataDir, store);
  return store;
}

export function loadSettingsFromDisk(userDataDir: string): AppSettings {
  try {
    const raw = storeFor(userDataDir).store as Partial<AppSettings>;
    return mergeSettings(DEFAULT_SETTINGS, raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettingsToDisk(userDataDir: string, patch: Partial<AppSettings>): AppSettings {
  if (!isRecord(patch)) throw new Error("Invalid settings patch.");
  const merged = mergeSettings(loadSettingsFromDisk(userDataDir), patch);
  storeFor(userDataDir).set(merged);
  return merged;
}

export async function loadQueueFromDisk(userDataDir: string): Promise<DownloadJob[]> {
  const file = join(userDataDir, QUEUE_FILE);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isDownloadJob);
  } catch {
    return [];
  }
}

/** Atomic snapshot (tmp + rename) so killing the app mid-write never corrupts. */
export async function saveQueueToDisk(
  userDataDir: string,
  jobs: readonly DownloadJob[],
): Promise<void> {
  if (!Array.isArray(jobs)) throw new Error("Invalid queue snapshot.");
  await mkdir(userDataDir, { recursive: true });
  const finalPath = join(userDataDir, QUEUE_FILE);
  const tmpPath = join(userDataDir, QUEUE_TMP);
  await writeFile(tmpPath, JSON.stringify(jobs), "utf8");
  await rename(tmpPath, finalPath);
}

export async function appendHistoryToDisk(userDataDir: string, job: DownloadJob): Promise<void> {
  if (!isDownloadJob(job)) throw new Error("Invalid history entry.");
  await mkdir(userDataDir, { recursive: true });
  await appendFile(join(userDataDir, HISTORY_FILE), `${JSON.stringify(job)}\n`, "utf8");
}

export async function loadHistoryFromDisk(userDataDir: string): Promise<DownloadJob[]> {
  const file = join(userDataDir, HISTORY_FILE);
  if (!existsSync(file)) return [];
  const out: DownloadJob[] = [];
  try {
    const text = await readFile(file, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.length === 0) continue;
      try {
        const parsed: unknown = JSON.parse(t);
        if (isDownloadJob(parsed)) out.push(parsed);
      } catch {
        // Skip corrupt lines; keep the rest.
      }
    }
  } catch {
    return [];
  }
  return out;
}

export async function removeHistoryFromDisk(userDataDir: string, id: string): Promise<void> {
  const kept = (await loadHistoryFromDisk(userDataDir)).filter((h) => h.id !== id);
  await mkdir(userDataDir, { recursive: true });
  await writeFile(
    join(userDataDir, HISTORY_FILE),
    kept.map((h) => JSON.stringify(h)).join("\n") + (kept.length > 0 ? "\n" : ""),
    "utf8",
  );
}

/** Replace one history record (matched by id; appended when absent). */
export async function updateHistoryOnDisk(userDataDir: string, job: DownloadJob): Promise<void> {
  if (!isDownloadJob(job)) throw new Error("Invalid history entry.");
  const loaded = await loadHistoryFromDisk(userDataDir);
  const next = loaded.some((h) => h.id === job.id)
    ? loaded.map((h) => (h.id === job.id ? job : h))
    : [...loaded, job];
  await mkdir(userDataDir, { recursive: true });
  await writeFile(
    join(userDataDir, HISTORY_FILE),
    next.map((h) => JSON.stringify(h)).join("\n") + (next.length > 0 ? "\n" : ""),
    "utf8",
  );
}

export async function clearHistoryOnDisk(userDataDir: string): Promise<void> {
  await mkdir(userDataDir, { recursive: true });
  await writeFile(join(userDataDir, HISTORY_FILE), "", "utf8");
}

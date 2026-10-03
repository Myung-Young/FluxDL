import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSettings, DownloadJob, JobStatus } from "@grabber/core/types.js";
import { DEFAULT_SETTINGS, mergeSettings } from "@grabber/core/settings.js";

/**
 * File persistence (main process only).
 * - Settings: atomic JSON (`<userData>/grabber-settings.json`).
 * - Queue snapshot: atomic JSON (`<userData>/queue.json`).
 * - History: JSON-lines (`<userData>/history.jsonl`, corrupt lines skipped).
 * All helpers take an explicit dir so tests can use temp dirs.
 *
 * Settings deliberately do NOT use electron-store: v11 is ESM-only, and the
 * main bundle is CommonJS, so `new Store()` threw "Store is not a constructor"
 * and *every* settings write silently failed in the packaged app (D94). The
 * file format is unchanged — a flat JSON object — so existing userData keeps
 * loading. We only ever used defaults + a sanitizing merge, both of which
 * `mergeSettings` already does.
 */

const SETTINGS_FILE = "grabber-settings.json";
const SETTINGS_TMP = "grabber-settings.json.tmp";
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

/**
 * Settings are read synchronously: `DesktopEngine.start()` needs them in the
 * middle of building argv, so an async API would force a signature change for
 * no benefit. Writes are atomic (tmp + rename) like the queue snapshot.
 */
export function loadSettingsFromDisk(userDataDir: string): AppSettings {
  try {
    const file = join(userDataDir, SETTINGS_FILE);
    if (!existsSync(file)) return DEFAULT_SETTINGS;
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(raw)) return DEFAULT_SETTINGS;
    return mergeSettings(DEFAULT_SETTINGS, raw);
  } catch {
    // Corrupt/unreadable settings must never block startup.
    return DEFAULT_SETTINGS;
  }
}

export function saveSettingsToDisk(
  userDataDir: string,
  patch: Partial<AppSettings>,
): AppSettings {
  if (!isRecord(patch)) throw new Error("Invalid settings patch.");
  const merged = mergeSettings(loadSettingsFromDisk(userDataDir), patch);
  const file = join(userDataDir, SETTINGS_FILE);
  const tmp = join(userDataDir, SETTINGS_TMP);
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
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
  // Enforce the keep-last-N prune setting (M2.9).
  let limit = 500;
  try {
    limit = loadSettingsFromDisk(userDataDir).historyLimit;
  } catch {
    // Defaults stand.
  }
  try {
    const lines = (await readFile(join(userDataDir, HISTORY_FILE), "utf8")).split("\n");
    const records = lines.filter((l) => l.trim().length > 0);
    if (records.length > limit) {
      await writeFile(join(userDataDir, HISTORY_FILE), `${records.slice(-limit).join("\n")}\n`, "utf8");
    }
  } catch {
    // Best effort; the append above already landed.
  }
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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSettings, DownloadJob, JobStatus, WatchChannel } from "@grabber/core/types.js";
import { DEFAULT_SETTINGS, mergeSettings } from "@grabber/core/settings.js";
import { normalizeWatchlist } from "@grabber/core/watchlist.js";

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
const HISTORY_TMP = "history.jsonl.tmp";
const WATCHLIST_FILE = "watchlist.json";
const WATCHLIST_TMP = "watchlist.json.tmp";

const STATUSES: readonly JobStatus[] = [
  "queued",
  "analyzing",
  "probing",
  "downloading",
  "processing",
  "paused",
  "done",
  "partial",
  "interrupted",
  "error",
  "postfailed",
  "cancelled",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Corrupt-store recovery (Phase 3): a whole file that no longer parses is
 * renamed to `<file>.corrupt-<ts>` (evidence preserved, never deleted) and
 * the caller gets defaults. Callers report the quarantine via
 * `consumeRecoveryNotices()` so the UI can say what happened.
 */
export function quarantineCorruptFile(file: string): string | null {
  try {
    const backup = `${file}.corrupt-${String(Date.now())}`;
    renameSync(file, backup);
    return backup;
  } catch {
    return null;
  }
}

/** Human-readable recovery notices since the last consume (main-side). */
interface PendingRecovery {
  readonly kind: "settings" | "queue" | "watchlist";
  readonly backup: string | null;
}

const recoveryNotices: PendingRecovery[] = [];

function noteRecovery(kind: PendingRecovery["kind"], file: string): void {
  recoveryNotices.push({ kind, backup: quarantineCorruptFile(file) });
}

/** Drain pending recovery notices (engine exposes this over IPC). */
export function consumeRecoveryNotices(): PendingRecovery[] {
  return recoveryNotices.splice(0, recoveryNotices.length);
}

export function isDownloadJob(value: unknown): value is DownloadJob {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string" || value["id"].length === 0) return false;
  if (typeof value["url"] !== "string" || typeof value["title"] !== "string") return false;
  if (typeof value["outputDir"] !== "string") return false;
  if (typeof value["createdAt"] !== "number" || !Number.isFinite(value["createdAt"])) return false;
  if (typeof value["attempts"] !== "number" || !Number.isFinite(value["attempts"])) return false;
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
  const file = join(userDataDir, SETTINGS_FILE);
  if (!existsSync(file)) return DEFAULT_SETTINGS;
  try {
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(raw)) {
      noteRecovery("settings", file);
      return DEFAULT_SETTINGS;
    }
    return mergeSettings(DEFAULT_SETTINGS, raw);
  } catch {
    // Corrupt/unreadable settings must never block startup.
    noteRecovery("settings", file);
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
    if (!Array.isArray(raw)) {
      noteRecovery("queue", file);
      return [];
    }
    return raw.filter(isDownloadJob);
  } catch {
    noteRecovery("queue", file);
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

/**
 * Serialise the last `limit` records of a history JSONL, or null when the
 * file is already within the limit (no rewrite needed). Pure string work so it
 * is directly testable.
 */
export function pruneHistoryText(text: string, limit: number): string | null {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 500;
  const records = text.split("\n").filter((l) => l.trim().length > 0);
  if (records.length <= cap) return null;
  return `${records.slice(-cap).join("\n")}\n`;
}

/**
 * Live record count per history file, so an append does NOT have to re-read
 * the whole JSONL just to find out whether it is over the limit.
 *
 * v1.7.2: the prune used to read the entire file and rewrite it on EVERY
 * append (plus a synchronous settings read). Restoring a backup appends N
 * records in a loop, which turned that into O(n^2) whole-file rewrites on the
 * Electron main thread — enough to freeze the window for minutes on a
 * 5000-record restore. The count is a hint: it is only ever used to SKIP work,
 * never to decide what to keep, so a stale value can at worst cost one extra
 * read (or miss one prune until the next append).
 */
const historyCounts = new Map<string, number>();

function historyFilePath(userDataDir: string): string {
  return join(userDataDir, HISTORY_FILE);
}

async function historyRecordCount(file: string): Promise<number> {
  try {
    const text = await readFile(file, "utf8");
    return text.split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

export async function appendHistoryToDisk(userDataDir: string, job: DownloadJob): Promise<void> {
  if (!isDownloadJob(job)) throw new Error("Invalid history entry.");
  await mkdir(userDataDir, { recursive: true });
  const file = historyFilePath(userDataDir);
  await appendFile(file, `${JSON.stringify(job)}\n`, "utf8");
  // Enforce the keep-last-N prune setting (M2.9).
  let limit = 500;
  try {
    limit = loadSettingsFromDisk(userDataDir).historyLimit;
  } catch {
    // Defaults stand.
  }
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 500;
  const cached = historyCounts.get(file);
  const count = cached === undefined ? await historyRecordCount(file) : cached + 1;
  historyCounts.set(file, count);
  if (count <= cap) return;
  try {
    const text = await readFile(file, "utf8");
    const pruned = pruneHistoryText(text, cap);
    historyCounts.set(file, cap);
    if (pruned === null) return;
    await writeFile(file, pruned, "utf8");
  } catch {
    // Best effort; the append above already landed.
  }
}

/**
 * Replace the whole history in ONE atomic write (tmp + rename).
 *
 * v1.7.2: backup restore used to `clearHistory()` and then append the records
 * one by one, swallowing every failure. Any error mid-loop left the user with
 * no history at all while the UI reported "restored N". A single atomic write
 * either lands completely or not at all — and it also removes the N-appends
 * path entirely.
 */
export async function restoreHistoryToDisk(
  userDataDir: string,
  jobs: readonly DownloadJob[],
): Promise<void> {
  const clean = jobs.filter(isDownloadJob);
  await mkdir(userDataDir, { recursive: true });
  const finalPath = historyFilePath(userDataDir);
  const tmpPath = join(userDataDir, HISTORY_TMP);
  await writeFile(
    tmpPath,
    clean.map((h) => JSON.stringify(h)).join("\n") + (clean.length > 0 ? "\n" : ""),
    "utf8",
  );
  await rename(tmpPath, finalPath);
  historyCounts.set(finalPath, clean.length);
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
  const file = historyFilePath(userDataDir);
  await writeFile(file, kept.map((h) => JSON.stringify(h)).join("\n") + (kept.length > 0 ? "\n" : ""), "utf8");
  historyCounts.set(file, kept.length);
}

/** Replace one history record (matched by id; appended when absent). */
export async function updateHistoryOnDisk(userDataDir: string, job: DownloadJob): Promise<void> {
  if (!isDownloadJob(job)) throw new Error("Invalid history entry.");
  const loaded = await loadHistoryFromDisk(userDataDir);
  const next = loaded.some((h) => h.id === job.id)
    ? loaded.map((h) => (h.id === job.id ? job : h))
    : [...loaded, job];
  await mkdir(userDataDir, { recursive: true });
  const file = historyFilePath(userDataDir);
  await writeFile(file, next.map((h) => JSON.stringify(h)).join("\n") + (next.length > 0 ? "\n" : ""), "utf8");
  historyCounts.set(file, next.length);
}

export async function clearHistoryOnDisk(userDataDir: string): Promise<void> {
  await mkdir(userDataDir, { recursive: true });
  const file = historyFilePath(userDataDir);
  await writeFile(file, "", "utf8");
  historyCounts.set(file, 0);
}

/** Watched channels (atomic JSON like the queue snapshot). */
export async function loadWatchlistFromDisk(userDataDir: string): Promise<WatchChannel[]> {
  const file = join(userDataDir, WATCHLIST_FILE);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
    return normalizeWatchlist(raw);
  } catch {
    noteRecovery("watchlist", file);
    return [];
  }
}

export async function saveWatchlistToDisk(
  userDataDir: string,
  channels: readonly WatchChannel[],
): Promise<void> {
  const clean = normalizeWatchlist(channels);
  await mkdir(userDataDir, { recursive: true });
  const finalPath = join(userDataDir, WATCHLIST_FILE);
  const tmpPath = join(userDataDir, WATCHLIST_TMP);
  await writeFile(tmpPath, JSON.stringify(clean), "utf8");
  await rename(tmpPath, finalPath);
}

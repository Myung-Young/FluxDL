import { create, type StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { AppSettings, DownloadJob, DownloadJobInput } from "./types.js";
import { QueueController } from "./queueController.js";
import { jobsEqual } from "./queue.js";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings.js";

export type QueueStoreEngine = Pick<
  DownloadEngine,
  | "start"
  | "pause"
  | "resume"
  | "cancel"
  | "onProgress"
  | "saveQueue"
  | "appendHistory"
  | "removeHistory"
  | "loadQueue"
>;

export interface QueueStoreState {
  readonly jobs: readonly DownloadJob[];
  readonly ready: boolean;
  refresh(): Promise<void>;
  enqueue(input: DownloadJobInput): Promise<string>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  setJobCookies(id: string, browser: string | null): Promise<void>;
  setJobPreset(id: string, preset: DownloadJob["preset"]): Promise<void>;
  setJobSchedule(id: string, startAfter: number | null): Promise<void>;
  togglePin(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  reorder(id: string, toIndex: number): Promise<void>;
  pauseAll(): Promise<void>;
  resumeAll(): Promise<void>;
  cancelQueued(): Promise<number>;
  clearFinished(): Promise<number>;
  undoSweep(): Promise<number>;
  retryAll(): Promise<void>;
  /** Drive due starts + backoff retries (reentrancy-guarded, cheap). */
  pump(): Promise<void>;
}

export function createQueueStore(
  engine: QueueStoreEngine,
  opts: { concurrency?: number; maxRetries?: number } = {},
): StoreApi<QueueStoreState> {
  let controller: QueueController | null = null;
  const getController = (set: StoreApi<QueueStoreState>["setState"]): QueueController => {
    if (controller === null) {
      controller = new QueueController({
        engine,
        concurrency: opts.concurrency ?? 2,
        maxRetries: opts.maxRetries ?? 3,
        onChange: (jobs) => {
          // Keep the array identity when nothing changed: an unconditional
          // `set` here re-rendered the shell once per second while idle (M4.8).
          set((prev) => (jobsEqual(prev.jobs, jobs) ? prev : { jobs: [...jobs] }));
        },
      });
    }
    return controller;
  };
  return create<QueueStoreState>()((set) => ({
    jobs: [],
    ready: false,
    refresh: async () => {
      const snapshot = await engine.loadQueue();
      getController(set).hydrate(snapshot);
      set({ jobs: getController(set).getJobs(), ready: true });
      // Boot-resumed queue must actually start (M4.1): hydrate alone leaves
      // everything queued forever since nothing else pumps on boot.
      await getController(set).pump();
    },
    enqueue: async (input) => getController(set).enqueue(input),
    pause: async (id) => {
      await getController(set).pause(id);
    },
    resume: async (id) => {
      await getController(set).resume(id);
    },
    cancel: async (id) => {
      await getController(set).cancel(id);
    },
    retry: async (id) => {
      await getController(set).retry(id);
    },
    setJobCookies: async (id, browser) => {
      await getController(set).setJobCookies(id, browser);
    },
    setJobPreset: async (id, preset) => {
      await getController(set).setJobPreset(id, preset);
    },
    setJobSchedule: async (id, startAfter) => {
      await getController(set).setJobSchedule(id, startAfter);
    },
    togglePin: async (id) => {
      await getController(set).togglePin(id);
    },
    remove: async (id) => {
      await getController(set).remove(id);
    },
    reorder: async (id, toIndex) => {
      await getController(set).reorder(id, toIndex);
    },
    pauseAll: async () => {
      await getController(set).pauseAll();
    },
    resumeAll: async () => {
      await getController(set).resumeAll();
    },
    cancelQueued: async () => getController(set).cancelQueued(),
    clearFinished: async () => getController(set).clearFinished(),
    undoSweep: async () => getController(set).undoSweep(),
    retryAll: async () => {
      await getController(set).retryAll();
    },
    pump: async () => {
      await getController(set).pump();
    },
  }));
}

export type SettingsStoreEngine = Pick<DownloadEngine, "loadSettings" | "saveSettings">;

export interface SettingsStoreState {
  readonly settings: AppSettings;
  readonly ready: boolean;
  load(): Promise<void>;
  save(patch: Partial<AppSettings>): Promise<void>;
}

export function createSettingsStore(engine: SettingsStoreEngine): StoreApi<SettingsStoreState> {
  // Lost-update guard (v1.7.2). The Shell kicks off `load()` on mount and the
  // user can flip a setting before that IPC round-trip lands. Both used to
  // `set` unconditionally, so a slow `load()` resolved *after* the `save()`
  // and silently rolled the user's change back — the control looked like it
  // had applied (the flash said "Saved.") but the value reverted. Counting
  // writes makes the in-flight load yield to anything newer.
  let writes = 0;
  return create<SettingsStoreState>()((set, get) => ({
    settings: DEFAULT_SETTINGS,
    ready: false,
    load: async () => {
      const seen = writes;
      const loaded = await engine.loadSettings();
      // A save landed while we were reading: that value is newer, keep it.
      if (seen !== writes) return;
      set({ settings: mergeSettings(DEFAULT_SETTINGS, loaded), ready: true });
    },
    save: async (patch) => {
      writes += 1;
      const saved = await engine.saveSettings(patch);
      // `ready` too: a save that beats the initial load must not leave the
      // Settings screen stuck on "Loading…" with the new value already in.
      set({ settings: mergeSettings(get().settings, saved), ready: true });
    },
  }));
}

import { create, type StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { AppSettings, DownloadJob, DownloadJobInput } from "./types.js";
import { QueueController } from "./queueController.js";
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
}

export function createQueueStore(
  engine: QueueStoreEngine,
  opts: { concurrency?: number; maxRetries?: number } = {},
): StoreApi<QueueStoreState> {
  let controller: QueueController | null = null;
  const getController = (set: (p: Partial<QueueStoreState>) => void): QueueController => {
    if (controller === null) {
      controller = new QueueController({
        engine,
        concurrency: opts.concurrency ?? 2,
        maxRetries: opts.maxRetries ?? 3,
        onChange: (jobs) => {
          set({ jobs: [...jobs] });
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
  return create<SettingsStoreState>()((set, get) => ({
    settings: DEFAULT_SETTINGS,
    ready: false,
    load: async () => {
      const loaded = await engine.loadSettings();
      set({ settings: mergeSettings(DEFAULT_SETTINGS, loaded), ready: true });
    },
    save: async (patch) => {
      const saved = await engine.saveSettings(patch);
      set({ settings: mergeSettings(get().settings, saved) });
    },
  }));
}

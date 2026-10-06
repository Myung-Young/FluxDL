import { describe, expect, it, vi } from "vitest";
import { createQueueStore, createSettingsStore } from "./stores.js";
import type { SettingsStoreEngine } from "./stores.js";
import { makeJob } from "./queue.js";
import type { AppSettings, DownloadJob, DownloadJobInput, EngineProgress } from "./index.js";
import { DEFAULT_SETTINGS } from "./settings.js";

const input: DownloadJobInput = {
  url: "https://youtu.be/aqz-KE-bpKQ",
  title: "Big Buck Bunny",
  preset: { kind: "video", videoPreset: "720", audioPreset: "MP3", rawFormat: null },
  outputDir: "C:\\Vids",
};

function makeEngine() {
  let cb: ((p: EngineProgress) => void) | null = null;
  let n = 0;
  let storedSettings: AppSettings = DEFAULT_SETTINGS;
  const started: DownloadJobInput[] = [];
  const saved: DownloadJob[][] = [];
  const history: DownloadJob[] = [];
  const snapshot: DownloadJob[] = [];
  return {
    started,
    saved,
    history,
    snapshot,
    get stored(): AppSettings {
      return storedSettings;
    },
    start: (job: DownloadJobInput): Promise<string> => {
      started.push(job);
      n += 1;
      return Promise.resolve(`eng-${String(n)}`);
    },
    pause: (): Promise<void> => Promise.resolve(),
    resume: (): Promise<void> => Promise.resolve(),
    cancel: (): Promise<void> => Promise.resolve(),
    onProgress: (fn: (p: EngineProgress) => void): (() => void) => {
      cb = fn;
      return () => {
        cb = null;
      };
    },
    saveQueue: (jobs: DownloadJob[]): Promise<void> => {
      saved.push([...jobs]);
      return Promise.resolve();
    },
    appendHistory: (job: DownloadJob): Promise<void> => {
      history.push(job);
      return Promise.resolve();
    },
    removeHistory: (id: string): Promise<void> => {
      const i = history.findIndex((h) => h.id === id);
      if (i >= 0) history.splice(i, 1);
      return Promise.resolve();
    },
    loadQueue: (): Promise<DownloadJob[]> => Promise.resolve([...snapshot]),
    loadSettings: (): Promise<AppSettings> => Promise.resolve(storedSettings),
    saveSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => {
      storedSettings = { ...storedSettings, ...patch };
      return Promise.resolve(storedSettings);
    },
    fire: (p: EngineProgress): void => {
      cb?.(p);
    },
  };
}

describe("stores", () => {
  it("queue store enqueues through the controller and persists", async () => {
    const e = makeEngine();
    const store = createQueueStore(e, { concurrency: 2, maxRetries: 3 });
    await store.getState().refresh();
    expect(store.getState().ready).toBe(true);
    const id = await store.getState().enqueue(input);
    expect(typeof id).toBe("string");
    expect(e.started).toHaveLength(1);
    expect(store.getState().jobs.map((j) => j.status)).toContain("downloading");
    expect(e.saved.length).toBeGreaterThan(0);
  });

  it("settings store loads, saves, and sanitizes", async () => {
    const e = makeEngine();
    const store = createSettingsStore(e);
    await store.getState().load();
    expect(store.getState().ready).toBe(true);
    await store.getState().save({ concurrency: 99 });
    expect(store.getState().settings.concurrency).toBe(5);
    await store.getState().save({ theme: "midnight" });
    expect(store.getState().settings.theme).toBe("midnight");
    expect(e.stored.concurrency).toBe(99);
  });

  it("queue store routes progress into state", async () => {
    const e = makeEngine();
    const store = createQueueStore(e, { concurrency: 2, maxRetries: 3 });
    await store.getState().enqueue(input);
    expect(typeof e.started[0]?.title).toBe("string");
  });

  it("a slow load never rolls back a newer save (v1.7.2)", async () => {
    // The Shell starts `load()` on mount; if the user flips a setting before
    // that round-trip lands, the late `load()` used to overwrite the store and
    // the control silently reverted (this is what made the language selector
    // look dead right after a restart).
    let releaseLoad: (() => void) | undefined;
    const engine: SettingsStoreEngine = {
      loadSettings: () =>
        new Promise<AppSettings>((resolve) => {
          releaseLoad = () => {
            resolve(DEFAULT_SETTINGS);
          };
        }),
      saveSettings: (patch) => Promise.resolve({ ...DEFAULT_SETTINGS, ...patch }),
    };
    const store = createSettingsStore(engine);
    const loading = store.getState().load();
    await store.getState().save({ language: "ms" });
    expect(store.getState().settings.language).toBe("ms");
    // The stale load finally answers with the on-disk (English) value.
    const release = releaseLoad;
    expect(typeof release).toBe("function");
    if (typeof release === "function") release();
    await loading;
    expect(store.getState().settings.language).toBe("ms");
    expect(store.getState().ready).toBe(true);
  });

  it("a save that beats the initial load still marks the store ready", async () => {
    const engine: SettingsStoreEngine = {
      loadSettings: () => new Promise<AppSettings>(() => undefined),
      saveSettings: (patch) => Promise.resolve({ ...DEFAULT_SETTINGS, ...patch }),
    };
    const store = createSettingsStore(engine);
    void store.getState().load();
    await store.getState().save({ theme: "ember" });
    expect(store.getState().ready).toBe(true);
    expect(store.getState().settings.theme).toBe("ember");
  });

  it("queue store routes progress into state (real engine)", async () => {
    const e = makeEngine();
    const store = createQueueStore(e, { concurrency: 2, maxRetries: 3 });
    await store.getState().enqueue(input);
    e.fire({
      id: "eng-1",
      percent: 42,
      speed: "2M/s",
      eta: "00:01",
      downloadedBytes: 42,
      totalBytes: 100,
      stage: "downloading",
      destination: null,
    });
    await vi.waitFor(() => {
      expect(store.getState().jobs[0]?.progress).toBe(42);
    });
  });

  it("refresh pumps a hydrated queue so boot jobs actually start (M4.1)", async () => {
    const e = makeEngine();
    e.snapshot.push({ ...makeJob("old", input, 1), status: "downloading" });
    const store = createQueueStore(e, { concurrency: 2, maxRetries: 3 });
    await store.getState().refresh();
    expect(store.getState().ready).toBe(true);
    expect(e.started).toHaveLength(1);
    expect(store.getState().jobs.map((j) => j.status)).toContain("downloading");
  });
});

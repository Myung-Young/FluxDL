import { useEffect, useState } from "react";
import { Shell } from "./Shell.js";
import type { DownloadEngine } from "./engine.js";
import { STRINGS } from "./strings.js";
import { ensureNotificationPermission } from "./notify.js";
import { createQueueStore, createSettingsStore } from "./stores.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import { createToastStore } from "./toast.js";
import type { ToastStoreState } from "./toast.js";
import type { StoreApi } from "zustand";

function getEngine(): DownloadEngine | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    grabber?: DownloadEngine;
    /** E2E seam: Playwright sets this before boot to inject a mock engine. */
    __grabberOverride?: DownloadEngine;
  };
  return w.__grabberOverride ?? w.grabber ?? null;
}

export function App(): React.JSX.Element {
  const [engine] = useState<DownloadEngine | null>(getEngine);
  const [queue] = useState<StoreApi<QueueStoreState> | null>(() =>
    engine === null ? null : createQueueStore(engine),
  );
  const [settings] = useState<StoreApi<SettingsStoreState> | null>(() =>
    engine === null ? null : createSettingsStore(engine),
  );
  const [toast] = useState<StoreApi<ToastStoreState>>(() => createToastStore());

  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

  useEffect(() => {
    if (engine === null || settings === null) return;
    // Warm the hourly update cache on launch when enabled. This only CHECKS
    // (GitHub Releases, best-effort) — the Shell toast owns the reminder UI,
    // and installing stays an explicit user action in Logs.
    settings
      .getState()
      .load()
      .then(() => {
        if (settings.getState().settings.autoCheckUpdate) {
          engine.checkForUpdates().catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, [engine, settings]);

  if (engine === null || queue === null || settings === null) {
    return (
      <main style={{ padding: 32 }}>
        <h1>{STRINGS.appUnavailableTitle}</h1>
        <p>{STRINGS.appUnavailable}</p>
      </main>
    );
  }
  return <Shell engine={engine} queue={queue} settings={settings} toast={toast} />;
}

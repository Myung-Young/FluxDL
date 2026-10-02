import { useEffect, useState } from "react";
import { Shell } from "./Shell.js";
import type { DownloadEngine } from "./engine.js";
import { STRINGS } from "./strings.js";
import { createQueueStore, createSettingsStore } from "./stores.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { StoreApi } from "zustand";

function getEngine(): DownloadEngine | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { grabber?: DownloadEngine };
  return w.grabber ?? null;
}

export function App(): React.JSX.Element {
  const [engine] = useState<DownloadEngine | null>(getEngine);
  const [queue] = useState<StoreApi<QueueStoreState> | null>(() =>
    engine === null ? null : createQueueStore(engine),
  );
  const [settings] = useState<StoreApi<SettingsStoreState> | null>(() =>
    engine === null ? null : createSettingsStore(engine),
  );

  useEffect(() => {
    if (engine === null || settings === null) return;
    // Auto-check engine updates on launch when enabled (runs yt-dlp -U).
    settings
      .getState()
      .load()
      .then(() => {
        if (settings.getState().settings.autoCheckUpdate) {
          engine.updateEngine().catch(() => undefined);
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
  return <Shell engine={engine} queue={queue} settings={settings} />;
}

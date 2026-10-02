import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine, EngineVersions } from "./engine.js";
import type { DownloadJob } from "./types.js";
import { STRINGS } from "./strings.js";
import { pressScale } from "./motion.js";
import type { QueueStoreState } from "./stores.js";

export interface LogsProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
}

export function Logs({ engine, queue }: LogsProps): React.JSX.Element {
  const jobs = useStore(queue, (s) => s.jobs);
  const [versions, setVersions] = useState<EngineVersions | null>(null);
  const [history, setHistory] = useState<readonly DownloadJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logText, setLogText] = useState<string | null>(null);
  const [updating, setUpdating] = useState<boolean>(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);

  const refreshVersions = useCallback(async (): Promise<void> => {
    const v = await engine.getEngineVersion().catch(() => null);
    setVersions(v);
  }, [engine]);

  useEffect(() => {
    void refreshVersions();
    engine
      .loadHistory()
      .then((h) => {
        setHistory(h);
      })
      .catch(() => undefined);
  }, [engine, refreshVersions]);

  const checkUpdate = async (): Promise<void> => {
    setUpdating(true);
    setUpdateNote(null);
    try {
      const v = await engine.updateEngine();
      setVersions(v);
      setUpdateNote(STRINGS.logs.upToDate);
    } catch {
      setUpdateNote(STRINGS.logs.updateFailed);
    } finally {
      setUpdating(false);
    }
  };

  const viewLog = async (id: string): Promise<void> => {
    setSelectedId(id);
    const text = await engine.getRawLog(id).catch(() => null);
    setLogText(text);
  };

  const rows: readonly DownloadJob[] = [...jobs, ...history];

  return (
    <section className="grabber-view" aria-label={STRINGS.logs.title}>
      <h1>{STRINGS.logs.title}</h1>
      <div className="grabber-card">
        <h2 className="dl-title">{STRINGS.logs.engineVersions}</h2>
        <p className="muted">
          {STRINGS.logs.appVersion}: {versions?.app ?? "…"} · {STRINGS.logs.ytdlpVersion}:{" "}
          {versions?.ytdlp ?? "…"} · {STRINGS.logs.ffmpegVersion}: {versions?.ffmpeg ?? "…"}
        </p>
        <button
          type="button"
          className="btn"
          disabled={updating}
          onPointerDown={(e) => {
            pressScale(e.currentTarget);
          }}
          onClick={() => {
            void checkUpdate();
          }}
        >
          {updating ? STRINGS.logs.updating : STRINGS.logs.checkUpdate}
        </button>
        {updateNote !== null && (
          <p className="note" role="status">
            {updateNote}
          </p>
        )}
      </div>

      <div className="grabber-card">
        <div className="chip-row">
          {rows.map((j) => (
            <button
              key={j.id}
              type="button"
              className="chip"
              aria-pressed={selectedId === j.id}
              onClick={() => {
                void viewLog(j.id);
              }}
            >
              {STRINGS.logs.viewLog}: {j.title.slice(0, 24)}
            </button>
          ))}
        </div>
        <pre className="log-pre" aria-live="polite">
          {logText ?? STRINGS.logs.logPlaceholder}
        </pre>
      </div>

      <div className="grabber-card">
        <p className="muted">{STRINGS.logs.copyrightNote}</p>
      </div>
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine, EngineVersions } from "./engine.js";
import type { DownloadJob } from "./types.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { useStrings } from "./locale.js";
import { pressScale } from "./motion.js";
import { buildDiagnostics } from "./diagnostics.js";
import { writeClipboardText } from "./clipboard.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";

export interface LogsProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
}

export function Logs({ engine, queue, settings }: LogsProps): React.JSX.Element {
  const S = useStrings(settings);
  const jobs = useStore(queue, (s) => s.jobs);
  const [versions, setVersions] = useState<EngineVersions | null>(null);
  const [history, setHistory] = useState<readonly DownloadJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logText, setLogText] = useState<string | null>(null);
  const [updating, setUpdating] = useState<boolean>(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [repairing, setRepairing] = useState<boolean>(false);
  const [repairNote, setRepairNote] = useState<string | null>(null);
  const [includeUrls, setIncludeUrls] = useState<boolean>(false);
  const [report, setReport] = useState<string | null>(null);
  const [diagNote, setDiagNote] = useState<string | null>(null);

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
      setUpdateNote(S.logs.upToDate);
    } catch {
      setUpdateNote(S.logs.updateFailed);
    } finally {
      setUpdating(false);
    }
  };

  const repair = async (): Promise<void> => {
    setRepairing(true);
    setRepairNote(null);
    try {
      const report = await engine.repairEngine();
      setRepairNote(report.ok ? S.logs.repaired : S.logs.repairFailed);
      if (report.versions !== null) setVersions(report.versions);
    } catch {
      setRepairNote(S.logs.repairFailed);
    } finally {
      setRepairing(false);
    }
  };

  const viewLog = async (id: string): Promise<void> => {
    setSelectedId(id);
    const text = await engine.getRawLog(id).catch(() => null);
    setLogText(text);
  };

  const buildReport = async (): Promise<string | null> => {
    const [loadedSettings, loadedHistory] = await Promise.all([
      engine.loadSettings().catch(() => DEFAULT_SETTINGS),
      engine.loadHistory().catch(() => [] as DownloadJob[]),
    ]);
    const errorEvents = loadedHistory
      .filter((h) => h.status === "error")
      .slice(-10)
      .map((h) => ({
        at: h.createdAt,
        category: h.errorCategory ?? "unknown",
        message: h.error ?? "",
      }));
    const jobTitle = rows.find((j) => j.id === selectedId)?.title ?? null;
    const text = buildDiagnostics({
      versions: versions ?? { ytdlp: "unknown", ffmpeg: null, app: "unknown" },
      settings: loadedSettings,
      errorEvents,
      logTail: logText,
      logJobTitle: jobTitle,
      includeUrls,
    });
    setReport(text);
    return text;
  };

  const copyReport = async (): Promise<void> => {
    const text = (await buildReport().catch(() => null)) ?? report;
    if (text === null) return;
    const ok = await writeClipboardText(text);
    setDiagNote(ok ? S.diagnostics.copied : S.menu.copyFailed);
  };

  const saveReport = async (): Promise<void> => {
    const text = (await buildReport().catch(() => null)) ?? report;
    if (text === null) return;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "fluxdl-diagnostics.txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 5000);
    setDiagNote(S.diagnostics.saved);
  };

  const rows: readonly DownloadJob[] = [...jobs, ...history];

  return (
    <section className="grabber-view" aria-label={S.logs.title}>
      <h1>{S.logs.title}</h1>
      <div className="grabber-card">
        <h2 className="dl-title">{S.logs.engineVersions}</h2>
        <p className="muted">
          {S.logs.appVersion}: {versions?.app ?? "…"} · {S.logs.ytdlpVersion}:{" "}
          {versions?.ytdlp ?? "…"} · {S.logs.ffmpegVersion}: {versions?.ffmpeg ?? "…"}
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
          {updating ? S.logs.updating : S.logs.checkUpdate}
        </button>
        <button
          type="button"
          className="btn"
          disabled={repairing}
          data-testid="logs-repair"
          onPointerDown={(e) => {
            pressScale(e.currentTarget);
          }}
          onClick={() => {
            void repair();
          }}
        >
          {repairing ? S.logs.repairing : S.logs.repairEngine}
        </button>
        {updateNote !== null && (
          <p className="note" role="status">
            {updateNote}
          </p>
        )}
        {repairNote !== null && (
          <p className="note" role="status">
            {repairNote}
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
              {S.logs.viewLog}: {j.title.slice(0, 24)}
            </button>
          ))}
        </div>
        <pre className="log-pre" aria-live="polite">
          {logText ?? S.logs.logPlaceholder}
        </pre>
      </div>

      <div className="grabber-card">
        <p className="muted">{S.logs.copyrightNote}</p>
      </div>

      <div className="grabber-card">
        <h2 className="dl-title">{S.diagnostics.reportTitle}</h2>
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeUrls}
            onChange={(e) => {
              setIncludeUrls(e.target.checked);
            }}
          />
          {S.diagnostics.includeUrls}
        </label>
        <div className="chip-row">
          <button
            type="button"
            className="btn"
            data-testid="logs-diag-copy"
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              void copyReport();
            }}
          >
            {S.diagnostics.copy}
          </button>
          <button
            type="button"
            className="btn"
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              void saveReport();
            }}
          >
            {S.diagnostics.save}
          </button>
        </div>
        {diagNote !== null && (
          <p className="note" role="status">
            {diagNote}
          </p>
        )}
        {report !== null && (
          <details>
            <summary>{S.diagnostics.preview}</summary>
            <pre className="log-pre" data-testid="diag-preview">
              {report}
            </pre>
          </details>
        )}
      </div>
    </section>
  );
}

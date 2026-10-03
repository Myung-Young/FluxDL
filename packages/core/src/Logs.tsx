import { useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine, EngineVersions } from "./engine.js";
import type { DownloadJob } from "./types.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { STRINGS } from "./strings.js";
import { pressScale } from "./motion.js";
import { buildDiagnostics } from "./diagnostics.js";
import { writeClipboardText } from "./clipboard.js";
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
      setUpdateNote(STRINGS.logs.upToDate);
    } catch {
      setUpdateNote(STRINGS.logs.updateFailed);
    } finally {
      setUpdating(false);
    }
  };

  const repair = async (): Promise<void> => {
    setRepairing(true);
    setRepairNote(null);
    try {
      const report = await engine.repairEngine();
      setRepairNote(report.ok ? STRINGS.logs.repaired : STRINGS.logs.repairFailed);
      if (report.versions !== null) setVersions(report.versions);
    } catch {
      setRepairNote(STRINGS.logs.repairFailed);
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
    setDiagNote(ok ? STRINGS.diagnostics.copied : STRINGS.menu.copyFailed);
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
    setDiagNote(STRINGS.diagnostics.saved);
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
          {repairing ? STRINGS.logs.repairing : STRINGS.logs.repairEngine}
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

      <div className="grabber-card">
        <h2 className="dl-title">{STRINGS.diagnostics.reportTitle}</h2>
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeUrls}
            onChange={(e) => {
              setIncludeUrls(e.target.checked);
            }}
          />
          {STRINGS.diagnostics.includeUrls}
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
            {STRINGS.diagnostics.copy}
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
            {STRINGS.diagnostics.save}
          </button>
        </div>
        {diagNote !== null && (
          <p className="note" role="status">
            {diagNote}
          </p>
        )}
        {report !== null && (
          <details>
            <summary>{STRINGS.diagnostics.preview}</summary>
            <pre className="log-pre" data-testid="diag-preview">
              {report}
            </pre>
          </details>
        )}
      </div>
    </section>
  );
}

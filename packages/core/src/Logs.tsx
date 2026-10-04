import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine, EngineVersions, UpdateStatus } from "./engine.js";
import type { DownloadJob } from "./types.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { formatStr, useStrings } from "./locale.js";
import { pressScale } from "./motion.js";
import { buildDiagnostics } from "./diagnostics.js";
import { countLogMatches, filterLogLines } from "./logFilter.js";
import { writeClipboardText } from "./clipboard.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";
import { nextPatchVersion } from "./updates.js";

export interface LogsProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
}

export function Logs({ engine, queue, settings, toast }: LogsProps): React.JSX.Element {
  const S = useStrings(settings);
  const jobs = useStore(queue, (s) => s.jobs);
  const [versions, setVersions] = useState<EngineVersions | null>(null);
  const [history, setHistory] = useState<readonly DownloadJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logText, setLogText] = useState<string | null>(null);
  const [updating, setUpdating] = useState<boolean>(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [checking, setChecking] = useState<boolean>(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checkFailed, setCheckFailed] = useState<boolean>(false);
  const [repairing, setRepairing] = useState<boolean>(false);
  const [repairNote, setRepairNote] = useState<string | null>(null);
  const [includeUrls, setIncludeUrls] = useState<boolean>(false);
  const [report, setReport] = useState<string | null>(null);
  const [diagNote, setDiagNote] = useState<string | null>(null);
  const [logQuery, setLogQuery] = useState<string>("");
  const [errorsOnly, setErrorsOnly] = useState<boolean>(false);
  const [follow, setFollow] = useState<boolean>(true);
  const [logNote, setLogNote] = useState<string | null>(null);
  const logPreRef = useRef<HTMLPreElement | null>(null);

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

  const checkUpdates = async (): Promise<void> => {
    setChecking(true);
    setCheckFailed(false);
    try {
      setUpdateStatus(await engine.checkForUpdates());
    } catch {
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  };

  // Demo: preview the exact launch reminder without a real newer release.
  // Builds a fake "one patch ahead" status, fills the card above, and fires
  // the same toast the auto-check would (same message + Get update action).
  const demoReminder = async (): Promise<void> => {
    const v = await engine.getEngineVersion().catch(() => null);
    const cur = v?.app ?? "1.5.0";
    const fake: UpdateStatus = {
      appCurrent: cur,
      appLatest: nextPatchVersion(cur),
      appUpdate: true,
      appUrl: "https://github.com/Myung-Young/FluxDL/releases",
      ytdlpCurrent: v?.ytdlp ?? "unknown",
      ytdlpLatest: null,
      ytdlpUpdate: false,
      checkedAt: Date.now(),
    };
    setCheckFailed(false);
    setUpdateStatus(fake);
    toast.getState().push(
      formatStr(S.logs.appUpdateReady, { v: fake.appLatest ?? "?", cur: fake.appCurrent }),
      "info",
      {
        label: S.logs.getUpdate,
        run: () => {
          engine.openExternal(fake.appUrl).catch(() => undefined);
        },
      },
    );
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

  // Follow live output: pin the scroll to the tail on new log text.
  useEffect(() => {
    if (!follow) return;
    const el = logPreRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [logText, follow]);

  const filtering = logQuery.trim().length > 0 || errorsOnly;
  const logSource = logText ?? S.logs.logPlaceholder;
  const shownLog = filtering ? filterLogLines(logSource, logQuery, errorsOnly).join("\n") : logSource;
  const matchCount = filtering ? countLogMatches(logSource, logQuery, errorsOnly) : null;

  const copyLog = async (): Promise<void> => {
    const ok = await writeClipboardText(shownLog);
    setLogNote(ok ? S.logs.logCopied : S.menu.copyFailed);
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
        <h2 className="dl-title">{S.logs.checkUpdates}</h2>
        <div className="chip-row">
          <button
            type="button"
            className="btn"
            disabled={checking}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              void checkUpdates();
            }}
          >
            {checking ? S.logs.checkingUpdates : S.logs.checkUpdates}
          </button>
          <button
            type="button"
            className="btn btn-small"
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              void demoReminder();
            }}
          >
            {S.logs.demoUpdate}
          </button>
          {updateStatus !== null && updateStatus.appUpdate && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                engine.openExternal(updateStatus.appUrl).catch(() => undefined);
              }}
            >
              {S.logs.getUpdate}
            </button>
          )}
        </div>
        {checkFailed && (
          <p className="error-text" role="alert">
            {S.logs.updateCheckFailed}
          </p>
        )}
        {updateStatus !== null && (
          <>
            <p className="muted" role="status">
              {updateStatus.appUpdate
                ? formatStr(S.logs.appUpdateReady, {
                    v: updateStatus.appLatest ?? "?",
                    cur: updateStatus.appCurrent,
                  })
                : formatStr(S.logs.appUpToDate, { v: updateStatus.appCurrent })}
            </p>
            <p className="muted" role="status">
              {updateStatus.ytdlpUpdate
                ? formatStr(S.logs.ytdlpUpdateReady, { v: updateStatus.ytdlpLatest ?? "?" })
                : formatStr(S.logs.ytdlpUpToDate, { v: updateStatus.ytdlpCurrent })}
            </p>
          </>
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
        <div className="url-row">
          <input
            id="logs-search"
            data-testid="logs-search"
            className="input"
            value={logQuery}
            placeholder={S.logs.search}
            aria-label={S.logs.search}
            spellCheck={false}
            onChange={(e) => {
              setLogQuery(e.target.value);
            }}
          />
          {logQuery.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setLogQuery("");
              }}
            >
              {S.logs.clearSearch}
            </button>
          )}
        </div>
        <div className="chip-row">
          <label className="check-row">
            <input
              type="checkbox"
              checked={errorsOnly}
              onChange={(e) => {
                setErrorsOnly(e.target.checked);
              }}
            />
            {S.logs.errorsOnly}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => {
                setFollow(e.target.checked);
              }}
            />
            {S.logs.follow}
          </label>
          <button
            type="button"
            className="btn btn-small"
            disabled={selectedId === null}
            onClick={() => {
              if (selectedId !== null) void viewLog(selectedId);
            }}
          >
            {S.logs.refresh}
          </button>
          <button
            type="button"
            className="btn btn-small"
            data-testid="logs-copy-log"
            onClick={() => {
              void copyLog();
            }}
          >
            {S.logs.copyLog}
          </button>
        </div>
        {matchCount !== null && (
          <p className="muted" role="status">
            {matchCount === 0
              ? S.logs.noMatch
              : formatStr(S.logs.matchCount, { n: matchCount })}
          </p>
        )}
        {logNote !== null && (
          <p className="note" role="status">
            {logNote}
          </p>
        )}
        <pre ref={logPreRef} className="log-pre" aria-live="polite">
          {shownLog}
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

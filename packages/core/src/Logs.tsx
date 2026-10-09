import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine, EngineVersions, UpdateStatus } from "./engine.js";
import { formatSize } from "./media.js";
import type { DownloadJob } from "./types.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { formatStr, useStrings } from "./locale.js";
import { pressScale } from "./motion.js";
import { buildDiagnostics } from "./diagnostics.js";
import { countLogMatches, filterLogLines } from "./logFilter.js";
import { writeClipboardText } from "./clipboard.js";
import { buildIssueUrl } from "./updates.js";
import { clearCrashReports, readCrashReports } from "./ErrorBoundary.js";
import thirdPartyNotices from "../../../THIRD_PARTY_NOTICES.md?raw";
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
  const [checking, setChecking] = useState<boolean>(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checkFailed, setCheckFailed] = useState<boolean>(false);
  const [repairing, setRepairing] = useState<boolean>(false);
  const [repairNote, setRepairNote] = useState<string | null>(null);
  const [includeUrls, setIncludeUrls] = useState<boolean>(false);
  const [report, setReport] = useState<string | null>(null);
  const [diagNote, setDiagNote] = useState<string | null>(null);
  const [logQuery, setLogQuery] = useState<string>("");
  const [cmdArgs, setCmdArgs] = useState<string[] | null>(null);
  const [errorsOnly, setErrorsOnly] = useState<boolean>(false);
  const [follow, setFollow] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [logNote, setLogNote] = useState<string | null>(null);
  const logPreRef = useRef<HTMLPreElement | null>(null);

  const refreshVersions = useCallback(async (): Promise<void> => {
    const v = await engine.getEngineVersion().catch(() => null);
    setVersions(v);
  }, [engine]);

  const loadHistory = useCallback(async (): Promise<readonly DownloadJob[]> => {
    const h = await engine.loadHistory().catch(() => [] as DownloadJob[]);
    setHistory(h);
    return h;
  }, [engine]);

  useEffect(() => {
    void refreshVersions();
    void loadHistory();
  }, [engine, refreshVersions, loadHistory]);

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

  // Force bypasses the hourly cache, so hammering this button always
  // re-reads GitHub (this was the "still shows the old version" bug).
  const checkUpdates = async (): Promise<void> => {
    setChecking(true);
    setCheckFailed(false);
    try {
      setUpdateStatus(await engine.checkForUpdates(true));
    } catch {
      setCheckFailed(true);
    } finally {
      setChecking(false);
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

  const viewLog = useCallback(async (id: string): Promise<void> => {
    setSelectedId(id);
    setCmdArgs(null);
    const text = await engine.getRawLog(id).catch(() => null);
    setLogText(text);
  }, [engine]);

  // Transparency (C6): the exact (redacted) yt-dlp argv behind a job.
  const viewCommand = async (): Promise<void> => {
    if (selectedId === null) return;
    const argv = await engine.getJobArgs(selectedId).catch(() => null);
    setCmdArgs(argv);
  };

  const rows: readonly DownloadJob[] = useMemo(() => [...jobs, ...history], [jobs, history]);

  // Nothing selected yet? Preselect the newest row (v1.7.2). Refresh and Show
  // command used to sit permanently disabled until the user happened to click
  // a job chip, which read as "those buttons are broken".
  useEffect(() => {
    if (selectedId !== null || rows.length === 0) return;
    const newest = [...rows].sort(
      (a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt),
    )[0];
    if (newest !== undefined) void viewLog(newest.id);
  }, [rows, selectedId, viewLog]);

  /** Refresh: engine versions, the job list, and the open log in one go. */
  const refreshAll = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await Promise.all([refreshVersions(), loadHistory()]);
      if (selectedId !== null) await viewLog(selectedId);
    } finally {
      setRefreshing(false);
    }
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

  const buildReport = async (): Promise<string> => {
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
      crashes: readCrashReports(),
    });
    setReport(text);
    return text;
  };

  const buildReportOrError = async (): Promise<string | Error> =>
    buildReport().catch((err: unknown) =>
      err instanceof Error ? err : new Error(String(err)),
    );

const copyReport = async (): Promise<void> => {
    // v1.7.2: never a silent no-op. If the report cannot be built there is now
    // a visible reason, because "the button did nothing" is exactly what made
    // these two controls untrustworthy.
    const built = await buildReportOrError();
    if (built instanceof Error) {
      setDiagNote(built.message.length > 0 ? built.message : S.settings.saveFailed);
      return;
    }
    const text = built;
    const ok = await writeClipboardText(text);
    setDiagNote(ok ? S.diagnostics.copied : S.menu.copyFailed);
  };

  const saveReport = async (): Promise<void> => {
    const built = await buildReportOrError();
    if (built instanceof Error) {
      setDiagNote(built.message.length > 0 ? built.message : S.settings.saveFailed);
      return;
    }
    const text = built;
    try {
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
    } catch (err) {
      setDiagNote(err instanceof Error && err.message.length > 0 ? err.message : S.settings.saveFailed);
    }
  };

  return (
    <section className="grabber-view" aria-label={S.logs.title}>
      <h1>{S.logs.title}</h1>
      <div className="grabber-card">
        <h2 className="dl-title">{S.logs.engineVersions}</h2>
        <p className="muted">
          {S.logs.appVersion}: {versions?.app ?? "…"} · {S.logs.ytdlpVersion}:{" "}
          {versions?.ytdlp ?? "…"} · {S.logs.ffmpegVersion}: {versions?.ffmpeg ?? "…"}
        </p>
        {versions !== null &&
          (versions.galleryDl !== undefined ||
            versions.jsRuntime !== undefined ||
            versions.aria2c !== undefined) && (
            <p className="muted">
              gallery-dl: {versions.galleryDl ?? "—"}
              {" · "}JS: {versions.jsRuntime ?? "—"}
              {" · "}aria2c: {versions.aria2c ?? "—"}
            </p>
          )}
        <p className="muted">{S.logs.poweredBy}</p>
        <div className="chip-row">
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
        </div>
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
              {updateStatus.appRelease?.publishedAt !== null &&
                updateStatus.appRelease?.publishedAt !== undefined && (
                  <>
                    {" "}
                    {formatStr(S.logs.appReleased, {
                      date: new Date(updateStatus.appRelease.publishedAt).toLocaleDateString(),
                    })}
                  </>
                )}
            </p>
            {updateStatus.appRelease?.setupSize !== null &&
              updateStatus.appRelease?.setupSize !== undefined && (
                <p className="muted" role="status">
                  {formatStr(S.updateModal.setupSize, {
                    size: formatSize(updateStatus.appRelease.setupSize, "en"),
                  })}
                </p>
              )}
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
            type="search"
            value={logQuery}
            placeholder={S.logs.search}
            aria-label={S.logs.search}
            spellCheck={false}
            autoComplete="off"
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
        <div className="chip-row log-tools">
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
            data-testid="logs-refresh"
            disabled={refreshing}
            title={S.logs.refresh}
            onClick={() => {
              void refreshAll();
            }}
          >
            {refreshing ? S.settings.loading : S.logs.refresh}
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
          <button
            type="button"
            className="btn btn-small"
            data-testid="logs-show-command"
            disabled={rows.length === 0}
            title={selectedId === null ? S.logs.selectJobFirst : S.logs.showCommand}
            onClick={() => {
              void viewCommand();
            }}
          >
            {S.logs.showCommand}
          </button>
        </div>
        {cmdArgs !== null && (
          <details open>
            <summary>{S.logs.showCommand}</summary>
            <pre className="log-pre" data-testid="job-command">
              {cmdArgs.join(" ")}
            </pre>
          </details>
        )}
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
        <div className="chip-row">
          <button
            type="button"
            className="btn"
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              const url = buildIssueUrl(versions?.app ?? "unknown", versions?.os ?? "windows");
              void engine.openExternal(url).catch(() => undefined);
            }}
          >
            {S.logs.reportBug}
          </button>
        </div>
        <details className="advanced">
          <summary>{S.logs.noticesTitle}</summary>
          <pre className="log-pre">{thirdPartyNotices}</pre>
        </details>
        <CrashBlock settings={settings} />
      </div>
    </section>
  );
}

function CrashBlock({ settings }: { readonly settings: StoreApi<SettingsStoreState> }): React.JSX.Element {
  const S = useStrings(settings);
  const crashOptIn = useStore(settings, (s) => s.settings.crashReports);
  const [crashes, setCrashes] = useState<readonly { t: number; view: string; message: string }[]>(() =>
    crashOptIn ? readCrashReports() : [],
  );
  useEffect(() => {
    if (crashOptIn) setCrashes(readCrashReports());
    else setCrashes([]);
  }, [crashOptIn]);
  return (
    <div>
      <h3 className="dl-title">{S.logs.crashTitle}</h3>
      {crashes.length === 0 ? (
        <p className="muted">{S.logs.crashEmpty}</p>
      ) : (
        <>
          {crashes.map((c, i) => (
            <p key={`${String(c.t)}-${String(i)}`} className="muted">
              [{Number.isFinite(c.t) ? new Date(c.t).toLocaleString() : "?"}] ({c.view}) {c.message}
            </p>
          ))}
          <div className="chip-row">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                clearCrashReports();
                setCrashes([]);
              }}
            >
              {S.logs.crashClear}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

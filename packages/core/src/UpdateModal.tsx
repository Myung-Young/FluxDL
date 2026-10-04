import { useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand";
import type { DownloadEngine, UpdateDownloadProgress, UpdateStatus } from "./engine.js";
import { formatStr, localeTag, resolveLanguage, useStrings } from "./locale.js";
import { formatSize } from "./media.js";
import type { SettingsStoreState } from "./stores.js";

export interface UpdateModalProps {
  readonly engine: Pick<
    DownloadEngine,
    "startUpdateDownload" | "getUpdateDownloadProgress" | "cancelUpdateDownload"
  >;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly status: UpdateStatus;
  readonly onClose: () => void;
}

function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Launch update popup: version, sizes, notes, publish date, and the
 * download itself. Download runs main-side; completion launches the
 * installer silently and quits the app (that handoff IS the install).
 */
export function UpdateModal({ engine, settings, status, onClose }: UpdateModalProps): React.JSX.Element {
  const S = useStrings(settings);
  const saved = settings.getState().settings;
  const locale = localeTag(resolveLanguage(saved.language));
  const release = status.appRelease;
  const [phase, setPhase] = useState<"idle" | "busy" | "failed">("idle");
  const [progress, setProgress] = useState<UpdateDownloadProgress>({
    state: "idle",
    receivedBytes: 0,
    totalBytes: null,
    error: null,
  });
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (phase !== "busy") return;
    const timer = setInterval(() => {
      void engine
        .getUpdateDownloadProgress()
        .then((p) => {
          setProgress(p);
          if (p.state === "error") setPhase("failed");
        })
        .catch(() => undefined);
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, [phase, engine]);

  useEffect(() => {
    boxRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && phase === "idle") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, phase]);

  const begin = (): void => {
    setPhase("busy");
    void engine
      .startUpdateDownload()
      .then(() => undefined)
      .catch((err: unknown) => {
        setPhase("failed");
        setProgress({
          state: "error",
          receivedBytes: 0,
          totalBytes: null,
          error: err instanceof Error ? err.message : "Download failed.",
        });
      });
  };

  const skip = (): void => {
    if (status.appLatest !== null) {
      void settings.getState().save({ skippedUpdate: status.appLatest }).catch(() => undefined);
    }
    onClose();
  };

  const ratio =
    progress.totalBytes !== null && progress.totalBytes > 0
      ? Math.min(1, progress.receivedBytes / progress.totalBytes)
      : null;

  return (
    <div
      className="grabber-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase === "idle") onClose();
      }}
    >
      <div
        ref={boxRef}
        className="grabber-card preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={S.updateModal.title}
        data-testid="update-modal"
      >
        <h2 className="dl-title">{S.updateModal.title}</h2>
        <p className="muted">
          {formatStr(S.updateModal.version, { v: status.appLatest ?? "?" })} ·{" "}
          {formatStr(S.updateModal.installed, { cur: status.appCurrent })}
        </p>
        {release?.publishedAt !== null && release?.publishedAt !== undefined && (
          <p className="muted">
            {formatStr(S.updateModal.published, {
              date: formatDate(release.publishedAt, locale),
            })}
          </p>
        )}
        {release?.setupSize !== null && release?.setupSize !== undefined && (
          <p className="muted">
            {formatStr(S.updateModal.setupSize, {
              size: formatSize(release.setupSize, locale),
            })}
          </p>
        )}
        {release?.portableSize !== null && release?.portableSize !== undefined && (
          <p className="muted">
            {formatStr(S.updateModal.portableSize, {
              size: formatSize(release.portableSize, locale),
            })}
          </p>
        )}
        <h3 className="field-label">{S.updateModal.notes}</h3>
        <pre className="log-pre" data-testid="update-notes">
          {release?.notes ?? S.updateModal.noNotes}
        </pre>
        {status.ytdlpUpdate && (
          <p className="note" role="status">
            {S.updateModal.ytdlpNote}
          </p>
        )}

        {phase === "busy" && (
          <>
            <div
              className="dl-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
            >
              <div className="dl-fill" style={{ width: ratio === null ? "100%" : `${String(Math.round(ratio * 100))}%` }} />
            </div>
            <p className="muted" role="status">
              {progress.state === "installing" || progress.state === "done"
                ? S.updateModal.installing
                : progress.totalBytes !== null
                  ? formatStr(S.updateModal.downloading, {
                      received: formatSize(progress.receivedBytes, locale),
                      total: formatSize(progress.totalBytes, locale),
                    })
                  : formatStr(S.updateModal.downloadingUnknown, {
                      received: formatSize(progress.receivedBytes, locale),
                    })}
            </p>
          </>
        )}
        {phase === "failed" && (
          <p className="error-text" role="alert">
            {formatStr(S.updateModal.failed, { detail: progress.error ?? "?" })}
          </p>
        )}

        <div className="chip-row">
          {phase === "idle" && (
            <>
              <button type="button" className="btn btn-primary" onClick={begin}>
                {S.updateModal.download}
              </button>
              <button type="button" className="btn" onClick={skip}>
                {S.updateModal.skip}
              </button>
              <button type="button" className="btn" onClick={onClose}>
                {S.updateModal.later}
              </button>
            </>
          )}
          {phase === "busy" && progress.state !== "done" && progress.state !== "installing" && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                void engine.cancelUpdateDownload().catch(() => undefined);
                setPhase("idle");
              }}
            >
              {S.downloads.cancel}
            </button>
          )}
          {phase === "failed" && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setPhase("busy");
                begin();
              }}
            >
              {S.updateModal.retry}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

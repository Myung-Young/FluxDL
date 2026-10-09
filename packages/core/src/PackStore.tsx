import { useCallback, useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";
import type { DownloadEngine, PackStatusRow } from "./engine.js";
import { formatStr, localeTag, resolveLanguage, useStrings } from "./locale.js";
import { formatSize } from "./media.js";
import type { SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";

export interface PackStoreProps {
  readonly engine: Pick<DownloadEngine, "packs">;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
  readonly hidden: boolean;
}

/**
 * Tool Packs store (Phase 5): install/update/remove + whisper models, with
 * explicit no-checksum consent, polled progress and cancel. One op at a
 * time engine-side; the UI mirrors that with a single busy row.
 */
export function PackStore({ engine, settings, toast, hidden }: PackStoreProps): React.JSX.Element {
  const S = useStrings(settings);
  const locale = localeTag(resolveLanguage(useStore(settings, (s) => s.settings.language)));
  const [rows, setRows] = useState<PackStatusRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [consent, setConsent] = useState<ReadonlySet<string>>(new Set());
  const [available, setAvailable] = useState<Readonly<Record<string, string>>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    void engine
      .packs({ op: "status" })
      .then((res) => {
        if (res.kind === "status") setRows(res.rows);
      })
      .catch(() => undefined);
  }, [engine]);

  useEffect(() => {
    if (hidden) return;
    refresh();
  }, [hidden, refresh]);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, []);

  const stopPoll = (): void => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPoll = (packId: string): void => {
    stopPoll();
    setBusy(packId);
    pollRef.current = setInterval(() => {
      void engine
        .packs({ op: "progress" })
        .then((res) => {
          if (res.kind !== "progress") return;
          const p = res.progress;
          if (p.phase === "idle") {
            stopPoll();
            setBusy(null);
            setProgress("");
            refresh();
            return;
          }
          const got = formatSize(p.receivedBytes, locale);
          const total = p.totalBytes === null ? "?" : formatSize(p.totalBytes, locale);
          setProgress(`${p.phase} · ${got} / ${total}`);
        })
        .catch(() => undefined);
    }, 500);
  };

  const fail = (err: unknown): void => {
    stopPoll();
    setBusy(null);
    setProgress("");
    toast
      .getState()
      .push(err instanceof Error && err.message.length > 0 ? err.message : S.settings.packFailed, "error");
    refresh();
  };

  const runOp = (packId: string, req: Parameters<DownloadEngine["packs"]>[0]): void => {
    startPoll(packId);
    void engine
      .packs(req)
      .then((res) => {
        if (res.kind === "installed" || res.kind === "model" || res.kind === "ok" || res.kind === "latest") {
          toast.getState().push(S.settings.packDone, "success");
        }
        stopPoll();
        setBusy(null);
        setProgress("");
        refresh();
      })
      .catch(fail);
  };

  const checkAll = (): void => {
    if (rows === null) return;
    startPoll("check");
    void (async (): Promise<void> => {
      const next: Record<string, string> = {};
      for (const r of rows) {
        try {
          const res = await engine.packs({ op: "check-update", id: r.id });
          if (res.kind === "latest" && res.updateAvailable && res.latest !== null) {
            next[r.id] = res.latest;
          }
        } catch {
          // One unreachable host never blocks the rest.
        }
      }
      setAvailable(next);
      stopPoll();
      setBusy(null);
    })().catch(fail);
  };

  return (
    <section className="grabber-card" aria-label={S.settings.packsTitle} hidden={hidden}>
      <h2 className="dl-title">{S.settings.packsTitle}</h2>
      <div className="chip-row">
        <button type="button" className="btn btn-small" disabled={busy !== null} onClick={checkAll}>
          {S.settings.packCheckUpdates}
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy !== null || Object.keys(available).length === 0}
          onClick={() => {
            const ids = (rows ?? []).filter((r) => available[r.id] !== undefined).map((r) => r.id);
            if (ids.length === 0) return;
            startPoll("update-all");
            void (async (): Promise<void> => {
              for (const id of ids) {
                try {
                  await engine.packs({ op: "update", id, acceptNoChecksum: true });
                } catch (err) {
                  toast.getState().push(
                    err instanceof Error ? err.message : S.settings.packFailed,
                    "error",
                  );
                }
              }
              stopPoll();
              setBusy(null);
              setProgress("");
              setAvailable({});
              refresh();
              toast.getState().push(S.settings.packDone, "success");
            })().catch(fail);
          }}
        >
          {S.settings.packUpdateAll}
        </button>
        {busy !== null && (
          <>
            <span className="muted" role="status">
              {S.settings.packWorking} {progress}
            </span>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                void engine.packs({ op: "cancel" }).catch(() => undefined);
              }}
            >
              {S.settings.packCancel}
            </button>
          </>
        )}
      </div>
      {rows === null ? (
        <p className="muted">…</p>
      ) : (        rows.map((r) => {
          const needsConsent = r.id !== "rclone";
          const agreed = consent.has(r.id);
          const updateTo = available[r.id] ?? null;
          return (
            <article key={r.id} className="grabber-card">
              <h3 className="dl-title">{r.name}</h3>
              <p className="muted">
                {r.installed === null
                  ? S.settings.packNotInstalled
                  : formatStr(S.settings.packInstalled, { v: r.installed })}
                {" · "}
                {formatStr(S.settings.packSize, { size: formatSize(r.sizeBytes, locale) })}
                {" · "}
                {formatStr(S.settings.packDiskUsed, { size: formatSize(r.diskBytes, locale) })}
              </p>
              <p className="muted">{r.capabilities.join(" · ")}</p>
              <p className="muted">
                {formatStr(S.settings.packLicense, { license: r.license })}
                {r.id === "rclone" ? ` · ${S.settings.packVerified}` : ` · ${r.consentNote}`}
              </p>
              {r.installed === null && needsConsent && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => {
                      setConsent((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(r.id);
                        else next.delete(r.id);
                        return next;
                      });
                    }}
                  />
                  {S.settings.packConsent}
                </label>
              )}
              <div className="chip-row">
                {r.installed === null ? (
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy !== null || (needsConsent && !agreed)}
                    onClick={() => {
                      runOp(r.id, { op: "install", id: r.id, acceptNoChecksum: true });
                    }}
                  >
                    {S.settings.packInstall}
                  </button>
                ) : (
                  <>
                    {updateTo !== null && (
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={busy !== null || (needsConsent && !agreed)}
                        onClick={() => {
                          runOp(r.id, { op: "update", id: r.id, acceptNoChecksum: true });
                        }}
                      >
                        {formatStr(S.settings.packUpdate, { v: updateTo })}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={busy !== null}
                      onClick={() => {
                        if (!window.confirm(`${S.settings.packRemove} ${r.name}?`)) return;
                        runOp(r.id, { op: "uninstall", id: r.id });
                      }}
                    >
                      {S.settings.packRemove}
                    </button>
                  </>
                )}
                <span className="muted">{r.homepage}</span>
              </div>
              {r.id === "whisper" && r.installed !== null && (
                <div className="chip-row">
                  <span className="muted">{S.settings.packModels}:</span>
                  {r.models.map((m) => (
                    <span key={m.id}>
                      {m.id} · {formatSize(m.sizeBytes, locale)}{" "}
                      {m.present ? (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy !== null}
                          onClick={() => {
                            runOp(r.id, { op: "remove-model", id: r.id, model: m.id });
                          }}
                        >
                          {S.settings.packModelRemove}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-small"
                          disabled={busy !== null}
                          onClick={() => {
                            runOp(r.id, { op: "install-model", id: r.id, model: m.id });
                          }}
                        >
                          {S.settings.packModelInstall}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}

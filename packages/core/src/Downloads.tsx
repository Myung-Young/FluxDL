import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { DownloadJob } from "./types.js";
import { STRINGS } from "./strings.js";
import { sendNotification } from "./notify.js";
import { pressScale, tweenProgress } from "./motion.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";
import { ErrorActionButtons, type ErrorNavigate } from "./ErrorActions.js";
import { ContextMenu, type MenuItemDef } from "./ContextMenu.js";
import { buildJobMenu } from "./JobMenu.js";
import { writeClipboardText } from "./clipboard.js";

export interface DownloadsProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
  readonly navigate: ErrorNavigate;
}

function Bar({ ratio }: { ratio: number }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current !== null) tweenProgress(ref.current, ratio);
  }, [ratio]);
  return (
    <div
      className="dl-track"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
    >
      <div ref={ref} className="dl-fill" style={{ width: "0%" }} />
    </div>
  );
}

function statusLine(job: DownloadJob): string {
  const bits: string[] = [job.status];
  if (job.speed !== null) bits.push(job.speed);
  if (job.eta !== null) bits.push(job.eta);
  if (job.stage !== null && job.stage !== job.status) bits.push(job.stage);
  return bits.join(" · ");
}

function Card({
  job,
  engine,
  queue,
  settings,
  toast,
  navigate,
  onMenu,
}: {
  job: DownloadJob;
  engine: DownloadEngine;
  queue: StoreApi<QueueStoreState>;
  settings: StoreApi<SettingsStoreState>;
  toast: StoreApi<ToastStoreState>;
  navigate: ErrorNavigate;
  onMenu: (job: DownloadJob, x: number, y: number) => void;
}): React.JSX.Element {
  const actions = queue.getState();
  const run = (fn: () => Promise<void>): void => {
    fn().catch(() => undefined);
  };
  const openMenuAt = (x: number, y: number): void => {
    onMenu(job, x, y);
  };
  return (
    <article
      className="grabber-card dl-card"
      aria-label={job.title}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenuAt(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          openMenuAt(r.left + 24, r.top + 24);
        }
      }}
    >
      <h2 className="dl-title">{job.title}</h2>
      <p className="muted">{statusLine(job)}</p>
      <Bar ratio={job.progress / 100} />
      {job.error !== null && (
        <p className="error-text" role="alert">
          {job.error}
        </p>
      )}
      {job.status === "error" && (
        <ErrorActionButtons
          job={job}
          engine={engine}
          queue={queue}
          settings={settings}
          toast={toast}
          navigate={navigate}
        />
      )}
      <div className="chip-row">
        {(job.status === "downloading" || job.status === "processing") && (
          <button
            type="button"
            className="btn btn-small"
            aria-label={STRINGS.downloads.pause}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              run(() => actions.pause(job.id));
            }}
          >
            {STRINGS.downloads.pause}
          </button>
        )}
        {job.status === "paused" && (
          <button
            type="button"
            className="btn btn-small"
            aria-label={STRINGS.downloads.resume}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              run(() => actions.resume(job.id));
            }}
          >
            {STRINGS.downloads.resume}
          </button>
        )}
        {job.status === "error" && (
          <button
            type="button"
            className="btn btn-small"
            aria-label={STRINGS.downloads.retry}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              run(() => actions.retry(job.id));
            }}
          >
            {STRINGS.downloads.retry}
          </button>
        )}
        {job.status !== "done" && (
          <button
            type="button"
            className="btn btn-small"
            aria-label={STRINGS.downloads.cancel}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              run(() => actions.cancel(job.id));
            }}
          >
            {STRINGS.downloads.cancel}
          </button>
        )}
        {job.destination !== null ? (
          <>
            <button
              type="button"
              className="btn btn-small"
              aria-label={STRINGS.downloads.openFile}
              onClick={() => {
                if (job.destination !== null) {
                  engine.openPath(job.destination).catch(() => undefined);
                }
              }}
            >
              {STRINGS.downloads.openFile}
            </button>
            <button
              type="button"
              className="btn btn-small"
              aria-label={STRINGS.downloads.showInFolder}
              onClick={() => {
                if (job.destination !== null) {
                  engine.revealInFolder(job.destination).catch(() => undefined);
                }
              }}
            >
              {STRINGS.downloads.showInFolder}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-small"
            aria-label={STRINGS.downloads.showFolder}
            onClick={() => {
              engine.openPath(job.outputDir).catch(() => undefined);
            }}
          >
            {STRINGS.downloads.showFolder}
          </button>
        )}
      </div>
    </article>
  );
}

export function Downloads({
  engine,
  queue,
  settings,
  toast,
  navigate,
}: DownloadsProps): React.JSX.Element {
  const jobs = useStore(queue, (s) => s.jobs);
  const prevIds = useRef<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ job: DownloadJob; x: number; y: number } | null>(null);

  const copyText = (text: string): void => {
    void writeClipboardText(text).then((ok) => {
      if (!ok) toast.getState().push(STRINGS.menu.copyFailed, "error");
    });
  };

  const menuItems = (job: DownloadJob): MenuItemDef[] => {
    const fail = (err: unknown): void => {
      toast.getState().push(err instanceof Error ? err.message : STRINGS.menu.copyFailed, "error");
    };
    return buildJobMenu(job, {
      copyUrl: (text) => {
        copyText(text);
      },
      copyPath: (text) => {
        copyText(text);
      },
      openFile: () => {
        if (job.destination !== null) {
          engine.openPath(job.destination).catch(fail);
        }
      },
      reveal: () => {
        if (job.destination !== null) {
          engine.revealInFolder(job.destination).catch(fail);
        }
      },
      retryWithPreset: (preset) => {
        queue
          .getState()
          .setJobPreset(job.id, preset)
          .then(() => queue.getState().retry(job.id))
          .catch(fail);
      },
      remove: () => {
        queue.getState().remove(job.id).catch(fail);
      },
      deleteFile: () => {
        const dest = job.destination;
        if (dest === null) return;
        if (!window.confirm(STRINGS.menu.deleteConfirm)) return;
        engine
          .trashFile(dest)
          .then(() => {
            toast.getState().push(STRINGS.menu.deletedToast, "success");
          })
          .catch(fail);
      },
    });
  };

  useEffect(() => {
    const ids = new Set(jobs.map((j) => j.id));
    const vanished = [...prevIds.current].filter((id) => !ids.has(id));
    prevIds.current = ids;
    if (vanished.length === 0) return;
    void (async () => {
      const hist = await engine.loadHistory().catch(() => []);
      const action = settings.getState().settings.postDownloadAction;
      for (const id of vanished) {
        const h = hist.find((x) => x.id === id);
        if (h?.status === "done") {
          toast.getState().push(`${STRINGS.toast.finished}: ${h.title}`, "success");
          sendNotification(STRINGS.toast.finished, h.title);
          if (action !== "none" && h.destination !== null) {
            if (action === "open-file") {
              await engine.openPath(h.destination).catch(() => undefined);
            } else {
              await engine.revealInFolder(h.destination).catch(() => undefined);
            }
          }
        } else if (h?.status === "error") {
          const detail = h.error !== null ? ` — ${h.error}` : "";
          toast
            .getState()
            .push(`${STRINGS.toast.failed}: ${h.title}${detail}`, "error", {
              label: STRINGS.errors.actionRetry,
              run: () => {
                void queue
                  .getState()
                  .enqueue({
                    url: h.url,
                    title: h.title,
                    preset: h.preset,
                    outputDir: settings.getState().settings.downloadDir,
                  })
                  .catch(() => undefined);
              },
            });
          sendNotification(STRINGS.toast.failed, h.title);
        }
      }
    })();
  }, [jobs, engine, queue, settings, toast]);

  return (
    <section className="grabber-view" aria-label={STRINGS.downloads.title}>
      <h1>{STRINGS.downloads.title}</h1>
      {jobs.length === 0 ? (
        <div className="grabber-card">
          <p className="muted">{STRINGS.downloads.empty}</p>
        </div>
      ) : (
        <div className="dl-list">
          {jobs.map((j) => (
            <Card
              key={j.id}
              job={j}
              engine={engine}
              queue={queue}
              settings={settings}
              toast={toast}
              navigate={navigate}
              onMenu={(target, x, y) => {
                setMenu({ job: target, x, y });
              }}
            />
          ))}
        </div>
      )}
      {menu !== null && (
        <ContextMenu
          label={STRINGS.menu.label}
          items={menuItems(menu.job)}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </section>
  );
}

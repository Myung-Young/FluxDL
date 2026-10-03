import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { DownloadJob } from "./types.js";
import type { Strings } from "./strings.js";
import { useStrings } from "./locale.js";
import { formatStr } from "./locale.js";
import { retryInSeconds } from "./queue.js";
import { sendNotification } from "./notify.js";
import { flipShift, pressScale, tweenProgress } from "./motion.js";
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
      aria-valuetext={`${String(Math.round(ratio * 100))}%`}
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
  queuePos,
  onMove,
  strings,
  now,
}: {
  job: DownloadJob;
  engine: DownloadEngine;
  queue: StoreApi<QueueStoreState>;
  settings: StoreApi<SettingsStoreState>;
  toast: StoreApi<ToastStoreState>;
  navigate: ErrorNavigate;
  onMenu: (job: DownloadJob, x: number, y: number) => void;
  /** Position within the queued subsequence (null when not queued). */
  queuePos: { index: number; total: number } | null;
  onMove: (id: string, toIndex: number) => void;
  strings: Strings;
  now: number;
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
      data-job-id={job.id}
      data-queued={job.status === "queued" ? "true" : "false"}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenuAt(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          openMenuAt(r.left + 24, r.top + 24);
          return;
        }
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && queuePos !== null) {
          e.preventDefault();
          onMove(job.id, queuePos.index + (e.key === "ArrowUp" ? -1 : 1));
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
      {job.status === "error" &&
        (() => {
          const secs = retryInSeconds(job, now);
          const text =
            secs !== null
              ? formatStr(strings.downloads.retryIn, { n: secs, a: job.attempts })
              : formatStr(strings.downloads.attempt, { a: job.attempts });
          return (
            <p className="muted" role="status">
              {text}
            </p>
          );
        })()}
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
            aria-label={strings.downloads.pause}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              run(() => actions.pause(job.id));
            }}
          >
            {strings.downloads.pause}
          </button>
        )}
        {job.status === "paused" && (
          <button
            type="button"
            className="btn btn-small"
            aria-label={strings.downloads.resume}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              run(() => actions.resume(job.id));
            }}
          >
            {strings.downloads.resume}
          </button>
        )}
        {job.status === "error" && (
          <button
            type="button"
            className="btn btn-small"
            aria-label={strings.downloads.retry}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              run(() => actions.retry(job.id));
            }}
          >
            {strings.downloads.retry}
          </button>
        )}
        {job.status !== "done" && (
          <button
            type="button"
            className="btn btn-small"
            aria-label={strings.downloads.cancel}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              run(() => actions.cancel(job.id));
            }}
          >
            {strings.downloads.cancel}
          </button>
        )}
        {job.destination !== null ? (
          <>
            <button
              type="button"
              className="btn btn-small"
              aria-label={strings.downloads.openFile}
              onClick={() => {
                if (job.destination !== null) {
                  engine.openPath(job.destination).catch(() => undefined);
                }
              }}
            >
              {strings.downloads.openFile}
            </button>
            <button
              type="button"
              className="btn btn-small"
              aria-label={strings.downloads.showInFolder}
              onClick={() => {
                if (job.destination !== null) {
                  engine.revealInFolder(job.destination).catch(() => undefined);
                }
              }}
            >
              {strings.downloads.showInFolder}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-small"
            aria-label={strings.downloads.showFolder}
            onClick={() => {
              engine.openPath(job.outputDir).catch(() => undefined);
            }}
          >
            {strings.downloads.showFolder}
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
  const S = useStrings(settings);
  const jobs = useStore(queue, (s) => s.jobs);
  const prevIds = useRef<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ job: DownloadJob; x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    id: string;
    startY: number;
    active: boolean;
    el: HTMLElement;
    toIndex: number;
  } | null>(null);

  const queuedIds = jobs.filter((j) => j.status === "queued").map((j) => j.id);

  const hasCountdown = jobs.some(
    (j) => j.status === "error" && j.nextRetryAt !== null && j.nextRetryAt > Date.now(),
  );
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!hasCountdown) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [hasCountdown]);

  const moveJob = (id: string, toIndex: number): void => {
    queue.getState().reorder(id, toIndex).catch(() => undefined);
  };

  /** FLIP settle after a committed reorder (moved rows glide to place). */
  const flipAfterReorder = (id: string, toIndex: number): void => {
    const list = listRef.current;
    const before = new Map<string, number>();
    if (list !== null) {
      for (const el of list.querySelectorAll("[data-job-id]")) {
        const jid = (el as HTMLElement).dataset["jobId"];
        if (jid !== undefined) before.set(jid, el.getBoundingClientRect().top);
      }
    }
    void queue
      .getState()
      .reorder(id, toIndex)
      .then(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (list === null) return;
            for (const el of list.querySelectorAll("[data-job-id]")) {
              const jid = (el as HTMLElement).dataset["jobId"];
              const old = jid === undefined ? undefined : before.get(jid);
              if (old !== undefined) {
                const dy = old - el.getBoundingClientRect().top;
                if (dy !== 0) flipShift(el, dy);
              }
            }
          });
        });
      })
      .catch(() => undefined);
  };

  const onListPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as Element;
    if (target.closest("button, select, input, textarea, a")) return;
    const article = target.closest("[data-job-id]");
    if (!(article instanceof HTMLElement)) return;
    if (article.dataset["queued"] !== "true") return;
    const jid = article.dataset["jobId"];
    if (jid === undefined) return;
    dragRef.current = { id: jid, startY: e.clientY, active: false, el: article, toIndex: -1 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort; moves still fire while over the list.
    }
  };

  const onListPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || !drag.el.isConnected) return;
    const dy = e.clientY - drag.startY;
    if (!drag.active && Math.abs(dy) < 6) return;
    if (!drag.active) {
      drag.active = true;
      drag.el.style.opacity = "0.85";
      drag.el.style.zIndex = "5";
    }
    drag.el.style.transform = `translateY(${String(dy)}px)`;
    // Insertion point among queued rows (dragged row excluded).
    const list = listRef.current;
    if (list === null) return;
    const domQueued: string[] = [];
    let insertAt = 0;
    let found = false;
    for (const el of list.querySelectorAll("[data-job-id]")) {
      const h = el as HTMLElement;
      const jid = h.dataset["jobId"];
      if (jid === undefined || jid === drag.id) continue;
      if (h.dataset["queued"] !== "true") continue;
      if (!found && e.clientY < h.getBoundingClientRect().top + h.offsetHeight / 2) {
        insertAt = domQueued.length;
        found = true;
      }
      domQueued.push(jid);
    }
    drag.toIndex = found ? insertAt : domQueued.length;
  };

  const endDrag = (commit: boolean): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag === null) return;
    drag.el.style.transform = "";
    drag.el.style.opacity = "";
    drag.el.style.zIndex = "";
    if (commit && drag.active && drag.toIndex >= 0) {
      flipAfterReorder(drag.id, drag.toIndex);
    }
  };

  const copyText = (text: string): void => {
    void writeClipboardText(text).then((ok) => {
      if (!ok) toast.getState().push(S.menu.copyFailed, "error");
    });
  };

  const failBulk = (err: unknown): void => {
    toast.getState().push(
      err instanceof Error ? err.message : S.menu.copyFailed,
      "error",
    );
  };

  const menuItems = (job: DownloadJob): MenuItemDef[] => {
    const fail = (err: unknown): void => {
      toast.getState().push(err instanceof Error ? err.message : S.menu.copyFailed, "error");
    };
    const qIndex = queuedIds.indexOf(job.id);
    return buildJobMenu(
      job,
      {
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
        moveUp: () => {
          if (qIndex > 0) moveJob(job.id, qIndex - 1);
        },
        moveDown: () => {
          if (qIndex >= 0 && qIndex < queuedIds.length - 1) moveJob(job.id, qIndex + 1);
        },
        remove: () => {
          queue.getState().remove(job.id).catch(fail);
        },
        deleteFile: () => {
          const dest = job.destination;
          if (dest === null) return;
          if (!window.confirm(S.menu.deleteConfirm)) return;
          engine
            .trashFile(dest)
            .then(() => {
              toast.getState().push(S.menu.deletedToast, "success");
            })
            .catch(fail);
        },
      },
      {
        up: qIndex > 0,
        down: qIndex >= 0 && qIndex < queuedIds.length - 1,
      },
      S,
    );
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
          const dest = h.destination;
          toast
            .getState()
            .push(
              `${S.toast.finished}: ${h.title}`,
              "success",
              dest === null
                ? undefined
                : {
                    label: S.downloads.openFile,
                    run: () => {
                      engine.openPath(dest).catch(() => undefined);
                    },
                  },
            );
          sendNotification(S.toast.finished, h.title);
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
            .push(`${S.toast.failed}: ${h.title}${detail}`, "error", {
              label: S.errors.actionRetry,
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
          sendNotification(S.toast.failed, h.title);
        }
      }
    })();
  }, [jobs, engine, queue, settings, toast, S]);

  const canPause = jobs.some(
    (j) => j.status === "queued" || j.status === "analyzing" || j.status === "downloading" || j.status === "processing",
  );
  const canResume = jobs.some((j) => j.status === "paused");
  const hasQueued = queuedIds.length > 0;
  const hasErrors = jobs.some((j) => j.status === "error");

  return (
    <section className="grabber-view" aria-label={S.downloads.title}>
      <h1>{S.downloads.title}</h1>
      {jobs.length > 0 && (
        <div className="chip-row" role="group" aria-label={S.downloads.bulkActions}>
          <button
            type="button"
            className="btn btn-small"
            disabled={!canPause}
            onClick={() => {
              queue.getState().pauseAll().catch(failBulk);
            }}
          >
            {S.downloads.pauseAll}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={!canResume}
            onClick={() => {
              queue.getState().resumeAll().catch(failBulk);
            }}
          >
            {S.downloads.resumeAll}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={!hasQueued}
            onClick={() => {
              if (!window.confirm(S.downloads.cancelQueuedConfirm)) return;
              queue.getState().cancelQueued().catch(failBulk);
            }}
          >
            {S.downloads.cancelQueued}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={!hasErrors}
            onClick={() => {
              queue.getState().retryAll().catch(failBulk);
            }}
          >
            {S.downloads.retryAll}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={!hasErrors}
            onClick={() => {
              queue.getState().clearFinished().catch(failBulk);
            }}
          >
            {S.downloads.clearFinished}
          </button>
        </div>
      )}
      {jobs.length === 0 ? (
        <div className="grabber-card">
          <p className="muted" role="status">
            {S.downloads.empty}
          </p>
        </div>
      ) : (
        <div
          className="dl-list"
          ref={listRef}
          onPointerDown={onListPointerDown}
          onPointerMove={onListPointerMove}
          onPointerUp={() => {
            endDrag(true);
          }}
          onPointerCancel={() => {
            endDrag(false);
          }}
        >
          {jobs.map((j) => {
            const qIndex = queuedIds.indexOf(j.id);
            return (
              <Card
                key={j.id}
                job={j}
                engine={engine}
                queue={queue}
                settings={settings}
                toast={toast}
                navigate={navigate}
                strings={S}
                now={now}
                onMenu={(target, x, y) => {
                  setMenu({ job: target, x, y });
                }}
                queuePos={
                  qIndex >= 0 ? { index: qIndex, total: queuedIds.length } : null
                }
                onMove={(id, toIndex) => {
                  flipAfterReorder(id, toIndex);
                }}
              />
            );
          })}
        </div>
      )}
      {menu !== null && (
        <ContextMenu
          label={S.menu.label}
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

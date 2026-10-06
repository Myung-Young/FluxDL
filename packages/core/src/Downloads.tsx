import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { DownloadJob } from "./types.js";
import type { Strings } from "./strings.js";
import { useStrings } from "./locale.js";
import { formatStr, localeTag, resolveLanguage } from "./locale.js";
import { formatSize } from "./media.js";
import { aggregateStatus, formatEta, queueEta } from "./aggregate.js";
import { fuzzyRank } from "./fuzzy.js";
import { retryInSeconds } from "./queue.js";
import { sendNotification } from "./notify.js";
import { flipShift, pressScale, tweenProgress } from "./motion.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";
import { ErrorActionButtons, type ErrorNavigate } from "./ErrorActions.js";
import { ContextMenu, type MenuItemDef } from "./ContextMenu.js";
import { buildJobMenu } from "./JobMenu.js";
import { writeClipboardText } from "./clipboard.js";

/** Downloads navigates home (empty state) plus the error-action targets. */
export type DownloadsNavigate = (view: "home" | "settings" | "logs", section?: string) => void;

export interface DownloadsProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
  readonly navigate: DownloadsNavigate;
}

function Bar({ ratio }: { ratio: number | null }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current !== null && ratio !== null) tweenProgress(ref.current, ratio);
  }, [ratio]);
  const isIndeterminate = ratio === null;
  return (
    <div
      className={`dl-track${isIndeterminate ? " is-indeterminate" : ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isIndeterminate ? undefined : Math.round(ratio * 100)}
      aria-valuetext={isIndeterminate ? "Recording" : `${String(Math.round(ratio * 100))}%`}
    >
      <div
        ref={ref}
        className={`dl-fill${isIndeterminate ? " is-indeterminate" : ""}`}
        style={{ width: isIndeterminate ? "100%" : "0%" }}
      />
    </div>
  );
}

function toLocalInput(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusLine(job: DownloadJob, strings: Strings, locale: string): string {
  if (job.stage === "recording") {
    const bits: string[] = [strings.downloads.recording];
    if (job.downloadedBytes !== null) {
      bits.push(formatSize(job.downloadedBytes, locale));
    }
    if (job.eta !== null) {
      bits.push(job.eta);
    }
    if (job.speed !== null) {
      bits.push(job.speed);
    }
    return bits.join(" · ");
  }
  const bits: string[] = [job.status];
  if (job.status === "queued" && job.startAfter !== undefined && job.startAfter !== null) {
    bits.push(
      formatStr(strings.downloads.startsAt, {
        when: new Date(job.startAfter).toLocaleString(locale),
      }),
    );
  }
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
  locale,
  now,
  selected,
  onToggleSelect,
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
  locale: string;
  now: number;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}): React.JSX.Element {
  const actions = queue.getState();
  const run = (fn: () => Promise<void>): void => {
    fn().catch(() => undefined);
  };
  const [schedOpen, setSchedOpen] = useState<boolean>(false);
  const [schedVal, setSchedVal] = useState<string>(() =>
    toLocalInput(job.startAfter ?? Date.now() + 3_600_000),
  );
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
      <div className="dl-head">
        <input
          type="checkbox"
          checked={selected}
          aria-label={job.title}
          onChange={() => {
            onToggleSelect(job.id);
          }}
        />
        <h2 className="dl-title">
          {job.pinned === true && <span className="badge">{strings.downloads.pinned}</span>}{" "}
          {job.title}
        </h2>
      </div>
      <p className="muted">{statusLine(job, strings, locale)}</p>
      <Bar ratio={job.progress !== null ? job.progress / 100 : null} />
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
            aria-label={job.stage === "recording" ? strings.downloads.stopRecording : strings.downloads.pause}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              run(() => actions.pause(job.id));
            }}
          >
            {job.stage === "recording" ? strings.downloads.stopRecording : strings.downloads.pause}
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
        <button
          type="button"
          className="btn btn-small"
          aria-label={job.pinned === true ? strings.downloads.unpin : strings.downloads.pin}
          aria-pressed={job.pinned === true}
          onClick={() => {
            run(() => actions.togglePin(job.id));
          }}
        >
          {job.pinned === true ? strings.downloads.unpin : strings.downloads.pin}
        </button>
        {job.status === "queued" && (
          <button
            type="button"
            className="btn btn-small"
            aria-label={strings.downloads.schedule}
            onClick={() => {
              setSchedVal(toLocalInput(job.startAfter ?? Date.now() + 3_600_000));
              setSchedOpen((v) => !v);
            }}
          >
            {strings.downloads.schedule}
          </button>
        )}
        {job.destination !== null ? (
          job.splitChapters === true ? (
            <button
              type="button"
              className="btn btn-small"
              aria-label={strings.downloads.showFolder}
              onClick={() => {
                if (job.destination !== null) {
                  engine.openPath(job.destination).catch(() => undefined);
                }
              }}
            >
              {strings.downloads.showFolder}
            </button>
          ) : (
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
          )
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
      {schedOpen && job.status === "queued" && (
        <div className="url-row">
          <input
            type="datetime-local"
            className="input"
            aria-label={strings.downloads.schedule}
            value={schedVal}
            onChange={(e) => {
              setSchedVal(e.target.value);
            }}
          />
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              const t = new Date(schedVal).getTime();
              if (!Number.isFinite(t)) return;
              run(() => actions.setJobSchedule(job.id, t));
              setSchedOpen(false);
            }}
          >
            {strings.downloads.applySchedule}
          </button>
          {job.startAfter !== undefined && job.startAfter !== null && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                run(() => actions.setJobSchedule(job.id, null));
                setSchedOpen(false);
              }}
            >
              {strings.downloads.clearSchedule}
            </button>
          )}
        </div>
      )}
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
  const settingsState = useStore(settings, (s) => s.settings);
  const locale = localeTag(resolveLanguage(settingsState.language));
  const jobs = useStore(queue, (s) => s.jobs);
  const ready = useStore(settings, (s) => s.ready);
  const speedLimit = useStore(settings, (s) => s.settings.speedLimit);
  const savedSearches = useStore(settings, (s) => s.settings.savedSearches);
  const recentSearches = useStore(settings, (s) => s.settings.recentSearches);
  const [query, setQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "error" | "done">("all");
  const filterRestored = useRef<boolean>(false);

  // Remember the filter across restarts (D2).
  useEffect(() => {
    if (!ready || filterRestored.current) return;
    filterRestored.current = true;
    const f = settings.getState().settings.lastQueueFilter;
    if (f === "all" || f === "active" || f === "error" || f === "done") {
      setStatusFilter(f);
    }
  }, [ready, settings]);

  useEffect(() => {
    if (!filterRestored.current) return;
    void settings.getState().save({ lastQueueFilter: statusFilter }).catch(() => undefined);
  }, [statusFilter, settings]);
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggleSelect = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runMany = (fn: (id: string) => Promise<void>): void => {
    const ids = visible.filter((j) => selected.has(j.id)).map((j) => j.id);
    void Promise.allSettled(ids.map((id) => fn(id))).then(() => {
      setSelected(new Set());
    });
  };

  // Search (fuzzy + typo-tolerant) + status filter, best matches first.
  const visible = jobs
    .map((j) => {
      if (statusFilter === "active" && !(j.status === "queued" || j.status === "analyzing" || j.status === "downloading" || j.status === "processing")) return null;
      if (statusFilter === "error" && j.status !== "error") return null;
      if (statusFilter === "done" && !(j.status === "done" || j.status === "cancelled")) return null;
      const q = query.trim();
      if (q.length === 0) return { j, s: 0 };
      const s = fuzzyRank(`${j.title} ${j.url}`, q);
      return s === null ? null : { j, s };
    })
    .filter((r): r is { j: DownloadJob; s: number } => r !== null)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.j);

  const eta = queueEta(jobs, aggregateStatus(jobs).speedBps);

  const commitSearch = (value: string): void => {
    const t = value.trim().slice(0, 40);
    if (t.length === 0) return;
    const cur = settings.getState().settings.recentSearches.filter((r) => r !== t);
    void settings
      .getState()
      .save({ recentSearches: [t, ...cur].slice(0, 5) })
      .catch(() => undefined);
  };

  const toggleSaved = (value: string): void => {
    const t = value.trim().slice(0, 40);
    if (t.length === 0) return;
    const cur = settings.getState().settings.savedSearches;
    const next = cur.includes(t) ? cur.filter((s) => s !== t) : [...cur, t].slice(0, 10);
    void settings.getState().save({ savedSearches: next }).catch(() => undefined);
  };

  const setThrottle = (value: string | null): void => {
    settings.getState().save({ speedLimit: value }).catch(() => undefined);
  };

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
            if (job.splitChapters === true) {
              engine.openPath(job.destination).catch(fail);
            } else {
              engine.revealInFolder(job.destination).catch(fail);
            }
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
          const confirmMsg = job.splitChapters === true ? S.menu.deleteFolderConfirm : S.menu.deleteConfirm;
          if (!window.confirm(confirmMsg)) return;
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
      const notify = settings.getState().settings.notifyFinished;
      const done: DownloadJob[] = [];
      const failed: DownloadJob[] = [];
      for (const id of vanished) {
        const h = hist.find((x) => x.id === id);
        if (h?.status === "done") done.push(h);
        else if (h?.status === "error") failed.push(h);
      }
      // Digest (C8): one summary instead of N toasts + N OS notifications.
      if (done.length + failed.length > 1) {
        toast
          .getState()
          .push(
            formatStr(S.toast.finishedSummary, { done: done.length, failed: failed.length }),
            failed.length > 0 ? "error" : "success",
          );
        if (notify) {
          sendNotification(
            failed.length > 0 ? S.toast.failed : S.toast.finished,
            formatStr(S.toast.finishedSummary, { done: done.length, failed: failed.length }),
          );
        }
      }
      for (const id of vanished) {
        const h = hist.find((x) => x.id === id);
        if (done.length + failed.length > 1) {
          // Summary above already covered this job; only post-download
          // actions (open/reveal) still run per file.
          if (h?.status === "done" && action !== "none" && h.destination !== null) {
            if (action === "open-file" || h.splitChapters === true) {
              await engine.openPath(h.destination).catch(() => undefined);
            } else {
              await engine.revealInFolder(h.destination).catch(() => undefined);
            }
          }
          continue;
        }
        if (h?.status === "done") {
          const dest = h.destination;
          const toastLabel = h.splitChapters === true ? S.downloads.showFolder : S.downloads.openFile;
          toast
            .getState()
            .push(
              `${S.toast.finished}: ${h.title}`,
              "success",
              dest === null
                ? undefined
                : {
                    label: toastLabel,
                    run: () => {
                      engine.openPath(dest).catch(() => undefined);
                    },
                  },
            );
          if (notify) sendNotification(S.toast.finished, h.title);
          if (action !== "none" && h.destination !== null) {
            if (action === "open-file" || h.splitChapters === true) {
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
          if (notify) sendNotification(S.toast.failed, h.title);
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
  const hasClearable = jobs.some(
    (j) => j.status === "error" || j.status === "done" || j.status === "cancelled",
  );

  return (
    <section className="grabber-view" aria-label={S.downloads.title}>
      <h1>{S.downloads.title}</h1>
      {/* v1.7.2: the command bar is always mounted. It used to disappear with
          an empty queue, so on a fresh install the page had no search box at
          all — the search looked "missing" rather than empty. */}
      <div className="grabber-card dl-toolbar">
        <div className="url-row">
          <input
            id="downloads-search"
            data-testid="downloads-search"
            className="input"
            type="search"
            placeholder={S.downloads.searchPlaceholder}
            value={query}
            aria-label={S.downloads.searchPlaceholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSearch(query);
            }}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="btn btn-small"
              aria-label={S.logs.clearSearch}
              onClick={() => {
                setQuery("");
              }}
            >
              {S.logs.clearSearch}
            </button>
          )}
        </div>
        {jobs.length > 0 && (
          <>
            {savedSearches.length > 0 && (
              <div className="chip-row" role="group" aria-label={S.downloads.savedSearches}>
              <span className="muted">{S.downloads.savedSearches}:</span>
              {savedSearches.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  aria-pressed={query === s}
                  title={S.downloads.removeSaved}
                  onClick={() => {
                    setQuery(s);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleSaved(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {query.trim().length === 0 && recentSearches.length > 0 && (
            <div className="chip-row" role="group" aria-label={S.downloads.recentSearches}>
              <span className="muted">{S.downloads.recentSearches}:</span>
              {recentSearches.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setQuery(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {query.trim().length > 0 && (
            <div className="chip-row">
              <button
                type="button"
                className="chip"
                aria-pressed={savedSearches.includes(query.trim().slice(0, 40))}
                onClick={() => {
                  toggleSaved(query);
                }}
              >
                {S.downloads.saveSearch}
              </button>
            </div>
          )}
          <div className="chip-row" role="group" aria-label={S.downloads.bulkActions}>
            {(
              [
                ["all", S.downloads.filterAll],
                ["active", S.downloads.filterActive],
                ["error", S.downloads.filterError],
                ["done", S.downloads.filterDone],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="chip"
                aria-pressed={statusFilter === id}
                onClick={() => {
                  setStatusFilter(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="chip-row" role="group" aria-label={S.downloads.throttleLabel}>
            <span className="muted">{S.downloads.throttleLabel}:</span>
            <button
              type="button"
              className="chip"
              aria-pressed={speedLimit === null}
              onClick={() => {
                setThrottle(null);
              }}
            >
              {S.downloads.throttleUnlimited}
            </button>
            {(["2M", "8M"] as const).map((rate) => (
              <button
                key={rate}
                type="button"
                className="chip"
                aria-pressed={speedLimit === rate}
                onClick={() => {
                  setThrottle(rate);
                }}
              >
                {rate}/s
              </button>
            ))}
            <button
              type="button"
              className="chip"
              aria-pressed={speedLimit !== null && speedLimit !== "2M" && speedLimit !== "8M"}
              title={S.settings.speedLimit}
              onClick={() => {
                navigate("settings", "speed");
              }}
            >
              {speedLimit !== null && speedLimit !== "2M" && speedLimit !== "8M"
                ? `${speedLimit}/s`
                : "…"}
            </button>
            <span className="muted">({S.downloads.throttleNote})</span>
          </div>
          {eta !== null && (
            <p className="muted" role="status">
              {formatStr(S.downloads.queueEta, {
                eta: formatEta(eta.etaSeconds),
                size: formatSize(eta.remainingBytes, locale),
              })}
            </p>
          )}
          </>
        )}
      </div>
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
              // No confirm: the sweep is undoable from its toast (C2).
              queue
                .getState()
                .cancelQueued()
                .then((n) => {
                  if (n === 0) return;
                  toast.getState().push(
                    formatStr(S.downloads.cancelledNote, { count: n }),
                    "info",
                    {
                      label: S.downloads.undo,
                      run: () => {
                        queue.getState().undoSweep().catch(() => undefined);
                      },
                    },
                  );
                })
                .catch(failBulk);
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
          {selected.size > 0 && (
            <>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  runMany((id) => queue.getState().pause(id));
                }}
              >
                {S.downloads.bulkPause}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  runMany((id) => queue.getState().resume(id));
                }}
              >
                {S.downloads.bulkResume}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  runMany((id) => queue.getState().retry(id));
                }}
              >
                {S.downloads.bulkRetry}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  runMany((id) => queue.getState().cancel(id));
                }}
              >
                {S.downloads.bulkCancel}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setSelected(new Set());
                }}
              >
                {formatStr(S.downloads.selectedCount, { n: selected.size })} ·{" "}
                {S.downloads.clearSelection}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              void writeClipboardText(visible.map((j) => j.url).join("\n")).then((ok) => {
                toast
                  .getState()
                  .push(ok ? S.downloads.linksCopied : S.menu.copyFailed, ok ? "success" : "error");
              });
            }}
          >
            {S.downloads.copyLinks}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={!hasClearable}
            onClick={() => {
              queue
                .getState()
                .clearFinished()
                .then((n) => {
                  if (n === 0) return;
                  toast.getState().push(
                    formatStr(S.downloads.clearedNote, { count: n }),
                    "info",
                    {
                      label: S.downloads.undo,
                      run: () => {
                        queue.getState().undoSweep().catch(() => undefined);
                      },
                    },
                  );
                })
                .catch(failBulk);
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
          <div className="chip-row">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                navigate("home");
              }}
            >
              {S.downloads.goHome}
            </button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="grabber-card">
          <p className="muted" role="status">
            {S.downloads.noMatch}
          </p>
          <div className="chip-row">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
              }}
            >
              {S.downloads.clearFilters}
            </button>
          </div>
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
          {visible.map((j) => {
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
                locale={locale}
                now={now}
                selected={selected.has(j.id)}
                onToggleSelect={toggleSelect}
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

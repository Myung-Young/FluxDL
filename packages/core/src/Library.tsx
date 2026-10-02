import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import { pruneHistory, searchHistory } from "./queue.js";
import type { DownloadJob } from "./types.js";
import { STRINGS } from "./strings.js";
import { pressScale } from "./motion.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";
import { ContextMenu, type MenuItemDef } from "./ContextMenu.js";
import { buildJobMenu } from "./JobMenu.js";
import { writeClipboardText } from "./clipboard.js";

export interface LibraryProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
}

export function Library({ engine, queue, settings, toast }: LibraryProps): React.JSX.Element {
  const [history, setHistory] = useState<readonly DownloadJob[]>([]);
  const [query, setQuery] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [menu, setMenu] = useState<{ job: DownloadJob; x: number; y: number } | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const loaded = await engine.loadHistory();
      setHistory(pruneHistory(loaded, 500));
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [engine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => searchHistory(history, query), [history, query]);

  const redownload = async (h: DownloadJob): Promise<void> => {
    // Explicit re-download: bypasses the duplicate guard (user said so) and
    // skips the archive for this job.
    await queue.getState().enqueue({
      url: h.url,
      title: h.title,
      preset: h.preset,
      outputDir: settings.getState().settings.downloadDir,
      extractor: h.extractor ?? null,
      videoId: h.videoId ?? null,
    });
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await engine.removeHistory(id);
      toast.getState().push(STRINGS.toast.removed, "info");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async (): Promise<void> => {
    if (!window.confirm(STRINGS.library.clearConfirm)) return;
    setBusy(true);
    try {
      await engine.clearHistory();
      toast.getState().push(STRINGS.toast.cleared, "info");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const copyText = (text: string): void => {
    void writeClipboardText(text).then((ok) => {
      if (!ok) toast.getState().push(STRINGS.menu.copyFailed, "error");
    });
  };

  const fail = (err: unknown): void => {
    toast.getState().push(
      err instanceof Error ? err.message : STRINGS.menu.copyFailed,
      "error",
    );
  };

  const menuItems = (job: DownloadJob): MenuItemDef[] =>
    buildJobMenu(job, {
      copyUrl: (text) => {
        copyText(text);
      },
      copyPath: (text) => {
        copyText(text);
      },
      openFile: () => {
        if (job.destination !== null) engine.openPath(job.destination).catch(fail);
      },
      reveal: () => {
        if (job.destination !== null) engine.revealInFolder(job.destination).catch(fail);
      },
      retryWithPreset: (preset) => {
        queue
          .getState()
          .enqueue({
            url: job.url,
            title: job.title,
            preset,
            outputDir: settings.getState().settings.downloadDir,
          })
          .catch(fail);
      },
      remove: () => {
        void remove(job.id);
      },
      deleteFile: () => {
        const dest = job.destination;
        if (dest === null) return;
        if (!window.confirm(STRINGS.menu.deleteConfirm)) return;
        engine
          .trashFile(dest)
          .then(() => engine.updateHistory({ ...job, fileDeleted: true }))
          .then(() => refresh())
          .then(() => {
            toast.getState().push(STRINGS.menu.deletedToast, "success");
          })
          .catch(fail);
      },
    });

  return (
    <section className="grabber-view" aria-label={STRINGS.library.title}>
      <h1>{STRINGS.library.title}</h1>
      <div className="grabber-card">
        <input
          className="input"
          placeholder={STRINGS.library.searchPlaceholder}
          value={query}
          aria-label={STRINGS.library.searchPlaceholder}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
      </div>
      {loading ? (
        <div className="grabber-card">
          <p className="muted" aria-busy="true">
            {STRINGS.library.loading}
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="grabber-card">
          <p className="muted">
            {query.trim().length > 0 ? STRINGS.library.emptySearch : STRINGS.library.empty}
          </p>
        </div>
      ) : (
        <div className="dl-list">
          {visible.map((h) => (
            <article
              key={h.id}
              className="grabber-card"
              aria-label={h.title}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ job: h, x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ job: h, x: r.left + 24, y: r.top + 24 });
                }
              }}
            >
              <h2 className="dl-title">{h.title}</h2>
              <p className="muted">
                {h.status}
                {h.error !== null ? ` · ${h.error}` : ""}
                {h.fileDeleted === true ? ` · ${STRINGS.menu.fileDeleted}` : ""}
              </p>
              <div className="chip-row">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onPointerDown={(e) => {
                    pressScale(e.currentTarget);
                  }}
                  onClick={() => {
                    redownload(h).catch(() => undefined);
                  }}
                >
                  {STRINGS.library.redownload}
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => {
                    void remove(h.id);
                  }}
                >
                  {STRINGS.library.remove}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {history.length > 0 && (
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            void clearAll();
          }}
        >
          {STRINGS.library.clearAll}
        </button>
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

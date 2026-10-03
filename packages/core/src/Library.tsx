import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import { pruneHistory, searchHistory } from "./queue.js";
import type { DownloadJob } from "./types.js";
import { pressScale } from "./motion.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";
import { useStrings } from "./locale.js";
import { chunkDestinations, deriveMissingIds } from "./health.js";
import { VirtualList } from "./VirtualList.js";
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
  const S = useStrings(settings);
  const [history, setHistory] = useState<readonly DownloadJob[]>([]);
  const [query, setQuery] = useState<string>("");
  const [debouncedQuery, setDebouncedQuery] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [menu, setMenu] = useState<{ job: DownloadJob; x: number; y: number } | null>(null);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [checking, setChecking] = useState<boolean>(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  const checkHealth = useCallback(
    async (records: readonly DownloadJob[]): Promise<void> => {
      setChecking(true);
      try {
        const exists = new Map<string, boolean>();
        for (const chunk of chunkDestinations(records, 40)) {
          const found = await engine.fileExistsBulk(chunk).catch(() => chunk.map(() => false));
          chunk.forEach((d, i) => {
            exists.set(d, found[i] ?? false);
          });
          await new Promise((r) => setTimeout(r, 0));
        }
        setMissing(deriveMissingIds(records, exists));
      } finally {
        setChecking(false);
      }
    },
    [engine],
  );

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const loaded = await engine.loadHistory();
      const pruned = pruneHistory(loaded, 500);
      setHistory(pruned);
      void checkHealth(pruned);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [engine, checkHealth]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(
    () => searchHistory(history, debouncedQuery),
    [history, debouncedQuery],
  );

  const locate = async (id: string): Promise<void> => {
    const picked = await engine.pickFile().catch(() => null);
    if (picked === null) return;
    const rec = history.find((h) => h.id === id);
    if (rec === undefined) return;
    setBusy(true);
    try {
      await engine.updateHistory({ ...rec, destination: picked, fileDeleted: false });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

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
      toast.getState().push(S.toast.removed, "info");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async (): Promise<void> => {
    if (!window.confirm(S.library.clearConfirm)) return;
    setBusy(true);
    try {
      await engine.clearHistory();
      toast.getState().push(S.toast.cleared, "info");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const copyText = (text: string): void => {
    void writeClipboardText(text).then((ok) => {
      if (!ok) toast.getState().push(S.menu.copyFailed, "error");
    });
  };

  const fail = (err: unknown): void => {
    toast.getState().push(
      err instanceof Error ? err.message : S.menu.copyFailed,
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
      },      deleteFile: () => {
        const dest = job.destination;
        if (dest === null) return;
        const confirmMsg = job.splitChapters === true ? S.menu.deleteFolderConfirm : S.menu.deleteConfirm;
        if (!window.confirm(confirmMsg)) return;
        engine
          .trashFile(dest)
          .then(() => engine.updateHistory({ ...job, fileDeleted: true }))
          .then(() => refresh())
          .then(() => {
            toast.getState().push(S.menu.deletedToast, "success");
          })
          .catch(fail);
      },
    },
    undefined,
    S);

  const renderRow = (h: DownloadJob): React.JSX.Element => (
    <article
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
        {h.fileDeleted === true ? ` · ${h.splitChapters === true ? S.menu.folderDeleted : S.menu.fileDeleted}` : ""}
        {missing.has(h.id) && (
          <>
            {" · "}
            <span className="badge badge-warn">{S.library.missing}</span>
          </>
        )}
      </p>
      <div className="chip-row">
        {h.destination !== null && !missing.has(h.id) && h.fileDeleted !== true && (
          <>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => {
                if (h.destination !== null) engine.openPath(h.destination).catch(fail);
              }}
            >
              {h.splitChapters === true ? S.downloads.showFolder : S.downloads.openFile}
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() => {
                if (h.destination !== null) engine.revealInFolder(h.destination).catch(fail);
              }}
            >
              {S.downloads.showInFolder}
            </button>
          </>
        )}
        {missing.has(h.id) && (
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => {
              void locate(h.id);
            }}
          >
            {S.library.locate}
          </button>
        )}
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
          {S.library.redownload}
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy}
          onClick={() => {
            void remove(h.id);
          }}
        >
          {S.library.remove}
        </button>
      </div>
    </article>
  );

  return (
    <section className="grabber-view" aria-label={S.library.title}>
      <h1>{S.library.title}</h1>
      <div className="grabber-card">
        <input
          className="input"
          placeholder={S.library.searchPlaceholder}
          value={query}
          aria-label={S.library.searchPlaceholder}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        {checking && <p className="muted">{S.library.checking}</p>}
      </div>
      {loading ? (
        <div className="grabber-card">
          <p className="muted" aria-busy="true">
            {S.library.loading}
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="grabber-card">
          <p className="muted" role="status">
            {query.trim().length > 0 ? S.library.emptySearch : S.library.empty}
          </p>
        </div>
      ) : visible.length >= 200 ? (
        <VirtualList
          items={visible}
          rowHeight={140}
          height={480}
          ariaLabel={S.library.title}
          keyOf={(h) => h.id}
          renderRow={(h) => renderRow(h)}
        />
      ) : (
        <div className="dl-list">
          {visible.map((h) => (
            <div key={h.id}>{renderRow(h)}</div>
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
          {S.library.clearAll}
        </button>
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

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import { pruneHistory, searchHistory } from "./queue.js";
import type { DownloadJob } from "./types.js";
import { pressScale } from "./motion.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";
import { formatStr, useStrings } from "./locale.js";
import { chunkDestinations, deriveMissingIds } from "./health.js";
import { VirtualList } from "./VirtualList.js";
import { ContextMenu, type MenuItemDef } from "./ContextMenu.js";
import { buildJobMenu } from "./JobMenu.js";
import { writeClipboardText } from "./clipboard.js";
import { PreviewModal } from "./PreviewModal.js";
import { isMediaFile } from "./destination.js";
import { addWatchChannel, diffWatch, touchWatch } from "./watchlist.js";
import type { PlaylistEntry, WatchChannel } from "./types.js";

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
  const [preview, setPreview] = useState<DownloadJob | null>(null);
  // Watchlist (A6): channels checked for new uploads.
  const [watch, setWatch] = useState<readonly WatchChannel[]>([]);
  const [watchUrl, setWatchUrl] = useState<string>("");
  const [watchNote, setWatchNote] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Readonly<Record<string, readonly PlaylistEntry[]>>>({});
  const [freshFrom, setFreshFrom] = useState<Readonly<Record<string, string | null>>>({});

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

  useEffect(() => {
    void engine
      .loadWatchlist()
      .then((w) => {
        setWatch(w);
      })
      .catch(() => undefined);
  }, [engine]);

  const persistWatch = async (next: readonly WatchChannel[]): Promise<void> => {
    setWatch(next);
    await engine.saveWatchlist([...next]).catch(() => undefined);
  };

  const addWatch = async (): Promise<void> => {
    const url = watchUrl.trim();
    if (url.length === 0) return;
    setBusy(true);
    try {
      const info = await engine.getInfo(url);
      const next = addWatchChannel(watch, info.url, info.title);
      setWatchUrl("");
      setWatchNote(null);
      await persistWatch(next);
    } catch {
      setWatchNote(S.home.invalidUrl);
    } finally {
      setBusy(false);
    }
  };

  const checkWatch = async (channel: WatchChannel): Promise<void> => {
    setBusy(true);
    try {
      const info = await engine.getInfo(channel.url);
      const diff = diffWatch(info, channel.lastVideoId);
      const next = touchWatch(watch, channel.url, {
        title: info.title,
        lastVideoId: diff.baseline,
        lastCheckedAt: Date.now(),
      });
      await persistWatch(next);
      setFresh((prev) => ({ ...prev, [channel.url]: diff.fresh }));
      setFreshFrom((prev) => ({ ...prev, [channel.url]: info.extractor }));
      setWatchNote(
        diff.isFirstCheck
          ? S.library.watchFirstCheck
          : formatStr(S.library.watchNew, { n: diff.fresh.length }),
      );
    } catch {
      setWatchNote(S.home.analyzeFailed);
    } finally {
      setBusy(false);
    }
  };

  const queueFresh = async (channel: WatchChannel): Promise<void> => {
    const entries = fresh[channel.url] ?? [];
    if (entries.length === 0) return;
    setBusy(true);
    try {
      const preset = settings.getState().settings.defaultPreset;
      const outputDir = settings.getState().settings.downloadDir;
      const extractor = freshFrom[channel.url] ?? null;
      for (const e of entries) {
        await queue.getState().enqueue({
          url: e.url,
          title: e.title,
          preset,
          outputDir,
          extractor,
          videoId: e.id,
        });
      }
      setFresh((prev) => ({ ...prev, [channel.url]: [] }));
      toast.getState().push(S.toast.queued, "info");
    } finally {
      setBusy(false);
    }
  };

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
    // Re-downloading replaces the existing file, so ask first (M4.8). The
    // confirmation names the file so nobody is surprised by a silent replace.
    if (!window.confirm(formatStr(S.library.redownloadConfirm, { title: h.title }))) return;
    setBusy(true);
    try {
      await queue.getState().enqueue({
        url: h.url,
        title: h.title,
        preset: h.preset,
        outputDir: settings.getState().settings.downloadDir,
        extractor: h.extractor ?? null,
        videoId: h.videoId ?? null,
        // Without this yt-dlp answers "has already been downloaded" and exits
        // successfully without fetching anything.
        forceOverwrite: true,
        // Re-download stays on the original engine.
        ...(h.engineId === "gallery-dl" ? { engineId: "gallery-dl" as const } : {}),
      });
      toast.getState().push(S.toast.queued, "info");
    } finally {
      setBusy(false);
    }
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
            {h.splitChapters !== true && isMediaFile(h.destination) && (
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => {
                  setPreview(h);
                }}
              >
                {S.library.preview}
              </button>
            )}
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
        {/* v1.7.2: a real `type="search"` box with a clear button and a live
            match count, so typing visibly does something on every page. */}
        <div className="url-row">
          <input
            id="library-search"
            data-testid="library-search"
            className="input"
            type="search"
            placeholder={S.library.searchPlaceholder}
            value={query}
            aria-label={S.library.searchPlaceholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
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
        {!loading && history.length > 0 && (
          <p className="muted" role="status">
            {formatStr(S.library.results, { n: visible.length, t: history.length })}
          </p>
        )}
        {checking && <p className="muted">{S.library.checking}</p>}
      </div>
      <div className="grabber-card">
        <h2 className="dl-title">{S.library.watchTitle}</h2>
        <div className="url-row">
          <input
            className="input"
            placeholder={S.library.watchPlaceholder}
            value={watchUrl}
            aria-label={S.library.watchPlaceholder}
            spellCheck={false}
            disabled={busy}
            onChange={(e) => {
              setWatchUrl(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addWatch();
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              void addWatch();
            }}
          >
            {S.library.watchAdd}
          </button>
        </div>
        {watchNote !== null && (
          <p className="note" role="status">
            {watchNote}
          </p>
        )}
        {watch.length === 0 ? (
          <p className="muted" role="status">
            {S.library.watchEmpty}
          </p>
        ) : (
          <ul className="entries">
            {watch.map((c) => {
              const freshCount = fresh[c.url]?.length ?? 0;
              return (
                <li key={c.url} className="batch-row">
                  <span className="batch-title" title={c.url}>
                    {c.title}
                  </span>
                  {c.lastCheckedAt !== null && (
                    <span className="muted">
                      {formatStr(S.library.watchLastChecked, {
                        when: new Date(c.lastCheckedAt).toLocaleString(),
                      })}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => {
                      void checkWatch(c);
                    }}
                  >
                    {S.library.watchCheck}
                  </button>
                  {freshCount > 0 && (
                    <button
                      type="button"
                      className="btn btn-small"
                      disabled={busy}
                      onClick={() => {
                        void queueFresh(c);
                      }}
                    >
                      {formatStr(S.library.watchQueueNew, { n: freshCount })}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={busy}
                    onClick={() => {
                      void persistWatch(watch.filter((w) => w.url !== c.url));
                    }}
                  >
                    {S.library.watchRemove}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
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
      {preview !== null && preview.destination !== null && (
        <PreviewModal
          engine={engine}
          settings={settings}
          path={preview.destination}
          title={preview.title}
          onClose={() => {
            setPreview(null);
          }}
        />
      )}
    </section>
  );
}

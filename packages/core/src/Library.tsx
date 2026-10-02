import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import { pruneHistory, searchHistory } from "./queue.js";
import type { DownloadJob } from "./types.js";
import { STRINGS } from "./strings.js";
import { pressScale } from "./motion.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";

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
    await queue.getState().enqueue({
      url: h.url,
      title: h.title,
      preset: h.preset,
      outputDir: settings.getState().settings.downloadDir,
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
            <article key={h.id} className="grabber-card" aria-label={h.title}>
              <h2 className="dl-title">{h.title}</h2>
              <p className="muted">
                {h.status}
                {h.error !== null ? ` · ${h.error}` : ""}
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
    </section>
  );
}

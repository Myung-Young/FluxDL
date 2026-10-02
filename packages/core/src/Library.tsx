import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import { pruneHistory, searchHistory } from "./queue.js";
import type { DownloadJob } from "./types.js";
import { STRINGS } from "./strings.js";
import { pressScale } from "./motion.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";

export interface LibraryProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
}

export function Library({ engine, queue, settings }: LibraryProps): React.JSX.Element {
  const [history, setHistory] = useState<readonly DownloadJob[]>([]);
  const [query, setQuery] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  const refresh = useCallback(async (): Promise<void> => {
    const loaded = await engine.loadHistory().catch(() => []);
    setHistory(pruneHistory(loaded, 500));
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
      {visible.length === 0 ? (
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

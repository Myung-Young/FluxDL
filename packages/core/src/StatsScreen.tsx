import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { DownloadJob } from "./types.js";
import { formatSize } from "./media.js";
import { pruneHistory } from "./queue.js";
import { useStrings } from "./locale.js";
import type { SettingsStoreState } from "./stores.js";
import {
  computeStats,
  formatTotalDuration,
  type DownloadStats,
} from "./stats.js";
import type { StorageInsights } from "./engine.js";

export interface StatsProps {
  readonly engine: DownloadEngine;
  readonly settings: StoreApi<SettingsStoreState>;
}

/** Widest bar value, so every chart shares one scale. */
function scale(values: readonly number[]): number {
  return Math.max(1, ...values);
}

/** Bar width as a percentage of the widest row in the same chart. */
function pct(value: number, max: number): number {
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function Stats({ engine, settings }: StatsProps): React.JSX.Element {
  const S = useStrings(settings);
  const settingsState = settings.getState().settings;
  const locale = settingsState.language === "ms" ? "ms-MY" : "en";
  const [history, setHistory] = useState<readonly DownloadJob[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [storage, setStorage] = useState<StorageInsights | null>(null);
  const [cleaning, setCleaning] = useState<boolean>(false);

  /**
   * Fill in the size of finished rows that have none (v1.7.2).
   *
   * Records written before the engine reported the real output size — or by a
   * build whose post-processing wiped it — leave the "total size" tile on
   * "Unknown" forever, even though the file is sitting right there on disk. The
   * engine measures it for us (guard-checked), so the tile is correct for the
   * whole existing library, not just for new downloads.
   */
  const backfillSizes = useCallback(
    async (rows: readonly DownloadJob[]): Promise<readonly DownloadJob[]> => {
      const targets: Array<{ index: number; path: string }> = [];
      rows.forEach((r, index) => {
        if (r.status !== "done") return;
        if (typeof r.totalBytes === "number" && r.totalBytes > 0) return;
        const dest = r.destination;
        if (dest === null || dest.length === 0) return;
        targets.push({ index, path: dest });
      });
      if (targets.length === 0) return rows;
      const sizes = await engine
        .fileSizesBulk(targets.map((t) => t.path))
        .catch(() => [] as Array<number | null>);
      if (sizes.length === 0) return rows;
      const byIndex = new Map<number, number>();
      targets.forEach((t, i) => {
        const size = sizes[i];
        if (size !== null && size !== undefined && size > 0) byIndex.set(t.index, size);
      });
      if (byIndex.size === 0) return rows;
      return rows.map((r, index) => {
        const size = byIndex.get(index);
        if (size === undefined) return r;
        return { ...r, totalBytes: size, downloadedBytes: r.downloadedBytes ?? size };
      });
    },
    [engine],
  );

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const loaded = await engine.loadHistory();
      const pruned = pruneHistory(loaded, settings.getState().settings.historyLimit);
      setHistory(await backfillSizes(pruned));
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
    void engine
      .getStorageInsights()
      .then((s) => {
        setStorage(s);
      })
      .catch(() => undefined);
  }, [engine, settings, backfillSizes]);

  const cleanOrphans = async (): Promise<void> => {
    if (storage === null || storage.orphans.length === 0) return;
    setCleaning(true);
    try {
      for (const p of storage.orphans) {
        await engine.trashFile(p).catch(() => undefined);
      }
      const next = await engine.getStorageInsights().catch(() => null);
      if (next !== null) setStorage(next);
    } finally {
      setCleaning(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stats: DownloadStats = useMemo(
    () => computeStats(history, Date.now()),
    [history],
  );

  if (loading) {
    return (
      <section className="grabber-view" aria-label={S.stats.title}>
        <h1>{S.stats.title}</h1>
        <p className="muted" role="status">
          {S.library.loading}
        </p>
      </section>
    );
  }

  const weekMax = scale(stats.weeks.map((w) => w.count));
  const uploaderMax = scale(stats.topUploaders.map((u) => u.count));
  const presetMax = scale(stats.presets.map((p) => p.count));

  return (
    <section className="grabber-view" aria-label={S.stats.title} data-testid="stats-view">
      <h1>{S.stats.title}</h1>

      {stats.empty ? (
        <p className="muted" data-testid="stats-empty">
          {S.stats.empty}
        </p>
      ) : (
        <>
          <div className="stat-row" data-testid="stats-tiles">
            <Tile label={S.stats.completed} value={String(stats.completed)} />
            <Tile label={S.stats.totalSize} value={stats.totalBytes === null ? S.stats.unknown : formatSize(stats.totalBytes)} />
            <Tile
              label={S.stats.totalDuration}
              value={
                stats.totalDurationSec === null
                  ? S.stats.unknown
                  : formatTotalDuration(stats.totalDurationSec)
              }
            />
            <Tile label={S.stats.failed} value={String(stats.failed)} />
          </div>

          {stats.unknownSizeCount > 0 && (
            <p className="hint" data-testid="stats-unknown-size">
              {S.stats.unknownNote.replace("{count}", String(stats.unknownSizeCount))}
            </p>
          )}

          <div className="grabber-card">
            <h2 className="dl-title">{S.stats.perWeek}</h2>
            <svg
              className="stat-chart"
              viewBox="0 0 320 90"
              preserveAspectRatio="none"
              role="img"
              aria-label={S.stats.perWeek}
              data-testid="stats-weeks"
            >
              {stats.weeks.map((week, i) => {
                const h = (week.count / weekMax) * 70;
                return (
                  <rect
                    key={week.start}
                    x={4 + i * 26}
                    y={80 - h}
                    width={20}
                    height={h}
                    rx={3}
                    fill="var(--accent)"
                    opacity={week.count === 0 ? 0.25 : 1}
                  >
                    <title>{`${week.label}: ${String(week.count)}`}</title>
                  </rect>
                );
              })}
            </svg>
            <div className="stat-axis">
              <span className="muted">{stats.weeks[0]?.label ?? ""}</span>
              <span className="muted">{stats.weeks[stats.weeks.length - 1]?.label ?? ""}</span>
            </div>
          </div>

          <TopList
            title={S.stats.topUploaders}
            rows={stats.topUploaders.map((u) => ({ key: u.name, count: u.count }))}
            max={uploaderMax}
            empty={S.stats.noUploaders}
            testId="stats-uploaders"
          />
          <TopList
            title={S.stats.presetMix}
            rows={stats.presets.map((p) => ({ key: p.label, count: p.count }))}
            max={presetMax}
            empty={S.stats.noData}
            testId="stats-presets"
          />
          <TopList
            title={S.stats.topSites}
            rows={stats.sites.map((u) => ({
              key: u.name === "?" ? S.stats.unknown : u.name,
              count: u.count,
            }))}
            max={uploaderMax}
            empty={S.stats.noData}
            testId="stats-sites"
          />
          <TopList
            title={S.stats.presetSuccess}
            rows={stats.presetSuccess.map((p) => ({
              key: `${p.label} · ${p.rate === null ? S.stats.unknown : `${String(Math.round(p.rate * 100))}%`}`,
              count: p.done,
            }))}
            max={Math.max(1, ...stats.presetSuccess.map((p) => p.done))}
            empty={S.stats.noData}
            testId="stats-success"
          />
          {stats.presetSuccess.some((p) => p.total >= 3 && (p.rate ?? 1) <= 0.5) && (
            <p className="note" role="status">
              {S.stats.presetAdvice}
            </p>
          )}
          {storage !== null && (
            <div className="grabber-card" data-testid="stats-storage">
              <h2 className="dl-title">{S.stats.storage}</h2>
              <ul className="stat-list">
                <li className="stat-row-line">
                  <span className="stat-name">
                    {S.home.kindAudio} · {formatSize(storage.audioBytes, locale)}
                  </span>
                  <span className="stat-bar" aria-hidden="true">
                    <span
                      className="stat-bar-fill"
                      style={{
                        width: `${String(pct(storage.audioFiles, Math.max(1, storage.audioFiles + storage.videoFiles + storage.otherFiles)))}%`,
                      }}
                    />
                  </span>
                  <span className="stat-count">{storage.audioFiles}</span>
                </li>
                <li className="stat-row-line">
                  <span className="stat-name">
                    {S.home.kindVideo} · {formatSize(storage.videoBytes, locale)}
                  </span>
                  <span className="stat-bar" aria-hidden="true">
                    <span
                      className="stat-bar-fill"
                      style={{
                        width: `${String(pct(storage.videoFiles, Math.max(1, storage.audioFiles + storage.videoFiles + storage.otherFiles)))}%`,
                      }}
                    />
                  </span>
                  <span className="stat-count">{storage.videoFiles}</span>
                </li>
              </ul>
              {storage.orphans.length > 0 && (
                <div className="chip-row">
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={cleaning}
                    onClick={() => {
                      void cleanOrphans();
                    }}
                  >
                    {S.stats.cleanOrphans} ({formatSize(storage.orphanBytes, locale)})
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="note">{S.stats.derivedFromHistory}</p>
        </>
      )}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="stat-tile">
      <span className="stat-value">{value}</span>
      <span className="muted">{label}</span>
    </div>
  );
}

interface TopRow {
  readonly key: string;
  readonly count: number;
}

function TopList({
  title,
  rows,
  max,
  empty,
  testId,
}: {
  title: string;
  rows: readonly TopRow[];
  max: number;
  empty: string;
  testId: string;
}): React.JSX.Element {
  return (
    <div className="grabber-card" data-testid={testId}>
      <h2 className="dl-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="stat-list">
          {rows.map((row) => (
            <li key={row.key} className="stat-row-line">
              <span className="stat-name">{row.key}</span>
              <span className="stat-bar" aria-hidden="true">
                <span className="stat-bar-fill" style={{ width: `${String(pct(row.count, max))}%` }} />
              </span>
              <span className="stat-count">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
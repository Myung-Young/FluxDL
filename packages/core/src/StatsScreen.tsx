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
  const [history, setHistory] = useState<readonly DownloadJob[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const loaded = await engine.loadHistory();
      setHistory(pruneHistory(loaded, settings.getState().settings.historyLimit));
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [engine, settings]);

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
import type { StoreApi } from "zustand";
import type { DownloadJob } from "./types.js";
import type { Strings } from "./strings.js";
import type { QueueStoreState } from "./stores.js";
import { miniRows, miniSummary } from "./window.js";

export interface MiniViewProps {
  readonly jobs: readonly DownloadJob[];
  readonly queue: StoreApi<QueueStoreState>;
  readonly strings: Strings;
  readonly aggregateText: string;
  readonly onExit: () => void;
}

/**
 * Compact view shown inside the mini window (M4.4).
 *
 * Deliberately not a second window: `QueueController` lives in the renderer,
 * so a second window would duplicate queue state and contend for the single
 * engine (D83). This is the same React tree with the sidebar hidden.
 */
export function MiniView({ jobs, queue, strings: S, aggregateText, onExit }: MiniViewProps): React.JSX.Element {
  const rows = miniRows(jobs);
  const summary = miniSummary(jobs);
  const paused = jobs.some((j) => j.status === "paused");

  return (
    <section className="grabber-view mini-view" aria-label={S.mini.title} data-testid="mini-view">
      <div className="mini-head">
        <span className="muted" data-testid="mini-aggregate" role="status">
          {aggregateText}
        </span>
        <button type="button" className="btn btn-small" onClick={onExit} data-testid="mini-exit">
          {S.mini.exit}
        </button>
      </div>

      <div className="chip-row">
        <button
          type="button"
          className="btn btn-small"
          data-testid="mini-pause-all"
          onClick={() => {
            void queue.getState().pauseAll().catch(() => undefined);
          }}
        >
          {S.downloads.pauseAll}
        </button>
        <button
          type="button"
          className="btn btn-small"
          data-testid="mini-resume-all"
          disabled={!paused}
          onClick={() => {
            void queue.getState().resumeAll().catch(() => undefined);
          }}
        >
          {S.downloads.resumeAll}
        </button>
        <span className="muted">{summary.total}</span>
      </div>

      {rows.length === 0 ? (
        <p className="muted" data-testid="mini-empty">
          {S.mini.empty}
        </p>
      ) : (
        <ul className="mini-list">
          {rows.map((job) => (
            <li key={job.id} className="mini-row" data-testid="mini-row">
              <span className="mini-title">{job.title}</span>
              <span className="mini-meta">
                {job.stage ?? job.status}
                {job.speed !== null ? ` · ${job.speed}` : ""}
              </span>
              <span
                className="dl-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job.progress ?? undefined}
                {...(job.progress === null ? { "aria-valuetext": S.status.working } : {})}
              >
                <span
                  className={`dl-fill${job.progress === null ? " is-indeterminate" : ""}`}
                  style={job.progress === null ? undefined : { width: `${String(job.progress)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
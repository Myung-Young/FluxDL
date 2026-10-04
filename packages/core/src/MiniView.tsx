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
 *
 * Scope (v1.7.0): monitor + control only — aggregate status, overall
 * progress, per-row pause/resume/cancel, failed retry-all. Queueing,
 * settings and history stay in the full window.
 */
export function MiniView({ jobs, queue, strings: S, aggregateText, onExit }: MiniViewProps): React.JSX.Element {
  const rows = miniRows(jobs);
  const summary = miniSummary(jobs);
  const paused = jobs.some((j) => j.status === "paused");
  const failed = jobs.filter((j) => j.status === "error").length;
  const known = rows.map((j) => j.progress).filter((p): p is number => p !== null);
  const overall = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;

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

      {rows.length > 0 && (
        <span
          className="dl-track mini-overall"
          role="progressbar"
          aria-label={aggregateText}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={overall === null ? undefined : Math.round(overall)}
          {...(overall === null ? { "aria-valuetext": S.status.working } : {})}
        >
          <span
            className={`dl-fill${overall === null ? " is-indeterminate" : ""}`}
            style={overall === null ? undefined : { width: `${String(overall)}%` }}
          />
        </span>
      )}

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

      {failed > 0 && (
        <div className="chip-row">
          <span className="muted" role="status">
            {S.downloads.filterError}: {failed}
          </span>
          <button
            type="button"
            className="btn btn-small"
            data-testid="mini-retry-all"
            onClick={() => {
              void queue.getState().retryAll().catch(() => undefined);
            }}
          >
            {S.downloads.retryAll}
          </button>
        </div>
      )}

      {rows.length === 0 && failed === 0 ? (
        <p className="muted" data-testid="mini-empty">
          {S.mini.empty}
        </p>
      ) : (
        <ul className="mini-list">
          {rows.map((job) => (
            <MiniRow key={job.id} job={job} queue={queue} strings={S} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MiniRow({
  job,
  queue,
  strings: S,
}: {
  readonly job: DownloadJob;
  readonly queue: StoreApi<QueueStoreState>;
  readonly strings: Strings;
}): React.JSX.Element {
  const isPaused = job.status === "paused";
  return (
    <li className="mini-row" data-testid="mini-row">
      <span className="mini-title">{job.title}</span>
      <span className="mini-meta">
        {job.stage ?? job.status}
        {job.speed !== null ? ` · ${job.speed}` : ""}
        {job.eta !== null ? ` · ${job.eta}` : ""}
        {job.progress !== null ? ` · ${String(Math.round(job.progress))}%` : ""}
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
      <span className="mini-actions">
        <button
          type="button"
          className="btn btn-small"
          aria-label={isPaused ? S.downloads.resume : S.downloads.pause}
          onClick={() => {
            const st = queue.getState();
            void (isPaused ? st.resume(job.id) : st.pause(job.id)).catch(() => undefined);
          }}
        >
          {isPaused ? S.downloads.resume : S.downloads.pause}
        </button>
        <button
          type="button"
          className="btn btn-small"
          aria-label={S.downloads.cancel}
          onClick={() => {
            void queue.getState().cancel(job.id).catch(() => undefined);
          }}
        >
          {S.downloads.cancel}
        </button>
      </span>
    </li>
  );
}

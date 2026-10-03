import type { DownloadJob } from "./types.js";
import { parseSpeedBps } from "./progress.js";

/**
 * Aggregate queue status for the sidebar footer, tray tooltip, and taskbar
 * progress (M1.5). Pure; the throttled send lives in Shell.
 */

export interface AggregateStatus {
  /** analyzing + downloading + processing jobs. */
  readonly active: number;
  readonly queued: number;
  /** Mean percent of downloading jobs; null when idle or when nothing is
   * downloading (analyzing/processing only -> indeterminate). */
  readonly percent: number | null;
  /** Summed download speed in bytes/s (0 when nothing reports speed). */
  readonly speedBps: number;
}

export function aggregateStatus(jobs: readonly DownloadJob[]): AggregateStatus {
  let active = 0;
  let queued = 0;
  let downloading = 0;
  let percentSum = 0;
  let speedBps = 0;
  for (const j of jobs) {
    if (j.status === "queued") {
      queued += 1;
    } else if (
      j.status === "analyzing" ||
      j.status === "downloading" ||
      j.status === "processing"
    ) {
      active += 1;
      const bps = parseSpeedBps(j.speed);
      if (bps !== null) speedBps += bps;
      if (j.status === "downloading") {
        downloading += 1;
        percentSum += j.progress;
      }
    }
  }
  return {
    active,
    queued,
    percent: active === 0 || downloading === 0 ? null : percentSum / downloading,
    speedBps,
  };
}

/** Human speed for the aggregate line, e.g. 13002342 -> "12.4 MB/s". */
export function formatSpeedBps(bps: number, locale = "en"): string {
  if (!Number.isFinite(bps) || bps < 0) return "-";
  const one = (v: number): string =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: false,
    }).format(v);
  if (bps < 1024) return `${String(Math.round(bps))} B/s`;
  if (bps < 1024 ** 2) return `${one(bps / 1024)} KB/s`;
  if (bps < 1024 ** 3) return `${one(bps / 1024 ** 2)} MB/s`;
  return `${one(bps / 1024 ** 3)} GB/s`;
}

/** Max taskbar/tray send rate: 4 updates/s. Pure gate (injected clock). */
export const AGGREGATE_SEND_MS = 250;

export function shouldSendAggregate(lastSentAt: number | null, now: number): boolean {
  return lastSentAt === null || now - lastSentAt >= AGGREGATE_SEND_MS;
}

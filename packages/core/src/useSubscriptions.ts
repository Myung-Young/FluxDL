import { useEffect, useRef } from "react";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import { diffWatch } from "./watchlist.js";
import { MAX_NEW_PER_CHECK, dueSubs, recordSubResult } from "./subscriptions.js";
import { resolveEngine } from "./engines.js";
import type { Strings } from "./strings.js";
import { formatStr } from "./locale.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";
import type { ShellView } from "./Shell.js";

export interface SubscriptionsHookDeps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
  readonly ready: boolean;
  readonly strings: Strings;
  readonly switchView: (view: ShellView) => void;
}

/**
 * Subscription poller (Phase 3). Tick every minute, check only due channels
 * (≥30 min interval, backoff on failure), sequentially, max 5 per tick.
 * Auto mode enqueues (per-sub folder/preset/engine, cap-50 confirm);
 * notify mode toasts. First check per channel only sets the baseline.
 * Replaces the experimental launch-only check: same job, always on.
 */
export function useSubscriptions(deps: SubscriptionsHookDeps): void {
  const checking = useRef<boolean>(false);
  const depsRef = useRef<SubscriptionsHookDeps>(deps);
  depsRef.current = deps;
  useEffect(() => {
    if (!deps.ready) return;
    // Liveness rides the timer ref: the cleanup nulls it, so an in-flight
    // tick (or a late interval fire) stops at the next guard. A plain
    // boolean flag gets narrowed away by no-unnecessary-condition.
    const timerRef: { current: ReturnType<typeof setInterval> | null } = { current: null };
    const isAlive = (): boolean => timerRef.current !== null;
    const tick = async (): Promise<void> => {
      const d = depsRef.current;
      if (checking.current || !isAlive()) return;
      checking.current = true;
      try {
        const channels = await d.engine.loadWatchlist().catch(() => null);
        if (channels === null || channels.length === 0 || !isAlive()) return;
        const due = dueSubs(channels, Date.now()).slice(0, 5);
        if (due.length === 0) return;
        const byUrl = new Map(channels.map((c) => [c.url, c] as const));
        let changed = false;
        for (const sub of due) {
          if (!isAlive()) break;
          const now = Date.now();
          try {
            const info = await d.engine.getInfo(sub.url);
            if (!isAlive()) break;
            const diff = diffWatch(info, sub.lastVideoId);
            const next = {
              ...recordSubResult(sub, true, now),
              title: info.title,
              lastVideoId: diff.baseline,
            };
            byUrl.set(sub.url, next);
            changed = true;
            if (diff.fresh.length === 0) continue;
            if (next.mode === "auto") {
              const st = d.settings.getState().settings;
              const items = diff.fresh.slice(0, MAX_NEW_PER_CHECK);
              if (
                diff.fresh.length > MAX_NEW_PER_CHECK &&
                !window.confirm(
                  formatStr(d.strings.library.watchCapConfirm, {
                    n: diff.fresh.length,
                    title: next.title,
                  }),
                )
              ) {
                continue;
              }
              for (const e of items) {
                const resolved = resolveEngine({
                  url: e.url,
                  mode: st.routerMode,
                  userRules: st.domainRules,
                });
                await d.queue.getState().enqueue({
                  url: e.url,
                  title: e.title,
                  preset: next.preset ?? st.defaultPreset,
                  outputDir:
                    next.folder !== null && next.folder.length > 0
                      ? next.folder
                      : st.downloadDir,
                  extractor: info.extractor,
                  videoId: e.id,
                  ...(next.engine !== null
                    ? { engineId: next.engine }
                    : resolved.engine === "gallery-dl"
                      ? { engineId: "gallery-dl" as const }
                      : {}),
                });
              }
              d.toast
                .getState()
                .push(
                  formatStr(d.strings.library.watchAutoQueued, {
                    n: items.length,
                    title: next.title,
                  }),
                  "info",
                );
            } else {
              d.toast.getState().push(
                formatStr(d.strings.library.watchNotifyNew, {
                  n: diff.fresh.length,
                  title: next.title,
                }),
                "info",
                {
                  label: d.strings.library.watchTitle,
                  run: () => {
                    depsRef.current.switchView("library");
                  },
                },
              );
            }
          } catch {
            const failed = recordSubResult(sub, false, now);
            const wasEnabled = !sub.autoDisabled && failed.autoDisabled;
            byUrl.set(sub.url, failed);
            changed = true;
            if (wasEnabled) {
              d.toast.getState().push(
                formatStr(d.strings.library.watchAutoDisabled, { title: sub.title }),
                "error",
              );
            }
          }
        }
        if (changed && isAlive()) {
          await d.engine
            .saveWatchlist(channels.map((c) => byUrl.get(c.url) ?? c))
            .catch(() => undefined);
        }
      } finally {
        checking.current = false;
      }
    };
    timerRef.current = setInterval(() => {
      void tick();
    }, 60_000);
    void tick();
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [deps.ready]);
}

import { useState } from "react";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { DownloadJob } from "./types.js";
import { actionsFor, type ErrorAction, type ErrorActionId } from "./errors.js";
import type { Strings } from "./strings.js";
import { useStrings } from "./locale.js";
import { activeCount } from "./queue.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";

export type ErrorNavigate = (view: "settings" | "logs", section?: string) => void;

const COOKIE_BROWSERS = [
  "chrome",
  "edge",
  "firefox",
  "brave",
  "chromium",
  "opera",
  "vivaldi",
  "whale",
] as const;

type CookieBrowser = (typeof COOKIE_BROWSERS)[number];

export interface ErrorActionButtonsProps {
  readonly job: DownloadJob;
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
  readonly navigate: ErrorNavigate;
}

function labelFor(strings: Strings, action: ErrorAction, busy: ErrorActionId | null): string {
  switch (action.id) {
    case "retry":
      return strings.errors.actionRetry;
    case "update-retry":
      return busy === "update-retry" ? strings.logs.updating : strings.errors.actionUpdateRetry;
    case "cookies-once":
      return strings.errors.actionCookiesOnce;
    case "cookies-always":
      return strings.errors.actionCookiesAlways;
    case "repair":
      return busy === "repair" ? strings.errors.engineRepairing : strings.errors.actionRepair;
    case "settings":
      return strings.errors.actionSettings;
    case "logs":
      return strings.errors.actionLogs;
    case "folder":
      return strings.errors.actionFolder;
  }
}

/**
 * Actionable error buttons for failed download cards (M1.4). Every button
 * is a native control (keyboard-reachable); busy actions disable the row.
 */
export function ErrorActionButtons({
  job,
  engine,
  queue,
  settings,
  toast,
  navigate,
}: ErrorActionButtonsProps): React.JSX.Element | null {
  const [busy, setBusy] = useState<ErrorActionId | null>(null);
  const [browser, setBrowser] = useState<CookieBrowser>("chrome");
  const S = useStrings(settings);
  const browserLabels: Readonly<Record<CookieBrowser, string>> = {
    chrome: S.browsers.chrome,
    edge: S.browsers.edge,
    firefox: S.browsers.firefox,
    brave: S.browsers.brave,
    chromium: S.browsers.chromium,
    opera: S.browsers.opera,
    vivaldi: S.browsers.vivaldi,
    whale: S.browsers.whale,
  };
  const actions = actionsFor(job.errorCategory);
  if (actions.length === 0) return null;
  const needsCookies = actions.some(
    (a) => a.id === "cookies-once" || a.id === "cookies-always",
  );

  const runAction = (action: ErrorAction): void => {
    void (async (): Promise<void> => {
      switch (action.id) {
        case "retry": {
          await queue.getState().retry(job.id);
          break;
        }
        case "update-retry": {
          // Never run -U while downloads are active (engine blocks too).
          if (activeCount(queue.getState().jobs) > 0) {
            toast.getState().push(S.errors.updateBlockedBusy, "error");
            break;
          }
          setBusy("update-retry");
          try {
            await engine.updateEngine();
            toast.getState().push(S.errors.engineUpdated, "success");
            await queue.getState().retry(job.id);
          } catch {
            toast.getState().push(S.logs.updateFailed, "error");
          } finally {
            setBusy(null);
          }
          break;
        }
        case "cookies-once": {
          await queue.getState().setJobCookies(job.id, browser);
          await queue.getState().retry(job.id);
          break;
        }
        case "cookies-always": {
          await settings.getState().save({ cookiesFromBrowser: browser });
          await queue.getState().retry(job.id);
          break;
        }
        case "repair": {
          setBusy("repair");
          try {
            const report = await engine.repairEngine();
            toast
              .getState()
              .push(
                report.ok ? S.errors.engineRepaired : S.errors.engineRepairFailed,
                report.ok ? "success" : "error",
              );
          } catch {
            toast.getState().push(S.errors.engineRepairFailed, "error");
          } finally {
            setBusy(null);
          }
          break;
        }
        case "settings": {
          navigate("settings", action.section);
          break;
        }
        case "logs": {
          navigate("logs");
          break;
        }
        case "folder": {
          const dir = await engine.pickFolder().catch(() => null);
          if (dir !== null) {
            await settings.getState().save({ downloadDir: dir });
            toast.getState().push(S.settings.saved, "success");
          }
          break;
        }
      }
    })().catch(() => undefined);
  };

  return (
    <div className="chip-row">
      {needsCookies && (
        <label className="check-row">
          {S.errors.cookiesLabel}
          <select
            className="input"
            value={browser}
            aria-label={S.errors.cookiesLabel}
            onChange={(e) => {
              const v = e.target.value;
              if ((COOKIE_BROWSERS as readonly string[]).includes(v)) {
                setBrowser(v as CookieBrowser);
              }
            }}
          >
            {COOKIE_BROWSERS.map((b) => (
              <option key={b} value={b}>
                {browserLabels[b]}
              </option>
            ))}
          </select>
        </label>
      )}
      {actions.map((a, i) => (
        <button
          key={`${a.id}-${String(i)}`}
          type="button"
          className="btn btn-small"
          disabled={busy !== null}
          onClick={() => {
            runAction(a);
          }}
        >
          {labelFor(S, a, busy)}
        </button>
      ))}
    </div>
  );
}

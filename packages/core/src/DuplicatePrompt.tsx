import { useCallback, useEffect, useRef, useState } from "react";
import type { Strings } from "./strings.js";
import type { DownloadJob } from "./types.js";
import {
  filterDuplicates,
  type DuplicateChoice,
  type DuplicateHit,
  type GuardedTarget,
  type GuardInput,
} from "./identity.js";

export type { DuplicateChoice, DuplicateHit, GuardedTarget, GuardInput };

export interface GuardSnapshots {
  readonly queueJobs: readonly DownloadJob[];
  readonly historyJobs: readonly DownloadJob[];
}

/**
 * Duplicate-guard dialog + hook (M1.3). `guard()` runs targets through
 * filterDuplicates; when a hit needs a decision it renders a modal dialog
 * (role=dialog, focus trapped, Esc = Skip, focus restored on close).
 */
export function useDuplicateGuard(
  strings: Strings,
  locale: string,
): {
  guard: (
    targets: readonly GuardInput[],
    opts: GuardSnapshots & {
      fileExists: (path: string) => Promise<boolean>;
      onOpen: (path: string) => Promise<void>;
    },
  ) => Promise<GuardedTarget[]>;
  dialog: React.JSX.Element | null;
} {
  const [pending, setPending] = useState<{
    hit: DuplicateHit;
    fileStillExists: boolean;
    resolve: (choice: DuplicateChoice) => void;
  } | null>(null);
  const lastFocus = useRef<Element | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (pending === null) return;
    lastFocus.current = document.activeElement;
    const box = boxRef.current;
    const focusables = (): HTMLElement[] =>
      box === null
        ? []
        : Array.from(box.querySelectorAll<HTMLButtonElement>("button")).filter(
            (b) => !b.disabled,
          );
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        pending.resolve("skip");
        setPending(null);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const back = lastFocus.current;
      if (back instanceof HTMLElement) back.focus();
    };
  }, [pending]);

  const guard = useCallback(
    async (
      targets: readonly GuardInput[],
      opts: GuardSnapshots & {
        fileExists: (path: string) => Promise<boolean>;
        onOpen: (path: string) => Promise<void>;
      },
    ): Promise<GuardedTarget[]> => {
      return filterDuplicates(targets, {
        ...opts,
        ask: (hit) => {
          const dest = hit.job.destination;
          const exists =
            dest !== null && dest.length > 0 ? opts.fileExists(dest) : Promise.resolve(false);
          return exists.then((fileStillExists) => {
            return new Promise<DuplicateChoice>((resolve) => {
              setPending({ hit, fileStillExists, resolve });
            });
          });
        },
      });
    },
    [],
  );

  const choose = (choice: DuplicateChoice): void => {
    pending?.resolve(choice);
    setPending(null);
  };

  if (pending === null) return { guard, dialog: null };
  const { hit, fileStillExists } = pending;
  const date = new Date(hit.job.createdAt).toLocaleDateString(locale);
  return {
    guard,
    dialog: (
      <div
        className="grabber-modal"
        role="dialog"
        aria-modal="true"
        aria-label={strings.duplicate.title}
        data-testid="dup-dialog"
      >
        <div className="grabber-card" ref={boxRef}>
          <h2>{strings.duplicate.title}</h2>
          <p className="muted">
            {hit.scope === "queue"
              ? strings.duplicate.queueMessage
              : strings.duplicate.historyMessage}
          </p>
          <p className="muted">
            {strings.duplicate.downloadedOn} {date}
          </p>
          <p className="preview-title">{hit.job.title}</p>
          <div className="chip-row">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="dup-skip"
              onClick={() => {
                choose("skip");
              }}
            >
              {strings.duplicate.skip}
            </button>
            <button
              type="button"
              className="btn"
              data-testid="dup-anyway"
              onClick={() => {
                choose("anyway");
              }}
            >
              {strings.duplicate.downloadAnyway}
            </button>
            {fileStillExists && hit.job.destination !== null && (
              <button
                type="button"
                className="btn"
                data-testid="dup-open"
                onClick={() => {
                  choose("open");
                }}
              >
                {strings.duplicate.openFile}
              </button>
            )}
          </div>
        </div>
      </div>
    ),
  };
}

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import { CHANGELOG_ENTRIES } from "./changelog.js";
import { AppIcon } from "./icons.js";
import { localeTag, resolveLanguage, useStrings } from "./locale.js";
import { pressScale } from "./motion.js";
import type { SettingsStoreState } from "./stores.js";

export interface ChangelogScreenProps {
  readonly settings: StoreApi<SettingsStoreState>;
}

/**
 * Full release history, newest first. Each card shows one summary line;
 * the chevron expands the complete notes for that version. Clicking
 * anywhere outside the expanded card (or pressing Escape) folds it back,
 * so the list never traps the reader in a wall of text.
 */
export function ChangelogScreen({ settings }: ChangelogScreenProps): React.JSX.Element {
  const S = useStrings(settings);
  const language = useStore(settings, (s) => s.settings.language);
  const ms = localeTag(resolveLanguage(language)).toLowerCase().startsWith("ms");
  const [expanded, setExpanded] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (expanded === null) return;
    const onPointer = (e: PointerEvent): void => {
      const root = listRef.current;
      const target = e.target as Element | null;
      if (root === null || target === null) return;
      const card = target.closest("[data-changelog]");
      // Inside the expanded card: only its own chevron toggles.
      if (card !== null && card.getAttribute("data-changelog") === expanded) return;
      setExpanded(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setExpanded(null);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  return (
    <section className="grabber-view" aria-label={S.changelog.title}>
      <h1>{S.changelog.title}</h1>
      <div className="dl-list" ref={listRef}>
        {CHANGELOG_ENTRIES.map((e) => {
          const open = expanded === e.version;
          return (
            <article key={e.version} className="grabber-card" data-changelog={e.version}>
              <div className="change-head">
                <h2 className="dl-title">
                  v{e.version} <span className="muted">· {e.date}</span>
                </h2>
                <button
                  type="button"
                  className={`btn btn-small change-chevron${open ? " is-open" : ""}`}
                  aria-expanded={open}
                  aria-label={open ? S.changelog.showLess : S.changelog.readMore}
                  title={open ? S.changelog.showLess : S.changelog.readMore}
                  onPointerDown={(ev) => {
                    pressScale(ev.currentTarget);
                  }}
                  onClick={() => {
                    setExpanded(open ? null : e.version);
                  }}
                >
                  <AppIcon name="chevron" />
                  <span>{open ? S.changelog.showLess : S.changelog.readMore}</span>
                </button>
              </div>
              <p className="muted">{ms ? e.summaryMs : e.summaryEn}</p>
              {open && (
                <pre className="log-pre change-full" data-testid={`changelog-full-${e.version}`}>
                  {e.full}
                </pre>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

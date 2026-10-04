import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import { CHANGELOG_ENTRIES } from "./changelog.js";
import { localeTag, resolveLanguage, useStrings } from "./locale.js";
import type { SettingsStoreState } from "./stores.js";

export interface ChangelogScreenProps {
  readonly settings: StoreApi<SettingsStoreState>;
}

/** In-app release history, newest first, in the active language. */
export function ChangelogScreen({ settings }: ChangelogScreenProps): React.JSX.Element {
  const S = useStrings(settings);
  const language = useStore(settings, (s) => s.settings.language);
  const ms = localeTag(resolveLanguage(language)).toLowerCase().startsWith("ms");
  return (
    <section className="grabber-view" aria-label={S.changelog.title}>
      <h1>{S.changelog.title}</h1>
      {CHANGELOG_ENTRIES.map((e) => (
        <article key={e.version} className="grabber-card">
          <h2 className="dl-title">
            v{e.version} <span className="muted">· {e.date}</span>
          </h2>
          <ul className="change-list">
            {(ms ? e.ms : e.en).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

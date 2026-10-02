import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import { APP_NAME } from "./branding.js";
import type { DownloadEngine } from "./engine.js";
import type { ThemeName } from "./types.js";
import { fadeSwap, pressScale, staggerIn } from "./motion.js";
import { STRINGS } from "./strings.js";
import { Home } from "./Home.js";
import { Downloads } from "./Downloads.js";
import { Library } from "./Library.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { Logs } from "./Logs.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import "./tokens.css";
import "./fonts.css";

export type ShellView = "home" | "downloads" | "library" | "settings" | "logs";

export interface ShellProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
}

const NAV: ReadonlyArray<{ id: ShellView; label: string }> = [
  { id: "home", label: STRINGS.home.title },
  { id: "downloads", label: STRINGS.downloads.title },
  { id: "library", label: STRINGS.library.title },
  { id: "settings", label: STRINGS.settings.title },
  { id: "logs", label: STRINGS.logs.title },
];

const THEMES: ReadonlyArray<{ id: ThemeName; swatch: string }> = [
  { id: "obsidian", swatch: "#27272a" },
  { id: "midnight", swatch: "#818cf8" },
  { id: "ember", swatch: "#fb923c" },
];

const THEME_LABELS: Readonly<Record<ThemeName, string>> = {
  obsidian: "Obsidian theme",
  midnight: "Midnight theme",
  ember: "Ember theme",
};

export function Shell({ engine, queue, settings }: ShellProps): React.JSX.Element {
  const [view, setView] = useState<ShellView>("home");
  const theme = useStore(settings, (s) => s.settings.theme);
  const navRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void settings
      .getState()
      .load()
      .catch(() => undefined);
    void queue
      .getState()
      .refresh()
      .catch(() => undefined);
  }, [queue, settings]);

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
  }, [theme]);

  useEffect(() => {
    if (navRef.current !== null) staggerIn(navRef.current, "[data-nav]");
  }, []);

  const switchView = (next: ShellView): void => {
    if (next === view) return;
    const apply = (): void => {
      setView(next);
    };
    if (mainRef.current !== null) fadeSwap(mainRef.current, apply);
    else apply();
  };

  const switchTheme = (next: ThemeName): void => {
    settings
      .getState()
      .save({ theme: next })
      .catch(() => undefined);
  };

  return (
    <div className="grabber-app" data-testid="grabber-shell">
      <header className="grabber-titlebar">
        <span className="grabber-mark" aria-hidden="true" />
        <span className="grabber-appname">{APP_NAME}</span>
        <span className="grabber-viewtitle">{NAV.find((n) => n.id === view)?.label ?? ""}</span>
        <span
          className="grabber-theme-dots no-drag"
          role="group"
          aria-label={STRINGS.navThemeGroup}
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="grabber-dot"
              style={{ background: t.swatch }}
              data-active={t.id === theme}
              title={THEME_LABELS[t.id]}
              aria-label={THEME_LABELS[t.id]}
              aria-pressed={t.id === theme}
              onPointerDown={(e) => {
                pressScale(e.currentTarget);
              }}
              onClick={() => {
                switchTheme(t.id);
              }}
            />
          ))}
        </span>
      </header>
      <div className="grabber-body">
        <nav ref={navRef} className="grabber-nav" aria-label="Primary">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              data-nav
              className="grabber-nav-btn"
              aria-current={item.id === view ? "page" : undefined}
              onPointerDown={(e) => {
                pressScale(e.currentTarget);
              }}
              onClick={() => {
                switchView(item.id);
              }}
            >
              <span className="grabber-nav-glyph" aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </nav>
        <main ref={mainRef} className="grabber-main">
          {view === "home" && <Home engine={engine} queue={queue} settings={settings} />}
          {view === "downloads" && <Downloads engine={engine} queue={queue} settings={settings} />}
          {view === "library" && <Library engine={engine} queue={queue} settings={settings} />}
          {view === "settings" && <SettingsScreen engine={engine} settings={settings} />}
          {view === "logs" && <Logs engine={engine} queue={queue} />}
        </main>
      </div>
    </div>
  );
}

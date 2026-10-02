import { useEffect, useRef, useState } from "react";
import { APP_NAME } from "./branding.js";
import type { DownloadEngine } from "./engine.js";
import type { ThemeName } from "./types.js";
import { fadeSwap, pressScale, staggerIn } from "./motion.js";
import "./tokens.css";
import "./fonts.css";

export type ShellView = "home" | "downloads" | "library" | "settings" | "logs";

const NAV: ReadonlyArray<{ id: ShellView; label: string }> = [
  { id: "home", label: "Home" },
  { id: "downloads", label: "Downloads" },
  { id: "library", label: "Library" },
  { id: "settings", label: "Settings" },
  { id: "logs", label: "Logs" },
];

const THEMES: ReadonlyArray<{ id: ThemeName; label: string; swatch: string }> = [
  { id: "obsidian", label: "Obsidian theme", swatch: "#27272a" },
  { id: "midnight", label: "Midnight theme", swatch: "#818cf8" },
  { id: "ember", label: "Ember theme", swatch: "#fb923c" },
];

const VIEW_COPY: Readonly<Record<ShellView, { title: string; body: string }>> = {
  home: { title: "Home", body: "Paste a link to analyze it. Full screen lands in M4." },
  downloads: { title: "Downloads", body: "Live progress cards land in M4." },
  library: { title: "Library", body: "History with search lands in M4." },
  settings: { title: "Settings", body: "Download folder, presets, and engine updates land in M4." },
  logs: { title: "Logs & About", body: "Raw engine console and versions land in M4." },
};

export function Shell({ engine }: { engine: DownloadEngine }): React.JSX.Element {
  const [view, setView] = useState<ShellView>("home");
  const [theme, setTheme] = useState<ThemeName>("obsidian");
  const navRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;
    engine
      .loadSettings()
      .then((s) => {
        if (alive) setTheme(s.theme);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [engine]);

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
    setTheme(next);
    engine.saveSettings({ theme: next }).catch(() => undefined);
  };

  const copy = VIEW_COPY[view];
  return (
    <div className="grabber-app" data-testid="grabber-shell">
      <header className="grabber-titlebar">
        <span className="grabber-mark" aria-hidden="true" />
        <span className="grabber-appname">{APP_NAME}</span>
        <span className="grabber-viewtitle">{copy.title}</span>
        <span className="grabber-theme-dots no-drag" role="group" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="grabber-dot"
              style={{ background: t.swatch }}
              data-active={t.id === theme}
              title={t.label}
              aria-label={t.label}
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
          <section className="grabber-view" aria-live="polite">
            <h1>{copy.title}</h1>
            <p>{copy.body}</p>
            <div className="grabber-card">
              <p>Engine + queue are wired underneath; screens arrive in M4.</p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

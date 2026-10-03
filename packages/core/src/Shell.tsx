import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import { APP_NAME } from "./branding.js";
import type { DownloadEngine } from "./engine.js";
import type { ThemeName } from "./types.js";
import { fadeSwap, pressScale, staggerIn } from "./motion.js";
import { formatStr, localeTag, resolveLanguage, useStrings } from "./locale.js";
import { isValidUrl } from "./url.js";
import { readClipboardText } from "./clipboard.js";
import { comboFromEvent, isCommandPalette, isEditableTarget, isOpenSettings, isPasteAnalyze, isShortcutHelp } from "./shortcuts.js";
import { ShortcutsDialog } from "./ShortcutsDialog.js";
import { CommandPalette } from "./CommandPalette.js";
import type { CommandContext } from "./commands.js";
import { Home } from "./Home.js";
import { Downloads } from "./Downloads.js";
import { Library } from "./Library.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { Logs } from "./Logs.js";
import { Toasts } from "./Toasts.js";
import { Onboarding } from "./Onboarding.js";
import {
  AGGREGATE_SEND_MS,
  aggregateStatus,
  formatSpeedBps,
  shouldSendAggregate,
} from "./aggregate.js";
import { deriveAccentScale } from "./color.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";
import "./tokens.css";
import "./fonts.css";

export type ShellView = "home" | "downloads" | "library" | "settings" | "logs";

export interface ShellProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
}
const THEMES: ReadonlyArray<{ id: ThemeName; swatch: string }> = [
  { id: "obsidian", swatch: "#27272a" },
  { id: "midnight", swatch: "#818cf8" },
  { id: "ember", swatch: "#fb923c" },
];

export function Shell({ engine, queue, settings, toast }: ShellProps): React.JSX.Element {
  const [view, setView] = useState<ShellView>("home");
  const [pendingPaste, setPendingPaste] = useState<string | null>(null);
  const [pendingSection, setPendingSection] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
  const [aggregateText, setAggregateText] = useState<string>("");
  const [replayOnboarding, setReplayOnboarding] = useState<boolean>(false);
  const settingsReady = useStore(settings, (s) => s.ready);
  const onboardingDone = useStore(settings, (s) => s.settings.onboardingDone);
  const lastAggSent = useRef<number | null>(null);
  const aggTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobs = useStore(queue, (s) => s.jobs);
  const theme = useStore(settings, (s) => s.settings.theme);
  const density = useStore(settings, (s) => s.settings.density);
  const accentOverride = useStore(settings, (s) => s.settings.accentOverride);
  const S = useStrings(settings);
  const locale = localeTag(resolveLanguage(useStore(settings, (s) => s.settings.language)));
  const nav: ReadonlyArray<{ id: ShellView; label: string }> = useMemo(
    () => [
      { id: "home", label: S.home.title },
      { id: "downloads", label: S.downloads.title },
      { id: "library", label: S.library.title },
      { id: "settings", label: S.settings.title },
      { id: "logs", label: S.logs.title },
    ],
    [S],
  );
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
    document.documentElement.dataset["density"] = density;
  }, [density]);

  // User accent override (M2.6): re-checked pairs, applied as CSS vars.
  useEffect(() => {
    const root = document.documentElement;
    const vars = ["--accent", "--accent-fg", "--accent-soft", "--accent-hover", "--accent-active"];
    if (accentOverride === null) {
      for (const v of vars) root.style.removeProperty(v);
      return;
    }
    const scale = deriveAccentScale(accentOverride);
    if (scale === null) {
      for (const v of vars) root.style.removeProperty(v);
      return;
    }
    root.style.setProperty("--accent", scale.base);
    root.style.setProperty("--accent-fg", scale.onAccent);
    root.style.setProperty("--accent-soft", scale.ghost);
    root.style.setProperty("--accent-hover", scale.hover);
    root.style.setProperty("--accent-active", scale.active);
  }, [accentOverride]);

  useEffect(() => {
    if (navRef.current !== null) staggerIn(navRef.current, "[data-nav]");
  }, []);

  const switchView = useCallback(
    (next: ShellView): void => {
      if (next === view) return;
      const apply = (): void => {
        setView(next);
      };
      if (mainRef.current !== null) fadeSwap(mainRef.current, apply);
      else apply();
    },
    [view],
  );

  // Move keyboard focus into the new view (SPA nav pattern).
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [view]);

  // Aggregate status: sidebar footer + throttled taskbar/tray updates.
  useEffect(() => {
    const agg = aggregateStatus(jobs);
    const speed = agg.speedBps > 0 ? ` · ${formatSpeedBps(agg.speedBps, locale)}` : "";
    const text =
      agg.active > 0 ? `${formatStr(S.status.activeCount, { count: agg.active })}${speed}` : S.status.ready;
    setAggregateText(text);
    const send = (): void => {
      lastAggSent.current = Date.now();
      engine
        .setAggregateProgress({ active: agg.active, percent: agg.percent, tooltip: text })
        .catch(() => undefined);
    };
    if (shouldSendAggregate(lastAggSent.current, Date.now())) {
      send();
    } else {
      if (aggTimer.current !== null) clearTimeout(aggTimer.current);
      aggTimer.current = setTimeout(send, AGGREGATE_SEND_MS);
    }
    return () => {
      if (aggTimer.current !== null) clearTimeout(aggTimer.current);
    };
  }, [jobs, engine, S, locale]);

  // Error-action deep links (settings section anchors).
  useEffect(() => {
    if (view !== "settings" || pendingSection === null) return;
    document
      .getElementById(`settings-section-${pendingSection}`)
      ?.scrollIntoView({ block: "nearest" });
    setPendingSection(null);
  }, [view, pendingSection]);

  const navigate = useCallback((next: ShellView, section?: string): void => {
    if (section !== undefined) setPendingSection(section);
    switchView(next);
  }, [switchView]);

  const pasteAndAnalyze = useCallback(
    (url: string): void => {
      setPendingPaste(url);
      switchView("home");
    },
    [switchView],
  );

  const paletteContext: CommandContext = useMemo(
    () => ({
      engine,
      queue,
      settings,
      toast,
      jobs,
      navigate,
      pasteAndAnalyze,
      showShortcuts: () => {
        setShortcutsOpen(true);
      },
    }),
    [engine, queue, settings, toast, jobs, navigate, pasteAndAnalyze],
  );

  // Global shortcuts: Ctrl+, opens Settings; Ctrl+V pastes + analyzes
  // when focus is outside editable fields; Ctrl+K opens the palette
  // everywhere except inside editable fields; ? opens shortcut help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const combo = comboFromEvent(e);
      if (isShortcutHelp(combo)) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (isCommandPalette(combo)) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (isOpenSettings(combo)) {
        e.preventDefault();
        switchView("settings");
        return;
      }
      if (isPasteAnalyze(combo)) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        void readClipboardText().then((text) => {
          const first = (text ?? "")
            .split(/\r?\n/)
            .map((s) => s.trim())
            .find((s) => s.length > 0);
          if (first !== undefined && isValidUrl(first)) {
            setPendingPaste(first);
            switchView("home");
          }
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [switchView]);

  const consumePaste = useCallback((): void => {
    setPendingPaste(null);
  }, []);

  const focusMain = (): void => {
    mainRef.current?.focus({ preventScroll: false });
  };

  const switchTheme = (next: ThemeName): void => {
    settings
      .getState()
      .save({ theme: next })
      .catch(() => undefined);
  };

  return (
    <div className="grabber-app" data-testid="grabber-shell">
      <a
        className="skip-link"
        href="#grabber-main"
        onClick={(e) => {
          e.preventDefault();
          focusMain();
        }}
      >
        {S.skipToContent}
      </a>
      <header className="grabber-titlebar">
        <span className="grabber-mark" aria-hidden="true" />
        <span className="grabber-appname">{APP_NAME}</span>
        <span className="grabber-viewtitle">{nav.find((n) => n.id === view)?.label ?? ""}</span>
        <span
          className="grabber-theme-dots no-drag"
          role="group"
          aria-label={S.navThemeGroup}
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="grabber-dot"
              style={{ background: t.swatch }}
              data-active={t.id === theme}
              title={S.settings.themes[t.id]}
              aria-label={S.settings.themes[t.id]}
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
          {nav.map((item) => (
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
          <div className="grabber-nav-foot" data-testid="aggregate" role="status">
            {aggregateText}
          </div>
        </nav>
        <main ref={mainRef} id="grabber-main" className="grabber-main" tabIndex={-1}>
          {view === "home" && (
            <Home
              engine={engine}
              queue={queue}
              settings={settings}
              pendingPaste={pendingPaste}
              onPasteConsumed={consumePaste}
            />
          )}
          {view === "downloads" && (
            <Downloads
              engine={engine}
              queue={queue}
              settings={settings}
              toast={toast}
              navigate={navigate}
            />
          )}
          {view === "library" && (
            <Library engine={engine} queue={queue} settings={settings} toast={toast} />
          )}
          {view === "settings" && (
            <SettingsScreen
              engine={engine}
              settings={settings}
              onReplay={() => {
                setReplayOnboarding(true);
              }}
            />
          )}
          {view === "logs" && <Logs engine={engine} queue={queue} settings={settings} />}
        </main>
      </div>
      <Toasts toast={toast} strings={S} />
      <CommandPalette
        open={paletteOpen}
        context={paletteContext}
        onClose={() => {
          setPaletteOpen(false);
        }}
      />
      {shortcutsOpen && (
        <ShortcutsDialog
          strings={S}
          onClose={() => {
            setShortcutsOpen(false);
          }}
        />
      )}
      {((settingsReady && !onboardingDone) || replayOnboarding) && (
        <Onboarding
          engine={engine}
          settings={settings}
          onDone={() => {
            setReplayOnboarding(false);
          }}
        />
      )}
    </div>
  );
}

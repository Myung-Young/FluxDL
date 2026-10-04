import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import { APP_NAME } from "./branding.js";
import type { DownloadEngine } from "./engine.js";
import type { ThemeName } from "./types.js";
import { THEMES } from "./themes.js";
import { fadeSwap, pressScale, staggerIn } from "./motion.js";
import { formatStr, localeTag, resolveLanguage, useStrings } from "./locale.js";
import { parseBatchText } from "./batch.js";
import { readClipboardText } from "./clipboard.js";
import { NAV_VIEWS, comboFromEvent, isCommandPalette, isEditableTarget, isMiniMode, isOpenSettings, isPasteAnalyze, isShortcutHelp, navIndexFor } from "./shortcuts.js";
import { ShortcutsDialog } from "./ShortcutsDialog.js";
import { CommandPalette } from "./CommandPalette.js";
import type { CommandContext } from "./commands.js";
import { AppIcon } from "./icons.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { diffWatch } from "./watchlist.js";
// Views load on demand (F4): the boot bundle stays lean, each screen is its
// own chunk. Static imports would defeat the split, hence the wrappers.
const Home = lazy(() => import("./Home.js").then((m) => ({ default: m.Home })));
const Downloads = lazy(() => import("./Downloads.js").then((m) => ({ default: m.Downloads })));
const Library = lazy(() => import("./Library.js").then((m) => ({ default: m.Library })));
const Stats = lazy(() => import("./StatsScreen.js").then((m) => ({ default: m.Stats })));
const SettingsScreen = lazy(() =>
  import("./SettingsScreen.js").then((m) => ({ default: m.SettingsScreen })),
);
const Logs = lazy(() => import("./Logs.js").then((m) => ({ default: m.Logs })));
const ChangelogScreen = lazy(() =>
  import("./ChangelogScreen.js").then((m) => ({ default: m.ChangelogScreen })),
);
import { Toasts } from "./Toasts.js";
import { Onboarding } from "./Onboarding.js";
import { MiniView } from "./MiniView.js";
import {
  AGGREGATE_SEND_MS,
  aggregateStatus,
  formatEta,
  formatSpeedBps,
  formatWindowTitle,
  queueEta,
  shouldSendAggregate,
} from "./aggregate.js";
import { deriveAccentScale } from "./color.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";
import "./tokens.css";
import "./fonts.css";

export type ShellView = "home" | "downloads" | "library" | "stats" | "settings" | "logs" | "changelog";

/**
 * Live bandwidth sparkline: hand-rolled SVG polyline over the last 30
 * aggregate samples (no chart library). Static geometry per render, so
 * there is nothing to animate and `prefers-reduced-motion` needs no carve-out.
 */
function Sparkline({
  samples,
  label,
}: {
  samples: readonly number[];
  label: string;
}): React.JSX.Element | null {
  if (samples.length < 2 || samples.every((v) => v <= 0)) return null;
  const w = 180;
  const h = 28;
  const max = Math.max(1, ...samples);
  const pts = samples
    .map((v, i) => {
      const x = (i / Math.max(1, samples.length - 1)) * w;
      const y = h - (v / max) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className="sparkline"
      width={w}
      height={h}
      viewBox={`0 0 ${String(w)} ${String(h)}`}
      role="img"
      aria-label={label}
      focusable="false"
    >
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export interface ShellProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
}

export function Shell({ engine, queue, settings, toast }: ShellProps): React.JSX.Element {
  const [view, setView] = useState<ShellView>("home");
  const [pendingPaste, setPendingPaste] = useState<string | null>(null);
  const [pendingBatch, setPendingBatch] = useState<string | null>(null);
  const [etaText, setEtaText] = useState<string>("");
  const [speedSamples, setSpeedSamples] = useState<readonly number[]>([]);
  const [updateNoted, setUpdateNoted] = useState<boolean>(false);
  const [online, setOnline] = useState<boolean>(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const wasOnline = useRef<boolean>(true);
  const [pendingSection, setPendingSection] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
  const [aggregateText, setAggregateText] = useState<string>("");
  const [replayOnboarding, setReplayOnboarding] = useState<boolean>(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(false);
  const [mini, setMini] = useState<boolean>(false);
  const settingsReady = useStore(settings, (s) => s.ready);
  const onboardingDone = useStore(settings, (s) => s.settings.onboardingDone);
  const lastAggSent = useRef<number | null>(null);
  const aggTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jobs = useStore(queue, (s) => s.jobs);
  const theme = useStore(settings, (s) => s.settings.theme);
  const followSystem = useStore(settings, (s) => s.settings.followSystemTheme);
  const [systemLight, setSystemLight] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const flip = (): void => {
      setSystemLight(mq.matches);
    };
    mq.addEventListener("change", flip);
    return () => {
      mq.removeEventListener("change", flip);
    };
  }, []);

  // Effective theme (E3): the saved theme is the dark side; Paper is the
  // light side when following the OS. Dots + onboarding keep the saved one.
  let effectiveTheme: ThemeName = theme;
  if (followSystem && systemLight) effectiveTheme = "paper";
  else if (followSystem && theme === "paper") effectiveTheme = "obsidian";
  const density = useStore(settings, (s) => s.settings.density);
  const accentOverride = useStore(settings, (s) => s.settings.accentOverride);
  const S = useStrings(settings);
  const locale = localeTag(resolveLanguage(useStore(settings, (s) => s.settings.language)));
  const nav: ReadonlyArray<{ id: ShellView; label: string }> = useMemo(
    () => [
      { id: "home", label: S.home.title },
      { id: "downloads", label: S.downloads.title },
      { id: "library", label: S.library.title },
      { id: "stats", label: S.stats.title },
      { id: "settings", label: S.settings.title },
      { id: "logs", label: S.logs.title },
      { id: "changelog", label: S.changelog.title },
    ],
    [S],
  );
  const navRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  const resumedOnce = useRef<boolean>(false);
  useEffect(() => {
    void settings
      .getState()
      .load()
      .catch(() => undefined);
    void queue
      .getState()
      .refresh()
      .then(() => {
        // Resume-session banner (A3): paused jobs survived the restart while
        // everything else re-queues itself, so offer one-click resume once.
        if (resumedOnce.current) return;
        resumedOnce.current = true;
        const paused = queue.getState().jobs.filter((j) => j.status === "paused");
        if (paused.length === 0) return;
        toast.getState().push(
          formatStr(S.status.pausedResume, { count: paused.length }),
          "info",
          {
            label: S.downloads.resumeAll,
            run: () => {
              queue.getState().resumeAll().catch(() => undefined);
            },
          },
        );
      })
      .catch(() => undefined);
  }, [queue, settings, toast, S]);

  useEffect(() => {
    document.documentElement.dataset["theme"] = effectiveTheme;
  }, [effectiveTheme]);

  useEffect(() => {
    document.documentElement.dataset["density"] = density;
  }, [density]);

  // Mini mode (M4.4): same window, compact layout flag, and the main process
  // owns the geometry/always-on-top. Tray toggles are pushed back to us.
  useEffect(() => {
    const root = document.documentElement;
    if (mini) root.dataset["mini"] = "true";
    else delete root.dataset["mini"];
  }, [mini]);

  useEffect(() => {
    void engine
      .applyWindowChrome({ mini, theme: effectiveTheme })
      .catch(() => undefined);
  }, [engine, mini, effectiveTheme]);

  useEffect(() => {
    const unsub = engine.onWindowChrome((state) => {
      setMini(state.mini);
    });
    return () => {
      unsub();
    };
  }, [engine]);

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

  // View history (B6): Alt+Left/Right walks it, scroll is remembered per view.
  const viewHist = useRef<ShellView[]>(["home"]);
  const viewIdx = useRef<number>(0);
  const scrollPos = useRef<Partial<Record<ShellView, number>>>({});

  const goView = useCallback(
    (next: ShellView, push: boolean): void => {
      if (next === view) return;
      if (mainRef.current !== null) {
        scrollPos.current[view] = mainRef.current.scrollTop;
      }
      if (push) {
        viewHist.current = [...viewHist.current.slice(0, viewIdx.current + 1), next];
        viewIdx.current = viewHist.current.length - 1;
        // Remember the view across restarts (D2, fire-and-forget).
        void settings
          .getState()
          .save({ lastView: next })
          .catch(() => undefined);
      }
      const apply = (): void => {
        setView(next);
      };
      if (mainRef.current !== null) fadeSwap(mainRef.current, apply);
      else apply();
    },
    [view, settings],
  );

  const switchView = useCallback(
    (next: ShellView): void => {
      goView(next, true);
    },
    [goView],
  );

  const stepHistory = useCallback(
    (delta: -1 | 1): void => {
      const next = viewIdx.current + delta;
      const target = viewHist.current[next];
      if (target === undefined) return;
      viewIdx.current = next;
      goView(target, false);
    },
    [goView],
  );

  // Restore the remembered scroll after each view lands.
  useEffect(() => {
    const el = mainRef.current;
    if (el !== null) el.scrollTop = scrollPos.current[view] ?? 0;
  }, [view]);

  // Move keyboard focus into the new view (SPA nav pattern).
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [view]);

  // Aggregate status: sidebar footer + throttled taskbar/tray updates.
  // The footer also carries a live bandwidth sparkline (30 samples) and the
  // whole-queue ETA; both ride the tray tooltip too.
  useEffect(() => {
    const agg = aggregateStatus(jobs);    const speed = agg.speedBps > 0 ? ` · ${formatSpeedBps(agg.speedBps, locale)}` : "";
    const text =
      agg.active > 0 ? `${formatStr(S.status.activeCount, { count: agg.active })}${speed}` : S.status.ready;
    setAggregateText(text);
    const eta = queueEta(jobs, agg.speedBps);
    const etaSuffix = eta !== null ? ` · ETA ${formatEta(eta.etaSeconds)}` : "";
    setEtaText(eta !== null ? `ETA ${formatEta(eta.etaSeconds)}` : "");
    setSpeedSamples((prev) => [...prev.slice(-29), agg.speedBps]);
    const tooltip = `${text}${etaSuffix}`;
    const send = (): void => {
      lastAggSent.current = Date.now();
      engine
        .setAggregateProgress({ active: agg.active, percent: agg.percent, tooltip })
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

  // Connection state (C3): one quiet toast per offline episode; the 1 s
  // pump already resumes everything when the network returns.
  useEffect(() => {
    const flip = (): void => {
      const up = navigator.onLine;
      setOnline(up);
      if (!up && wasOnline.current) {
        toast.getState().push(S.status.offline, "info");
      }
      wasOnline.current = up;
    };
    window.addEventListener("online", flip);
    window.addEventListener("offline", flip);
    return () => {
      window.removeEventListener("online", flip);
      window.removeEventListener("offline", flip);
    };
  }, [toast, S]);

  // Experimental: check watched channels on launch (F6). Baselines are
  // always saved; the toast only fires when something is actually new.
  const [watchChecked, setWatchChecked] = useState<boolean>(false);
  useEffect(() => {
    if (!settingsReady || watchChecked) return;
    if (!settings.getState().settings.experimental) return;
    setWatchChecked(true);
    void (async (): Promise<void> => {
      try {
        const channels = await engine.loadWatchlist();
        if (channels.length === 0) return;
        let freshTotal = 0;
        const updated = [...channels];
        for (let i = 0; i < channels.length; i += 1) {
          const c = channels[i];
          if (c === undefined) continue;
          try {
            const info = await engine.getInfo(c.url);
            const d = diffWatch(info, c.lastVideoId);
            updated[i] = {
              ...c,
              title: info.title,
              lastVideoId: d.baseline,
              lastCheckedAt: Date.now(),
            };
            freshTotal += d.fresh.length;
          } catch {
            // One bad channel never blocks the rest.
          }
        }
        await engine.saveWatchlist(updated).catch(() => undefined);
        if (freshTotal > 0) {
          toast.getState().push(formatStr(S.library.watchNew, { n: freshTotal }), "info", {
            label: S.library.watchTitle,
            run: () => {
              switchView("library");
            },
          });
        }
      } catch {
        // Silent: watchlist must never break launch.
      }
    })();
  }, [settingsReady, watchChecked, engine, settings, toast, switchView, S]);

  // Restore the last view once settings arrive (D2).
  const viewRestored = useRef<boolean>(false);
  useEffect(() => {
    if (!settingsReady || viewRestored.current) return;
    viewRestored.current = true;
    const v = settings.getState().settings.lastView;
    if ((NAV_VIEWS as readonly string[]).includes(v) && v !== view) {
      switchView(v as ShellView);
    }
  }, [settingsReady, settings, switchView, view]);

  // Window title carries the active count (M3.8): `(N) FluxDL` or `FluxDL`.
  useEffect(() => {
    document.title = formatWindowTitle(aggregateStatus(jobs).active, APP_NAME);
  }, [jobs]);

  // Launch update reminder: one best-effort check (hourly-cached main-side),
  // then a toast when the app or yt-dlp has something newer. Honors the
  // autoCheckUpdate setting; failures stay silent (offline is normal).
  useEffect(() => {
    if (!settingsReady || updateNoted) return;
    setUpdateNoted(true);
    if (!settings.getState().settings.autoCheckUpdate) return;
    void engine
      .checkForUpdates()
      .then((st) => {
        if (st.appUpdate) {
          toast.getState().push(
            formatStr(S.logs.appUpdateReady, {
              v: st.appLatest ?? "?",
              cur: st.appCurrent,
            }),
            "info",
            {
              label: S.logs.getUpdate,
              run: () => {
                engine.openExternal(st.appUrl).catch(() => undefined);
              },
            },
          );
        } else if (st.ytdlpUpdate) {
          toast.getState().push(
            formatStr(S.logs.ytdlpUpdateReady, { v: st.ytdlpLatest ?? "?" }),
            "info",
            {
              label: S.logs.title,
              run: () => {
                switchView("logs");
              },
            },
          );
        }
      })
      .catch(() => undefined);
  }, [engine, settings, settingsReady, updateNoted, toast, switchView, S]);

  // Keep the queue moving (M4.1): hydrated boot jobs and backoff retries
  // only start when something pumps. The 1 s tick is cheap and the
  // controller drops overlapping ticks via its reentrancy guard.
  useEffect(() => {
    const timer = setInterval(() => {
      void queue
        .getState()
        .pump()
        .catch(() => undefined);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [queue]);

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

  // Deep links (fluxdl:// URL, CLI arg, second-instance forward): land on
  // Home and analyze like a paste. Batch files (.fluxdl) seed the Batch
  // panel instead. Registered once; the engine owns delivery.
  useEffect(() => {
    const unsub = engine.onDeepLink((url) => {
      setPendingPaste(url);
      setView("home");
    });
    const unsubBatch = engine.onBatchLink((text) => {
      setPendingBatch(text);
      setView("home");
    });
    return () => {
      unsub();
      unsubBatch();
    };
  }, [engine]);

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
      toggleMiniMode: () => {
        setMini((v) => !v);
      },
    }),
    [engine, queue, settings, toast, jobs, navigate, pasteAndAnalyze],
  );

  // Global shortcuts: Ctrl+, opens Settings; Ctrl+V pastes + analyzes
  // when focus is outside editable fields; Ctrl+K opens the palette
  // everywhere except inside editable fields; ? opens shortcut help;
  // Alt+Left/Right walks the view history.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          if (isEditableTarget(e.target)) return;
          e.preventDefault();
          stepHistory(e.key === "ArrowLeft" ? -1 : 1);
          return;
        }
      }
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
      if (isMiniMode(combo)) {
        // Window-level toggle: must work while typing in a field.
        e.preventDefault();
        setMini((v) => !v);
        return;
      }
      const navIndex = navIndexFor(combo);
      if (navIndex !== null) {
        // Digits are typed in fields — only navigate outside them.
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        const target = NAV_VIEWS[navIndex];
        if (target !== undefined) switchView(target);
        return;
      }
      if (isPasteAnalyze(combo)) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        void readClipboardText().then((text) => {
          const valid = parseBatchText(text ?? "").valid;
          if (valid.length >= 2) {
            setPendingBatch(text);
            switchView("home");
          } else if (valid.length === 1 && valid[0] !== undefined) {
            setPendingPaste(valid[0].url);
            switchView("home");
          }
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [switchView, stepHistory]);

  const consumePaste = useCallback((): void => {
    setPendingPaste(null);
  }, []);

  const consumeBatch = useCallback((): void => {
    setPendingBatch(null);
  }, []);

  // Window-level drop: multi-URL drops from the browser land in Batch.
  // File drops (.txt) belong to BatchPanel; single-URL drops keep the
  // card-level behavior in Home.
  const onWindowDrop = (e: React.DragEvent): void => {
    if (e.dataTransfer.files.length > 0) return;
    const text =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain") ||
      e.dataTransfer.getData("text");
    if (text.trim().length === 0) return;
    if (parseBatchText(text).valid.length >= 2) {
      e.preventDefault();
      setPendingBatch(text);
      setView("home");
    }
  };

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
    <div
      className="grabber-app"
      data-testid="grabber-shell"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={onWindowDrop}
    >
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
        <span className="grabber-mark" aria-hidden="true">
          <AppIcon name="logo" />
        </span>
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
        <nav ref={navRef} className="grabber-nav" aria-label="Primary" hidden={mini}>
          {nav.map((item, i) => (
            <button
              key={item.id}
              type="button"
              data-nav
              className="grabber-nav-btn"
              title={`Ctrl+${String(i + 1)}`}
              aria-keyshortcuts={`Control+${String(i + 1)}`}
              aria-current={item.id === view ? "page" : undefined}
              onPointerDown={(e) => {
                pressScale(e.currentTarget);
              }}
              onClick={() => {
                switchView(item.id);
              }}
            >
              <span className="grabber-nav-glyph" aria-hidden="true">
                <AppIcon name={item.id} />
              </span>
              <span className="grabber-nav-label">{item.label}</span>
              {item.id === "downloads" && jobs.length > 0 && (
                <span className="grabber-nav-badge" data-testid="downloads-nav-badge">
                  {jobs.length}
                </span>
              )}
            </button>
          ))}
          <div className="grabber-nav-foot" data-testid="aggregate" role="status">
            {aggregateText}
            {!online && <div className="muted">{S.status.offline}</div>}
            {etaText.length > 0 && <div className="muted">{etaText}</div>}
            <Sparkline samples={speedSamples} label={aggregateText} />
          </div>
        </nav>
        <main ref={mainRef} id="grabber-main" className="grabber-main" tabIndex={-1}>
          <ErrorBoundary
            title={S.errors.viewCrashed}
            message={S.errors.viewCrashedHint}
            resetLabel={S.errors.reloadView}
            resetKey={view}
          >
          <Suspense
            fallback={
              <div className="grabber-card" aria-busy="true">
                <p className="muted">{S.settings.loading}</p>
              </div>
            }
          >
          {mini && (
            <MiniView
              jobs={jobs}
              queue={queue}
              strings={S}
              aggregateText={aggregateText}
              onExit={() => {
                setMini(false);
              }}
            />
          )}
          {!mini && view === "home" && (
            <Home
              engine={engine}
              queue={queue}
              settings={settings}
              pendingPaste={pendingPaste}
              onPasteConsumed={consumePaste}
              pendingBatch={pendingBatch}
              onBatchConsumed={consumeBatch}
            />
          )}
          {!mini && view === "downloads" && (
            <Downloads
              engine={engine}
              queue={queue}
              settings={settings}
              toast={toast}
              navigate={navigate}
            />
          )}
          {!mini && view === "library" && (
            <Library engine={engine} queue={queue} settings={settings} toast={toast} />
          )}
          {!mini && view === "stats" && (
            <Stats engine={engine} settings={settings} />
          )}
          {!mini && view === "settings" && (
            <SettingsScreen
              engine={engine}
              settings={settings}
              queue={queue}
              onReplay={() => {
                setReplayOnboarding(true);
                setOnboardingDismissed(false);
              }}
            />
          )}
          {!mini && view === "logs" && (
            <Logs engine={engine} queue={queue} settings={settings} toast={toast} />
          )}
          {!mini && view === "changelog" && <ChangelogScreen settings={settings} />}
          </Suspense>
          </ErrorBoundary>
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
      {((settingsReady && !onboardingDone && !onboardingDismissed) || replayOnboarding) && (
        <Onboarding
          engine={engine}
          settings={settings}
          onDone={() => {
            setReplayOnboarding(false);
            setOnboardingDismissed(true);
          }}
        />
      )}
    </div>
  );
}

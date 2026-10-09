import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { AppSettings, Container, Density } from "./types.js";
import { CONTAINERS } from "./types.js";
import { THEME_NAMES } from "./themes.js";
import { deriveAccentScale } from "./color.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import type { ToastStoreState } from "./toast.js";
import { formatStr, useStrings } from "./locale.js";
import { filterSettingIds, type FilterableField } from "./settingsFilter.js";
import { previewFilename, validateFilenameTemplate, validateSpeedLimit, validateWindowTime } from "./validate.js";
import { exportBackup, parseBackup } from "./backup.js";
import { PackStore } from "./PackStore.js";
import { RemoteSection } from "./RemoteSection.js";
import { ToolsSection } from "./ToolsSection.js";
import { validateGalleryConfigJson } from "./galleryConfig.js";

const ACCENT_SWATCHES: readonly string[] = [
  "#818cf8",
  "#fb923c",
  "#e4e4e7",
  "#34d399",
  "#38bdf8",
  "#f472b6",
  "#facc15",
  "#a78bfa",
];

export interface SettingsScreenProps {
  readonly engine: DownloadEngine;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly queue: StoreApi<QueueStoreState>;
  readonly toast: StoreApi<ToastStoreState>;
  readonly onReplay: () => void;
}

const FILENAME_PRESETS: readonly string[] = [
  "%(title)s [%(id)s].%(ext)s",
  "%(title)s.%(ext)s",
  "%(upload_date)s - %(title)s [%(id)s].%(ext)s",
  // Phase 3: by-uploader (sorts a flat folder by channel) and
  // Plex/Jellyfin-friendly (one folder per uploader). Standard fields only.
  "%(uploader)s - %(title)s [%(id)s].%(ext)s",
  "%(uploader)s/%(title)s [%(id)s].%(ext)s",
];

/**
 * Container choices offered for video downloads (v1.7.2).
 *
 * Verified against the bundled yt-dlp 2026.08.19: `--merge-output-format`
 * accepts avi/flv/mkv/mov/mp4/webm, while `--remux-video` additionally accepts
 * gif. The picker offers the union (so any container yt-dlp can produce is
 * reachable) and the args builder only ever hands `--merge-output-format` a
 * mergeable value. Commonly quoted values this binary rejects (ogv, mpg, ts,
 * vob, 3gp, m2ts, wmv, f4v) are deliberately absent.
 */
const CONTAINER_CHOICES: readonly Container[] = [...CONTAINERS];

export function SettingsScreen({ engine, settings, queue, toast, onReplay }: SettingsScreenProps): React.JSX.Element {
  const S = useStrings(settings);
  const saved = useStore(settings, (s) => s.settings);
  const ready = useStore(settings, (s) => s.ready);
  const [flash, setFlash] = useState<boolean>(false);
  const [archiveNote, setArchiveNote] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>("");
  const [templateDraft, setTemplateDraft] = useState<string | null>(null);
  const [speedDraft, setSpeedDraft] = useState<string | null>(null);
  // Raw gallery-dl config draft (v1.8.5): null = show the saved value.
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const [customNote, setCustomNote] = useState<string | null>(null);
  const [windowDraft, setWindowDraft] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  });
  const templateRef = useRef<HTMLInputElement | null>(null);

  // Filename token builder (D6): click a placeholder to splice it at the
  // cursor instead of typing yt-dlp syntax by hand. Commits on blur as usual.
  const insertToken = (token: string): void => {
    const el = templateRef.current;
    const base = templateDraft ?? saved.filenameTemplate;
    if (el === null || el.selectionStart === null) {
      setTemplateDraft(`${base}${token}`);
      return;
    }
    const at = el.selectionStart;
    const end = el.selectionEnd ?? at;
    const next = `${base.slice(0, at)}${token}${base.slice(end)}`;
    el.value = next;
    setTemplateDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at + token.length, at + token.length);
    });
  };
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSaved = (): void => {
    setFlash(true);
    setSaveError(null);
    setArchiveNote(false);
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      setFlash(false);
      setArchiveNote(false);
    }, 2000);
  };

  /**
   * A failed save used to be swallowed here, which is how "settings do
   * nothing" went unnoticed for five releases: the control looked clickable,
   * nothing persisted, and no error appeared (D94). Surface it instead.
   */
  const flashSaveError = (err: unknown): void => {
    setFlash(false);
    setArchiveNote(false);
    setSaveError(err instanceof Error && err.message.length > 0 ? err.message : S.settings.saveFailed);
  };

  const flashArchive = (): void => {
    setFlash(false);
    setArchiveNote(true);
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      setFlash(false);
      setArchiveNote(false);
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    };
  }, []);

  const fields: readonly FilterableField[] = useMemo(
    () => [
      { id: "set-dir", label: S.settings.downloadDir, keywords: ["download", "folder", "directory"] },
      { id: "set-template", label: S.settings.filenameTemplate, keywords: ["filename", "template"] },
      { id: "set-concurrency", label: S.settings.concurrency, keywords: ["concurrency", "simultaneous"] },
      {
        id: "set-packs",
        label: S.settings.packsTitle,
        keywords: ["pack", "tool", "streamlink", "whisper", "rclone", "install"],
      },
      {
        id: "set-tools",
        label: [
          S.settings.toolsTitle,
          S.settings.toolsChannel,
          S.settings.toolsRunDoctor,
          S.settings.toolsUpdateAll,
        ].join(" "),
        keywords: ["tools", "engines", "doctor", "health", "update", "reinstall", "rollback", "yt-dlp", "ffmpeg", "deno", "aria2c", "channel"],
      },
      {
        id: "set-images",
        label: [
          S.settings.sectionImages,
          S.settings.imagesDownloadDir,
          S.settings.imagesFolderTemplate,
          S.settings.imagesFilenameTemplate,
          S.settings.imagesArchive,
          S.settings.imagesSidecar,
          S.settings.imagesCustom,
        ].join(" "),
        keywords: ["images", "gallery", "gallery-dl", "folder", "template", "archive", "proxy", "config", "sleep", "retries"],
      },
      {
        id: "set-remote",
        label: [S.settings.remoteTitle, S.settings.remoteEnable].join(" "),
        keywords: ["remote", "api", "loopback", "token", "port", "pairing", "extension", "pwa", "phone"],
      },
      {
        id: "set-postprocess",
        label: S.settings.postTitle,
        keywords: ["post", "convert", "compress", "tag", "exif", "zip", "cbz", "ugoira"],
      },
      { id: "set-timeout", label: S.settings.analyzeTimeout, keywords: ["analyze", "timeout"] },
      { id: "set-history", label: S.settings.historyLimit, keywords: ["history", "keep"] },
      { id: "set-speed", label: S.settings.speedLimit, keywords: ["speed", "limit", "rate"] },
      { id: "set-proxy", label: S.settings.proxy, keywords: ["proxy", "network"] },
      { id: "set-cookies", label: S.settings.cookies, keywords: ["cookies", "browser"] },
      {
        id: "set-network2",
        label: [
          S.settings.downloadRetries,
          S.settings.concurrentFragments,
          S.settings.socketTimeoutSec,
          S.settings.useAria2c,
        ].join(" "),
        keywords: ["network", "retries", "fragments", "timeout", "aria2c", "downloader"],
      },
      { id: "set-cookies-file", label: S.settings.cookiesFile, keywords: ["cookies", "file"] },
      {
        id: "set-pacing",
        label: [S.settings.pacingTitle, S.settings.pacingRequests, S.settings.pacingHint].join(" "),
        keywords: ["pacing", "sleep", "rate", "limit", "polite", "429"],
      },
      {
        id: "togglesQuality",
        label: [
          S.settings.embedThumbnail,
          S.settings.embedMetadata,
          S.settings.sponsorBlock,
          S.settings.sponsorCats,
          S.settings.skipArchived,
          S.settings.playlistSubfolder,
        ].join(" "),
        keywords: ["toggle", "embed", "sponsorblock", "archive"],
      },
      {
        id: "togglesSubs",
        label: [
          S.settings.subtitles,
          S.settings.embedSubs,
          S.settings.includeAutoSubs,
        ].join(" "),
        keywords: ["toggle", "embed", "subtitle"],
      },
      {
        id: "togglesAppearance",
        label: [S.settings.thumbnailAccent].join(" "),
        keywords: ["toggle", "thumbnail", "accent"],
      },
      {
        id: "togglesWindow",
        label: [
          S.settings.autoCheckUpdate,
          S.settings.autoUpdateTools,
          S.settings.crashReports,
          S.settings.minimizeToTray,
          S.settings.notifyFinished,
          S.settings.followSystemTheme,
          S.settings.launchAtLogin,
          S.settings.autoSort,
          S.settings.experimental,
        ].join(" "),
        keywords: ["toggle", "update", "tray", "startup", "experimental"],
      },
      { id: "set-close", label: S.settings.closeBehavior, keywords: ["close", "quit", "tray", "window", "minimize"] },
      { id: "set-profiles", label: S.settings.profiles, keywords: ["profile", "preset", "music", "video", "bundle"] },
      { id: "set-sublangs", label: S.settings.subtitleLangs, keywords: ["subtitle", "language"] },
      { id: "set-merge", label: [S.settings.mergeContainer, S.settings.customFormat].join(" "), keywords: ["merge", "container", "format", "custom"] },
      { id: "set-codec", label: S.settings.codecPreference, keywords: ["codec", "h264", "vp9", "av1"] },
      { id: "set-theme", label: S.settings.theme, keywords: ["theme"] },
      { id: "set-density", label: S.settings.density, keywords: ["density", "comfortable", "compact"] },
      { id: "set-accent", label: `${S.settings.accent} ${S.settings.accentCustom}`, keywords: ["accent", "colour", "color", "hex"] },
      { id: "set-language", label: S.settings.language, keywords: ["language", "locale"] },
      { id: "set-post", label: S.settings.postAction, keywords: ["after", "download", "open", "reveal"] },
      { id: "archive", label: S.settings.clearArchive, keywords: ["archive", "clear"] },
      { id: "backup", label: S.settings.backup, keywords: ["backup", "restore", "export", "import"] },
      { id: "replay", label: S.onboarding.replay, keywords: ["onboarding", "replay", "wizard"] },
    ],
    [S],
  );
  const visible = useMemo(
    () => new Set(filterSettingIds(fields, query)),
    [fields, query],
  );
  const hide = (id: string): boolean => query.trim().length > 0 && !visible.has(id);
  const hideSection = (ids: readonly string[]): boolean =>
    query.trim().length > 0 && !ids.some((id) => visible.has(id));
  const backupFile = useRef<HTMLInputElement | null>(null);
  const [backupNote, setBackupNote] = useState<string | null>(null);

  // Toggle rows live in four groups so each settings section owns its
  // switches instead of one endless wall of checkboxes.
  const toggleRows = [
    ["embedThumbnail", S.settings.embedThumbnail],
    ["embedMetadata", S.settings.embedMetadata],
    ["subtitles", S.settings.subtitles],
    ["embedSubs", S.settings.embedSubs],
    ["includeAutoSubs", S.settings.includeAutoSubs],
    ["sponsorBlock", S.settings.sponsorBlock],
    ["skipArchived", S.settings.skipArchived],
    ["playlistSubfolder", S.settings.playlistSubfolder],
    ["thumbnailAccent", S.settings.thumbnailAccent],
    ["autoCheckUpdate", S.settings.autoCheckUpdate],
    ["autoUpdateTools", S.settings.autoUpdateTools],
    ["crashReports", S.settings.crashReports],
    ["minimizeToTray", S.settings.minimizeToTray],
    ["notifyFinished", S.settings.notifyFinished],
    ["followSystemTheme", S.settings.followSystemTheme],
    ["launchAtLogin", S.settings.launchAtLogin],
    ["autoSort", S.settings.autoSort],
    ["experimental", S.settings.experimental],
  ] as const;

  const renderToggles = (id: string, keys: readonly string[]): React.JSX.Element => (
    <div className="check-col" hidden={hide(id)}>
      {toggleRows
        .filter(([key]) => keys.includes(key))
        .map(([key, label]) => {
          // Dependent fields (D7): sub-options sleep while subtitles are off.
          const off = (key === "embedSubs" || key === "includeAutoSubs") && !saved.subtitles;
          return (
            <label key={key} className="check-row">
              <input
                type="checkbox"
                // Stable automation hook: the toggle order changes with every
                // release, the setting key never does.
                data-setting={key}
                checked={saved[key]}
                disabled={off}
                onChange={(e) => {
                  save({ [key]: e.target.checked });
                }}
              />
              {label}
            </label>
          );
        })}
    </div>
  );

  if (!ready) {
    return (
      <section className="grabber-view" aria-label={S.settings.title}>
        <h1>{S.settings.title}</h1>
        <div className="grabber-card">
          <p className="muted" aria-busy="true">
            {S.settings.loading}
          </p>
        </div>
      </section>
    );
  }

  const save = (patch: Partial<AppSettings>): void => {
    settings
      .getState()
      .save(patch)
      .then(() => {
        flashSaved();
      })
      .catch(flashSaveError);
  };

  const commitText = (
    e: React.FocusEvent<HTMLInputElement>,
    patch: (value: string) => Partial<AppSettings>,
  ): void => {
    save(patch(e.target.value));
  };

  const browse = async (): Promise<void> => {
    const dir = await engine.pickFolder().catch(() => null);
    if (dir !== null) save({ downloadDir: dir });
  };

  // Backup & restore (D9): one portable JSON file, everything sanitized.
  const exportAll = async (): Promise<void> => {
    try {
      const [s, q, h, w] = await Promise.all([
        engine.loadSettings().catch(() => saved),
        engine.loadQueue().catch(() => []),
        engine.loadHistory().catch(() => []),
        engine.loadWatchlist().catch(() => []),
      ]);
      const blob = new Blob([exportBackup(s, q, h, w)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "fluxdl-backup.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 5000);
    } catch {
      setBackupNote(S.settings.backupFailed);
    }
  };

  const importAll = (file: File | null): void => {
    if (file === null) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== "string") return;
      void (async (): Promise<void> => {
        try {
          const parsed = parseBackup(text);
          const merged = await engine.saveSettings(parsed.settings);
          settings.getState().save(merged).catch(() => undefined);
          await engine.saveQueue(parsed.queue);
          await queue.getState().refresh().catch(() => undefined);
          // v1.7.2: ONE atomic replace. This used to clear the history first
          // and then append the records one by one with every failure
          // swallowed — so a single error mid-loop destroyed the user's
          // existing history and still reported "restored N records".
          await engine.restoreHistory(parsed.history);
          await engine.saveWatchlist(parsed.watchlist).catch(() => undefined);
          setBackupNote(
            formatStr(S.settings.backupDone, {
              q: parsed.queue.length,
              h: parsed.history.length,
              d: parsed.dropped,
              w: parsed.watchlist.length,
            }),
          );
          flashSaved();
        } catch (err) {
          setBackupNote(
            err instanceof Error && err.message.length > 0
              ? `${S.settings.backupFailed} ${err.message}`
              : S.settings.backupFailed,
          );
        }
      })();
    };
    reader.readAsText(file);
  };

  return (
    <section className="grabber-view" aria-label={S.settings.title}>
      <h1>{S.settings.title}</h1>
      {flash && (
        <p className="note" role="status">
          {S.settings.saved}
        </p>
      )}
      {saveError !== null && (
        <p className="error-text" role="alert" data-testid="settings-save-error">
          {formatStr(S.settings.saveFailed, { detail: saveError })}
        </p>
      )}
      {archiveNote && (
        <p className="note" role="status">
          {S.settings.archiveCleared}
        </p>
      )}

      <div className="settings-grid">
      <div className="grabber-card">
        <div className="url-row">
          <input
            id="settings-search"
            data-testid="settings-search"
            className="input"
            type="search"
            value={query}
            placeholder={S.settings.search}
            aria-label={S.settings.search}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setQuery("");
              }}
            >
              {S.settings.clearSearch}
            </button>
          )}
        </div>
        {query.trim().length > 0 && (
          <p className="muted" role="status">
            {visible.size === 0
              ? S.settings.noMatch
              : formatStr(S.settings.matchCount, { n: visible.size, t: fields.length })}
          </p>
        )}
      </div>

      <section
        className="grabber-card"
        aria-label={S.settings.sectionDownloads}
        hidden={hideSection(["set-dir", "set-template", "set-concurrency", "set-timeout", "set-history"])}
      >
        <h2 className="dl-title">{S.settings.sectionDownloads}</h2>
        <label className="field-label" htmlFor="set-dir" id="settings-section-folder" hidden={hide("set-dir")}>
          {S.settings.downloadDir}
        </label>
        <div className="url-row" hidden={hide("set-dir")}>
          <input
            id="set-dir"
            key={`dir:${saved.downloadDir}`}
            className="input"
            defaultValue={saved.downloadDir}
            placeholder={S.settings.downloadDir}
            spellCheck={false}
            onBlur={(e) => {
              commitText(e, (v) => ({ downloadDir: v }));
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              void browse();
            }}
          >
            {S.settings.browse}
          </button>
        </div>

        <label className="field-label" htmlFor="set-template" hidden={hide("set-template")}>
          {S.settings.filenameTemplate}
        </label>
        <input
          id="set-template"
          key={`template:${saved.filenameTemplate}`}
          ref={templateRef}
          className="input"
          defaultValue={saved.filenameTemplate}
          spellCheck={false}
          hidden={hide("set-template")}
          onChange={(e) => {
            setTemplateDraft(e.target.value);
          }}
          onBlur={(e) => {
            setTemplateDraft(null);
            commitText(e, (v) => ({ filenameTemplate: v }));
          }}
        />
        <div className="chip-row" aria-label={S.settings.filenameTemplate} hidden={hide("set-template")}>
          {["%(title)s", "%(id)s", "%(uploader)s", "%(upload_date)s", "%(extractor)s", "%(ext)s"].map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              onClick={() => {
                insertToken(t);
              }}
            >
              {t}
            </button>
          ))}
        </div>
        {(() => {
          const shown = templateDraft ?? saved.filenameTemplate;
          return validateFilenameTemplate(shown) ? (
            <p className="muted" role="status" hidden={hide("set-template")}>
              {formatStr(S.settings.templatePreview, { name: previewFilename(shown) })}
            </p>
          ) : (
            <p className="error-text" role="alert" hidden={hide("set-template")}>
              {S.settings.templateInvalid}
            </p>
          );
        })()}
        <div className="chip-row" aria-label={S.settings.filenamePresets} hidden={hide("set-template")}>
          {FILENAME_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className="chip"
              aria-pressed={saved.filenameTemplate === p}
              onClick={() => {
                save({ filenameTemplate: p });
              }}
            >
              {p}
            </button>
          ))}
        </div>

        <label className="field-label" htmlFor="set-concurrency" hidden={hide("set-concurrency")}>
          {S.settings.concurrency}
        </label>        <input
          id="set-concurrency"
          key={`concurrency:${String(saved.concurrency)}`}
          className="input"
          type="number"
          min={1}
          max={5}
          defaultValue={saved.concurrency}
          hidden={hide("set-concurrency")}
          onBlur={(e) => {
            save({ concurrency: Number(e.target.value) });
          }}
        />

        <label className="field-label" htmlFor="set-concurrency-gallery" hidden={hide("set-concurrency")}>
          {S.settings.concurrencyGallery}
        </label>
        <input
          id="set-concurrency-gallery"
          key={`concurrencyGallery:${String(saved.concurrencyGallery)}`}
          className="input"
          type="number"
          min={1}
          max={5}
          defaultValue={saved.concurrencyGallery}
          hidden={hide("set-concurrency")}
          onBlur={(e) => {
            save({ concurrencyGallery: Number(e.target.value) });
          }}
        />

        <label className="field-label" htmlFor="set-window-start" hidden={hide("set-concurrency")}>
          {S.settings.downloadWindowStart}
        </label>
        <input
          id="set-window-start"
          key={`windowStart:${saved.downloadWindowStart ?? ""}`}
          className="input"
          defaultValue={saved.downloadWindowStart ?? ""}
          placeholder="22:00"
          spellCheck={false}
          hidden={hide("set-concurrency")}
          onChange={(e) => {
            setWindowDraft((prev) => ({ ...prev, start: e.target.value }));
          }}
          onBlur={(e) => {
            setWindowDraft((prev) => ({ ...prev, start: null }));
            commitText(e, (v) => ({ downloadWindowStart: v }));
          }}
        />
        <label className="field-label" htmlFor="set-window-end" hidden={hide("set-concurrency")}>
          {S.settings.downloadWindowEnd}
        </label>
        <input
          id="set-window-end"
          key={`windowEnd:${saved.downloadWindowEnd ?? ""}`}
          className="input"
          defaultValue={saved.downloadWindowEnd ?? ""}
          placeholder="06:00"
          spellCheck={false}
          hidden={hide("set-concurrency")}
          onChange={(e) => {
            setWindowDraft((prev) => ({ ...prev, end: e.target.value }));
          }}
          onBlur={(e) => {
            setWindowDraft((prev) => ({ ...prev, end: null }));
            commitText(e, (v) => ({ downloadWindowEnd: v }));
          }}
        />
        {(() => {
          const s = windowDraft.start ?? saved.downloadWindowStart;
          const e = windowDraft.end ?? saved.downloadWindowEnd;
          return validateWindowTime(s) && validateWindowTime(e) ? null : (
            <p className="error-text" role="alert" hidden={hide("set-concurrency")}>
              {S.settings.windowInvalid}
            </p>
          );
        })()}

        <label className="field-label" htmlFor="set-timeout" hidden={hide("set-timeout")}>
          {S.settings.analyzeTimeout}
        </label>        <input
          id="set-timeout"
          key={`timeout:${String(saved.analyzeTimeoutSec)}`}
          className="input"
          type="number"
          min={10}
          max={300}
          defaultValue={saved.analyzeTimeoutSec}
          hidden={hide("set-timeout")}
          onBlur={(e) => {
            save({ analyzeTimeoutSec: Number(e.target.value) });
          }}
        />

        <label className="field-label" htmlFor="set-history" hidden={hide("set-history")}>
          {S.settings.historyLimit}
        </label>
        <input
          id="set-history"
          key={`history:${String(saved.historyLimit)}`}
          className="input"
          type="number"
          min={10}
          max={5000}
          defaultValue={saved.historyLimit}
          hidden={hide("set-history")}
          onBlur={(e) => {
            save({ historyLimit: Number(e.target.value) });
          }}
        />
      </section>

      <section
        className="grabber-card"
        aria-label={S.settings.sectionNetwork}
        hidden={hideSection([
          "set-speed",
          "set-proxy",
          "set-cookies",
          "set-cookies-file",
          "set-network2",
          "set-pacing",
        ])}
      >
        <h2 className="dl-title">{S.settings.sectionNetwork}</h2>
        <label className="field-label" htmlFor="set-speed" id="settings-section-speed" hidden={hide("set-speed")}>
          {S.settings.speedLimit}
        </label>
        <input
          id="set-speed"
          key={`speed:${saved.speedLimit ?? ""}`}
          className="input"
          defaultValue={saved.speedLimit ?? ""}
          spellCheck={false}
          hidden={hide("set-speed")}
          onChange={(e) => {
            setSpeedDraft(e.target.value);
          }}
          onBlur={(e) => {
            setSpeedDraft(null);
            commitText(e, (v) => ({ speedLimit: v }));
          }}
        />
        {(() => {
          const shown = speedDraft ?? saved.speedLimit;
          return validateSpeedLimit(shown) ? null : (
            <p className="error-text" role="alert" hidden={hide("set-speed")}>
              {S.settings.speedInvalid}
            </p>
          );
        })()}

        <label className="field-label" htmlFor="set-proxy" id="settings-section-proxy" hidden={hide("set-proxy")}>
          {S.settings.proxy}
        </label>
        <input
          id="set-proxy"
          key={`proxy:${saved.proxy ?? ""}`}
          className="input"
          defaultValue={saved.proxy ?? ""}
          spellCheck={false}
          hidden={hide("set-proxy")}
          onBlur={(e) => {
            commitText(e, (v) => ({ proxy: v }));
          }}
        />

        <label className="field-label" htmlFor="set-cookies" id="settings-section-cookies" hidden={hide("set-cookies")}>
          {S.settings.cookies}
        </label>
        <input
          id="set-cookies"
          key={`cookies:${saved.cookiesFromBrowser ?? ""}`}
          className="input"
          defaultValue={saved.cookiesFromBrowser ?? ""}
          placeholder="chrome"
          spellCheck={false}
          hidden={hide("set-cookies")}
          onBlur={(e) => {
            commitText(e, (v) => ({ cookiesFromBrowser: v }));
          }}
        />

        <label className="field-label" htmlFor="set-cookies-file" hidden={hide("set-cookies-file")}>
          {S.settings.cookiesFile}
        </label>
        <input
          id="set-cookies-file"
          key={`cookies-file:${saved.cookiesFile ?? ""}`}
          className="input"
          defaultValue={saved.cookiesFile ?? ""}
          placeholder="C:\Users\me\cookies.txt"
          spellCheck={false}
          hidden={hide("set-cookies-file")}
          onBlur={(e) => {
            commitText(e, (v) => ({ cookiesFile: v }));
          }}
        />

        {/* Retry/fragment/timeout knobs (Phase 2): null = tool default. */}
        <div className="meta-grid" hidden={hide("set-network2")}>
          {(
            [
              ["downloadRetries", "set-net-retries", S.settings.downloadRetries, 0, 30],
              ["concurrentFragments", "set-net-fragments", S.settings.concurrentFragments, 1, 16],
              ["socketTimeoutSec", "set-net-timeout", S.settings.socketTimeoutSec, 5, 300],
            ] as const
          ).map(([key, id, label, min, max]) => (
            <label key={key} className="meta-field" htmlFor={id}>
              <span className="field-label">{label}</span>
              <input
                id={id}
                data-setting={key}
                className="input"
                type="number"
                min={min}
                max={max}
                step={1}
                key={`${key}:${String(saved[key] ?? "")}`}
                defaultValue={saved[key] ?? ""}
                inputMode="numeric"
                placeholder={S.settings.pacingOff}
                spellCheck={false}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  save({ [key]: raw.length === 0 ? null : Number(raw) });
                }}
              />
            </label>
          ))}
        </div>
        <div className="check-col" hidden={hide("set-network2")}>
          <label className="check-row">
            <input
              type="checkbox"
              data-setting="useAria2c"
              checked={saved.useAria2c}
              onChange={(e) => {
                save({ useAria2c: e.target.checked });
              }}
            />
            {S.settings.useAria2c}
          </label>
        </div>

        {/* Polite pacing (v1.7.2): the "be a good citizen" delays. All off by
            default; each maps 1:1 onto a documented yt-dlp flag. */}
        <h3 className="field-label" hidden={hide("set-pacing")}>
          {S.settings.pacingTitle}
        </h3>
        <div className="meta-grid" hidden={hide("set-pacing")}>
          {(
            [
              ["sleepRequestsSec", "set-pacing-requests", S.settings.pacingRequests],
              ["minSleepIntervalSec", "set-pacing-min", S.settings.pacingMin],
              ["maxSleepIntervalSec", "set-pacing-max", S.settings.pacingMax],
              ["sleepSubtitlesSec", "set-pacing-subs", S.settings.pacingSubs],
            ] as const
          ).map(([key, id, label]) => (
            <label key={key} className="meta-field" htmlFor={id}>
              <span className="field-label">{label}</span>
              <input
                id={id}
                data-setting={key}
                className="input"
                type="number"
                min={0}
                max={3600}
                step={1}
                key={`${key}:${String(saved.pacing[key] ?? "")}`}
                defaultValue={saved.pacing[key] ?? ""}
                inputMode="numeric"
                placeholder={S.settings.pacingOff}
                spellCheck={false}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  if (raw.length === 0) {
                    void settings
                      .getState()
                      .save({ pacing: { ...saved.pacing, [key]: null } })
                      .catch(() => undefined);
                    return;
                  }
                  const seconds = Number(raw);
                  if (!Number.isFinite(seconds) || seconds < 0) return;
                  void settings
                    .getState()
                    .save({
                      pacing: {
                        ...saved.pacing,
                        [key]: Math.floor(seconds),
                      },
                    })
                    .catch(() => undefined);
                }}
              />
            </label>
          ))}
        </div>
        <p className="hint" hidden={hide("set-pacing")}>
          {S.settings.pacingHint}
        </p>
        <div className="chip-row" hidden={hide("set-pacing")}>
          {(
            [
              ["off", S.settings.pacingOff, null],
              ["light", S.settings.pacingLight, { sleepRequestsSec: 1, minSleepIntervalSec: 2 }],
              [
                "standard",
                S.settings.pacingStandard,
                { sleepRequestsSec: 2, minSleepIntervalSec: 5, maxSleepIntervalSec: 10 },
              ],
            ] as const
          ).map(([id, label, preset]) => (
            <button
              key={id}
              type="button"
              className="chip"
              onClick={() => {
                const base = {
                  sleepRequestsSec: null,
                  minSleepIntervalSec: null,
                  maxSleepIntervalSec: null,
                  sleepSubtitlesSec: null,
                };
                void settings
                  .getState()
                  .save({ pacing: { ...base, ...(preset ?? {}) } })
                  .catch(() => undefined);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section
        className="grabber-card"
        aria-label={S.settings.sectionImages}
        hidden={hideSection(["set-images"])}
      >
        <h2 className="dl-title">{S.settings.sectionImages}</h2>
        <label className="field-label" htmlFor="set-images-dir" hidden={hide("set-images")}>
          {S.settings.imagesDownloadDir}
        </label>
        <input
          id="set-images-dir"
          className="input"
          data-setting="images.downloadDir"
          type="text"
          defaultValue={saved.images.downloadDir}
          key={`images-dir:${saved.images.downloadDir}`}
          hidden={hide("set-images")}
          spellCheck={false}
          onBlur={(e) => {
            save({ images: { ...saved.images, downloadDir: e.target.value } });
          }}
        />
        <label className="field-label" htmlFor="set-images-folder" hidden={hide("set-images")}>
          {S.settings.imagesFolderTemplate}
        </label>
        <input
          id="set-images-folder"
          className="input"
          data-setting="images.folderTemplate"
          type="text"
          defaultValue={saved.images.folderTemplate}
          key={`images-folder:${saved.images.folderTemplate}`}
          hidden={hide("set-images")}
          spellCheck={false}
          onBlur={(e) => {
            save({ images: { ...saved.images, folderTemplate: e.target.value } });
          }}
        />
        <label className="field-label" htmlFor="set-images-file" hidden={hide("set-images")}>
          {S.settings.imagesFilenameTemplate}
        </label>
        <input
          id="set-images-file"
          className="input"
          data-setting="images.filenameTemplate"
          type="text"
          defaultValue={saved.images.filenameTemplate}
          key={`images-file:${saved.images.filenameTemplate}`}
          hidden={hide("set-images")}
          spellCheck={false}
          onBlur={(e) => {
            save({ images: { ...saved.images, filenameTemplate: e.target.value } });
          }}
        />
        <label className="field-label" htmlFor="set-images-proxy" hidden={hide("set-images")}>
          {S.settings.proxy}
        </label>
        <input
          id="set-images-proxy"
          className="input"
          data-setting="images.proxy"
          type="text"
          defaultValue={saved.images.proxy ?? ""}
          key={`images-proxy:${saved.images.proxy ?? ""}`}
          hidden={hide("set-images")}
          spellCheck={false}
          onBlur={(e) => {
            save({ images: { ...saved.images, proxy: e.target.value } });
          }}
        />
        <div className="meta-grid" hidden={hide("set-images")}>
          {(
            [
              ["sleepRequestsSec", "set-images-sleep-req", 0, 60],
              ["maxSleepIntervalSec", "set-images-sleep-max", 0, 3600],
              ["retries", "set-images-retries", 0, 20],
            ] as const
          ).map(([key, id, min, max]) => (
            <label key={key} className="meta-field" htmlFor={id}>
              <span className="field-label">{key}</span>
              <input
                id={id}
                data-setting={`images.${key}`}
                className="input"
                type="number"
                min={min}
                max={max}
                step={1}
                key={`${key}:${String(saved.images[key] ?? "")}`}
                defaultValue={saved.images[key] ?? ""}
                inputMode="numeric"
                placeholder={S.settings.pacingOff}
                spellCheck={false}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  save({
                    images: {
                      ...saved.images,
                      [key]: raw.length === 0 ? null : Number(raw),
                    },
                  });
                }}
              />
            </label>
          ))}
        </div>
        <div className="check-col" hidden={hide("set-images")}>
          <label className="check-row">
            <input
              type="checkbox"
              data-setting="images.archive"
              checked={saved.images.archive}
              onChange={(e) => {
                save({ images: { ...saved.images, archive: e.target.checked } });
              }}
            />
            {S.settings.imagesArchive}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              data-setting="images.metadataSidecar"
              checked={saved.images.metadataSidecar}
              onChange={(e) => {
                save({ images: { ...saved.images, metadataSidecar: e.target.checked } });
              }}
            />
            {S.settings.imagesSidecar}
          </label>
        </div>
        <label className="field-label" htmlFor="set-images-raw" hidden={hide("set-images")}>
          {S.settings.imagesCustom}
        </label>
        <textarea
          id="set-images-raw"
          className="input batch-text"
          data-setting="images.customConfig"
          value={customDraft ?? saved.images.customConfig ?? ""}
          hidden={hide("set-images")}
          spellCheck={false}
          rows={6}
          placeholder={'{\n  "extractor": {}\n}'}
          onChange={(e) => {
            setCustomDraft(e.target.value);
            setCustomNote(null);
          }}
        />
        <p className="hint" hidden={hide("set-images")}>
          {S.settings.imagesCustomHint}
        </p>
        {customNote !== null && (
          <p className="note" role="status" hidden={hide("set-images")}>
            {customNote}
          </p>
        )}
        <div className="chip-row" hidden={hide("set-images")}>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              const text = customDraft ?? saved.images.customConfig ?? "";
              const check = validateGalleryConfigJson(text);
              if (!check.ok) {
                setCustomNote(formatStr(S.settings.imagesCustomInvalid, { detail: check.error }));
                return;
              }
              setCustomDraft(null);
              setCustomNote(null);
              save({ images: { ...saved.images, customConfig: text } });
            }}
          >
            {S.settings.saved}
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              setCustomDraft(null);
              setCustomNote(null);
              save({ images: { ...saved.images, customConfig: null } });
            }}
          >
            {S.settings.imagesCustomReset}
          </button>
        </div>
      </section>

      <section
        className="grabber-card"
        aria-label={S.settings.sectionSubtitles}
        hidden={hideSection(["togglesSubs", "set-sublangs"])}
      >
        <h2 className="dl-title">{S.settings.sectionSubtitles}</h2>
        {renderToggles("togglesSubs", ["subtitles", "embedSubs", "includeAutoSubs"])}
        <label className="field-label" htmlFor="set-sublangs" hidden={hide("set-sublangs")}>
          {S.settings.subtitleLangs}
        </label>
        <input
          id="set-sublangs"
          key={`sublangs:${saved.subtitleLangs}`}
          className="input"
          defaultValue={saved.subtitleLangs}
          spellCheck={false}
          disabled={!saved.subtitles}
          hidden={hide("set-sublangs")}
          onBlur={(e) => {
            commitText(e, (v) => ({ subtitleLangs: v }));
          }}
        />
      </section>

      <section
        className="grabber-card"
        aria-label={S.settings.sectionQuality}
        hidden={hideSection(["set-merge", "set-codec", "togglesQuality"])}
      >
        <h2 className="dl-title">{S.settings.sectionQuality}</h2>
        <label className="field-label" htmlFor="set-merge" hidden={hide("set-merge")}>
          {S.settings.mergeContainer}
        </label>
        <select
          id="set-merge"
          className="input"
          value={saved.mergeContainer}
          hidden={hide("set-merge")}
          onChange={(e) => {
            save({ mergeContainer: e.target.value });
          }}
        >
          {CONTAINER_CHOICES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          {!CONTAINER_CHOICES.includes(saved.mergeContainer as Container) && (
            <option value={saved.mergeContainer}>{saved.mergeContainer}</option>
          )}
        </select>
        <p className="hint">{S.settings.mergeContainerHint}</p>

        <label className="field-label" htmlFor="set-codec" hidden={hide("set-codec")}>
          {S.settings.codecPreference}
        </label>
        <select
          id="set-codec"
          className="input"
          value={saved.codecPreference}
          hidden={hide("set-codec")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "auto" || v === "h264" || v === "vp9" || v === "av1") {
              save({ codecPreference: v });
            }
          }}
        >
          <option value="auto">{S.settings.codecAuto}</option>
          <option value="h264">{S.settings.codecH264}</option>
          <option value="vp9">{S.settings.codecVp9}</option>
          <option value="av1">{S.settings.codecAv1}</option>
        </select>
        {renderToggles("togglesQuality", [
          "embedThumbnail",
          "embedMetadata",
          "sponsorBlock",
          "skipArchived",
          "playlistSubfolder",
        ])}
        <label className="field-label" htmlFor="set-sponsorcats" hidden={hide("togglesQuality")}>
          {S.settings.sponsorCats}
        </label>
        <input
          id="set-sponsorcats"
          key={`sponsorcats:${saved.sponsorBlockCategories}`}
          className="input"
          data-setting="sponsorBlockCategories"
          type="text"
          defaultValue={saved.sponsorBlockCategories}
          hidden={hide("togglesQuality")}
          spellCheck={false}
          onBlur={(e) => {
            commitText(e, (v) => ({ sponsorBlockCategories: v }));
          }}
        />
        <p className="hint" hidden={hide("togglesQuality")}>
          {S.settings.sponsorCatsHint}
        </p>
        <label className="field-label" htmlFor="set-customformat" hidden={hide("set-merge")}>
          {S.settings.customFormat}
        </label>
        <input
          id="set-customformat"
          key={`customformat:${saved.customFormat ?? ""}`}
          className="input"
          data-setting="customFormat"
          type="text"
          defaultValue={saved.customFormat ?? ""}
          placeholder="bestvideo+bestaudio/best"
          hidden={hide("set-merge")}
          spellCheck={false}
          onBlur={(e) => {
            commitText(e, (v) => ({ customFormat: v }));
          }}
        />
        <p className="hint" hidden={hide("set-merge")}>
          {S.settings.customFormatHint}
        </p>
      </section>

      <section
        className="grabber-card"
        aria-label={S.settings.sectionAppearance}
        hidden={hideSection(["set-theme", "set-density", "set-accent", "set-language", "togglesAppearance"])}
      >
        <h2 className="dl-title">{S.settings.sectionAppearance}</h2>
        <span className="field-label" id="set-theme-label" hidden={hide("set-theme")}>
          {S.settings.theme}
        </span>        <div className="chip-row" role="group" aria-labelledby="set-theme-label" hidden={hide("set-theme")}>
          {THEME_NAMES.map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              aria-pressed={saved.theme === t}
              onClick={() => {
                save({ theme: t });
              }}
            >
              {S.settings.themes[t]}
            </button>
          ))}
        </div>

        <span className="field-label" id="set-density-label" hidden={hide("set-density")}>
          {S.settings.density}
        </span>        <div className="chip-row" role="group" aria-labelledby="set-density-label" hidden={hide("set-density")}>
          {(
            [
              ["comfortable", S.settings.densityComfortable],
              ["compact", S.settings.densityCompact],
            ] as const
          ).map(([d, label]: readonly [Density, string]) => (
            <button
              key={d}
              type="button"
              className="chip"
              aria-pressed={saved.density === d}
              onClick={() => {
                save({ density: d });
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="field-label" id="set-accent-label" hidden={hide("set-accent")}>
          {S.settings.accent}
        </span>
        <div className="chip-row" role="group" aria-labelledby="set-accent-label" hidden={hide("set-accent")}>
          {ACCENT_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              className="chip swatch"
              aria-pressed={saved.accentOverride === hex}
              aria-label={hex}
              title={hex}
              style={{ background: hex }}
              onClick={() => {
                save({ accentOverride: hex });
              }}
            />
          ))}
        </div>
        <div className="url-row" hidden={hide("set-accent")}>
          <input
            id="set-accent-custom"
            key={`accent:${saved.accentOverride ?? "none"}`}
            className="input"
            defaultValue={saved.accentOverride ?? ""}
            placeholder={S.settings.accentCustom}
            spellCheck={false}
            aria-label={S.settings.accentCustom}
            onBlur={(e) => {
              const v = e.target.value.trim().toLowerCase();
              if (v.length === 0) {
                save({ accentOverride: null });
              } else if (/^#[0-9a-f]{6}$/.test(v)) {
                save({ accentOverride: v });
              }
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              save({ accentOverride: null });
            }}
          >
            {S.settings.accentReset}
          </button>
        </div>
        {saved.accentOverride !== null &&
          (deriveAccentScale(saved.accentOverride)?.warning ?? false) && (
            <p className="note" role="status">
              {S.settings.accentWarning}
            </p>
          )}

        <label className="field-label" htmlFor="set-language" hidden={hide("set-language")}>
          {S.settings.language}
        </label>
        <select
          id="set-language"
          className="input"
          value={saved.language}
          hidden={hide("set-language")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "auto" || v === "en" || v === "ms") {
              save({ language: v });
            }
          }}
        >
          <option value="auto">{S.settings.languageAuto}</option>
          <option value="en">{S.settings.languageEnglish}</option>
          <option value="ms">{S.settings.languageMalay}</option>
        </select>
        {renderToggles("togglesAppearance", ["thumbnailAccent"])}
      </section>

      <section
        className="grabber-card"
        aria-label={S.settings.sectionBehavior}
        hidden={hideSection(["set-post", "set-close", "togglesWindow"])}
      >
        <h2 className="dl-title">{S.settings.sectionBehavior}</h2>
        <label className="field-label" htmlFor="set-post" hidden={hide("set-post")}>
          {S.settings.postAction}
        </label>        <select
          id="set-post"
          className="input"
          value={saved.postDownloadAction}
          hidden={hide("set-post")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "none" || v === "open-file" || v === "reveal") {
              save({ postDownloadAction: v });
            }
          }}
        >
          <option value="none">{S.settings.postNone}</option>
          <option value="open-file">{S.settings.postOpen}</option>
          <option value="reveal">{S.settings.postReveal}</option>
        </select>

        <label className="field-label" htmlFor="set-close" hidden={hide("set-close")}>
          {S.settings.closeBehavior}
        </label>
        <select
          id="set-close"
          className="input"
          value={saved.closeBehavior}
          hidden={hide("set-close")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "tray" || v === "quit") {
              save({ closeBehavior: v });
            }
          }}
        >
          <option value="tray">{S.settings.closeTray}</option>
          <option value="quit">{S.settings.closeQuit}</option>
        </select>
        {renderToggles("togglesWindow", [
          "autoCheckUpdate",
          "autoUpdateTools",
          "crashReports",
          "minimizeToTray",
          "notifyFinished",
          "followSystemTheme",
          "launchAtLogin",
          "autoSort",
          "experimental",
        ])}
      </section>

      {/* Post-processing pipeline (Phase 4): after-download steps. */}
      <section
        className="grabber-card"
        aria-label={S.settings.postTitle}
        hidden={hideSection(["set-postprocess"])}
      >
        <h2 className="dl-title">{S.settings.postTitle}</h2>
        <div className="check-col" hidden={hide("set-postprocess")}>
          {(
            [
              ["convertImages", S.settings.ppConvert],
              ["autoTagAudio", S.settings.ppAutoTag],
              ["transcribeAudio", S.settings.ppTranscribe],
              ["autoUpload", S.settings.ppAutoUpload],
              ["keepOriginals", S.settings.ppKeepOriginals],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="check-row">
              <input
                type="checkbox"
                data-setting={`postProcess.${key}`}
                checked={saved.postProcess[key]}
                onChange={(e) => {
                  save({ postProcess: { ...saved.postProcess, [key]: e.target.checked } });
                }}
              />
              {label}
            </label>
          ))}
        </div>
        <p className="hint" hidden={hide("set-postprocess")}>
          {S.settings.ppAutoTagHint}
        </p>
        <p className="hint" hidden={hide("set-postprocess")}>
          {S.settings.ppTranscribeHint}
        </p>
        <label className="field-label" htmlFor="set-pp-model" hidden={hide("set-postprocess")}>
          {S.settings.ppWhisperModel}
        </label>
        <select
          id="set-pp-model"
          className="input"
          value={saved.postProcess.whisperModel}
          hidden={hide("set-postprocess")}
          onChange={(e) => {
            const v = e.target.value;
            save({
              postProcess: {
                ...saved.postProcess,
                whisperModel: v === "base" || v === "small" ? v : "tiny",
              },
            });
          }}
        >
          <option value="tiny">tiny · ~75 MB</option>
          <option value="base">base · ~142 MB</option>
          <option value="small">small · ~466 MB</option>
        </select>
        <label className="field-label" htmlFor="set-pp-remote" hidden={hide("set-postprocess")}>
          {S.settings.ppRcloneRemote}
        </label>
        <input
          id="set-pp-remote"
          key={`ppRemote:${saved.postProcess.rcloneRemote ?? ""}`}
          className="input"
          defaultValue={saved.postProcess.rcloneRemote ?? ""}
          placeholder="myremote:backups/"
          spellCheck={false}
          hidden={hide("set-postprocess")}
          onBlur={(e) => {
            commitText(e, (v) => ({
              postProcess: { ...saved.postProcess, rcloneRemote: v },
            }));
          }}
        />
        <p className="hint" hidden={hide("set-postprocess")}>
          {S.settings.ppRcloneRemoteHint}
        </p>
        <label className="field-label" htmlFor="set-pp-format" hidden={hide("set-postprocess")}>
          {S.settings.ppFormat}
        </label>
        <select
          id="set-pp-format"
          className="input"
          value={saved.postProcess.imageFormat}
          hidden={hide("set-postprocess")}
          onChange={(e) => {
            save({
              postProcess: {
                ...saved.postProcess,
                imageFormat: e.target.value === "png" ? "png" : "jpg",
              },
            });
          }}
        >
          <option value="jpg">JPG</option>
          <option value="png">PNG</option>
        </select>
        <label className="field-label" htmlFor="set-pp-quality" hidden={hide("set-postprocess")}>
          {S.settings.ppQuality}
        </label>
        <input
          id="set-pp-quality"
          key={`ppQuality:${String(saved.postProcess.imageQuality)}`}
          className="input"
          type="number"
          min={1}
          max={100}
          defaultValue={saved.postProcess.imageQuality}
          hidden={hide("set-postprocess")}
          onBlur={(e) => {
            save({ postProcess: { ...saved.postProcess, imageQuality: Number(e.target.value) } });
          }}
        />
        <label className="field-label" htmlFor="set-pp-maxdim" hidden={hide("set-postprocess")}>
          {S.settings.ppMaxDim}
        </label>
        <input
          id="set-pp-maxdim"
          key={`ppMaxDim:${String(saved.postProcess.imageMaxDim)}`}
          className="input"
          type="number"
          min={64}
          max={8192}
          defaultValue={saved.postProcess.imageMaxDim}
          hidden={hide("set-postprocess")}
          onBlur={(e) => {
            save({ postProcess: { ...saved.postProcess, imageMaxDim: Number(e.target.value) } });
          }}
        />
        <div className="check-col" hidden={hide("set-postprocess")}>
          <label className="check-row">
            <input
              type="checkbox"
              data-setting="postProcess.stripExif"
              checked={saved.postProcess.stripExif}
              onChange={(e) => {
                save({ postProcess: { ...saved.postProcess, stripExif: e.target.checked } });
              }}
            />
            {S.settings.ppStripExif}
          </label>
        </div>
        <label className="field-label" htmlFor="set-pp-package" hidden={hide("set-postprocess")}>
          {S.settings.ppPackage}
        </label>
        <select
          id="set-pp-package"
          className="input"
          value={saved.postProcess.packageGallery}
          hidden={hide("set-postprocess")}
          onChange={(e) => {
            const v = e.target.value;
            save({
              postProcess: {
                ...saved.postProcess,
                packageGallery: v === "zip" || v === "cbz" ? v : "off",
              },
            });
          }}
        >
          <option value="off">{S.settings.ppPackageOff}</option>
          <option value="zip">ZIP</option>
          <option value="cbz">CBZ</option>
        </select>
        <label className="field-label" htmlFor="set-pp-ugoira" hidden={hide("set-postprocess")}>
          {S.settings.ppUgoira}
        </label>
        <select
          id="set-pp-ugoira"
          className="input"
          value={saved.postProcess.ugoiraFormat}
          hidden={hide("set-postprocess")}
          onChange={(e) => {
            const v = e.target.value;
            save({
              postProcess: {
                ...saved.postProcess,
                ugoiraFormat: v === "mp4" || v === "gif" || v === "webm" ? v : "off",
              },
            });
          }}
        >
          <option value="off">{S.settings.ppUgoiraOff}</option>
          <option value="mp4">MP4</option>
          <option value="gif">GIF</option>
          <option value="webm">WebM</option>
        </select>
        <label className="field-label" htmlFor="set-pp-compress" hidden={hide("set-postprocess")}>
          {S.settings.ppCompress}
        </label>
        <select
          id="set-pp-compress"
          className="input"
          value={saved.postProcess.compressVideo}
          hidden={hide("set-postprocess")}
          onChange={(e) => {
            const v = e.target.value;
            save({
              postProcess: {
                ...saved.postProcess,
                compressVideo:
                  v === "small" || v === "balanced" || v === "archive" ? v : "off",
              },
            });
          }}
        >
          <option value="off">{S.settings.ppCompressOff}</option>
          <option value="small">{S.settings.ppCompressSmall}</option>
          <option value="balanced">{S.settings.ppCompressBalanced}</option>
          <option value="archive">{S.settings.ppCompressArchive}</option>
        </select>
        <p className="hint" hidden={hide("set-postprocess")}>
          {S.settings.ppKeepOriginalsHint}
        </p>
      </section>

      <section
        className="grabber-card"
        aria-label={S.settings.sectionPresets}
        hidden={hideSection(["set-profiles"])}
      >
        <h2 className="dl-title">{S.settings.sectionPresets}</h2>
        <span className="field-label" id="set-profiles" hidden={hide("set-profiles")}>
          {S.settings.profiles}
        </span>
        <p className="muted" hidden={hide("set-profiles")}>
          {S.settings.profilesHint}
        </p>
        <div className="chip-row" role="group" aria-labelledby="set-profiles" hidden={hide("set-profiles")}>
          <button
            type="button"
            className="chip"
            onClick={() => {
              save({
                defaultPreset: { kind: "audio", videoPreset: "Best", audioPreset: "MP3", rawFormat: null },
                speedLimit: null,
              });
            }}
          >
            {S.settings.profileMusic}
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => {
              save({
                defaultPreset: { kind: "video", videoPreset: "Compatible", audioPreset: "MP3", rawFormat: null },
                speedLimit: null,
              });
            }}
          >
            {S.settings.profileVideo}
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => {
              save({
                defaultPreset: { kind: "audio", videoPreset: "Best", audioPreset: "MP3", rawFormat: null },
                embedMetadata: true,
                embedThumbnail: true,
                subtitles: true,
                includeAutoSubs: true,
              });
            }}
          >
            {S.settings.profileArchive}
          </button>
        </div>
      </section>

      <PackStore
        engine={engine}
        settings={settings}
        toast={toast}
        hidden={hideSection(["set-packs"])}
      />
      <RemoteSection
        engine={engine}
        settings={settings}
        toast={toast}
        hidden={hideSection(["set-remote"])}
      />
      <ToolsSection
        engine={engine}
        settings={settings}
        toast={toast}
        hidden={hideSection(["set-tools"])}
      />
      <section
        className="grabber-card"
        aria-label={S.settings.sectionData}
        hidden={hideSection(["archive", "backup", "replay"])}
      >
        <h2 className="dl-title">{S.settings.sectionData}</h2>
        <div hidden={hide("archive")}>
          <button
            type="button"
            className="btn"
            aria-label={S.settings.clearArchive}
            onClick={() => {
              if (!window.confirm(S.settings.archiveConfirm)) return;
              void engine
                .clearArchive()
                .then(() => {
                  flashArchive();
                })
                .catch(() => undefined);
            }}
          >
            {S.settings.clearArchive}
          </button>
        </div>

        <span className="field-label" hidden={hide("backup")}>
          {S.settings.backup}
        </span>
        <div className="chip-row" hidden={hide("backup")}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void exportAll();
            }}
          >
            {S.settings.exportBackup}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              backupFile.current?.click();
            }}
          >
            {S.settings.importBackup}
          </button>
          <input
            ref={backupFile}
            type="file"
            accept=".json,application/json"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              importAll(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </div>
        {backupNote !== null && (
          <p className="note" role="status" hidden={hide("backup")}>
            {backupNote}
          </p>
        )}

        <div hidden={hide("replay")}>
          <button
            type="button"
            className="btn"
            data-testid="settings-replay"
            onClick={onReplay}
          >
            {S.onboarding.replay}
          </button>
        </div>
      </section>
      </div>
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { AppSettings, Density } from "./types.js";
import { THEME_NAMES } from "./themes.js";
import { deriveAccentScale } from "./color.js";
import type { SettingsStoreState } from "./stores.js";
import { formatStr, useStrings } from "./locale.js";
import { filterSettingIds, type FilterableField } from "./settingsFilter.js";
import { previewFilename, validateFilenameTemplate, validateSpeedLimit } from "./validate.js";

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
  readonly onReplay: () => void;
}

const FILENAME_PRESETS: readonly string[] = [
  "%(title)s [%(id)s].%(ext)s",
  "%(title)s.%(ext)s",
  "%(upload_date)s - %(title)s [%(id)s].%(ext)s",
];

const MERGE_CONTAINERS: readonly string[] = ["mp4", "mkv", "webm"];

export function SettingsScreen({ engine, settings, onReplay }: SettingsScreenProps): React.JSX.Element {
  const S = useStrings(settings);
  const saved = useStore(settings, (s) => s.settings);
  const ready = useStore(settings, (s) => s.ready);
  const [flash, setFlash] = useState<boolean>(false);
  const [archiveNote, setArchiveNote] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>("");
  const [templateDraft, setTemplateDraft] = useState<string | null>(null);
  const [speedDraft, setSpeedDraft] = useState<string | null>(null);
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
      { id: "set-timeout", label: S.settings.analyzeTimeout, keywords: ["analyze", "timeout"] },
      { id: "set-history", label: S.settings.historyLimit, keywords: ["history", "keep"] },
      { id: "set-speed", label: S.settings.speedLimit, keywords: ["speed", "limit", "rate"] },
      { id: "set-proxy", label: S.settings.proxy, keywords: ["proxy", "network"] },
      { id: "set-cookies", label: S.settings.cookies, keywords: ["cookies", "browser"] },
      { id: "set-cookies-file", label: S.settings.cookiesFile, keywords: ["cookies", "file"] },
      {
        id: "toggles",
        label: [
          S.settings.embedThumbnail,
          S.settings.embedMetadata,
          S.settings.subtitles,
          S.settings.embedSubs,
          S.settings.sponsorBlock,
          S.settings.skipArchived,
          S.settings.playlistSubfolder,
          S.settings.thumbnailAccent,
          S.settings.autoCheckUpdate,
        ].join(" "),
        keywords: ["toggle", "embed", "subtitle", "sponsorblock", "archive", "update"],
      },
      { id: "set-sublangs", label: S.settings.subtitleLangs, keywords: ["subtitle", "language"] },
      { id: "set-merge", label: S.settings.mergeContainer, keywords: ["merge", "container"] },
      { id: "set-codec", label: S.settings.codecPreference, keywords: ["codec", "h264", "vp9", "av1"] },
      { id: "set-theme", label: S.settings.theme, keywords: ["theme"] },
      { id: "set-density", label: S.settings.density, keywords: ["density", "comfortable", "compact"] },
      { id: "set-accent", label: `${S.settings.accent} ${S.settings.accentCustom}`, keywords: ["accent", "colour", "color", "hex"] },
      { id: "set-language", label: S.settings.language, keywords: ["language", "locale"] },
      { id: "set-post", label: S.settings.postAction, keywords: ["after", "download", "open", "reveal"] },
      { id: "archive", label: S.settings.clearArchive, keywords: ["archive", "clear"] },
      { id: "replay", label: S.onboarding.replay, keywords: ["onboarding", "replay", "wizard"] },
    ],
    [S],
  );
  const visible = useMemo(
    () => new Set(filterSettingIds(fields, query)),
    [fields, query],
  );
  const hide = (id: string): boolean => query.trim().length > 0 && !visible.has(id);

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

      <div className="grabber-card settings-grid">
        <div className="url-row">
          <input
            id="settings-search"
            data-testid="settings-search"
            className="input"
            value={query}
            placeholder={S.settings.search}
            aria-label={S.settings.search}
            spellCheck={false}
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

        <label className="field-label" htmlFor="set-speed" hidden={hide("set-speed")}>
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

        <div className="check-col" hidden={hide("toggles")}>
          {(
            [
              ["embedThumbnail", S.settings.embedThumbnail],
              ["embedMetadata", S.settings.embedMetadata],
              ["subtitles", S.settings.subtitles],
              ["embedSubs", S.settings.embedSubs],
              ["sponsorBlock", S.settings.sponsorBlock],
              ["skipArchived", S.settings.skipArchived],
              ["playlistSubfolder", S.settings.playlistSubfolder],
              ["thumbnailAccent", S.settings.thumbnailAccent],
              ["autoCheckUpdate", S.settings.autoCheckUpdate],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="check-row">
              <input
                type="checkbox"
                checked={saved[key]}
                onChange={(e) => {
                  save({ [key]: e.target.checked });
                }}
              />
              {label}
            </label>
          ))}
        </div>

        <label className="field-label" htmlFor="set-sublangs" hidden={hide("set-sublangs")}>
          {S.settings.subtitleLangs}
        </label>
        <input
          id="set-sublangs"
          key={`sublangs:${saved.subtitleLangs}`}
          className="input"
          defaultValue={saved.subtitleLangs}
          spellCheck={false}
          hidden={hide("set-sublangs")}
          onBlur={(e) => {
            commitText(e, (v) => ({ subtitleLangs: v }));
          }}
        />

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
          {MERGE_CONTAINERS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          {!MERGE_CONTAINERS.includes(saved.mergeContainer) && (
            <option value={saved.mergeContainer}>{saved.mergeContainer}</option>
          )}
        </select>

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
      </div>
    </section>
  );
}

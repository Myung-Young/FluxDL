import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { AppSettings, Density, ThemeName } from "./types.js";
import { STRINGS } from "./strings.js";
import { deriveAccentScale } from "./color.js";
import type { SettingsStoreState } from "./stores.js";

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
  const saved = useStore(settings, (s) => s.settings);
  const ready = useStore(settings, (s) => s.ready);
  const [flash, setFlash] = useState<boolean>(false);
  const [archiveNote, setArchiveNote] = useState<boolean>(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSaved = (): void => {
    setFlash(true);
    setArchiveNote(false);
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      setFlash(false);
      setArchiveNote(false);
    }, 2000);
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

  if (!ready) {
    return (
      <section className="grabber-view" aria-label={STRINGS.settings.title}>
        <h1>{STRINGS.settings.title}</h1>
        <div className="grabber-card">
          <p className="muted" aria-busy="true">
            {STRINGS.settings.loading}
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
      .catch(() => undefined);
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
    <section className="grabber-view" aria-label={STRINGS.settings.title}>
      <h1>{STRINGS.settings.title}</h1>
      {flash && (
        <p className="note" role="status">
          {STRINGS.settings.saved}
        </p>
      )}
      {archiveNote && (
        <p className="note" role="status">
          {STRINGS.settings.archiveCleared}
        </p>
      )}

      <div className="grabber-card settings-grid">
        <label className="field-label" htmlFor="set-dir" id="settings-section-folder">
          {STRINGS.settings.downloadDir}
        </label>
        <div className="url-row">
          <input
            id="set-dir"
            key={saved.downloadDir}
            className="input"
            defaultValue={saved.downloadDir}
            placeholder={STRINGS.settings.downloadDir}
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
            {STRINGS.settings.browse}
          </button>
        </div>

        <label className="field-label" htmlFor="set-template">
          {STRINGS.settings.filenameTemplate}
        </label>
        <input
          id="set-template"
          key={saved.filenameTemplate}
          className="input"
          defaultValue={saved.filenameTemplate}
          spellCheck={false}
          onBlur={(e) => {
            commitText(e, (v) => ({ filenameTemplate: v }));
          }}
        />
        <div className="chip-row" aria-label={STRINGS.settings.filenamePresets}>
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

        <label className="field-label" htmlFor="set-concurrency">
          {STRINGS.settings.concurrency}
        </label>        <input
          id="set-concurrency"
          key={String(saved.concurrency)}
          className="input"
          type="number"
          min={1}
          max={5}
          defaultValue={saved.concurrency}
          onBlur={(e) => {
            save({ concurrency: Number(e.target.value) });
          }}
        />

        <label className="field-label" htmlFor="set-timeout">
          {STRINGS.settings.analyzeTimeout}
        </label>
        <input
          id="set-timeout"
          key={String(saved.analyzeTimeoutSec)}
          className="input"
          type="number"
          min={10}
          max={300}
          defaultValue={saved.analyzeTimeoutSec}
          onBlur={(e) => {
            save({ analyzeTimeoutSec: Number(e.target.value) });
          }}
        />

        <label className="field-label" htmlFor="set-speed">
          {STRINGS.settings.speedLimit}
        </label>
        <input
          id="set-speed"
          key={saved.speedLimit ?? ""}
          className="input"
          defaultValue={saved.speedLimit ?? ""}
          spellCheck={false}
          onBlur={(e) => {
            commitText(e, (v) => ({ speedLimit: v }));
          }}
        />

        <label className="field-label" htmlFor="set-proxy" id="settings-section-proxy">
          {STRINGS.settings.proxy}
        </label>
        <input
          id="set-proxy"
          key={saved.proxy ?? ""}
          className="input"
          defaultValue={saved.proxy ?? ""}
          spellCheck={false}
          onBlur={(e) => {
            commitText(e, (v) => ({ proxy: v }));
          }}
        />

        <label className="field-label" htmlFor="set-cookies" id="settings-section-cookies">
          {STRINGS.settings.cookies}
        </label>
        <input
          id="set-cookies"
          key={saved.cookiesFromBrowser ?? ""}
          className="input"
          defaultValue={saved.cookiesFromBrowser ?? ""}
          placeholder="chrome"
          spellCheck={false}
          onBlur={(e) => {
            commitText(e, (v) => ({ cookiesFromBrowser: v }));
          }}
        />

        <label className="field-label" htmlFor="set-cookies-file">
          {STRINGS.settings.cookiesFile}
        </label>
        <input
          id="set-cookies-file"
          key={saved.cookiesFile ?? ""}
          className="input"
          defaultValue={saved.cookiesFile ?? ""}
          placeholder="C:\Users\me\cookies.txt"
          spellCheck={false}
          onBlur={(e) => {
            commitText(e, (v) => ({ cookiesFile: v }));
          }}
        />

        <div className="check-col">
          {(
            [
              ["embedThumbnail", STRINGS.settings.embedThumbnail],
              ["embedMetadata", STRINGS.settings.embedMetadata],
              ["subtitles", STRINGS.settings.subtitles],
              ["embedSubs", STRINGS.settings.embedSubs],
              ["sponsorBlock", STRINGS.settings.sponsorBlock],
              ["skipArchived", STRINGS.settings.skipArchived],
              ["thumbnailAccent", STRINGS.settings.thumbnailAccent],
              ["autoCheckUpdate", STRINGS.settings.autoCheckUpdate],
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

        <label className="field-label" htmlFor="set-sublangs">
          {STRINGS.settings.subtitleLangs}
        </label>
        <input
          id="set-sublangs"
          key={saved.subtitleLangs}
          className="input"
          defaultValue={saved.subtitleLangs}
          spellCheck={false}
          onBlur={(e) => {
            commitText(e, (v) => ({ subtitleLangs: v }));
          }}
        />

        <label className="field-label" htmlFor="set-merge">
          {STRINGS.settings.mergeContainer}
        </label>
        <select
          id="set-merge"
          className="input"
          value={saved.mergeContainer}
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

        <label className="field-label" htmlFor="set-codec">
          {STRINGS.settings.codecPreference}
        </label>
        <select
          id="set-codec"
          className="input"
          value={saved.codecPreference}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "auto" || v === "h264" || v === "vp9" || v === "av1") {
              save({ codecPreference: v });
            }
          }}
        >
          <option value="auto">{STRINGS.settings.codecAuto}</option>
          <option value="h264">{STRINGS.settings.codecH264}</option>
          <option value="vp9">{STRINGS.settings.codecVp9}</option>
          <option value="av1">{STRINGS.settings.codecAv1}</option>
        </select>

        <span className="field-label" id="set-theme-label">
          {STRINGS.settings.theme}
        </span>        <div className="chip-row" role="group" aria-labelledby="set-theme-label">
          {(["obsidian", "midnight", "ember"] as const).map((t: ThemeName) => (
            <button
              key={t}
              type="button"
              className="chip"
              aria-pressed={saved.theme === t}
              onClick={() => {
                save({ theme: t });
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <span className="field-label" id="set-density-label">
          {STRINGS.settings.density}
        </span>        <div className="chip-row" role="group" aria-labelledby="set-density-label">
          {(
            [
              ["comfortable", STRINGS.settings.densityComfortable],
              ["compact", STRINGS.settings.densityCompact],
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

        <span className="field-label" id="set-accent-label">
          {STRINGS.settings.accent}
        </span>
        <div className="chip-row" role="group" aria-labelledby="set-accent-label">
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
        <div className="url-row">
          <input
            id="set-accent-custom"
            key={saved.accentOverride ?? "none"}
            className="input"
            defaultValue={saved.accentOverride ?? ""}
            placeholder={STRINGS.settings.accentCustom}
            spellCheck={false}
            aria-label={STRINGS.settings.accentCustom}
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
            {STRINGS.settings.accentReset}
          </button>
        </div>
        {saved.accentOverride !== null &&
          (deriveAccentScale(saved.accentOverride)?.warning ?? false) && (
            <p className="note" role="status">
              {STRINGS.settings.accentWarning}
            </p>
          )}

        <label className="field-label" htmlFor="set-post">
          {STRINGS.settings.postAction}
        </label>        <select
          id="set-post"
          className="input"
          value={saved.postDownloadAction}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "none" || v === "open-file" || v === "reveal") {
              save({ postDownloadAction: v });
            }
          }}
        >
          <option value="none">{STRINGS.settings.postNone}</option>
          <option value="open-file">{STRINGS.settings.postOpen}</option>
          <option value="reveal">{STRINGS.settings.postReveal}</option>
        </select>

        <div>
          <button
            type="button"
            className="btn"
            aria-label={STRINGS.settings.clearArchive}
            onClick={() => {
              if (!window.confirm(STRINGS.settings.archiveConfirm)) return;
              void engine
                .clearArchive()
                .then(() => {
                  flashArchive();
                })
                .catch(() => undefined);
            }}
          >
            {STRINGS.settings.clearArchive}
          </button>
        </div>

        <div>
          <button
            type="button"
            className="btn"
            data-testid="settings-replay"
            onClick={onReplay}
          >
            {STRINGS.onboarding.replay}
          </button>
        </div>
      </div>
    </section>
  );
}

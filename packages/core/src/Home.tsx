import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { AudioPreset, DownloadPreset, MediaInfo, MediaKind, VideoPreset } from "./types.js";
import { isValidUrl } from "./url.js";
import { readClipboardText } from "./clipboard.js";
import { STRINGS } from "./strings.js";
import { pressScale } from "./motion.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";

export interface HomeProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly pendingPaste: string | null;
  readonly onPasteConsumed: () => void;
}

const VIDEO_PRESETS: readonly VideoPreset[] = ["Best", "2160", "1440", "1080", "720", "480"];
const AUDIO_PRESETS: readonly AudioPreset[] = ["MP3", "M4A", "Opus", "FLAC"];

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds)) {
    return STRINGS.home.unknownDuration;
  }
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${String(h)}:` : ""}${mm}:${String(r).padStart(2, "0")}`;
}

export function Home({
  engine,
  queue,
  settings,
  pendingPaste,
  onPasteConsumed,
}: HomeProps): React.JSX.Element {
  const [url, setUrl] = useState<string>("");
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [queueing, setQueueing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [kind, setKind] = useState<MediaKind>("video");
  const [videoPreset, setVideoPreset] = useState<VideoPreset>("1080");
  const [audioPreset, setAudioPreset] = useState<AudioPreset>("MP3");
  const [rawFormat, setRawFormat] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [watchClipboard, setWatchClipboard] = useState<boolean>(false);
  const [queuedNote, setQueuedNote] = useState<string | null>(null);
  const lastIndex = useRef<number | null>(null);
  const urlRef = useRef<string>(url);
  urlRef.current = url;
  const settingsState = useStore(settings, (s) => s.settings);

  useEffect(() => {
    if (!watchClipboard) return;
    const timer = setInterval(() => {
      void readClipboardText().then((text) => {
        if (text === null) return;
        const t = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
        if (t.length > 0 && t !== urlRef.current && isValidUrl(t)) {
          setUrl(t);
        }
      });
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, [watchClipboard]);

  const paste = (): void => {
    void readClipboardText().then((text) => {
      if (text !== null && text.trim().length > 0) {
        setUrl(text.trim());
      } else if (text !== null) {
        setError(STRINGS.home.invalidUrl);
      }
    });
  };

  const analyzeValue = useCallback(
    async (value: string): Promise<void> => {
      setError(null);
      setInfo(null);
      setQueuedNote(null);
      if (!isValidUrl(value)) {
        setError(STRINGS.home.invalidUrl);
        return;
      }
      setAnalyzing(true);
      try {
        const media = await engine.getInfo(value);
        setInfo(media);
        setSelected(media.entries.map((e) => e.id));
        setRawFormat(null);
        lastIndex.current = null;
      } catch {
        setError(STRINGS.home.analyzeFailed);
      } finally {
        setAnalyzing(false);
      }
    },
    [engine],
  );

  const analyze = async (): Promise<void> => {
    await analyzeValue(url);
  };

  useEffect(() => {
    if (pendingPaste === null) return;
    setUrl(pendingPaste);
    onPasteConsumed();
    void analyzeValue(pendingPaste);
  }, [pendingPaste, analyzeValue, onPasteConsumed]);

  const toggleEntry = (id: string, index: number, additive: boolean): void => {
    if (!info) return;
    if (additive && lastIndex.current !== null) {
      const [a, b] =
        lastIndex.current < index ? [lastIndex.current, index] : [index, lastIndex.current];
      const range = info.entries.slice(a, b + 1).map((e) => e.id);
      setSelected((prev) => [...new Set([...prev, ...range])]);
    } else {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }
    lastIndex.current = index;
  };

  const enqueueAll = async (): Promise<void> => {
    if (!info) return;
    setError(null);
    setQueuedNote(null);
    setQueueing(true);
    try {
      const preset: DownloadPreset = { kind, videoPreset, audioPreset, rawFormat };
      const outputDir = settingsState.downloadDir;
      const targets =
        info.isPlaylist && info.entries.length > 0
          ? info.entries.filter((e) => selected.includes(e.id))
          : [{ url: info.url, title: info.title }];
      for (const t of targets) {
        await queue.getState().enqueue({ url: t.url, title: t.title, preset, outputDir });
      }
      setQueuedNote(`${STRINGS.home.queuedToast} (${String(targets.length)})`);
    } catch {
      setError(STRINGS.home.analyzeFailed);
    } finally {
      setQueueing(false);
    }
  };

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const text =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain") ||
      e.dataTransfer.getData("text");
    const first = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.length > 0);
    if (first !== undefined && isValidUrl(first)) setUrl(first);
  };

  const presets = kind === "video" ? VIDEO_PRESETS : AUDIO_PRESETS;

  return (
    <section className="grabber-view" aria-label={STRINGS.home.title}>
      <h1>{STRINGS.home.title}</h1>
      <div
        className="grabber-card"
        aria-busy={analyzing}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={onDrop}
      >
        <label className="field-label" htmlFor="home-url">
          {STRINGS.home.urlLabel}
        </label>
        <div className="url-row">
          <input
            id="home-url"
            className="input"
            placeholder={STRINGS.home.urlPlaceholder}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void analyze();
            }}
            spellCheck={false}
          />
          <button
            type="button"
            className="btn"
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={paste}
          >
            {STRINGS.home.paste}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={analyzing}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              void analyze();
            }}
          >
            {analyzing ? STRINGS.home.analyzing : STRINGS.home.analyze}
          </button>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={watchClipboard}
            onChange={(e) => {
              setWatchClipboard(e.target.checked);
            }}
          />
          {STRINGS.home.watchClipboard}
        </label>
        <p className="hint">{STRINGS.home.dropHint}</p>
        <p className="hint">{STRINGS.home.shortcutsHint}</p>
        {error !== null && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>

      {info !== null && (
        <div className="grabber-card">
          <div className="preview-row">
            {info.thumbnail !== null ? (
              <img
                className="preview-thumb"
                src={info.thumbnail}
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="preview-thumb preview-fallback" aria-hidden="true">
                {info.title.slice(0, 1)}
              </div>
            )}
            <div>
              <h2 className="preview-title">{info.title}</h2>
              {info.uploader !== null && <p className="muted">{info.uploader}</p>}
              <p className="muted">
                {STRINGS.home.previewDuration}: {formatDuration(info.duration)}
              </p>
            </div>
          </div>

          <div className="segmented" role="group" aria-label="media kind">
            {(["video", "audio"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className="chip"
                aria-pressed={kind === k}
                onPointerDown={(e) => {
                  pressScale(e.currentTarget);
                }}
                onClick={() => {
                  setKind(k);
                  setRawFormat(null);
                }}
              >
                {k === "video" ? STRINGS.home.kindVideo : STRINGS.home.kindAudio}
              </button>
            ))}
          </div>
          <div className="chip-row">
            {presets.map((p) => {
              const active = kind === "video" ? videoPreset === p : audioPreset === p;
              return (
                <button
                  key={p}
                  type="button"
                  className="chip"
                  aria-pressed={active}
                  onPointerDown={(e) => {
                    pressScale(e.currentTarget);
                  }}
                  onClick={() => {
                    if (kind === "video") setVideoPreset(p as VideoPreset);
                    else setAudioPreset(p as AudioPreset);
                    setRawFormat(null);
                  }}
                >
                  {p}
                </button>
              );
            })}
          </div>

          {info.formats.length > 0 && (
            <details className="advanced">
              <summary>{STRINGS.home.advancedFormats}</summary>
              <label className="format-row">
                <input
                  type="radio"
                  name="adv-format"
                  checked={rawFormat === null}
                  onChange={() => {
                    setRawFormat(null);
                  }}
                />
                <span>Best (auto)</span>
              </label>
              {info.formats.map((f) => (
                <label key={f.formatId} className="format-row">
                  <input
                    type="radio"
                    name="adv-format"
                    checked={rawFormat === f.formatId}
                    onChange={() => {
                      setRawFormat(f.formatId);
                    }}
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </details>
          )}

          {info.isPlaylist && info.entries.length > 0 && (
            <div className="playlist">
              <div className="playlist-bar">
                <span className="muted">
                  {String(selected.length)}/{String(info.entries.length)}{" "}
                  {STRINGS.home.entriesSelected}
                </span>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    setSelected(info.entries.map((e) => e.id));
                  }}
                >
                  {STRINGS.home.selectAll}
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    setSelected([]);
                  }}
                >
                  {STRINGS.home.selectNone}
                </button>
              </div>
              <ul className="entries">
                {info.entries.map((e, i) => (
                  <li key={e.id}>
                    <label className="format-row">
                      <input
                        type="checkbox"
                        checked={selected.includes(e.id)}
                        onChange={() => undefined}
                        onClick={(ev) => {
                          toggleEntry(e.id, i, ev.shiftKey);
                        }}
                      />
                      <span>{e.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="hint">{STRINGS.home.playlistPresetNote}</p>
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={queueing}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              void enqueueAll();
            }}
          >
            {info.isPlaylist && info.entries.length > 0
              ? STRINGS.home.queueSelected
              : STRINGS.home.queueSingle}
          </button>
          {queuedNote !== null && (
            <p className="note" role="status">
              {queuedNote}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

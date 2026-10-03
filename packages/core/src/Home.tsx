import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type {
  AudioPreset,
  CodecPreference,
  DownloadJob,
  DownloadPreset,
  MediaInfo,
  MediaKind,
  VideoPreset,
} from "./types.js";
import { isValidUrl, normalizeUrl } from "./url.js";
import { estimatePresetSize, formatSize } from "./media.js";
import { deriveAccent } from "./color.js";
import { LruCache } from "./cache.js";
import { readClipboardText } from "./clipboard.js";
import { STRINGS } from "./strings.js";
import { pressScale, tweenAccentVar } from "./motion.js";
import { BatchPanel } from "./BatchPanel.js";
import { useDuplicateGuard } from "./DuplicatePrompt.js";
import type { GuardInput } from "./identity.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";

export interface HomeProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly pendingPaste: string | null;
  readonly onPasteConsumed: () => void;
}

const VIDEO_PRESETS: readonly VideoPreset[] = [
  "Compatible",
  "Best",
  "2160",
  "1440",
  "1080",
  "720",
  "480",
];
const AUDIO_PRESETS: readonly AudioPreset[] = ["MP3", "M4A", "Opus", "FLAC"];

function presetLabel(kind: MediaKind, preset: VideoPreset | AudioPreset): string {
  if (kind === "video" && preset === "Compatible") return STRINGS.home.presetCompatible;
  return preset;
}

function estimateText(
  info: MediaInfo,
  preset: DownloadPreset,
  codecPref: CodecPreference,
): string {
  const est = estimatePresetSize(info, preset, codecPref);
  if (est === null) return STRINGS.home.sizeUnknown;
  return `~${formatSize(est.bytes)}`;
}

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
  const [kind, setKind] = useState<MediaKind>(() => settings.getState().settings.defaultPreset.kind);
  const [videoPreset, setVideoPreset] = useState<VideoPreset>(
    () => settings.getState().settings.defaultPreset.videoPreset,
  );
  const [audioPreset, setAudioPreset] = useState<AudioPreset>(
    () => settings.getState().settings.defaultPreset.audioPreset,
  );
  const [rawFormat, setRawFormat] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [watchClipboard, setWatchClipboard] = useState<boolean>(false);
  const [queuedNote, setQueuedNote] = useState<string | null>(null);
  const { guard, dialog: duplicateDialog } = useDuplicateGuard();
  const analyzeCache = useRef(new LruCache<MediaInfo>(30, 10 * 60 * 1000));
  const analyzeReq = useRef<string | null>(null);
  const cancelledReqs = useRef<Set<string>>(new Set());
  const previewRef = useRef<HTMLDivElement | null>(null);
  const lastAccent = useRef<string | null>(null);
  const [thumbAccent, setThumbAccent] = useState<string | null>(null);
  const lastIndex = useRef<number | null>(null);
  const urlRef = useRef<string>(url);
  urlRef.current = url;
  const settingsState = useStore(settings, (s) => s.settings);

  const cssVar = (name: string, fallback: string): string => {
    if (typeof document === "undefined") return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };

  const applyThumbAccent = useCallback(
    async (thumbnail: string | null): Promise<void> => {
      const el = previewRef.current;
      if (thumbnail === null || !settingsState.thumbnailAccent || el === null) {
        lastAccent.current = null;
        setThumbAccent(null);
        return;
      }
      try {
        const rgb = await engine.getThumbnailColor(thumbnail);
        if (rgb === null || previewRef.current !== el) {
          return;
        }
        const hex = deriveAccent(rgb, [cssVar("--bg-1", "#121214"), cssVar("--bg-0", "#0a0a0b")]);
        tweenAccentVar(el, "--thumb-accent", lastAccent.current, hex);
        lastAccent.current = hex;
        setThumbAccent(hex);
      } catch {
        lastAccent.current = null;
        setThumbAccent(null);
      }
    },
    [engine, settingsState.thumbnailAccent],
  );

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
    async (value: string, opts: { force?: boolean } = {}): Promise<void> => {
      setError(null);
      setQueuedNote(null);
      let key: string;
      try {
        key = normalizeUrl(value);
      } catch {
        setError(STRINGS.home.invalidUrl);
        return;
      }
      if (!opts.force) {
        const cached = analyzeCache.current.get(key);
        if (cached !== null) {
          setInfo(cached);
          setSelected(cached.entries.map((e) => e.id));
          setRawFormat(null);
          lastIndex.current = null;
          void applyThumbAccent(cached.thumbnail);
          return;
        }
      } else {
        analyzeCache.current.delete(key);
      }
      setInfo(null);
      lastAccent.current = null;
      setThumbAccent(null);
      setAnalyzing(true);
      const requestId = crypto.randomUUID();
      analyzeReq.current = requestId;
      try {
        const media = await engine.getInfo(value, { requestId });
        if (analyzeReq.current !== requestId) return;
        analyzeCache.current.set(key, media);
        setInfo(media);
        setSelected(media.entries.map((e) => e.id));
        setRawFormat(null);
        lastIndex.current = null;
        void applyThumbAccent(media.thumbnail);
      } catch (err) {
        if (analyzeReq.current !== requestId) return;
        if (cancelledReqs.current.has(requestId)) {
          cancelledReqs.current.delete(requestId);
          return;
        }
        setError(
          err instanceof Error && err.message.length > 0
            ? err.message
            : STRINGS.home.analyzeFailed,
        );
      } finally {
        if (analyzeReq.current === requestId) {
          analyzeReq.current = null;
          setAnalyzing(false);
        }
      }
    },
    [engine, applyThumbAccent],
  );

  const cancelAnalyze = useCallback((): void => {
    const id = analyzeReq.current;
    if (id === null) return;
    cancelledReqs.current.add(id);
    analyzeReq.current = null;
    setAnalyzing(false);
    void engine.cancelAnalyze(id).catch(() => undefined);
  }, [engine]);

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
      const playlist = info.isPlaylist && info.entries.length > 0;
      const rawTargets =
        playlist
          ? info.entries
              .filter((e) => selected.includes(e.id))
              .map((e) => ({ url: e.url, title: e.title }))
          : [{ url: info.url, title: info.title }];
      const inputs: GuardInput[] = rawTargets.map((t) => ({
        url: t.url,
        title: t.title,
        extractor: playlist ? null : info.extractor,
        videoId: playlist ? null : info.videoId,
        fromPlaylist: playlist,
      }));
      let history: DownloadJob[] = [];
      try {
        history = await engine.loadHistory();
      } catch {
        history = [];
      }
      const guarded = await guard(inputs, {
        queueJobs: queue.getState().jobs,
        historyJobs: history,
        fileExists: (p) => engine.fileExists(p),
        onOpen: (p) => engine.openPath(p),
      });
      let count = 0;
      for (const t of guarded) {
        await queue.getState().enqueue({
          url: t.url,
          title: t.title,
          preset,
          outputDir,
          extractor: t.extractor,
          videoId: t.videoId,
          ...(t.fromPlaylist && settingsState.skipArchived && !t.forceFresh
            ? { useArchive: true as const }
            : {}),
        });
        count += 1;
      }
      setQueuedNote(`${STRINGS.home.queuedToast} (${String(count)})`);
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
              if (e.key === "Escape") cancelAnalyze();
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
          {analyzing && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                cancelAnalyze();
              }}
            >
              {STRINGS.home.cancelAnalyze}
            </button>
          )}
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

      <BatchPanel engine={engine} queue={queue} settings={settings} />

      {analyzing && info === null && (
        <div className="grabber-card" aria-busy="true">
          <p className="muted" role="status">
            {STRINGS.home.analyzing}
          </p>
          <div className="skeleton skeleton-title" aria-hidden="true" />
          <div className="skeleton skeleton-line" aria-hidden="true" />
          <div className="skeleton skeleton-line" aria-hidden="true" />
          <div className="skeleton skeleton-chips" aria-hidden="true" />
        </div>
      )}

      {info !== null && (
        <div
          className="grabber-card"
          ref={previewRef}
          data-accent={thumbAccent !== null ? "true" : undefined}
          style={
            thumbAccent !== null
              ? ({ "--thumb-accent": thumbAccent } as React.CSSProperties)
              : undefined
          }
        >
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
              const rowPreset: DownloadPreset =
                kind === "video"
                  ? { kind, videoPreset: p as VideoPreset, audioPreset, rawFormat: null }
                  : { kind, videoPreset, audioPreset: p as AudioPreset, rawFormat: null };
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
                  {presetLabel(kind, p)}{" "}
                  <span className="chip-size">
                    {estimateText(info, rowPreset, settingsState.codecPreference)}
                  </span>
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
                  <span className="muted">
                    {f.filesize !== null ? `~${formatSize(f.filesize)}` : STRINGS.home.sizeUnknown}
                  </span>
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
          <button
            type="button"
            className="btn btn-small"
            disabled={analyzing}
            onClick={() => {
              void analyzeValue(url, { force: true });
            }}
          >
            {STRINGS.home.reanalyze}
          </button>
          {queuedNote !== null && (
            <p className="note" role="status">
              {queuedNote}
            </p>
          )}
        </div>
      )}
      {duplicateDialog}
    </section>
  );
}

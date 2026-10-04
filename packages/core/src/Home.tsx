import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type {
  AudioPreset,
  ChapterInfo,
  CodecPreference,
  DownloadJob,
  DownloadPreset,
  MediaInfo,
  MediaKind,
  PlaylistEntry,
  VideoPreset,
} from "./types.js";
import type { Strings } from "./strings.js";
import { isValidUrl, normalizeUrl } from "./url.js";
import { estimatePresetSize, formatSize } from "./media.js";
import { deriveAccent } from "./color.js";
import { LruCache } from "./cache.js";
import { readClipboardText } from "./clipboard.js";
import { formatStr, localeTag, resolveLanguage, useStrings } from "./locale.js";
import { pressScale, tweenAccentVar } from "./motion.js";
import { BatchPanel } from "./BatchPanel.js";
import { parseBatchText } from "./batch.js";
import { useDuplicateGuard } from "./DuplicatePrompt.js";
import type { GuardInput } from "./identity.js";
import { identityKey } from "./identity.js";
import { deriveEntryStates, sanitizePlaylistTitle, type EntryState } from "./playlist.js";
import {
  defaultAudioMetadata,
  hasAudioMetadata,
  isAudioPreset,
  type AudioMetadata,
} from "./metadata.js";
import { VirtualList } from "./VirtualList.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";

export interface HomeProps {
  readonly engine: DownloadEngine;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  readonly pendingPaste: string | null;
  readonly onPasteConsumed: () => void;
  /** Multiline text routed from global paste/drop (goes to Batch). */
  readonly pendingBatch?: string | null;
  readonly onBatchConsumed?: () => void;
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

function presetLabel(
  strings: Strings,
  kind: MediaKind,
  preset: VideoPreset | AudioPreset,
): string {
  if (kind === "video" && preset === "Compatible") return strings.home.presetCompatible;
  return preset;
}

function estimateText(
  strings: Strings,
  locale: string,
  info: MediaInfo,
  preset: DownloadPreset,
  codecPref: CodecPreference,
): string {
  const est = estimatePresetSize(info, preset, codecPref);
  if (est === null) return strings.home.sizeUnknown;
  return `~${formatSize(est.bytes, locale)}`;
}

export function formatDuration(strings: Strings, totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds)) {
    return strings.home.unknownDuration;
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
  pendingBatch = null,
  onBatchConsumed,
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
  const [hideDownloaded, setHideDownloaded] = useState<boolean>(false);
  const [entryFilter, setEntryFilter] = useState<string>("");
  const [entryStates, setEntryStates] = useState<Map<string, EntryState> | null>(null);
  const [checkingEntries, setCheckingEntries] = useState<boolean>(false);
  const [entryPresets, setEntryPresets] = useState<Record<string, DownloadPreset>>({});
  const [liveFromStart, setLiveFromStart] = useState<boolean>(false);
  const [waitForVideo, setWaitForVideo] = useState<boolean>(true);
  const [splitChapters, setSplitChapters] = useState<boolean>(false);
  const [metaEditor, setMetaEditor] = useState<AudioMetadata | null>(null);
  const settingsState = useStore(settings, (s) => s.settings);
  const S = useStrings(settings);
  const locale = localeTag(resolveLanguage(settingsState.language));
  const { guard, dialog: duplicateDialog } = useDuplicateGuard(S, locale);
  const analyzeCache = useRef(new LruCache<MediaInfo>(30, 10 * 60 * 1000));
  const analyzeReq = useRef<string | null>(null);
  const cancelledReqs = useRef<Set<string>>(new Set());
  const previewRef = useRef<HTMLDivElement | null>(null);
  const lastAccent = useRef<string | null>(null);
  const [thumbAccent, setThumbAccent] = useState<string | null>(null);
  const lastIndex = useRef<number | null>(null);
  const urlRef = useRef<string>(url);
  urlRef.current = url;

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

  // Multiline input routing: 0-1 valid URLs stay here, 2+ go to Batch.
  // Returns true when the text was routed to Batch (caller: show nothing else).
  const [batchSeed, setBatchSeed] = useState<string | null>(null);
  const routeText = useCallback(
    (text: string): boolean => {
      const valid = parseBatchText(text).valid;
      if (valid.length >= 2) {
        setError(null);
        setBatchSeed(text);
        setQueuedNote(formatStr(S.home.multiToBatch, { count: valid.length }));
        return true;
      }
      return false;
    },
    [S],
  );

  useEffect(() => {
    if (!watchClipboard) return;
    const timer = setInterval(() => {
      void readClipboardText().then((text) => {
        if (text === null) return;
        // Auto-watch fills single links only; multi-link clipboards are
        // left alone (the user routes those deliberately via Paste/Ctrl+V).
        const first = parseBatchText(text).valid[0]?.url ?? "";
        if (first.length > 0 && first !== urlRef.current) {
          setUrl(first);
        }
      });
    }, 2000);
    return () => {
      clearInterval(timer);
    };
  }, [watchClipboard]);

  const paste = (): void => {
    void readClipboardText().then((text) => {
      if (text === null || text.trim().length === 0) {
        setError(S.home.invalidUrl);
        return;
      }
      if (routeText(text)) return;
      const first = parseBatchText(text).valid[0]?.url ?? text.trim();
      if (isValidUrl(first)) setUrl(first);
      else setError(S.home.invalidUrl);
    });
  };

  const refreshEntryStates = useCallback(
    async (media: MediaInfo): Promise<void> => {
      if (!media.isPlaylist || media.entries.length === 0) {
        setEntryStates(null);
        return;
      }
      setCheckingEntries(true);
      try {
        const keys = media.entries.map((e) => {
          try {
            return identityKey({ url: e.url, extractor: media.extractor, videoId: e.id });
          } catch {
            return e.url;
          }
        });
        const [archivedArr, history] = await Promise.all([
          engine.archiveHas(keys).catch(() => keys.map(() => false)),
          engine.loadHistory().catch(() => [] as DownloadJob[]),
        ]);
        const archived = new Set<string>();
        keys.forEach((k, i) => {
          if (archivedArr[i] === true) archived.add(k);
        });
        const dests = [
          ...new Set(
            history.map((h) => h.destination).filter((d): d is string => d !== null),
          ),
        ];
        const existsArr =
          dests.length > 0
            ? await engine.fileExistsBulk(dests).catch(() => dests.map(() => false))
            : [];
        const existsByDestination = new Map<string, boolean>();
        dests.forEach((d, i) => {
          existsByDestination.set(d, existsArr[i] ?? false);
        });
        setEntryStates(
          deriveEntryStates(media.entries, media.extractor, archived, history, existsByDestination),
        );
      } finally {
        setCheckingEntries(false);
      }
    },
    [engine],
  );

  const analyzeValue = useCallback(
    async (value: string, opts: { force?: boolean } = {}): Promise<void> => {
      setError(null);
      setQueuedNote(null);
      let key: string;
      try {
        key = normalizeUrl(value);
      } catch {
        setError(S.home.invalidUrl);
        return;
      }
      if (!opts.force) {
        const cached = analyzeCache.current.get(key);
        if (cached !== null) {
          setInfo(cached);
          setSelected(cached.entries.map((e) => e.id));
          setRawFormat(null);
          setEntryStates(null);
          setEntryPresets({});
          setSplitChapters(false);
          setMetaEditor(defaultAudioMetadata(cached));
          lastIndex.current = null;
          void applyThumbAccent(cached.thumbnail);
          void refreshEntryStates(cached);
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
        setEntryStates(null);
        setEntryPresets({});
        setSplitChapters(false);
        lastIndex.current = null;
        void applyThumbAccent(media.thumbnail);
        void refreshEntryStates(media);
      } catch (err) {
        if (analyzeReq.current !== requestId) return;
        if (cancelledReqs.current.has(requestId)) {
          cancelledReqs.current.delete(requestId);
          return;
        }
        setError(
          err instanceof Error && err.message.length > 0
            ? err.message
            : S.home.analyzeFailed,
        );
      } finally {
        if (analyzeReq.current === requestId) {
          analyzeReq.current = null;
          setAnalyzing(false);
        }
      }
    },
    [engine, applyThumbAccent, refreshEntryStates, S],
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
    // Defensive: a multiline paste reaching here is routed to Batch.
    if (routeText(pendingPaste)) {
      onPasteConsumed();
      return;
    }
    setUrl(pendingPaste);
    onPasteConsumed();
    void analyzeValue(pendingPaste);
  }, [pendingPaste, analyzeValue, onPasteConsumed, routeText]);

  useEffect(() => {
    if (pendingBatch === null) return;
    routeText(pendingBatch);
    onBatchConsumed?.();
  }, [pendingBatch, onBatchConsumed, routeText]);

  const consumeSeed = useCallback((): void => {
    setBatchSeed(null);
  }, []);

  const visibleEntries = useMemo(() => {
    if (info === null || !info.isPlaylist) return [];
    const q = entryFilter.trim().toLowerCase();
    return info.entries.filter((e) => {
      if (q.length > 0 && !e.title.toLowerCase().includes(q)) return false;
      if (hideDownloaded) {
        const st = entryStates?.get(e.id);
        if (st !== undefined && (st.archived || st.exists)) return false;
      }
      return true;
    });
  }, [info, entryFilter, hideDownloaded, entryStates]);

  const chapters = useMemo<readonly ChapterInfo[]>(
    () =>
      info !== null && !info.isPlaylist && info.chapters !== undefined && info.chapters !== null
        ? info.chapters
        : [],
    [info],
  );
  const hasChapters = chapters.length > 0;

  const toggleEntry = (id: string, index: number, additive: boolean): void => {
    if (!info) return;
    const pool = visibleEntries;
    if (additive && lastIndex.current !== null) {
      const [a, b] =
        lastIndex.current < index ? [lastIndex.current, index] : [index, lastIndex.current];
      const range = pool.slice(a, b + 1).map((e) => e.id);
      setSelected((prev) => [...new Set([...prev, ...range])]);
    } else {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }
    lastIndex.current = index;
  };

  const renderEntryRow = (e: PlaylistEntry, i: number): React.JSX.Element => {
    const st = entryStates?.get(e.id);
    const downloaded = st !== undefined && (st.archived || st.exists);
    const override = entryPresets[e.id] ?? null;
    const overrideValue =
      override === null
        ? "global"
        : override.kind === "video"
          ? `v:${override.videoPreset}`
          : `a:${override.audioPreset}`;
    return (
      <label className="format-row entry-row">
        <input
          type="checkbox"
          checked={selected.includes(e.id)}
          onChange={() => undefined}
          onClick={(ev) => {
            toggleEntry(e.id, i, ev.shiftKey);
          }}
        />
        <span className="entry-title" title={e.title}>
          {e.title}
        </span>
        {downloaded && <span className="badge">{S.playlist.downloaded}</span>}
        <select
          className="input"
          aria-label={S.batch.presetLabel}
          value={overrideValue}
          onChange={(sel) => {
            const v = sel.target.value;
            if (v === "global") {
              setEntryPresets((prev) => {
                const next: Record<string, DownloadPreset> = {};
                for (const [pid, p] of Object.entries(prev)) {
                  if (pid !== e.id) next[pid] = p;
                }
                return next;
              });
              return;
            }
            const [kkind, name] = v.split(":");
            if (kkind === "v" && name !== undefined) {
              setEntryPresets((prev) => ({
                ...prev,
                [e.id]: { kind: "video", videoPreset: name as VideoPreset, audioPreset: "MP3", rawFormat: null },
              }));
            } else if (kkind === "a" && name !== undefined) {
              setEntryPresets((prev) => ({
                ...prev,
                [e.id]: { kind: "audio", videoPreset: "Best", audioPreset: name as AudioPreset, rawFormat: null },
              }));
            }
          }}
        >
          <option value="global">{S.batch.useGlobalPreset}</option>
          {VIDEO_PRESETS.map((p) => (
            <option key={`v:${p}`} value={`v:${p}`}>
              {p}
            </option>
          ))}
          {AUDIO_PRESETS.map((p) => (
            <option key={`a:${p}`} value={`a:${p}`}>
              {p}
            </option>
          ))}
        </select>
      </label>
    );
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
      const subdir =
        playlist && settingsState.playlistSubfolder
          ? sanitizePlaylistTitle(info.title)
          : null;
      const rawTargets = playlist
        ? info.entries
            .filter((e) => selected.includes(e.id))
            .map((e) => ({ url: e.url, title: e.title, entryId: e.id }))
        : [{ url: info.url, title: info.title, entryId: null as string | null }];
      const inputs: GuardInput[] = rawTargets.map((t) => ({
        url: t.url,
        title: t.title,
        extractor: info.extractor,
        videoId: playlist ? t.entryId : info.videoId,
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
        const entryId = playlist
          ? (info.entries.find((e) => e.url === t.url)?.id ?? null)
          : null;
        const rowPreset =
          entryId !== null ? (entryPresets[entryId] ?? preset) : preset;
        await queue.getState().enqueue({
          url: t.url,
          title: t.title,
          preset: rowPreset,
          outputDir,
          extractor: t.extractor,
          videoId: t.videoId,
          ...(t.fromPlaylist && settingsState.skipArchived && !t.forceFresh
            ? { useArchive: true as const }
            : {}),
          // "Download anyway" on an already-downloaded video must refetch:
          // without this yt-dlp sees the existing file and exits 0 having
          // downloaded nothing (M4.8).
          ...(t.forceFresh ? { forceOverwrite: true as const } : {}),
          ...(subdir !== null ? { playlistSubdir: subdir } : {}),
          ...(info.liveStatus !== undefined && info.liveStatus !== null
            ? { liveStatus: info.liveStatus }
            : {}),
          ...(info.liveStatus === "is_live" && liveFromStart ? { liveFromStart: true } : {}),
          ...(info.liveStatus === "is_upcoming" && waitForVideo ? { waitForVideo: true } : {}),
          ...(splitChapters && hasChapters ? { splitChapters: true } : {}),
          // M4.3: only audio jobs carry tag overrides, and only when at
          // least one field is filled in.
          ...(isAudioPreset(rowPreset) && hasAudioMetadata(metaEditor)
            ? { audioMetadata: metaEditor }
            : {}),
          // M4.5: uploader/duration ride along for the stats screen.
          ...(info.uploader !== null ? { uploader: info.uploader } : {}),
          ...(info.duration !== null ? { durationSec: info.duration } : {}),
        });
        count += 1;
      }
      setQueuedNote(formatStr(S.home.queuedToast, { count }));
    } catch {
      setError(S.home.analyzeFailed);
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
    if (text.trim().length === 0) return;
    if (routeText(text)) return;
    const first = parseBatchText(text).valid[0]?.url;
    if (first !== undefined && isValidUrl(first)) setUrl(first);
  };

  const presets = kind === "video" ? VIDEO_PRESETS : AUDIO_PRESETS;

  return (
    <section className="grabber-view" aria-label={S.home.title}>
      <h1>{S.home.title}</h1>
      <div
        className="grabber-card"
        aria-busy={analyzing}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={onDrop}
      >
        <label className="field-label" htmlFor="home-url">
          {S.home.urlLabel}
        </label>
        <div className="url-row">
          <input
            id="home-url"
            className="input"
            placeholder={S.home.urlPlaceholder}
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
            {S.home.paste}
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
            {analyzing ? S.home.analyzing : S.home.analyze}
          </button>
          {analyzing && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                cancelAnalyze();
              }}
            >
              {S.home.cancelAnalyze}
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
          {S.home.watchClipboard}
        </label>
        <p className="hint">{S.home.dropHint}</p>
        <p className="hint">{S.home.shortcutsHint}</p>
        {error !== null && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>

      <BatchPanel
        engine={engine}
        queue={queue}
        settings={settings}
        seedText={batchSeed}
        onSeedConsumed={consumeSeed}
      />

      {analyzing && info === null && (
        <div className="grabber-card" aria-busy="true">
          <p className="muted" role="status">
            {S.home.analyzing}
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
              <div className="preview-title-row">
                <h2 className="preview-title">{info.title}</h2>
                {info.liveStatus === "is_live" && (
                  <span className="badge badge-live">{S.home.liveBadge}</span>
                )}
                {info.liveStatus === "is_upcoming" && (
                  <span className="badge badge-upcoming">{S.home.upcomingBadge}</span>
                )}
                {info.liveStatus === "was_live" && (
                  <span className="badge badge-was-live">{S.home.wasLiveBadge}</span>
                )}
              </div>
              {info.uploader !== null && <p className="muted">{info.uploader}</p>}
              <p className="muted">
                {S.home.previewDuration}: {formatDuration(S, info.duration)}
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
                {k === "video" ? S.home.kindVideo : S.home.kindAudio}
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
                  {presetLabel(S, kind, p)}{" "}
                  <span className="chip-size">
                    {estimateText(S, locale, info, rowPreset, settingsState.codecPreference)}
                  </span>
                </button>
              );
            })}
          </div>

          {info.liveStatus === "is_live" && (
            <div className="chip-row">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={liveFromStart}
                  onChange={(e) => {
                    setLiveFromStart(e.target.checked);
                  }}
                />
                {S.home.liveFromStart}
              </label>
            </div>
          )}
          {info.liveStatus === "is_upcoming" && (
            <div className="chip-row">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={waitForVideo}
                  onChange={(e) => {
                    setWaitForVideo(e.target.checked);
                  }}
                />
                {S.home.waitForVideo}
              </label>
            </div>
          )}

          {hasChapters && (
            <>
              <div className="chip-row">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={splitChapters}
                    onChange={(e) => {
                      setSplitChapters(e.target.checked);
                    }}
                  />
                  {S.home.splitChapters}
                </label>
                <span className="muted">
                  {formatStr(S.home.chaptersCount, { count: chapters.length })}
                </span>
              </div>
              {splitChapters && (
                <details className="advanced">
                  <summary>
                    {formatStr(S.home.chaptersList, { count: chapters.length })}
                  </summary>
                  <ul className="chapter-list">
                    {chapters.map((ch) => (
                      <li key={`${String(ch.startTime)}-${ch.title}`} className="chapter-row">
                        <span className="chapter-time">
                          {formatDuration(S, ch.startTime)}
                        </span>
                        <span className="chapter-title">{ch.title}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          {/* M4.3: audio tag editor. Playlists are excluded: one title/artist
              pair cannot describe N entries. */}
          {metaEditor !== null && kind === "audio" && rawFormat === null && !info.isPlaylist && (
            <details className="advanced" data-testid="meta-editor">
              <summary>{S.home.metadata}</summary>
              <div className="meta-grid">
                {(
                  [
                    ["title", S.home.metaTitle, "meta-title"],
                    ["artist", S.home.metaArtist, "meta-artist"],
                    ["album", S.home.metaAlbum, "meta-album"],
                    ["year", S.home.metaYear, "meta-year"],
                  ] as const
                ).map(([key, label, testid]) => (
                  <label key={key} className="meta-field">
                    <span className="field-label">{label}</span>
                    <input
                      type="text"
                      className="input"
                      data-testid={testid}
                      value={metaEditor[key]}
                      maxLength={200}
                      onChange={(e) => {
                        const next = e.target.value;
                        setMetaEditor({ ...metaEditor, [key]: next });
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="hint">{S.home.metadataHint}</p>
            </details>
          )}


          {info.formats.length > 0 && (
            <details className="advanced">
              <summary>{S.home.advancedFormats}</summary>
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
                    {f.filesize !== null ? `~${formatSize(f.filesize, locale)}` : S.home.sizeUnknown}
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
                  {S.home.entriesSelected}
                </span>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    setSelected(info.entries.map((e) => e.id));
                  }}
                >
                  {S.home.selectAll}
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    setSelected([]);
                  }}
                >
                  {S.home.selectNone}
                </button>
              </div>
              <div className="chip-row">
                <input
                  className="input"
                  placeholder={S.playlist.filterPlaceholder}
                  aria-label={S.playlist.filterPlaceholder}
                  value={entryFilter}
                  spellCheck={false}
                  onChange={(e) => {
                    setEntryFilter(e.target.value);
                  }}
                />
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={hideDownloaded}
                    onChange={(e) => {
                      setHideDownloaded(e.target.checked);
                    }}
                  />
                  {S.playlist.hideDownloaded}
                </label>
                {checkingEntries && <span className="muted">{S.playlist.checking}</span>}
              </div>
              {visibleEntries.length >= 200 ? (
                <VirtualList
                  items={visibleEntries}
                  rowHeight={44}
                  height={440}
                  ariaLabel={S.home.entriesSelected}
                  keyOf={(e) => e.id}
                  renderRow={(e, i) => renderEntryRow(e, i)}
                />
              ) : (
                <ul className="entries">
                  {visibleEntries.map((e, i) => (
                    <li key={e.id}>{renderEntryRow(e, i)}</li>
                  ))}
                </ul>
              )}
              <p className="hint">{S.home.playlistPresetNote}</p>
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
              ? S.home.queueSelected
              : S.home.queueSingle}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={analyzing}
            onClick={() => {
              void analyzeValue(url, { force: true });
            }}
          >
            {S.home.reanalyze}
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

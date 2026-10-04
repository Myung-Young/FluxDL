import { useEffect, useRef, useState } from "react";
import { readClipboardText } from "./clipboard.js";
import { autoSortSubdir } from "./destination.js";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type {
  AudioPreset,
  DownloadJob,
  DownloadPreset,
  MediaInfo,
  MediaKind,
  VideoPreset,
} from "./types.js";
import type { Strings } from "./strings.js";
import { pressScale } from "./motion.js";
import { formatStr, localeTag, resolveLanguage, useStrings } from "./locale.js";
import { LruCache } from "./cache.js";
import { sanitizePlaylistTitle } from "./playlist.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
import { useDuplicateGuard } from "./DuplicatePrompt.js";
import type { GuardInput } from "./identity.js";
import {
  MAX_BATCH_BYTES,
  addBatchEntries,
  expandPlaylistEntry,
  parseBatchText,
  removeBatchEntry,
  retryBatchEntries,
  updateBatchEntry,
  type BatchEntry,
  type BatchStatus,
} from "./batch.js";

export interface BatchPanelProps {
  readonly engine: Pick<
    DownloadEngine,
    "getInfo" | "cancelAnalyze" | "loadHistory" | "fileExists" | "openPath"
  >;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
  /** Externally-routed text (multiline paste / drop). Ingested once, then consumed. */
  readonly seedText?: string | null;
  readonly onSeedConsumed?: () => void;
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

function statusLabel(strings: Strings, status: BatchStatus): string {
  switch (status) {
    case "pending":
      return strings.batch.statusPending;
    case "analyzing":
      return strings.batch.statusAnalyzing;
    case "ready":
      return strings.batch.statusReady;
    case "failed":
      return strings.batch.statusFailed;
  }
}

function presetName(strings: Strings, preset: VideoPreset | AudioPreset): string {
  return preset === "Compatible" ? strings.home.presetCompatible : preset;
}

function overrideValue(preset: DownloadPreset | null): string {
  if (preset === null) return "global";
  return preset.kind === "video" ? `v:${preset.videoPreset}` : `a:${preset.audioPreset}`;
}

function overrideFromValue(value: string): DownloadPreset | null {
  if (value === "global") return null;
  const [kind, name] = value.split(":");
  if (kind === "v" && (VIDEO_PRESETS as readonly string[]).includes(name ?? "")) {
    return {
      kind: "video",
      videoPreset: name as VideoPreset,
      audioPreset: "MP3",
      rawFormat: null,
    };
  }
  if (kind === "a" && (AUDIO_PRESETS as readonly string[]).includes(name ?? "")) {
    return { kind: "audio", videoPreset: "Best", audioPreset: name as AudioPreset, rawFormat: null };
  }
  return null;
}

export function BatchPanel({
  engine,
  queue,
  settings,
  seedText = null,
  onSeedConsumed,
}: BatchPanelProps): React.JSX.Element {
  const [entries, setEntriesState] = useState<readonly BatchEntry[]>([]);
  // Unsent draft survives restarts (D8): seeded on boot, saved debounced.
  const [text, setText] = useState<string>(() => settings.getState().settings.batchDraft);

  useEffect(() => {
    const timer = setTimeout(() => {
      void settings.getState().save({ batchDraft: text }).catch(() => undefined);
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [text, settings]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [queueing, setQueueing] = useState<boolean>(false);
  const [kind, setKind] = useState<MediaKind>(() => settings.getState().settings.defaultPreset.kind);
  const [videoPreset, setVideoPreset] = useState<VideoPreset>(
    () => settings.getState().settings.defaultPreset.videoPreset,
  );
  const [audioPreset, setAudioPreset] = useState<AudioPreset>(
    () => settings.getState().settings.defaultPreset.audioPreset,
  );
  const entriesRef = useRef<readonly BatchEntry[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const settingsState = useStore(settings, (s) => s.settings);
  const S = useStrings(settings);
  const { guard, dialog: duplicateDialog } = useDuplicateGuard(
    S,
    localeTag(resolveLanguage(settingsState.language)),
  );
  const analyzeCache = useRef(new LruCache<MediaInfo>(30, 10 * 60 * 1000));
  const inFlight = useRef(new Map<string, string>());
  const cancelledReqs = useRef<Set<string>>(new Set());

  const setEntries = (next: readonly BatchEntry[]): void => {
    entriesRef.current = next;
    setEntriesState(next);
  };

  const ingestRef = useRef<(raw: string) => void>(() => undefined);

  const globalPreset: DownloadPreset = { kind, videoPreset, audioPreset, rawFormat: null };

  const ingest = (raw: string): void => {
    const parsed = parseBatchText(raw);
    setEntries(addBatchEntries(entriesRef.current, parsed.valid));
    const parts: string[] = [];
    if (parsed.invalid.length > 0) {
      parts.push(formatStr(S.batch.invalidSkipped, { n: parsed.invalid.length }));
    }
    if (parsed.duplicates > 0) {
      parts.push(formatStr(S.batch.duplicatesSkipped, { n: parsed.duplicates }));
    }
    if (parsed.truncated) parts.push(S.batch.truncatedNote);
    setNote(parts.length > 0 ? parts.join(" ") : null);
  };

  ingestRef.current = ingest;
  // External routing (multiline paste / window drop): ingest once.
  useEffect(() => {
    if (seedText === null) return;
    ingestRef.current(seedText);
    onSeedConsumed?.();
    // Consumed by the parent flipping seedText back to null; the ref call
    // keeps this effect stable across renders (no ingest dep).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedText]);

  const ingestFile = (file: File | null): void => {
    if (file === null) return;
    if (file.size > MAX_BATCH_BYTES) {
      setNote(S.batch.fileTooBig);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") ingest(reader.result);
    };
    reader.readAsText(file);
  };

  const analyzeStatuses = async (statuses: readonly BatchStatus[]): Promise<void> => {
    const keys = entriesRef.current
      .filter((e) => statuses.includes(e.status))
      .map((e) => e.key);
    if (keys.length === 0) return;
    setBusy(true);
    try {
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const key = keys[next];
          next += 1;
          if (key === undefined) return;
          const entry = entriesRef.current.find((e) => e.key === key);
          if (entry === undefined) continue;
          const cached = analyzeCache.current.get(entry.url);
          if (cached !== null) {
            setEntries(
              updateBatchEntry(entriesRef.current, key, {
                status: "ready",
                info: cached,
                error: null,
              }),
            );
            continue;
          }
          setEntries(updateBatchEntry(entriesRef.current, key, { status: "analyzing" }));
          const requestId = crypto.randomUUID();
          inFlight.current.set(key, requestId);
          try {
            const info = await engine.getInfo(entry.url, { requestId });
            inFlight.current.delete(key);
            if (cancelledReqs.current.has(requestId)) {
              cancelledReqs.current.delete(requestId);
              setEntries(updateBatchEntry(entriesRef.current, key, { status: "pending" }));
              continue;
            }
            analyzeCache.current.set(entry.url, info);
            setEntries(
              updateBatchEntry(entriesRef.current, key, { status: "ready", info, error: null }),
            );
          } catch {
            inFlight.current.delete(key);
            if (cancelledReqs.current.has(requestId)) {
              cancelledReqs.current.delete(requestId);
              setEntries(updateBatchEntry(entriesRef.current, key, { status: "pending" }));
              continue;
            }
            setEntries(
              updateBatchEntry(entriesRef.current, key, {
                status: "failed",
                error: S.home.analyzeFailed,
              }),
            );
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } finally {
      setBusy(false);
    }
  };

  const stopAnalyze = (): void => {
    for (const [key, requestId] of inFlight.current) {
      cancelledReqs.current.add(requestId);
      void engine.cancelAnalyze(requestId).catch(() => undefined);
      setEntries(updateBatchEntry(entriesRef.current, key, { status: "pending" }));
    }
    inFlight.current.clear();
    setBusy(false);
  };

  const queueAll = async (): Promise<void> => {
    const ready = entriesRef.current.filter((e) => e.status === "ready" && e.info !== null);
    if (ready.length === 0 || queueing) return;
    setQueueing(true);
    try {
      const outputDir = settingsState.downloadDir;
      const byUrl = new Map<string, BatchEntry>();
      const inputs: GuardInput[] = [];
      for (const e of ready) {
        if (e.info === null) continue;
        const playlist = e.info.isPlaylist && e.info.entries.length > 0;
        byUrl.set(e.url, e);
        inputs.push({
          url: e.url,
          title: e.info.title,
          extractor: e.info.extractor,
          videoId: playlist ? null : e.info.videoId,
          fromPlaylist: playlist || e.fromPlaylist === true,
        });
      }
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
      for (const g of guarded) {
        const row = byUrl.get(g.url);
        const info = row?.info;
        if (row === undefined || info === null || info === undefined) continue;
        const preset = row.preset ?? globalPreset;
        const playlist = info.isPlaylist && info.entries.length > 0;
        const playlistDir =
          playlist && settingsState.playlistSubfolder
            ? sanitizePlaylistTitle(info.title)
            : null;
        const subdir =
          playlistDir ??
          (settingsState.autoSort && !playlist
            ? autoSortSubdir(preset.kind, info.title)
            : null);
        const targets = playlist
          ? info.entries.map((en) => ({
              url: en.url,
              title: en.title,
              extractor: info.extractor,
              videoId: en.id,
            }))
          : [{ url: row.url, title: info.title, extractor: info.extractor, videoId: info.videoId }];
        for (const t of targets) {
          await queue.getState().enqueue({
            url: t.url,
            title: t.title,
            preset,
            outputDir,
            extractor: t.extractor,
            videoId: t.videoId,
            ...(g.fromPlaylist && settingsState.skipArchived && !g.forceFresh
              ? { useArchive: true as const }
              : {}),
            ...(g.forceFresh ? { forceOverwrite: true as const } : {}),
            ...(subdir !== null ? { playlistSubdir: subdir } : {}),
          });
          count += 1;
        }
        setEntries(removeBatchEntry(entriesRef.current, row.key));
      }
      setNote(formatStr(S.batch.queuedToast, { count }));
    } finally {
      setQueueing(false);
    }
  };

  const readyCount = entries.filter((e) => e.status === "ready").length;
  const failedCount = entries.filter((e) => e.status === "failed").length;
  const presets = kind === "video" ? VIDEO_PRESETS : AUDIO_PRESETS;

  return (
    <div
      className="grabber-card"
      aria-label={S.batch.title}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const file = Array.from(e.dataTransfer.files).find((f) =>
          f.name.toLowerCase().endsWith(".txt"),
        );
        ingestFile(file ?? null);
      }}
    >
      <h2>{S.batch.title}</h2>
      <p className="hint">{S.batch.description}</p>
      <label className="field-label" htmlFor="batch-input">
        {S.batch.inputLabel}
      </label>
      <textarea
        id="batch-input"
        className="input batch-text"
        placeholder={S.batch.inputPlaceholder}
        value={text}
        rows={4}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <div className="chip-row">
        <button
          id="batch-add"
          type="button"
          className="btn"
          onPointerDown={(e) => {
            pressScale(e.currentTarget);
          }}
          onClick={() => {
            ingest(text);
            setText("");
          }}
        >
          {S.batch.add}
        </button>
        <button
          type="button"
          className="btn"
          onPointerDown={(e) => {
            pressScale(e.currentTarget);
          }}
          onClick={() => {
            fileRef.current?.click();
          }}
        >
          {S.batch.chooseFile}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            ingestFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>

      <div className="segmented" role="group" aria-label={S.batch.presetLabel}>
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
            }}
          >
            {k === "video" ? S.home.kindVideo : S.home.kindAudio}
          </button>
        ))}
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            className="chip"
            aria-pressed={kind === "video" ? videoPreset === p : audioPreset === p}
            onPointerDown={(e) => {
              pressScale(e.currentTarget);
            }}
            onClick={() => {
              if (kind === "video") setVideoPreset(p as VideoPreset);
              else setAudioPreset(p as AudioPreset);
            }}
          >
            {presetName(S, p)}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <>
          <p className="hint" role="status">
            {S.batch.empty}
          </p>
          <div className="chip-row">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                void readClipboardText().then((clip) => {
                  if (clip !== null && clip.trim().length > 0) setText(clip);
                });
              }}
            >
              {S.batch.pasteClipboard}
            </button>
          </div>
        </>
      ) : (
        <ul className="entries">
          {entries.map((e) => (
            <li key={e.key} data-testid="batch-row" className="batch-row">
              <span data-testid="batch-status" className="muted">
                {statusLabel(S, e.status)}
              </span>
              <span className="batch-title" title={e.input}>
                {e.info !== null ? e.info.title : e.input}
              </span>
              {e.status === "failed" && e.error !== null && (
                <span className="error-text">{e.error}</span>
              )}
              {e.status === "ready" && e.info !== null && e.info.isPlaylist && (
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    setEntries(expandPlaylistEntry(entriesRef.current, e.key));
                  }}
                >
                  {S.batch.expand}
                </button>
              )}
              <select
                className="input"
                aria-label={S.batch.presetLabel}
                value={overrideValue(e.preset)}
                onChange={(sel) => {
                  setEntries(
                    updateBatchEntry(entriesRef.current, e.key, {
                      preset: overrideFromValue(sel.target.value),
                    }),
                  );
                }}
              >
                <option value="global">{S.batch.useGlobalPreset}</option>
                {VIDEO_PRESETS.map((p) => (
                  <option key={`v:${p}`} value={`v:${p}`}>
                    {presetName(S, p)}
                  </option>
                ))}
                {AUDIO_PRESETS.map((p) => (
                  <option key={`a:${p}`} value={`a:${p}`}>
                    {presetName(S, p)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setEntries(removeBatchEntry(entriesRef.current, e.key));
                }}
              >
                {S.batch.remove}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="chip-row">
        <button
          id="batch-analyze"
          type="button"
          className="btn btn-primary"
          disabled={busy || entries.length === 0}
          onPointerDown={(e) => {
            pressScale(e.currentTarget);
          }}
          onClick={() => {
            void analyzeStatuses(["pending"]);
          }}
        >
          {busy ? S.batch.analyzing : S.batch.analyzeAll}
        </button>
        {busy && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              stopAnalyze();
            }}
          >
            {S.batch.stop}
          </button>
        )}
        <button
          id="batch-queue"
          type="button"
          className="btn"
          disabled={busy || queueing || readyCount === 0}
          onPointerDown={(e) => {
            pressScale(e.currentTarget);
          }}
          onClick={() => {
            void queueAll();
          }}
        >
          {queueing ? S.batch.queueing : `${S.batch.queueAllReady} (${String(readyCount)})`}
        </button>
        {failedCount > 0 && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              setEntries(retryBatchEntries(entriesRef.current));
              void analyzeStatuses(["pending"]);
            }}
          >
            {S.batch.retryFailed} ({String(failedCount)})
          </button>
        )}
      </div>
      {note !== null && (
        <p className="note" role="status">
          {note}
        </p>
      )}
      {duplicateDialog}
    </div>
  );
}

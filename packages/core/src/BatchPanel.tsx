import { useRef, useState } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand";
import type { DownloadEngine } from "./engine.js";
import type { AudioPreset, DownloadPreset, MediaKind, VideoPreset } from "./types.js";
import { STRINGS } from "./strings.js";
import { pressScale } from "./motion.js";
import type { QueueStoreState, SettingsStoreState } from "./stores.js";
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
  readonly engine: Pick<DownloadEngine, "getInfo">;
  readonly queue: StoreApi<QueueStoreState>;
  readonly settings: StoreApi<SettingsStoreState>;
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

function statusLabel(status: BatchStatus): string {
  switch (status) {
    case "pending":
      return STRINGS.batch.statusPending;
    case "analyzing":
      return STRINGS.batch.statusAnalyzing;
    case "ready":
      return STRINGS.batch.statusReady;
    case "failed":
      return STRINGS.batch.statusFailed;
  }
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

export function BatchPanel({ engine, queue, settings }: BatchPanelProps): React.JSX.Element {
  const [entries, setEntriesState] = useState<readonly BatchEntry[]>([]);
  const [text, setText] = useState<string>("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [queueing, setQueueing] = useState<boolean>(false);
  const [kind, setKind] = useState<MediaKind>("video");
  const [videoPreset, setVideoPreset] = useState<VideoPreset>("Compatible");
  const [audioPreset, setAudioPreset] = useState<AudioPreset>("MP3");
  const entriesRef = useRef<readonly BatchEntry[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const settingsState = useStore(settings, (s) => s.settings);

  const setEntries = (next: readonly BatchEntry[]): void => {
    entriesRef.current = next;
    setEntriesState(next);
  };

  const globalPreset: DownloadPreset = { kind, videoPreset, audioPreset, rawFormat: null };

  const ingest = (raw: string): void => {
    const parsed = parseBatchText(raw);
    setEntries(addBatchEntries(entriesRef.current, parsed.valid));
    const parts: string[] = [];
    if (parsed.invalid.length > 0) {
      parts.push(`${STRINGS.batch.invalidSkipped} ${String(parsed.invalid.length)}`);
    }
    if (parsed.duplicates > 0) {
      parts.push(`${STRINGS.batch.duplicatesSkipped} ${String(parsed.duplicates)}`);
    }
    if (parsed.truncated) parts.push(STRINGS.batch.truncatedNote);
    setNote(parts.length > 0 ? parts.join(" ") : null);
  };

  const ingestFile = (file: File | null): void => {
    if (file === null) return;
    if (file.size > MAX_BATCH_BYTES) {
      setNote(STRINGS.batch.fileTooBig);
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
          setEntries(updateBatchEntry(entriesRef.current, key, { status: "analyzing" }));
          const entry = entriesRef.current.find((e) => e.key === key);
          if (entry === undefined) continue;
          try {
            const info = await engine.getInfo(entry.url);
            setEntries(
              updateBatchEntry(entriesRef.current, key, { status: "ready", info, error: null }),
            );
          } catch {
            setEntries(
              updateBatchEntry(entriesRef.current, key, {
                status: "failed",
                error: STRINGS.home.analyzeFailed,
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

  const queueAll = async (): Promise<void> => {
    const ready = entriesRef.current.filter((e) => e.status === "ready" && e.info !== null);
    if (ready.length === 0 || queueing) return;
    setQueueing(true);
    try {
      const outputDir = settingsState.downloadDir;
      let count = 0;
      for (const e of ready) {
        const info = e.info;
        if (info === null) continue;
        const preset = e.preset ?? globalPreset;
        const targets =
          info.isPlaylist && info.entries.length > 0
            ? info.entries.map((en) => ({ url: en.url, title: en.title }))
            : [{ url: e.url, title: info.title }];
        for (const t of targets) {
          await queue.getState().enqueue({ url: t.url, title: t.title, preset, outputDir });
          count += 1;
        }
        setEntries(removeBatchEntry(entriesRef.current, e.key));
      }
      setNote(`${STRINGS.batch.queuedToast} (${String(count)})`);
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
      aria-label={STRINGS.batch.title}
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
      <h2>{STRINGS.batch.title}</h2>
      <p className="hint">{STRINGS.batch.description}</p>
      <label className="field-label" htmlFor="batch-input">
        {STRINGS.batch.inputLabel}
      </label>
      <textarea
        id="batch-input"
        className="input batch-text"
        placeholder={STRINGS.batch.inputPlaceholder}
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
          {STRINGS.batch.add}
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
          {STRINGS.batch.chooseFile}
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

      <div className="segmented" role="group" aria-label={STRINGS.batch.presetLabel}>
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
            {k === "video" ? STRINGS.home.kindVideo : STRINGS.home.kindAudio}
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
            {p}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <p className="hint">{STRINGS.batch.empty}</p>
      ) : (
        <ul className="entries">
          {entries.map((e) => (
            <li key={e.key} data-testid="batch-row" className="batch-row">
              <span data-testid="batch-status" className="muted">
                {statusLabel(e.status)}
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
                  {STRINGS.batch.expand}
                </button>
              )}
              <select
                className="input"
                aria-label={STRINGS.batch.presetLabel}
                value={overrideValue(e.preset)}
                onChange={(sel) => {
                  setEntries(
                    updateBatchEntry(entriesRef.current, e.key, {
                      preset: overrideFromValue(sel.target.value),
                    }),
                  );
                }}
              >
                <option value="global">{STRINGS.batch.useGlobalPreset}</option>
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
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  setEntries(removeBatchEntry(entriesRef.current, e.key));
                }}
              >
                {STRINGS.batch.remove}
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
          {busy ? STRINGS.batch.analyzing : STRINGS.batch.analyzeAll}
        </button>
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
          {queueing ? STRINGS.batch.queueing : `${STRINGS.batch.queueAllReady} (${String(readyCount)})`}
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
            {STRINGS.batch.retryFailed} ({String(failedCount)})
          </button>
        )}
      </div>
      {note !== null && (
        <p className="note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { DownloadEngine } from "./engine.js";
import type { SettingsStoreState } from "./stores.js";
import type { StoreApi } from "zustand";
import { useStrings } from "./locale.js";

export interface PreviewModalProps {
  readonly engine: Pick<DownloadEngine, "getMediaUrl">;
  readonly settings: StoreApi<SettingsStoreState>;
  /** Absolute output path of the finished download. */
  readonly path: string;
  readonly title: string;
  readonly onClose: () => void;
}

function isVideo(path: string): boolean {
  return /\.(mp4|m4v|webm|mkv|mov|avi|3gp)$/i.test(path);
}

/** `m:ss` / `h:mm:ss` for the media element's reported duration. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${String(h)}:${mm}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * In-app quick preview (audio/video). The file is served main-side over the
 * allowlisted `media://` protocol — the renderer never sees a file:// URL
 * and never touches paths outside the download roots. Playback stops when
 * the modal unmounts (element is destroyed with it).
 */
export function PreviewModal({
  engine,
  settings,
  path,
  title,
  onClose,
}: PreviewModalProps): React.JSX.Element {
  const S = useStrings(settings);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  /** Duration reported by the media element (null until metadata lands). */
  const [duration, setDuration] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let live = true;
    engine
      .getMediaUrl(path)
      .then((u) => {
        if (!live) return;
        if (u === null) setFailed(true);
        else setUrl(u);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [engine, path]);

  useEffect(() => {
    const box = boxRef.current;
    box?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Focus trap (same pattern as the other dialogs).
      if (e.key !== "Tab" || box === null) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>("button, audio, video"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="grabber-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        className="grabber-card preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="preview-modal"
      >
        <h2 className="dl-title">{title}</h2>
        {failed ? (
          <p className="error-text" role="alert">
            {S.library.previewUnavailable}
          </p>
        ) : url === null ? (
          <p className="muted" role="status">
            {S.library.previewLoading}
          </p>
        ) : isVideo(path) ? (
          <video
            ref={videoRef}
            className="preview-media"
            src={url}
            controls
            preload="metadata"
            data-testid="preview-video"
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration);
            }}
          />
        ) : (
          <audio
            ref={audioRef}
            className="preview-media"
            src={url}
            controls
            preload="metadata"
            data-testid="preview-audio"
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration);
            }}
          />
        )}
        {url !== null && duration !== null && (
          // Surfaces the duration the file really has; a `0:00` readout here
          // means the media protocol served a non-seekable response.
          <p className="muted" data-testid="preview-duration">
            {S.home.previewDuration}: {clock(duration)}
          </p>
        )}
        <div className="chip-row">
          {isVideo(path) && url !== null && (
            <>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  // Both APIs exist in Electron 36; failures (e.g. no video
                  // track loaded yet) stay silent by design.
                  void videoRef.current?.requestPictureInPicture().catch(() => undefined);
                }}
              >
                {S.library.previewPip}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  void videoRef.current?.requestFullscreen().catch(() => undefined);
                }}
              >
                {S.library.previewFullscreen}
              </button>
            </>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {S.shortcuts.close}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  return /\.(mp4|m4v|webm|mkv)$/i.test(path);
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
  const boxRef = useRef<HTMLDivElement | null>(null);

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
      if (e.key === "Escape") onClose();
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
            className="preview-media"
            src={url}
            controls
            preload="metadata"
            data-testid="preview-video"
          />
        ) : (
          <audio
            className="preview-media"
            src={url}
            controls
            preload="metadata"
            data-testid="preview-audio"
          />
        )}
        <div className="chip-row">
          <button type="button" className="btn" onClick={onClose}>
            {S.shortcuts.close}
          </button>
        </div>
      </div>
    </div>
  );
}

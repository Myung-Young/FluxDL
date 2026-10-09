import { useState } from "react";
import type { StoreApi } from "zustand";
import type { GalleryProbeItem } from "./galleryProbe.js";
import { formatStr, useStrings } from "./locale.js";
import type { SettingsStoreState } from "./stores.js";

export interface GalleryPreviewProps {
  readonly settings: StoreApi<SettingsStoreState>;
  readonly items: readonly GalleryProbeItem[];
  readonly errors: readonly string[];
  readonly busy: boolean;
  readonly onDownloadAll: () => void;
  readonly onDownloadSelected: (items: readonly GalleryProbeItem[]) => void;
}

function dims(item: GalleryProbeItem): string | null {
  if (item.width === null || item.height === null) return null;
  return `${String(item.width)}×${String(item.height)}`;
}

/**
 * Gallery preview (Phase 1 v1.8.5): item count, lazy thumbnails, select /
 * deselect, Download all / selected. Thumbnails are the extractors' own
 * direct media URLs over https: (already allowed by the img-src CSP);
 * nothing is fetched through the app.
 */
export function GalleryPreview({
  settings,
  items,
  errors,
  busy,
  onDownloadAll,
  onDownloadSelected,
}: GalleryPreviewProps): React.JSX.Element {
  const S = useStrings(settings);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(items.map((i) => i.url)),
  );

  const toggle = (url: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const selectAll = (): void => {
    setSelected(new Set(items.map((i) => i.url)));
  };

  const selectNone = (): void => {
    setSelected(new Set());
  };

  const chosen = items.filter((i) => selected.has(i.url));

  return (
    <div className="grabber-card" data-testid="gallery-preview">
      <h2 className="dl-title">{S.home.galleryTitle}</h2>
      <p className="muted" role="status">
        {formatStr(S.home.galleryCount, { count: items.length })}
      </p>
      {errors.map((e, i) => (
        <p key={`ge-${String(i)}`} className="muted">
          {e}
        </p>
      ))}
      {items.length === 0 ? (
        <p className="muted">{S.home.galleryEmpty}</p>
      ) : (
        <>
          <div className="chip-row">
            <button type="button" className="btn btn-small" onClick={selectAll}>
              {S.home.selectAll}
            </button>
            <button type="button" className="btn btn-small" onClick={selectNone}>
              {S.home.selectNone}
            </button>
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={busy}
              onClick={onDownloadAll}
            >
              {S.home.galleryDownloadAll}
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={busy || chosen.length === 0}
              onClick={() => {
                onDownloadSelected(chosen);
              }}
            >
              {S.home.galleryDownloadSelected}
            </button>
          </div>
          <div className="gallery-grid">
            {items.map((item) => {
              const on = selected.has(item.url);
              const caption = item.filename ?? item.url;
              const meta = dims(item);
              return (
                <label key={item.url} className="gallery-cell" aria-pressed={on}>
                  <input
                    type="checkbox"
                    className="gallery-check"
                    checked={on}
                    onChange={() => {
                      toggle(item.url);
                    }}
                    aria-label={caption}
                  />
                  <img
                    className="gallery-thumb"
                    src={item.url}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  <span className="gallery-caption" title={caption}>
                    {caption}
                    {meta !== null && <span className="muted"> · {meta}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

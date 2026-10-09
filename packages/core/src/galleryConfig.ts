/**
 * gallery-dl config generator (pure). The app owns one JSON config file in
 * userData generated from FluxDL settings; the user's global config is never
 * touched unless they opt in ("use my config" is a future toggle).
 *
 * Flags must be verified against `gallery-dl --help` before wiring new keys.
 */
import type { ImagesSettings } from "./types.js";

export interface GalleryConfigInput {
  readonly images: ImagesSettings;
  readonly cookiesFile: string | null;
  readonly downloadRoot: string;
}

export interface GalleryConfig {
  /** JSON-serializable config object written to userData. */
  readonly config: Record<string, unknown>;
  /** Pretty JSON text for the file + raw-editor preview. */
  readonly text: string;
}

function cleanTemplate(value: string, fallback: string): string {
  const t = value.trim();
  return t.length > 0 ? t.slice(0, 200) : fallback;
}

export function buildGalleryDlConfig(input: GalleryConfigInput): GalleryConfig {
  const images = input.images;
  const extractor: Record<string, unknown> = {
    retries: images.retries ?? 3,
  };
  if (images.proxy !== null && images.proxy.trim().length > 0) {
    extractor["proxy"] = images.proxy.trim();
  }
  if (input.cookiesFile !== null && input.cookiesFile.trim().length > 0) {
    extractor["cookies"] = input.cookiesFile.trim();
  }
  const downloader: Record<string, unknown> = {};
  if (images.sleepRequestsSec !== null) downloader["sleep-request"] = images.sleepRequestsSec;
  if (images.maxSleepIntervalSec !== null) downloader["sleep"] = images.maxSleepIntervalSec;

  const config: Record<string, unknown> = {
    extractor,
    downloader,
    output: {
      mode: "auto",
      directory: cleanTemplate(images.folderTemplate, "{site}/{gallery}"),
      filename: cleanTemplate(images.filenameTemplate, "{filename}.{extension}"),
    },
    metadata: images.metadataSidecar,
    archive: images.archive ? "<download-root>/gallery-dl-archive.sqlite3" : null,
    // FluxDL-managed marker; the engine ignores unknown top-level keys.
    fluxdl: { managed: true, downloadRoot: input.downloadRoot },
  };
  return { config, text: JSON.stringify(config, null, 2) };
}

/** Validate a raw JSON editor payload (object only). */
export function validateGalleryConfigJson(text: string): { ok: true } | { ok: false; error: string } {
  if (text.length > 200_000) return { ok: false, error: "Config is too large (max 200 KB)." };
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "Config must be a JSON object." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Invalid JSON." };
  }
}

/**
 * Resolve the config file text (v1.8.5): a valid raw override wins,
 * otherwise the generated file stands in. An invalid override never
 * reaches the binary — the UI surfaces the validation error at edit time,
 * and this fallback keeps a stale/bad saved value from breaking downloads.
 */
export function resolveGalleryConfigText(input: GalleryConfigInput): string {
  const custom = input.images.customConfig;
  if (custom !== null && validateGalleryConfigJson(custom).ok) return custom;
  return buildGalleryDlConfig(input).text;
}

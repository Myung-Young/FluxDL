/**
 * Inline field validation (M3.7). Pure helpers behind the Settings hints:
 * hints only, never blocking — the sanitizing merge stays authoritative.
 */

/** Filename template must be non-empty and carry an extension slot. */
export function validateFilenameTemplate(template: string): boolean {
  const t = template.trim();
  return t.length > 0 && t.includes("%(ext)s");
}

/** Speed limit: empty (unlimited) or a yt-dlp `--limit-rate` rate. */
export function validateSpeedLimit(value: string | null): boolean {
  if (value === null) return true;
  const t = value.trim();
  if (t.length === 0) return true;
  return /^\d+(\.\d+)?[KMGT]?$/i.test(t);
}

const PREVIEW_SAMPLE: Readonly<Record<string, string>> = {
  title: "Sample Video",
  id: "abc123",
  ext: "mp4",
  upload_date: "20260101",
  uploader: "Sample Channel",
  extractor: "youtube",
};

/** Render a template with sample metadata (unknown keys pass through). */
export function previewFilename(template: string): string {
  return template.replace(/%\((\w+)\)s/g, (match, key: string) => {
    const value = PREVIEW_SAMPLE[key];
    return value === undefined ? match : value;
  });
}

/**
 * Trim time for --download-sections: empty (off), plain seconds, or
 * [HH:]MM:SS with optional fraction. Hints only — args sanitizes again.
 */
export function validateTrimTime(value: string | null): boolean {
  if (value === null) return true;
  const t = value.trim();
  if (t.length === 0) return true;
  if (/^\d+(\.\d+)?$/.test(t)) return true;
  return /^(?:\d+:)?[0-5]?\d:[0-5]\d(?:\.\d+)?$/.test(t);
}

/** Download-window clock time: empty (off) or strict 24 h HH:MM. */
export function validateWindowTime(value: string | null): boolean {
  if (value === null) return true;
  const t = value.trim();
  if (t.length === 0) return true;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

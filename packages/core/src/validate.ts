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
};

/** Render a template with sample metadata (unknown keys pass through). */
export function previewFilename(template: string): string {
  return template.replace(/%\((\w+)\)s/g, (match, key: string) => {
    const value = PREVIEW_SAMPLE[key];
    return value === undefined ? match : value;
  });
}

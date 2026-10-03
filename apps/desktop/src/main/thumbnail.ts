import { nativeImage } from "electron";
import type { Rgb } from "@grabber/core/color.js";
import { dominantColor } from "@grabber/core/color.js";

/**
 * Thumbnail accent (M2.4). Main fetches the image (https only, <=2 MB,
 * short timeout, image/* only, no redirect off https), decodes with
 * nativeImage down to ~32px, and maps the dominant colour via the pure
 * core median-cut. toBitmap() is BGRA on Windows (verified empirically
 * with a red/green probe PNG in Electron 36) — converted to RGB here.
 * Never throws: failures resolve null (preview keeps the theme accent).
 */

export const THUMB_MAX_BYTES = 2 * 1024 * 1024;
export const THUMB_TIMEOUT_MS = 10_000;
export const THUMB_SIZE = 32;
const MAX_REDIRECTS = 4;

export function assertThumbnailUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Invalid thumbnail URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("Only https thumbnails.");
  return parsed.toString();
}

async function fetchImageBytes(url: string): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, THUMB_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const res = await fetch(current, { redirect: "manual", signal: ctrl.signal });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (location === null) throw new Error("Redirect without location.");
        const next = new URL(location, current);
        if (next.protocol !== "https:") throw new Error("Thumbnail redirected off https.");
        current = next.toString();
        continue;
      }
      if (!res.ok) throw new Error(`Thumbnail HTTP ${String(res.status)}.`);
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) throw new Error("Not an image.");
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (Number.isFinite(declared) && declared > THUMB_MAX_BYTES) {
        throw new Error("Thumbnail too large.");
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > THUMB_MAX_BYTES) throw new Error("Thumbnail too large.");
      return buf;
    }
    throw new Error("Too many redirects.");
  } finally {
    clearTimeout(timer);
  }
}

/** BGRA (native) -> RGB triplets, skipping translucent pixels. */
export function bgraToRgb(bgra: Buffer): number[] {
  const rgb: number[] = [];
  for (let i = 0; i + 4 <= bgra.length; i += 4) {
    const alpha = bgra[i + 3] ?? 0;
    if (alpha < 128) continue;
    rgb.push(bgra[i + 2] ?? 0, bgra[i + 1] ?? 0, bgra[i] ?? 0);
  }
  return rgb;
}

export async function thumbnailColor(rawUrl: string): Promise<Rgb | null> {
  try {
    const url = assertThumbnailUrl(rawUrl);
    const bytes = await fetchImageBytes(url);
    const img = nativeImage.createFromBuffer(bytes);
    if (img.isEmpty()) return null;
    const bitmap = img.resize({ width: THUMB_SIZE, height: THUMB_SIZE }).toBitmap();
    return dominantColor(bgraToRgb(bitmap));
  } catch {
    return null;
  }
}

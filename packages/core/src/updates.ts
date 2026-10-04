/**
 * Update-check helpers (pure, no network here).
 * Main fetches the GitHub Releases API; these compare + gate what the UI
 * may open. `openExternal` only ever opens the project's Releases page.
 */

export const APP_RELEASES_URL = "https://github.com/Myung-Young/FluxDL/releases" as const;

export const APP_API_URL =
  "https://api.github.com/repos/Myung-Young/FluxDL/releases/latest" as const;

export const YTDLP_API_URL =
  "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest" as const;

/** Only this URL (and its /tag/... children) may be opened externally. */
export function isAllowedExternalUrl(raw: string): boolean {
  return (
    raw === APP_RELEASES_URL || raw.startsWith(`${APP_RELEASES_URL}/tag/`)
  );
}

function numericParts(version: string): number[] | null {
  const clean = version.trim().replace(/^[vV]/, "");
  if (!/^\d+(\.\d+)*$/.test(clean)) return null;
  return clean.split(".").map((p) => Number(p));
}

/**
 * True when `latest` is strictly newer than `current`.
 * Unknown/unparseable versions (dev builds, "unknown") never report
 * an update — a false reminder is worse than a missed one.
 */
export function isNewerVersion(current: string, latest: string | null): boolean {
  if (latest === null) return false;
  const cur = numericParts(current);
  const lat = numericParts(latest);
  if (cur === null || lat === null) return false;
  const n = Math.max(cur.length, lat.length);
  for (let i = 0; i < n; i += 1) {
    const c = cur[i] ?? 0;
    const l = lat[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/** Extract `tag_name` from a GitHub latest-release payload (null when absent). */
export function latestTagFromRelease(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const tag = (payload as Record<string, unknown>)["tag_name"];
  return typeof tag === "string" && tag.trim().length > 0 ? tag.trim() : null;
}

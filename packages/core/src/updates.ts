/**
 * Update-check helpers (pure, no network here).
 * Main fetches the GitHub Releases API; these compare + gate what the UI
 * may open. `openExternal` only ever opens same-repo pages: Releases (and
 * its /tag/... children) plus a prefilled new-issue form (report-a-bug).
 */

export const APP_RELEASES_URL = "https://github.com/Myung-Young/FluxDL/releases" as const;

export const APP_ISSUES_URL = "https://github.com/Myung-Young/FluxDL/issues" as const;

/** Prefilled bug-report form. Query carries the template — capped below. */
export function buildIssueUrl(version: string, os: string): string {
  const clean = (s: string): string => s.trim().slice(0, 64).replace(/[\r\n]+/g, " ");
  const body = [
    `FluxDL ${clean(version)} / ${clean(os)}`,
    "",
    "Steps to reproduce:",
    "1. ",
    "",
    "Diagnostics (Settings → Logs → Copy diagnostics, paste below):",
  ].join("\n");
  const params = new URLSearchParams({
    title: "[bug] ",
    body: body.slice(0, 1200),
  });
  return `${APP_ISSUES_URL}/new?${params.toString()}`;
}

/**
 * Only same-repo Releases (and /tag/... children) plus the prefilled
 * new-issue form may be opened externally. Everything else throws
 * main-side — notably `evil-releases` prefix tricks and foreign hosts.
 */
export function isAllowedExternalUrl(raw: string): boolean {
  if (raw === APP_RELEASES_URL || raw.startsWith(`${APP_RELEASES_URL}/tag/`)) return true;
  if (raw === `${APP_ISSUES_URL}/new` || raw.startsWith(`${APP_ISSUES_URL}/new?`)) return true;
  return false;
}

export const APP_API_URL =
  "https://api.github.com/repos/Myung-Young/FluxDL/releases/latest" as const;

export const YTDLP_API_URL =
  "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest" as const;

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

export interface ReleaseAssetInfo {
  readonly name: string;
  readonly sizeBytes: number;
  readonly url: string;
}

export interface ParsedRelease {
  readonly tag: string;
  readonly publishedAt: string | null;
  /** Release notes, capped so a novel never reaches the UI. */
  readonly body: string | null;
  readonly assets: readonly ReleaseAssetInfo[];
}

/**
 * Parse a GitHub `releases/latest` payload defensively (null on anything
 * unexpected — update checks must never throw for network reasons).
 */
export function parseReleasePayload(payload: unknown): ParsedRelease | null {
  if (typeof payload !== "object" || payload === null) return null;
  const rec = payload as Record<string, unknown>;
  const tag = latestTagFromRelease(rec);
  if (tag === null) return null;
  const publishedAt =
    typeof rec["published_at"] === "string" && rec["published_at"].length > 0
      ? rec["published_at"]
      : null;
  const body =
    typeof rec["body"] === "string" && rec["body"].trim().length > 0
      ? rec["body"].slice(0, 8000)
      : null;
  const assets: ReleaseAssetInfo[] = [];
  if (Array.isArray(rec["assets"])) {
    for (const a of rec["assets"].slice(0, 50)) {
      if (typeof a !== "object" || a === null) continue;
      const r = a as Record<string, unknown>;
      if (typeof r["name"] !== "string" || typeof r["browser_download_url"] !== "string") {
        continue;
      }
      if (typeof r["size"] !== "number" || !Number.isFinite(r["size"]) || r["size"] <= 0) {
        continue;
      }
      assets.push({ name: r["name"], sizeBytes: Math.floor(r["size"]), url: r["browser_download_url"] });
    }
  }
  return { tag, publishedAt, body, assets };
}

/**
 * Pick the Setup installer from release assets (the only artifact the
 * auto-installer can run silently). Portable exes need a manual swap, so
 * they are shown for size but never auto-installed.
 */
export function pickSetupAsset(assets: readonly ReleaseAssetInfo[]): ReleaseAssetInfo | null {
  const setup = assets.find((a) => /setup.*\.exe$/i.test(a.name));
  if (setup !== undefined) return setup;
  return null;
}

/** Portable asset, for the size table only. */
export function pickPortableAsset(assets: readonly ReleaseAssetInfo[]): ReleaseAssetInfo | null {
  return assets.find((a) => /portable.*\.exe$/i.test(a.name)) ?? null;
}

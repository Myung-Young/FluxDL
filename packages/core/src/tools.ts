/**
 * Tool registry (Phase 2). One manifest per external tool: version, source,
 * checksum, license, size, required/optional, install mode (bundled/on-demand
 * /external). No new dependency — plain data + tiny version helpers.
 *
 * Install-mode policy (recorded in DECISIONS.md):
 * - bundled: ships in the installer (yt-dlp, ffmpeg/ffprobe, gallery-dl).
 * - external: detected only (PATH or userData/bin drop-in); the app never
 *   downloads these itself (deno, aria2c). On-demand download stays on the
 *   roadmap until version+checksum pinning is verified per release.
 */

export type ToolInstallMode = "bundled" | "external";

export interface ToolManifest {
  readonly id: string;
  /** Display name (user-facing; brand names stay out of APP_NAME). */
  readonly name: string;
  readonly exe: string;
  readonly version: string;
  readonly url: string;
  readonly homepage: string;
  readonly sha256: string | null;
  readonly license: string;
  /** Approximate bytes, null when unknown (shown as "—"). */
  readonly size: number | null;
  readonly required: boolean;
  readonly installMode: ToolInstallMode;
  readonly description: string;
}

export const TOOL_MANIFESTS: readonly ToolManifest[] = [
  {
    id: "yt-dlp",
    name: "yt-dlp",
    exe: "yt-dlp.exe",
    version: "2026.08.19",
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe",
    homepage: "https://github.com/yt-dlp/yt-dlp",
    sha256: null,
    license: "Unlicense",
    size: null,
    required: true,
    installMode: "bundled",
    description: "Video/audio engine.",
  },
  {
    id: "ffmpeg",
    name: "ffmpeg + ffprobe",
    exe: "ffmpeg.exe",
    version: "win64-gpl (latest)",
    url: "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
    homepage: "https://github.com/yt-dlp/FFmpeg-Builds",
    sha256: null,
    license: "GPL",
    size: null,
    required: true,
    installMode: "bundled",
    description: "Merging, thumbnails, audio extraction.",
  },
  {
    id: "gallery-dl",
    name: "gallery-dl",
    exe: "gallery-dl.exe",
    version: "1.26.12",
    url: "https://github.com/mikf/gallery-dl/releases/download/v1.26.12/gallery-dl.exe",
    homepage: "https://github.com/mikf/gallery-dl",
    sha256: null,
    license: "GPL-2.0-only",
    size: null,
    required: false,
    installMode: "bundled",
    description: "Image/gallery engine.",
  },
  {
    id: "deno",
    name: "Deno (JS runtime)",
    exe: "deno.exe",
    version: "detect-only",
    url: "https://github.com/denoland/deno/releases",
    homepage: "https://deno.com",
    sha256: null,
    license: "MIT",
    size: null,
    required: false,
    installMode: "external",
    description: "YouTube JS challenges for yt-dlp (--js-runtimes). Drop deno.exe into the bin folder or PATH.",
  },
  {
    id: "aria2c",
    name: "aria2c (downloader)",
    exe: "aria2c.exe",
    version: "detect-only",
    url: "https://github.com/aria2/aria2/releases",
    homepage: "https://aria2.github.io",
    sha256: null,
    license: "GPL-2.0-only",
    size: null,
    required: false,
    installMode: "external",
    description: "Optional faster fragment downloads (--downloader). Drop aria2c.exe into the bin folder or PATH.",
  },
];

export function toolManifest(id: string): ToolManifest | null {
  return TOOL_MANIFESTS.find((t) => t.id === id) ?? null;
}

/** Numeric-aware version compare: -1 | 0 | 1 (no digits on either side = 0). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[^0-9]+/).filter((p) => p.length > 0).map(Number);
  const pb = b.split(/[^0-9]+/).filter((p) => p.length > 0).map(Number);
  if (pa.length === 0 || pb.length === 0) return 0;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** Minimum versions enforced by Doctor (null = presence only). */
export const MIN_TOOL_VERSIONS: Readonly<Record<string, string | null>> = {
  "yt-dlp": "2026.08.19",
  ffmpeg: null,
  "gallery-dl": "1.26.12",
  deno: null,
  aria2c: null,
};

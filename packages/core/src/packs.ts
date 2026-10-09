/**
 * Optional Tool Packs (Phase 5, pure). Manifests, release-asset discovery,
 * checksum parsing, revoke checks, filename safety. Downloading, verifying
 * and executing live main-side; nothing here touches the network or disk.
 *
 * All URLs below were verified against the live GitHub API on 2026-10-08.
 * Only rclone publishes a checksums file — the rest install with explicit
 * user consent + size check (recorded in DECISIONS.md, surfaced in the UI).
 */

export type PackKind = "engine" | "postprocessor";

export type PackId = "streamlink" | "n-m3u8dl-re" | "whisper" | "rclone";

export interface PackManifest {
  readonly id: PackId;
  /** Display name. */
  readonly name: string;
  readonly kind: PackKind;
  /** Executable to locate after extraction (walked, ≤3 levels). */
  readonly exe: string;
  /** Pinned fallback version (update discovery prefers newer). */
  readonly version: string;
  /** Pinned download URL for the fallback version. */
  readonly url: string;
  /** Approximate bytes (display + sanity bound, not exact). */
  readonly sizeBytes: number;
  /** Free bytes required before downloading. */
  readonly requiredFreeBytes: number;
  readonly license: string;
  readonly homepage: string;
  /** GitHub Releases API for update discovery (list endpoint). */
  readonly releasesApi: string;
  /** What the pack plugs into (router rule, pipeline step, …). */
  readonly capabilities: readonly string[];
  /** True when the pack shells out to FFmpeg (PATH-wired at spawn). */
  readonly requiresFfmpeg: boolean;
  /** Checksums asset name when the project publishes one (rclone only). */
  readonly sumsAsset?: string;
  /** User-facing risk/consent note (no published checksums, nightlies…). */
  readonly consentNote: string;
}

export const PACK_MANIFESTS: readonly PackManifest[] = [
  {
    id: "streamlink",
    name: "Streamlink",
    kind: "engine",
    exe: "streamlink.exe",
    version: "8.6.2-1",
    url: "https://github.com/streamlink/windows-builds/releases/download/8.6.2-1/streamlink-8.6.2-1-py314-x86_64.zip",
    sizeBytes: 84_000_000,
    requiredFreeBytes: 500_000_000,
    license: "BSD-2-Clause",
    homepage: "https://streamlink.github.io/",
    releasesApi: "https://api.github.com/repos/streamlink/windows-builds/releases?per_page=10",
    capabilities: ["live-stream capture", "router rule (opt-in per domain)"],
    requiresFfmpeg: false,
    consentNote: "No published checksums file — GitHub release asset only.",
  },
  {
    id: "n-m3u8dl-re",
    name: "N_m3u8DL-RE",
    kind: "engine",
    exe: "N_m3u8DL-RE.exe",
    version: "v0.6.0-beta",
    url: "https://github.com/nilaoda/N_m3u8DL-RE/releases/download/v0.6.0-beta/N_m3u8DL-RE_v0.6.0-beta_win-x64_20260629.zip",
    sizeBytes: 5_500_000,
    requiredFreeBytes: 100_000_000,
    license: "MIT",
    homepage: "https://github.com/nilaoda/N_m3u8DL-RE",
    releasesApi: "https://api.github.com/repos/nilaoda/N_m3u8DL-RE/releases?per_page=10",
    capabilities: ["HLS/DASH fallback", "direct .m3u8/.mpd input", "Try-with on failure"],
    requiresFfmpeg: true,
    consentNote: "No published checksums file — GitHub release asset only.",
  },
  {
    id: "whisper",
    name: "whisper.cpp",
    kind: "postprocessor",
    exe: "whisper-cli.exe",
    version: "b5454",
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip",
    sizeBytes: 8_900_000,
    requiredFreeBytes: 100_000_000,
    license: "MIT",
    homepage: "https://github.com/ggml-org/whisper.cpp",
    releasesApi: "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=20",
    capabilities: ["speech-to-text subtitles (.srt sidecar)", "CPU default", "experimental"],
    requiresFfmpeg: true,
    consentNote: "Nightly build (stables ship no binaries) + no published checksums file.",
  },
  {
    id: "rclone",
    name: "rclone",
    kind: "postprocessor",
    exe: "rclone.exe",
    version: "v1.75.1",
    url: "https://github.com/rclone/rclone/releases/download/v1.75.1/rclone-v1.75.1-windows-amd64.zip",
    sizeBytes: 20_000_000,
    requiredFreeBytes: 200_000_000,
    license: "MIT",
    homepage: "https://rclone.org/",
    releasesApi: "https://api.github.com/repos/rclone/rclone/releases?per_page=10",
    capabilities: ["upload to 70+ remotes", "rclone owns its config — FluxDL never sees credentials"],
    requiresFfmpeg: false,
    sumsAsset: "SHA256SUMS",
    consentNote: "SHA256SUMS-verified.",
  },
];

export function packManifest(id: string): PackManifest | null {
  return PACK_MANIFESTS.find((p) => p.id === id) ?? null;
}

export interface DiscoveredAsset {
  readonly version: string;
  readonly url: string;
  readonly size: number | null;
}

interface ReleaseAsset {
  readonly name: string;
  readonly url: string;
  readonly size: number | null;
}

function assetsOf(release: unknown): ReleaseAsset[] {
  if (typeof release !== "object" || release === null) return [];
  const raw = (release as Record<string, unknown>)["assets"];
  if (!Array.isArray(raw)) return [];
  const out: ReleaseAsset[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec["name"] !== "string" || typeof rec["browser_download_url"] !== "string") continue;
    const size = typeof rec["size"] === "number" ? rec["size"] : null;
    out.push({ name: rec["name"], url: rec["browser_download_url"], size });
  }
  return out;
}

function tagOf(release: unknown): string | null {
  if (typeof release !== "object" || release === null) return null;
  const tag = (release as Record<string, unknown>)["tag_name"];
  const draft = (release as Record<string, unknown>)["draft"];
  if (typeof tag !== "string" || tag.length === 0 || draft === true) return null;
  return tag;
}

function firstReleaseWith(
  releases: unknown,
  match: (name: string, tag: string) => string | null,
): DiscoveredAsset | null {
  if (!Array.isArray(releases)) return null;
  for (const rel of releases.slice(0, 20)) {
    const tag = tagOf(rel);
    if (tag === null) continue;
    for (const a of assetsOf(rel)) {
      const version = match(a.name, tag);
      if (version !== null) return { version, url: a.url, size: a.size };
    }
  }
  return null;
}

/** Newest windows-builds release carrying a portable py*-x86_64 zip. */
export function discoverStreamlink(releases: unknown): DiscoveredAsset | null {
  return firstReleaseWith(releases, (name) => {
    const m = /^streamlink-(\d+\.\d+\.\d+-\d+)-py\d+-x86_64\.zip$/.exec(name);
    return m?.[1] ?? null;
  });
}

/** Newest win-x64 (not arm64/x86) zip; version is the tag itself. */
export function discoverNm3u8dl(releases: unknown): DiscoveredAsset | null {
  return firstReleaseWith(releases, (name, tag) =>
    name.includes("win-x64") && name.endsWith(".zip") ? tag : null,
  );
}

/** Newest nightly carrying the CPU x64 binary zip. */
export function discoverWhisper(releases: unknown): DiscoveredAsset | null {
  return firstReleaseWith(releases, (name, tag) =>
    name === "whisper-bin-x64.zip" ? tag : null,
  );
}

export interface RcloneDiscovery extends DiscoveredAsset {
  readonly sumsUrl: string | null;
}

/** Newest windows-amd64 zip + its SHA256SUMS sibling. */
export function discoverRclone(releases: unknown): RcloneDiscovery | null {
  if (!Array.isArray(releases)) return null;
  for (const rel of releases.slice(0, 20)) {
    const tag = tagOf(rel);
    if (tag === null) continue;
    const assets = assetsOf(rel);
    const bin = assets.find((a) => /^rclone-v[\d.]+-windows-amd64\.zip$/.test(a.name));
    if (bin === undefined) continue;
    const sums = assets.find((a) => a.name === "SHA256SUMS");
    return { version: tag, url: bin.url, size: bin.size, sumsUrl: sums?.url ?? null };
  }
  return null;
}

/** Parse a SHA256SUMS-style file for one filename (hash + space + name). */
export function parseSha256sums(text: string, filename: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/.exec(line.trim());
    if (m !== null && m[2] === filename) return m[1] ?? null;
  }
  return null;
}

/** Bundled revoke list: pack id → blocked versions (updated with releases). */
export interface RevokedPacks {
  readonly packs: Readonly<Record<string, readonly string[]>>;
}

export function isRevoked(revoked: RevokedPacks, id: string, version: string): boolean {
  const blocked = revoked.packs[id];
  return blocked !== undefined && blocked.includes(version);
}

/** Host allowlist for pack + model downloads (initial URL only; fetch follows CDN redirects). */
const PACK_HOSTS: readonly string[] = [
  "github.com",
  "objects.githubusercontent.com",
  "huggingface.co",
  // Loopback: unit tests (local HTTP fixtures) and user-run local mirrors.
  // Manifests are built-in constants, never user-supplied, so this cannot
  // be steered at an arbitrary host by anyone but the caller.
  "127.0.0.1",
  "localhost",
];

export function isAllowedPackUrl(rawUrl: string): boolean {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return PACK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Whisper model files (Hugging Face, sizes verified 2026-10-08). */
export interface WhisperModel {
  readonly id: "tiny" | "base" | "small";
  readonly url: string;
  readonly sizeBytes: number;
}

export const WHISPER_MODELS: readonly WhisperModel[] = [
  {
    id: "tiny",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    sizeBytes: 75_000_000,
  },
  {
    id: "base",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    sizeBytes: 142_000_000,
  },
  {
    id: "small",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    sizeBytes: 466_000_000,
  },
];

export function whisperModel(id: string): WhisperModel | null {
  return WHISPER_MODELS.find((m) => m.id === id) ?? null;
}

const RESERVED_STEMS: readonly string[] = [
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/** Direct stream-manifest URLs route to N_m3u8DL-RE when installed. */
export function isManifestUrl(rawUrl: string): boolean {
  const path = rawUrl.trim().split(/[?#]/)[0] ?? "";
  const lower = path.toLowerCase();
  return lower.endsWith(".m3u8") || lower.endsWith(".mpd");
}

/**
 * Windows-safe output stem for pack engines (streamlink -o, N_m3u8DL-RE
 * --save-name): illegal chars + control codes → _, no trailing dots/spaces,
 * reserved names prefixed, capped at 120 chars. Never empty.
 */
export function sanitizeFileStem(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .filter((c) => c >= " " && c !== "\u007f")
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 120)
    .trim();
  const base = cleaned.length > 0 ? cleaned : "download";
  if (RESERVED_STEMS.includes(base.toLowerCase())) return `_${base}`;
  return base;
}

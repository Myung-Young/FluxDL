/**
 * Multi-engine router (Phase 1, pure, no I/O).
 *
 * Modes: auto picks per domain/rules, video pins yt-dlp, images pins gallery-dl.
 * Auto order: user domain table → built-in table → cached probe → unsupported.
 * Overlapping sites (X/Twitter, Reddit, Tumblr, Instagram) default to yt-dlp
 * to preserve existing behaviour; the UI offers "Try other engine".
 */
import type { EngineId, RouterMode } from "./types.js";

export interface DomainRule {
  readonly domain: string;
  readonly engine: EngineId;
}

export type ProbeResult = EngineId | null;

export interface ResolveInput {
  readonly url: string;
  readonly mode: RouterMode;
  /** Lowercase host → engine, user editable. Suffix match. */
  readonly userRules?: Readonly<Record<string, EngineId>>;
  /** Host → cached probe outcome (null = neither supports). */
  readonly probeCache?: Readonly<Record<string, ProbeResult>>;
}

export type ResolveReason =
  | "pinned-mode"
  | "user-rule"
  | "builtin-rule"
  | "probe-cache"
  | "needs-probe"
  | "unsupported";

export interface ResolveOutput {
  readonly engine: EngineId | null;
  readonly reason: ResolveReason;
  /** Lowercase host, or null when the URL is not parseable. */
  readonly host: string | null;
}

/**
 * Image-first hosts that default to gallery-dl. Everything else falls
 * through to yt-dlp (video default) unless a user rule or probe says otherwise.
 */
const GALLERY_HOSTS: readonly string[] = [
  "commons.wikimedia.org",
  "flickr.com",
  "imgur.com",
  "pixiv.net",
  "deviantart.com",
  "artstation.com",
  "danbooru.donmai.us",
  "gelbooru.com",
  "pinterest.com",
  "wallhaven.cc",
];

export const BUILTIN_ENGINE_RULES: readonly DomainRule[] = GALLERY_HOSTS.map((domain) => ({
  domain,
  engine: "gallery-dl",
}));

export function domainOf(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.trim().toLowerCase();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

function matchSuffix(host: string, rules: Readonly<Record<string, EngineId>>): EngineId | null {
  const direct = rules[host];
  if (direct !== undefined) return direct;
  for (const [suffix, engine] of Object.entries(rules)) {
    if (suffix.length === 0) continue;
    if (host === suffix || host.endsWith(`.${suffix}`)) return engine;
  }
  return null;
}

function builtinMatch(host: string): EngineId | null {
  for (const rule of BUILTIN_ENGINE_RULES) {
    if (host === rule.domain || host.endsWith(`.${rule.domain}`)) return rule.engine;
  }
  return null;
}

export function resolveEngine(input: ResolveInput): ResolveOutput {
  if (input.mode === "video") {
    return { engine: "yt-dlp", reason: "pinned-mode", host: domainOf(input.url) };
  }
  if (input.mode === "images") {
    return { engine: "gallery-dl", reason: "pinned-mode", host: domainOf(input.url) };
  }
  const host = domainOf(input.url);
  if (host === null) return { engine: null, reason: "unsupported", host };
  const userHit = matchSuffix(host, input.userRules ?? {});
  if (userHit !== null) return { engine: userHit, reason: "user-rule", host };
  const builtinHit = builtinMatch(host);
  if (builtinHit !== null) return { engine: builtinHit, reason: "builtin-rule", host };
  const cache = input.probeCache ?? {};
  if (host in cache) {
    const probed: ProbeResult | undefined = cache[host];
    if (probed === undefined) return { engine: null, reason: "needs-probe", host };
    if (probed === null) return { engine: null, reason: "unsupported", host };
    return { engine: probed, reason: "probe-cache", host };
  }
  // No table hit and no cached probe: default to yt-dlp (existing behaviour)
  // when the host looks like a video/mixed site, else ask the caller to probe.
  // Conservative: unknown hosts need a probe rather than a blind guess.
  return { engine: null, reason: "needs-probe", host };
}

/** Engine badge label for job cards/history. */
export function engineLabel(engine: EngineId | null | undefined): string {
  if (engine === "gallery-dl") return "Images";
  return "Video";
}

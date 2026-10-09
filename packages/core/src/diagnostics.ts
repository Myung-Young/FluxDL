import type { AppSettings } from "./types.js";
import type { EngineVersions } from "./engine.js";
import { STRINGS } from "./strings.js";

/**
 * Diagnostics report (M1.8). Pure build + redaction; the Logs screen
 * gathers inputs (versions, settings, history error events, selected log).
 * Section headers come from strings.ts; values are dynamic report content.
 * Secrets are ALWAYS redacted; full URLs only appear when opted in.
 */

export interface DiagnosticError {
  readonly at: number;
  readonly category: string;
  readonly message: string;
}

export interface DiagnosticsData {
  readonly versions: EngineVersions;
  readonly settings: AppSettings;
  readonly errorEvents: readonly DiagnosticError[];
  readonly logTail: string | null;
  readonly logJobTitle: string | null;
  readonly includeUrls: boolean;
  /** Opt-in local crash reports (capped upstream, messages already trimmed). */
  readonly crashes?: readonly { readonly t: number; readonly view: string; readonly message: string }[];
}

export const LOG_TAIL_CHARS = 4000;
export const MAX_ERROR_EVENTS = 10;

/** Last path segment (no node:path in core). */
export function baseName(path: string): string {
  const parts = path.split(/[/\\]+/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

/** user:pass@host -> ***@host (only when credentials are present). */
export function redactProxyCredentials(text: string): string {
  return text.replace(/:\/\/([^/\s:@]+):([^/\s@]+)@/g, "://***@");
}

const SECRET_PARAM = /([?&](?:token|sig|signature|key|auth|sessionid|session|password|passwd|secret)=)[^&\s"'<>]*/gi;

/** Mask secret query params (token=, sig=, key=, …), keeping the URL shape. */
export function redactUrlSecrets(text: string): string {
  return text.replace(SECRET_PARAM, "$1***");
}

/** Strip all http(s) URLs when the user did not opt into including them. */
export function stripUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/g, "[url]");
}

/** C:\Users\<name> -> C:\Users\*** and /home/<name> -> /home/***. */
export function redactUserPaths(text: string): string {
  return text
    .replace(/([A-Za-z]:\\Users\\)[^\\/:*?"<>|]+/g, "$1***")
    .replace(/(\/home\/)[^/:]+/g, "$1***");
}

function redactText(text: string, includeUrls: boolean): string {
  const secrets = redactUrlSecrets(text);
  const urls = includeUrls ? secrets : stripUrls(secrets);
  return redactUserPaths(redactProxyCredentials(urls));
}

function fmtValue(value: string | null): string {
  return value === null || value.trim().length === 0 ? "(unset)" : value;
}

function settingsLines(settings: AppSettings): string[] {
  const s = settings;
  return [
    `downloadDir: ${redactUserPaths(redactProxyCredentials(s.downloadDir))}`,
    `filenameTemplate: ${s.filenameTemplate}`,
    `concurrency: ${String(s.concurrency)}`,
    `speedLimit: ${fmtValue(s.speedLimit)}`,
    `proxy: ${redactProxyCredentials(fmtValue(s.proxy))}`,
    `cookiesFromBrowser: ${fmtValue(s.cookiesFromBrowser)}`,
    `cookiesFile: ${s.cookiesFile === null ? "(unset)" : baseName(s.cookiesFile)}`,
    `embedThumbnail: ${String(s.embedThumbnail)}`,
    `embedMetadata: ${String(s.embedMetadata)}`,
    `subtitles: ${String(s.subtitles)}`,
    `subtitleLangs: ${s.subtitleLangs}`,
    `embedSubs: ${String(s.embedSubs)}`,
    `mergeContainer: ${s.mergeContainer}`,
    `sponsorBlock: ${String(s.sponsorBlock)}`,
    `codecPreference: ${s.codecPreference}`,
    `skipArchived: ${String(s.skipArchived)}`,
    `theme: ${s.theme}`,
    `postDownloadAction: ${s.postDownloadAction}`,
    `autoCheckUpdate: ${String(s.autoCheckUpdate)}`,
  ];
}

/** Build the full diagnostics text (redacted per the toggle). */
export function buildDiagnostics(data: DiagnosticsData): string {
  const L = STRINGS.diagnostics;
  const v = data.versions;
  const lines: string[] = [
    L.reportTitle,
    `${L.reportVersions}: app=${v.app} yt-dlp=${v.ytdlp} ffmpeg=${v.ffmpeg ?? "(unknown)"} os=${v.os ?? "(unknown)"} arch=${v.arch ?? "(unknown)"} electron=${v.electron ?? "(unknown)"} node=${v.node ?? "(unknown)"}`,
    "",
    L.reportSettings,
    ...settingsLines(data.settings),
    "",
    L.reportErrors,
  ];
  const errors = data.errorEvents.slice(-MAX_ERROR_EVENTS);
  if (errors.length === 0) {
    lines.push(L.reportNoErrors);
  } else {
    for (const e of errors) {
      // v1.7.2: `toISOString()` THROWS on a non-finite timestamp. History rows
      // are read from disk and a corrupt `createdAt` (or a `1e999` that JSON
      // parses to Infinity) reaches here, the throw was swallowed by the Logs
      // caller, and Copy/Save diagnostics silently did nothing. A report is
      // more useful with one "?" in it than no report at all.
      const stamp = Number.isFinite(e.at) ? new Date(e.at).toISOString() : "?";
      lines.push(`[${stamp}] (${e.category}) ${redactText(e.message, data.includeUrls)}`);
    }
  }
  lines.push("", L.reportLog + (data.logJobTitle !== null ? ` (${data.logJobTitle})` : ""));
  if (data.logTail === null || data.logTail.trim().length === 0) {
    lines.push(L.reportNoLog);
  } else {
    lines.push(redactText(data.logTail.slice(-LOG_TAIL_CHARS), data.includeUrls));
  }
  const crashes = data.crashes ?? [];
  if (crashes.length > 0) {
    lines.push("", L.reportCrashes);
    for (const c of crashes.slice(0, 5)) {
      const stamp = Number.isFinite(c.t) ? new Date(c.t).toISOString() : "?";
      lines.push(`[${stamp}] (${c.view.slice(0, 64)}) ${redactText(c.message.slice(0, 500), data.includeUrls)}`);
    }
  }
  return lines.join("\n");
}

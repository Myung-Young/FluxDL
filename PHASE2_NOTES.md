# PHASE2_NOTES.md — mobile engine contract (DO NOT START until `GO PHASE 2`)

Phase 2 reuses `packages/core` unchanged (UI, queue, settings, strings, motion)
inside a Capacitor shell. Only the `DownloadEngine` implementation is new: a
Kotlin plugin over youtubedl-android (+ ffmpeg). There are NO mobile files in
this repo yet — this note is the complete contract.

## Reuse as-is (no forks)

- `types.ts`: `MediaInfo`, `FormatOption`, `PlaylistEntry`, `DownloadPreset`,
  `DownloadJob` (including `attempts`/`nextRetryAt`/`destination`), `JobStatus`,
  `AppSettings` (including `embedSubs`), `ThemeName`.
- Pure helpers: `url.ts` (validate EVERY shared-in URL before the engine),
  `errors.ts` (map native failures to the 9 categories, keep raw logs),
  `media.ts` (normalize native metadata into `MediaInfo`),
  `queue.ts` + `queueController.ts` (inject the Kotlin engine + a clock;
  FIFO/concurrency/backoff work unchanged), `settings.ts`, `stores.ts`,
  `strings.ts`, UI screens, `Shell.tsx`, `motion.ts`, `toast.ts`, `notify.ts`.
- Do NOT port `args.ts` / `progress.ts` template: they encode yt-dlp CLI flags
  and `--progress-template` text parsing. The Kotlin side emits structured
  progress natively — map it into the same `EngineProgress` shape instead.

## Implement: all 20 `DownloadEngine` methods

1. `getInfo(url): Promise<MediaInfo>` — metadata only, no files. Honor playlists
   (entries with selectable ids/urls/durations like `--flat-playlist` semantics).
2. `start(job: DownloadJobInput): Promise<string>` — returns an engine id;
   honors the persisted `AppSettings` snapshot (preset mapping, template,
   container, embeds/subs, sponsorblock, rate/proxy/cookies) the way
   `DesktopEngine.start` reads settings from disk.
3. `pause(id)` — stop writes, KEEP partial data for resume.
4. `resume(id)` — continue from partial data (desktop uses `--continue`).
5. `cancel(id)` — stop + best-effort delete of partial files.
6. `onProgress(cb): Unsubscribe` — emit `{id, percent, speed, eta,
downloadedBytes, totalBytes, stage, destination}` with stages
   `downloading|processing|paused|done|error|cancelled`. Destination is the
   final file path (or content-URI string — see below) as soon as known.
7. `getEngineVersion(): Promise<EngineVersions>` — `{ytdlp, ffmpeg, app}` with
   the Android library versions in the first two slots.
8. `updateEngine(): Promise<EngineVersions>` — update path for the bundled
   libraries (whatever youtubedl-android supports; surface failures via the
   error mapper categories).
9. `pickFolder(): Promise<string|null>` — SAF directory picker (null = cancelled).
10. `openPath(path)` — open the finished file (FileProvider/content intent).
11. `revealInFolder(path)` — closest Android equivalent (open the parent
    location; document the behavior difference in-app).
12. `loadSettings/saveSettings` — same `AppSettings` JSON shape; store wherever
    is idiomatic (DataStore/Preferences), sanitized through `mergeSettings`.
13. `loadQueue/saveQueue` — same `DownloadJob[]` JSON; atomic writes; re-queue
    in-flight as `queued` on boot via existing `hydrate()`.
14. `appendHistory/loadHistory/removeHistory/clearHistory` — same JSONL/JSON
    semantics; corrupt lines skipped on load.
15. `getRawLog(id): Promise<string|null>` — per-job native log tail for Logs.

## Android-specific obligations (from the Phase 1 preview)

- Capacitor shell reusing `packages/core`; NO remote content (keep the CSP
  equivalent: local bundle only; `img-src https:` stays for thumbnails).
- Foreground service owns downloads (survives UI close like the desktop tray
  behavior); pause/resume/cancel must work from its notification.
- Share-intent: incoming links go through `normalizeUrl()` before `getInfo()`
  — same validation as desktop paste/drop/clipboard paths.
- Saving via MediaStore/SAF: `destination` strings must round-trip through
  `openPath`/`revealInFolder` and survive reboots — decide URI-vs-path encoding
  up front and keep `isDownloadJob()` accepting it.
- Android 13+ notification permission: `ensureNotificationPermission()` already
  no-ops gracefully; wire the real permission prompt at first download.
- Responsive layout: `Shell.tsx` sidebar becomes bottom nav under a width
  breakpoint + safe-area insets; no `backdrop-filter` on long lists (perf rule
  carries over); honor `prefers-reduced-motion` equivalents.
- Build: `arm64-v8a` APK (debug + signed release) with pinned
  youtubedl-android + ffmpeg versions recorded like `versions.json`.

## Done when (mirror of Phase 1)

Fresh device: share a link in → analyze → video + audio download → queue /
pause / resume across process death → engine update path works. All reused
core tests green, `tsc` strict with no `any`, no Node/Electron imports in core
(and no JVM imports in shared TS — platform code stays behind the interface).

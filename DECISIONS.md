# DECISIONS.md

Log for ambiguous decisions (simplest option wins, keep going).

## M0

- D1: electron-vite + React + zustand, pnpm workspaces (`packages/core`, `apps/desktop`).
- D2: M0 keeps the native window frame; custom frameless titlebar + tray land in M3.
- D3: `APP_NAME` lives only in `packages/core/src/branding.ts`.
- D4: `IPC_CHANNELS` single channel map lives in `packages/core/src/engine.ts`; preload is a thin typed wrapper over it.
- D5: No `apps/mobile`, Capacitor, or Kotlin files until `GO PHASE 2`.
- D6: Versions pinned loosely (`electron ^36`, `vite ^6`, `react ^19`) and resolved at install time for Windows compat.

## M1

- D7: Pure logic (URL normalize, arg builder, progress parser, error mapper, media mapper) lives in `packages/core` with unit tests; `DesktopEngine` only spawns + streams.
- D8: Flags verified vs yt-dlp `2026.08.19` (`--dump-single-json`, `--flat-playlist`, `--newline`, `--progress-template`, `--continue`, `-U`, `--ffmpeg-location`, `--merge-output-format`, embed/subs/sponsorblock/proxy/cookies/rate flags all present).
- D9: Progress template `[GRABBER] downloaded:… total:… percent:… speed:… eta:…` + classic `[download] %` fallback; post-process stages (`Merger`, `ExtractAudio`, …) map to `processing`.
- D10: Pause = `kill()` keep `.part`; resume = relaunch same args (`--continue`); cancel = kill + best-effort delete `destination`, `.part`, `.ytdl`.
- D11: `resolveBinaryPaths`: userData copy → bundled fallback → PATH; `ensureUserDataBinary` copies on first run; `updateEngine` runs `-U` on the userData copy only.
- D12: `fetch-binaries.mjs` pins `YTDLP_VERSION=2026.08.19` (matches installed binary), yt-dlp from `yt-dlp/yt-dlp` + `SHA2-256SUMS`, ffmpeg win64-gpl from `yt-dlp/FFmpeg-Builds` + `checksums.sha256`; unzip via system `tar` args array (no extra deps).
- D13: SponsorBlock toggle = `--sponsorblock-remove all,-filler` / `--no-sponsorblock`; single downloads default `--no-playlist`; per-job raw logs capped at 500k chars, `getRawLog()` exposed for M4 Logs wiring.

## M2

- D14: Queue machine is pure in core (`queue.ts` transitions, FIFO `selectNextToStart`, `computeBackoffMs` 2s doubling capped 30s); `QueueController` takes injected engine + clock, no internal timers — `pump()` drives starts/retries deterministically.
- D15: `DownloadJob` gains `attempts`/`nextRetryAt`; auto-retry keeps attempts, manual `retry()` resets to 0; past-max failures, done, and cancelled jobs move to history; manual `resume()` calls `engine.resume` directly (may briefly exceed the cap by design).
- D16: Persist via `DownloadEngine` (renderer talks through it only): electron-store settings, atomic `queue.json` (tmp + rename so kill-mid-write is safe), `history.jsonl` with corrupt-line skip; IPC map grows 11 → 19 channels, preload mirrors 1:1.
- D17: `hydrate()` re-queues in-flight (`analyzing`/`downloading`/`processing`) as `queued` on restart; finished statuses are never restored as active.

## M3

- D18: Frameless via `frame:false` + `titleBarStyle:hidden` + Windows `titleBarOverlay` (neutral black, 44px) instead of custom IPC buttons — keeps snap layouts, adds zero channels; overlay stays neutral across all 3 themes.
- D19: Window close hides to tray (downloads continue); tray Show/Quit owns lifetime; tray icon is a deterministic 32px PNG from `scripts/make-tray-icon.mjs` (committed under `resources/icons`); full `.ico`/installer art lands in M7.
- D20: Inter Variable (OFL, rsms/inter) self-hosted via `@font-face`; bundled into renderer output; zero remote fetches at runtime.
- D21: GSAP helpers (`staggerIn`, `fadeSwap`, `pressScale`, `tweenProgress`) all no-op safely under `prefers-reduced-motion` (JS guard + CSS kill-switch); no `backdrop-filter` anywhere.
- D22: Launch smoke test caught two real bugs: (a) main/preload externalized `@grabber/core` TS sources at runtime — fixed by bundling core (exclude + directory alias) with deep imports so React/CSS never leaks into Node bundles; (b) sandboxed preloads must be CJS — dropped `type:module` from the desktop package (templates do the same) and pointed main at `preload/index.js`. Also centralized `baseUrl` in root tsconfig and added a vitest alias for deep imports.

## M4

- D23: CSP `img-src` allows `https:` for video thumbnails only (script/connect stay `'self'`); thumbnails use `referrerPolicy=no-referrer` with an initials fallback block.
- D24: `EngineProgress`/`DownloadJob` gain nullable `destination`; the engine reports it on every event so cards offer Open file / Show in folder, and the post-download action fires on queue→history transitions within a session.
- D25: `DesktopEngine.start` reads persisted settings from disk itself (template/subs/proxy/etc.) — no `DownloadJobInput` widening; empty template falls back to `%(title)s [%(id)s].%(ext)s`.
- D26: Screen file is `SettingsScreen.tsx` (Windows is case-insensitive: `Settings.tsx` collided with `settings.ts`); main/preload keep deep core imports.
- D27: Verified live over CDP against the built app: nav/view/theme switching plus a real YouTube analyze (preview + 54 advanced formats + preset chips).

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

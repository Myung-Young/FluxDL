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

## M5

- D28: Toasts are a dependency-free zustand store (cap 3, TTL auto-dismiss) rendered with `role=status/alert`; finish/fail also fires a renderer `Notification` (packaged `appUserModelId` in M7 attributes it) — no IPC needed.
- D29: Shortcuts are pure matchers (`shortcuts.ts`): Ctrl/Cmd+, opens Settings everywhere; Ctrl/Cmd+V pastes + analyzes only outside editable fields (native paste untouched), routing through `pendingPaste` so it works from any view.
- D30: View switches move focus to `<main>` (plus a skip link); empty/loading/error states now cover all five screens; token grays were picked against near-black grounds for contrast (spot-checked, not metered).
- D31: Live-verified over CDP: Ctrl+, lands on Settings, skip link focuses main, Ctrl+V with empty clipboard is a safe no-op.

## M6

- D32: Rename to FluxDL = `APP_NAME` only (plus README/AGENTS/docs). npm scopes (`@grabber/*`), `window.grabber`, `GrabberApi`, and on-disk names (`grabber-settings.json`) stay as internal identifiers — no migration, no churn.
- D33: `--trim-filenames 200` added to every download (verified flag exists) so very long titles stay inside Windows path limits.
- D34: Error mapper hardened with a real captured proxy-failure stderr (`Unable to connect to proxy`/`NewConnectionError` → network); true ENOSPC fill is not simulated — write-failure surfacing (bad-path rejection) plus the disk-full message mapping is what's tested.
- D35: Kill/resume is a live integration test (`desktopEngine.integration.test.ts`, skipped without a PATH yt-dlp): real 1MB download into a spaces/unicode dir, pause (kill, keep .part) mid-stream, resume to a complete `.mp4` with destination reported.
- D36: Playwright smoke (`e2e/smoke.e2e.ts`, `*.e2e.ts` so vitest ignores it) launches Electron, injects a mock engine via a `__grabberOverride` seam (preload `contextBridge` props are read-only, so overwrite is impossible), then analyzes + queues + asserts progress with zero page errors.

## M7

- D37: `productName`/`appId` live in the electron-builder config (static JSON cannot import `APP_NAME`; the single source remains `branding.ts` for everything the app itself displays).
- D38: Binaries ship via `extraResources` (unpacked `resources/bin` + tray icon) rather than `asarUnpack` — same guarantee (spawnable outside the asar) matched to how the engine resolves paths.
- D39: `fetch-binaries.mjs` needed two Windows fixes: relative tar args (bsdtar parses `C:` as a host) and `System32\\tar.exe` explicitly (PATH tar is GNU tar, no zip support).
- D40: NSIS is per-user wizard (`perMachine:false`, install dir changeable); portable is a single exe; both verified from `/release` (198MB each, binaries + icon inside).
- D41: Portable verified from a spaces path end to end: launch → analyze → real 1MB mp4 download → completed file on disk, then traces removed.

## R0 (v1.1 baseline)

- D42: `package.json` says `0.1.0` but that IS the shipped v1.0. Version stays until the M1.9 release commit, which bumps straight to `1.1.0` and tags `v1.1.0` (no retroactive `v1.0.0` tag; the M7 commit is the de-facto v1.0).
- D43: Baseline gates all green: `typecheck` ✓, `lint` (0 warnings) ✓, `test` 76 passed (core 62 incl. live-capable unit, desktop 14 incl. 3 live-binary), `build` ✓. Pinned binaries: yt-dlp `2026.08.19` (matches `versions.json` + D8/D12), ffmpeg `N-125875-g5d4d3bdc61-20260731`, PATH yt-dlp present so live tests RAN (not skipped).
- D44: Mobile/Android cancelled permanently: `PHASE2_NOTES.md` → `docs/archive/PHASE2_NOTES.md` (`git mv`, history kept); mobile gotchas in `CLAUDE.md` + `AGENTS.md` replaced with "out of scope"; stale `PHASE2_NOTES.md` pointer in `engine.ts` removed.
- D45: `--ignore-config` was ALREADY in both `buildInfoArgs` and `buildDownloadArgs` — R0 added a regression test only (`args.test.ts`), no engine change.
- D46: Back-compat contract: `fixtures/v1.0/{settings.json,queue.json,history.jsonl}` are real-shaped v1.0 samples; `backcompat.test.ts` (main side) loads them through the real disk loaders. It lives in `apps/desktop` because the eslint `no-restricted-imports` rule has NO test exemption — core tests cannot `node:fs`-read fixture files.
- D47: Flag pre-verification vs pinned binary for v1.1–v1.4: `-S/--format-sort`, `--download-archive`, `--cookies`, `--download-sections`, `--force-keyframes-at-cuts`, `--split-chapters`, `--live-from-start`, `--wait-for-video` ALL present. Empirically: default select on BBB (`aqz-KE-bpKQ`) = `av01+opus/webm`; `-S vcodec:h264` → `avc1`; `-S vcodec:h264,acodec:aac` + `--merge-output-format mp4` → `avc1+mp4a/mp4`; `-S vcodec:vp9` → `vp9`. Codec preference via `-S` sort is viable (M1.1).

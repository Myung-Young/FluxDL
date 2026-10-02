# FluxDL

Premium dark-UI GUI for the yt-dlp CLI. Phase 1 delivers a Windows `.exe`
(per-user NSIS installer + single portable exe) with queueing, themes,
self-updating engine binaries, and persisted settings/history.

> You are responsible for respecting copyright and each site's terms.
> Only download content you own or are allowed to keep.

## Requirements

- Node 20+, pnpm 10+
- Windows 10/11 x64 for running/packaging (dev tooling is cross-platform,
  but binaries and installers target win64)
- No yt-dlp/ffmpeg install needed: `fetch-binaries` downloads SHA256-verified
  `yt-dlp.exe` + `ffmpeg`/`ffprobe` win64 at build time (never committed)

## Dev

```sh
pnpm install        # all workspaces
pnpm dev            # desktop dev window (electron-vite)
pnpm typecheck      # tsc, all workspaces
pnpm lint           # eslint, zero warnings
pnpm test           # vitest unit + integration (integration skips without a PATH yt-dlp)
pnpm build          # production bundles (out/)
```

Desktop extras:

```sh
pnpm --filter @grabber/desktop test:e2e   # Playwright smoke (needs pnpm build first)
pnpm fetch:binaries  # yt-dlp 2026.08.19 + ffmpeg win64-gpl into apps/desktop/resources/bin
pnpm make:icon       # regenerate tray PNG + app ICO (deterministic, no deps)
```

## Release

```sh
pnpm fetch:binaries  # once per clean checkout (gitignored output)
pnpm build
pnpm dist            # NSIS + portable into /release (also gitignored)
```

Artifacts (`/release`):

- `FluxDL-Setup-0.1.0.exe` — per-user NSIS wizard, no admin, install dir changeable
- `FluxDL-Portable-0.1.0.exe` — single exe, runs from any folder (even with spaces)

First run copies `yt-dlp.exe` into userData so self-update (`-U`) works under
Program Files; `ffmpeg`/`ffprobe` resolve from the bundled copy with a PATH
fallback. Packaged `appId` (`app.fluxdl.desktop`) doubles as the Windows
toast `appUserModelId`.

## Layout

```text
packages/core/        shared UI + state, talks ONLY to DownloadEngine
  src/branding.ts     APP_NAME — the one display-name constant
  src/types.ts        MediaInfo, FormatOption, DownloadJob, JobStatus, AppSettings
  src/engine.ts       DownloadEngine interface + IPC_CHANNELS (single map)
  src/url|args|progress|errors|media.ts   pure engine logic, unit-tested
  src/queue.ts        state machine (FIFO, concurrency 1–5, backoff)
  src/queueController.ts  engine-agnostic orchestrator (injected clock/engine)
  src/settings.ts     defaults + sanitizing merge
  src/stores.ts       zustand queue/settings stores over DownloadEngine
  src/Home|Downloads|Library|SettingsScreen|Logs.tsx  the five screens
  src/Shell.tsx       frameless titlebar, sidebar, themes, shortcuts, toasts
  src/motion.ts       GSAP helpers (reduced-motion safe)
  src/strings.ts      every user-facing string, EN
  src/tokens.css      design tokens + 3 [data-theme]s
  src/assets/fonts/   self-hosted Inter Variable (OFL)
apps/desktop/         Electron shell + DesktopEngine (child_process, args arrays only)
  src/main/           window/CSP/tray, binaries resolve, engine, persist, IPC
  src/preload/        typed window.grabber bridge (CJS for the sandbox)
  src/renderer/       thin mount of core App
  e2e/smoke.e2e.ts    Playwright: launch → mocked analyze → queue item
scripts/              fetch-binaries.mjs, make-tray-icon.mjs, make-app-icon.mjs
```

Further reading: `AGENTS.md` (working rules), `CLAUDE.md` (conventions/commands/map),
`DECISIONS.md` (why things are the way they are), `PHASE2_NOTES.md` (mobile contract).

## Conventions (short)

- TypeScript strict, no `any`; conventional commits; surgical edits only.
- Zero Electron/Node imports in `packages/core` (eslint-enforced).
- Never spawn with `shell: true`; every URL validated before the engine.
- After every milestone: gates green → ≤5-line summary → commit. No mobile
  scaffolding until someone types `GO PHASE 2`.

# FluxDL

Premium dark-UI GUI for the yt-dlp CLI. Windows `.exe` (per-user NSIS
installer + single portable exe) with queueing, themes, codec-aware presets,
batch paste, duplicate guard + download archive, actionable errors, taskbar
progress, context menus, bulk queue control, diagnostics, command palette,
onboarding, thumbnail accents, density + accent options, smart playlists,
English + Bahasa Melayu, library health, destination recovery, retry
countdown, settings search, shortcut help, log triage, template validation,
live-stream support, split-by-chapters, audio tag editing, a compact
always-on-top mini window, download statistics, four themes with Windows High
Contrast support, self-updating engine binaries, and persisted
settings/history.

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

- `FluxDL-Setup-1.4.0.exe` — per-user NSIS wizard, no admin, install dir changeable
- `FluxDL-Portable-1.4.0.exe` — single exe, runs from any folder (even with spaces)

First run copies `yt-dlp.exe` into userData so self-update (`-U`) works under
Program Files; `ffmpeg`/`ffprobe` resolve from the bundled copy with a PATH
fallback. Packaged `appId` (`app.fluxdl.desktop`) doubles as the Windows
toast `appUserModelId`.

### Windows SmartScreen warning

**These builds are not code-signed.** SmartScreen shows *"Windows protected
your PC"* for any executable without a publisher signature or reputation — it
is not a malware verdict. Click **More info → Run anyway**.

See [`docs/SIGNING.md`](docs/SIGNING.md) for the signing options (SignPath for
OSS, Azure Trusted Signing, OV/EV), how electron-builder consumes
`CSC_LINK` / `CSC_KEY_PASSWORD`, and how to verify a download with SHA-256.

## Layout

```text
packages/core/        shared UI + state, talks ONLY to DownloadEngine
  src/branding.ts     APP_NAME — the one display-name constant
  src/types.ts        MediaInfo, FormatOption, DownloadJob, JobStatus, AppSettings
  src/engine.ts       DownloadEngine interface + IPC_CHANNELS (single map)
  src/url|args|progress|errors|media.ts   pure engine logic, unit-tested
  src/batch|identity|aggregate|menu|diagnostics.ts  batch, dup guard, status, menu, diag
  src/cache|color|playlist|health|locale.ts  analyze LRU, colour, playlists, health, i18n
  src/destination|settingsFilter|logFilter|validate.ts  dest recovery, settings/log filters, validation
  src/queue.ts        state machine (FIFO, concurrency 1–5, backoff, reorder)
  src/queueController.ts  engine-agnostic orchestrator (injected clock/engine)
  src/settings.ts     defaults + sanitizing merge
  src/stores.ts       zustand queue/settings stores over DownloadEngine
  src/Home|Downloads|Library|StatsScreen|SettingsScreen|Logs.tsx  the six screens
  src/BatchPanel|DuplicatePrompt|ErrorActions|ContextMenu|JobMenu  feature UI
  src/CommandPalette|Onboarding|VirtualList  palette, wizard, virtual list
  src/Shell.tsx       frameless titlebar, sidebar, themes, shortcuts, toasts, mini mode
  src/motion.ts       GSAP helpers (reduced-motion safe)
  src/strings.ts      every user-facing string, EN
  src/tokens.css      design tokens + 4 [data-theme]s + forced-colors pass
  src/assets/fonts/   self-hosted Inter Variable (OFL)
apps/desktop/         Electron shell + DesktopEngine (child_process, args arrays only)
  src/main/           window/CSP/tray/taskbar, binaries resolve+repair, engine, persist, IPC, window chrome
  scripts/soak.mjs    idle CPU/RAM soak (hide the window, sample app metrics)
  src/preload/        typed window.grabber bridge (CJS for the sandbox)
  src/renderer/       thin mount of core App
  e2e/smoke.e2e.ts    Playwright: launch → analyze → queue → batch → guard → repair → menu → bulk
  fixtures/v1.0/      v1.0 settings/queue/history samples (back-compat contract)
scripts/              fetch-binaries.mjs, make-tray-icon.mjs, make-app-icon.mjs,
                      make-overlay-dot.mjs
```

Further reading: `AGENTS.md` (working rules), `CLAUDE.md` (conventions/commands/map),
`DECISIONS.md` (why things are the way they are), `CHANGELOG.md` (release notes),
[`docs/SIGNING.md`](docs/SIGNING.md) (code signing + SmartScreen).

## Conventions (short)

- TypeScript strict, no `any`; conventional commits; surgical edits only.
- Zero Electron/Node imports in `packages/core` (eslint-enforced).
- Never spawn with `shell: true`; every URL validated before the engine.
- After every milestone: gates green → ≤5-line summary → commit. Mobile is
  out of scope (cancelled permanently).

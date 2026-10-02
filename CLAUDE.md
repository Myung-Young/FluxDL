# CLAUDE.md

## Conventions

- TypeScript strict, no `any` (`@typescript-eslint/no-explicit-any: error`).
  `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are on: handle
  `undefined`/`null` explicitly, never assume.
- **Surgical edits only**: touch the minimum files for the task, no drive-by
  rewrites, no unrelated refactors. New features add files; fixes edit in place.
- Display name lives in exactly ONE constant: `APP_NAME` in
  `packages/core/src/branding.ts`. Never hardcode it (window title, tray,
  notifications, docs all read the constant; renderer sets `document.title`
  at boot). npm scopes (`@grabber/*`), `window.grabber`, and on-disk names
  are internal identifiers and stay as-is.
- All UI + state lives in `packages/core` and talks ONLY to the
  `DownloadEngine` interface (`packages/core/src/engine.ts`). Zero
  Electron/Node imports in core — enforced by eslint `no-restricted-imports`
  (vitest imports are allowed in tests).
- NEVER spawn with `shell: true`. Always an args array. Validate/normalize
  every URL via `normalizeUrl()` before it reaches the engine.
- Electron security baseline: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, typed preload over the single `IPC_CHANNELS` map in core,
  CSP in main header + renderer meta (scripts/connect locked to `'self'`,
  `img-src` additionally allows `https:` for thumbnails), no remote code,
  no telemetry. Sandboxed preloads must be CommonJS (desktop ships CJS
  output for main/preload for exactly this reason).
- Pure logic goes in core with unit tests (url/args/progress/errors/media,
  queue machine, settings merge, toast/shortcut helpers). Platform code goes
  in `apps/desktop/src/main`. The renderer is a thin mount.
- Ambiguous decision → simplest option, log it in `DECISIONS.md`, keep going.
  Ask the user only if truly blocked.
- After EVERY milestone: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  (plus `test:e2e` when the app shell changed), fix failures, ≤5-line summary,
  conventional commit. Never proceed on red.

## Commands

- `pnpm install` — all workspaces
- `pnpm dev` — desktop dev window
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` — gates
- `pnpm --filter @grabber/desktop test:e2e` — Playwright smoke (run `build` first)
- `pnpm fetch:binaries` — pinned yt-dlp + ffmpeg win64, SHA256-verified, gitignored
- `pnpm make:icon` — regenerate tray PNG + app ICO (deterministic scripts)
- `pnpm dist` — NSIS installer + portable exe into `/release`
- `pnpm --filter @grabber/desktop build` — desktop bundle only

## Architecture map

- `packages/core/src/branding.ts` — `APP_NAME`.
- `packages/core/src/types.ts` — `MediaInfo`, `FormatOption`, `PlaylistEntry`,
  `DownloadPreset`, `DownloadJob` (+`attempts`/`nextRetryAt`/`destination`),
  `JobStatus`, `AppSettings` (+`embedSubs`).
- `packages/core/src/engine.ts` — `DownloadEngine` (20 methods),
  `IPC_CHANNELS` (20 channels), `EngineProgress` (+`destination`), `EngineVersions`.
- `packages/core/src/url|args|progress|errors|media.ts` — pure engine logic.
  `args.ts` owns the machine `--progress-template` and `--trim-filenames 200`.
- `packages/core/src/queue.ts` — transition table, FIFO selector, backoff,
  history search/prune. Illegal transitions throw.
- `packages/core/src/queueController.ts` — FIFO orchestrator, injected
  engine + clock, no internal timers (`pump()` drives starts/retries).
- `packages/core/src/settings.ts` — `DEFAULT_SETTINGS`, sanitizing `mergeSettings`.
- `packages/core/src/stores.ts` — zustand stores bound to a `DownloadEngine`.
- `packages/core/src/Home|Downloads|Library|SettingsScreen|Logs.tsx` — screens.
- `packages/core/src/Shell.tsx` — titlebar/sidebar/themes/shortcuts/toasts/focus.
- `packages/core/src/{motion,strings,toast,notify,shortcuts,clipboard}.ts` — helpers.
- `packages/core/src/tokens.css` + `fonts.css` — tokens, 3 themes, self-hosted Inter.
- `apps/desktop/src/main/index.ts` — frameless window + overlay, CSP, tray
  (close hides; tray owns lifetime), userData binary copy.
- `apps/desktop/src/main/binaries.ts` — userData copy → bundled → PATH resolve.
- `apps/desktop/src/main/desktopEngine.ts` — `DownloadEngine` over `child_process`
  (pause=kill keep .part, resume=same args with `--continue`, cancel=kill+cleanup,
  settings read from disk per download, destination on every event).
- `apps/desktop/src/main/persist.ts` — electron-store settings, atomic
  `queue.json`, `history.jsonl` (corrupt lines skipped).
- `apps/desktop/src/main/ipc.ts` — typed handlers with arg validation.
- `apps/desktop/src/preload/index.ts` — `window.grabber` 1:1 mirror (CJS).
- `apps/desktop/src/renderer/` — mounts core `App`, sets title from `APP_NAME`.
- `apps/desktop/e2e/smoke.e2e.ts` — `*.e2e.ts` so vitest ignores it; mock engine
  via `__grabberOverride` (contextBridge props are read-only).
- `apps/desktop/src/main/*.integration.test.ts` — live yt-dlp tests, skip
  without a PATH binary.
- `scripts/` — `fetch-binaries.mjs` (bsdtar via System32, relative paths),
  `make-tray-icon.mjs`, `make-app-icon.mjs`.

## Gotchas learned (don't regress)

- Main/preload must BUNDLE `@grabber/core` (exclude + directory alias) and use
  deep imports — otherwise Node tries to load workspace TS at runtime, and
  React/CSS leaks into Node bundles.
- tsconfig `baseUrl` lives in the ROOT config only; desktop drops `rootDir`
  (cross-package sources break it under `noEmit`).
- `Settings.tsx` collides with `settings.ts` on Windows — screen is
  `SettingsScreen.tsx`.
- Vitest needs its own alias config for deep core imports (`vitest.config.ts`).
- `window.grabber` cannot be overwritten (frozen bridge) — e2e uses
  `__grabberOverride`, read once by `App.getEngine()`.
- Do NOT create `apps/mobile`, Capacitor, Kotlin, or Android files until the
  user types `GO PHASE 2`. See `PHASE2_NOTES.md` for the mobile contract.

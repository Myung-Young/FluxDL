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
- `packages/core/src/types.ts` — `MediaInfo` (+`extractor`/`videoId`),
  `FormatOption` (+`width`/`height`), `PlaylistEntry`, `DownloadPreset`,
  `DownloadJob` (+`attempts`/`nextRetryAt`/`destination`, optional
  `useArchive`/`extractor`/`videoId`/`cookiesFromBrowser`/`errorCategory`/`fileDeleted`),
  `JobStatus`, `AppSettings` (+`embedSubs`, `codecPreference`, `skipArchived`,
  `cookiesFile`), `CodecPreference`, `VideoPreset` (+`"Compatible"`).
- `packages/core/src/engine.ts` — `DownloadEngine` (31 methods),
  `IPC_CHANNELS` (31 channels), `EngineProgress`
  (+`destination`/`errorMessage`/`errorCategory`), `EngineVersions`
  (+optional `os`/`arch`/`electron`/`node`), `RepairReport`,
  `AggregateProgressState`, `ThumbnailColor`, `GetInfoInit`.
- `packages/core/src/url|args|progress|errors|media.ts` — pure engine logic.
  `args.ts` owns the machine `--progress-template`, `--trim-filenames 200`,
  `--ignore-config` (every spawn), `-S` codec sorts, `--download-archive`,
  `--cookies`. `errors.ts` maps stderr to `{category, message, actions[]}`.
  `media.ts` maps dumps + `estimatePresetSize`/`formatSize`.
- `packages/core/src/queue.ts` — transition table, FIFO selector, backoff,
  history search/prune, `reorder()` (createdAt permutation, queued only).
  Illegal transitions throw. `paused` accepts progress/done (resume lands).
  `retryInSeconds()` reports the live backoff countdown.
- `packages/core/src/aggregate.ts` — aggregate status, speed formatting,
  taskbar gate, `formatWindowTitle()` for the `(N) App` title.
- `packages/core/src/queueController.ts` — FIFO orchestrator, injected
  engine + clock, no internal timers (`pump()` drives starts/retries);
  per-job cookie/preset overrides, remove/reorder, pauseAll/resumeAll,
  cancelQueued, clearFinished, retryAll.
- `packages/core/src/{batch,identity,aggregate,menu,diagnostics}.ts` — batch
  parse/state, duplicate guard, aggregate status, menu matrix, diagnostics.
- `packages/core/src/{cache,color,playlist,health,locale}.ts` — analyze LRU,
  colour/contrast scales, playlist sanitize + entry states, library health,
  locale resolution/formatting.
- `packages/core/src/destination.ts` — mojibake detector + fallback picker
  (video-id match, else newest recent media).
- `packages/core/src/settingsFilter.ts` — settings search matcher
  (multi-word AND over label + id + English keywords).
- `packages/core/src/logFilter.ts` — raw-log line filter (text + errors-only).
- `packages/core/src/validate.ts` — settings field hints (template/speed/preview).
- `packages/core/src/{BatchPanel,DuplicatePrompt,ErrorActions,ContextMenu,JobMenu}.tsx` —
  batch UI, guard dialog, error buttons, themed menu, menu builder.
- `packages/core/src/{CommandPalette,Onboarding,VirtualList}.tsx` — palette,
  first-run wizard (+ step machine), virtualized list.
- `packages/core/src/ShortcutsDialog.tsx` — `?` help dialog (+ pure row table).
- `packages/core/src/settings.ts` — `DEFAULT_SETTINGS`, sanitizing `mergeSettings`.
- `packages/core/src/stores.ts` — zustand stores bound to a `DownloadEngine`.
- `packages/core/src/Home|Downloads|Library|SettingsScreen|Logs.tsx` — screens.
- `packages/core/src/Shell.tsx` — titlebar/sidebar/themes/shortcuts/toasts/focus,
  aggregate footer, throttled taskbar updates, settings-section deep links.
- `packages/core/src/{motion,strings,toast,notify,shortcuts,clipboard}.ts` — helpers
  (`flipShift`, toast actions, clipboard read/write).
- `packages/core/src/tokens.css` + `fonts.css` — tokens, 3 themes, self-hosted Inter.
- `packages/core/src/bbb-54formats.json` — real 53-format capture for estimator tests.
- `fixtures/v1.0/` — v1.0 settings/queue/history samples (back-compat contract).
- `apps/desktop/src/main/index.ts` — frameless window + overlay, CSP, tray
  (close hides; tray owns lifetime), userData binary copy, taskbar progress +
  overlay dot + error/overlay flags (cleared on show/focus).
- `apps/desktop/src/main/binaries.ts` — userData copy → bundled → PATH resolve;
  SHA256 verify, pinned versions, `repairBinaries`.
- `apps/desktop/src/main/desktopEngine.ts` — `DownloadEngine` over `child_process`
  (pause=kill keep .part, resume=same args with `--continue`, cancel=kill+cleanup,
  settings read from disk per download, destination on every event incl.
  Merger/ExtractAudio, `isAllowedPath` trust boundary, archive/cookies plumbing,
  update-blocked-while-active, `repairEngine`).
- `apps/desktop/src/main/taskbar.ts` — pure taskbar mode resolver.
- `apps/desktop/src/main/thumbnail.ts` — guarded thumbnail fetch + BGRA decode.
- `apps/desktop/src/main/persist.ts` — electron-store settings, atomic
  `queue.json`, `history.jsonl` (corrupt lines skipped), history update.
- `apps/desktop/src/main/ipc.ts` — typed handlers with arg validation.
- `apps/desktop/src/preload/index.ts` — `window.grabber` 1:1 mirror (CJS).
- `apps/desktop/src/renderer/` — mounts core `App`, sets title from `APP_NAME`.
- `apps/desktop/e2e/smoke.e2e.ts` — `*.e2e.ts` so vitest ignores it; mock engine
  via `__grabberOverride` (contextBridge props are read-only). Mock mirrors
  `DEFAULT_SETTINGS` + unique engine ids + pause/resume events.
- `apps/desktop/src/main/*.integration.test.ts` — live yt-dlp tests, skip
  without a PATH binary.
- `scripts/` — `fetch-binaries.mjs` (bsdtar via System32, relative paths),
  `make-tray-icon.mjs`, `make-app-icon.mjs`, `make-overlay-dot.mjs`.

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
  `__grabberOverride`, read once by `App.getEngine()`. The mock must mirror
  `DEFAULT_SETTINGS` field-for-field (a missing field once crashed Logs).
- Mobile/Android is out of scope (cancelled permanently; the old
  Phase 2 contract is archived under `docs/archive/` for reference only).
  Never create `apps/mobile`, Capacitor, Kotlin, or Android files.
- Frozen yt-dlp prints non-ASCII paths as mojibake no matter what
  (`PYTHONIOENCODING`/`PYTHONUTF8` verified no-ops) — never trust printed
  paths for non-ASCII dirs; Open/Reveal must existence-check.
- `DesktopEngine.start()` rebuilds its input: every new `DownloadJobInput`
  field must be carried over explicitly or it silently drops.
- `resolveJsonModule` is on (JSON fixtures importable in core tests, which
  still cannot use `node:*` — eslint has no test exemption).
- Interface callback props use property style (`onClose: () => void`), never
  method shorthand — `unbound-method` flags the latter.
- Windows filename collisions (never `X.tsx` + `x.ts` in one dir):
  `SettingsScreen`, `Onboarding` (machine inside the component),
  `health` (not `library`).

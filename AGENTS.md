# AGENTS.md — FluxDL

Working name is `FluxDL`. It lives in exactly ONE constant: `APP_NAME` in
`packages/core/src/branding.ts`. Never hardcode the display name elsewhere.

## Scope

- PHASE 1 only: `packages/core` + `apps/desktop` (Electron, Windows .exe).
- Mobile/Android is out of scope (cancelled permanently). Never create
  `apps/mobile`, Capacitor, Kotlin, or Android files.
- Future edits must be surgical: touch minimum files, no unrelated rewrites.

## Non-negotiables

- TypeScript strict, no `any` (`@typescript-eslint/no-explicit-any: error`).
- pnpm workspaces, Node 20+.
- NEVER spawn with `shell: true`. Always pass an args array. Validate/normalize every URL before it reaches the engine.
- Electron security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, typed preload via `window.grabber`, CSP set (main header + renderer meta), no remote content, no telemetry. Everything local.
- All UI + state lives in `packages/core` and talks ONLY to the `DownloadEngine` interface (`packages/core/src/engine.ts`). Zero Electron/Node imports in core (enforced by eslint `no-restricted-imports`).
- Verify yt-dlp flags/output formats against the actual installed binary (`yt-dlp --help`), not memory.
- After EVERY milestone: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Fix failures. <=5 line summary. Then conventional commit. Do not proceed on red.

## Architecture map

- `packages/core/src/branding.ts` — `APP_NAME` constant.
- `packages/core/src/types.ts` — `MediaInfo`, `FormatOption`, `DownloadJob`, `JobStatus`, `AppSettings`, presets.
- `packages/core/src/engine.ts` — `DownloadEngine` interface + `IPC_CHANNELS` single channel map + progress/version types.
- `packages/core/src/App.tsx` + `tokens.css` — shared UI + design tokens.
- `apps/desktop/src/main/` — Electron main (window, CSP, IPC handlers in M1).
- `apps/desktop/src/preload/` — typed `window.grabber` bridge only.
- `apps/desktop/src/renderer/` — thin mount of `App` from core.
- `scripts/` — `fetch-binaries.mjs` (M1): downloads yt-dlp.exe + ffmpeg/ffprobe win64 at build time, SHA256-verified, never committed.

## Commands

- `pnpm install` — install all workspaces.
- `pnpm dev` — run desktop dev window.
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` — gates (all must be green).
- `pnpm --filter @grabber/desktop build` — desktop bundle only.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, …).
- Ambiguous decision → simplest option, log in `DECISIONS.md`, keep going. Ask user only if truly blocked.
- Plain CSS with custom properties (`tokens.css`, `[data-theme]`). No UI kit. No CDNs (self-host fonts in M3).
- Respect `prefers-reduced-motion` when GSAP lands (M3).

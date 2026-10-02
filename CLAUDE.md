# CLAUDE.md

## Conventions

- TypeScript strict, no `any`. Surgical edits only (minimum files, no unrelated rewrites).
- `APP_NAME` in `packages/core/src/branding.ts` is the only place holding the app name.
- Core (`packages/core`) has zero Electron/Node imports; it talks only to `DownloadEngine`.

## Commands

- `pnpm install`
- `pnpm dev`
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build`

## Architecture map

- `packages/core/src/` — branding, types, engine interface + IPC map, App UI, tokens.
- `apps/desktop/src/main` — Electron main, CSP, window.
- `apps/desktop/src/preload` — typed `window.grabber` bridge.
- `apps/desktop/src/renderer` — mounts `App` from core.
- `scripts/` — binary fetcher (M1+).

# Contributing

Thanks for helping with FluxDL. Read this first — the project is strict
about a few things because regressions are expensive with real users.

## Ground rules (`AGENTS.md` / `CLAUDE.md` are binding)

- TypeScript strict, no `any`. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  must all be green (lint allows zero warnings).
- Surgical edits: minimum files, no drive-by rewrites. New features add
  files; fixes edit in place. Conventional commits (`feat:`, `fix:` …).
- Display name lives in exactly ONE constant (`APP_NAME` in
  `packages/core/src/branding.ts`). Internal scopes (`@grabber/*`,
  `window.grabber`) never change.
- UI + state lives in `packages/core` and talks ONLY to the
  `DownloadEngine` interface. Zero Electron/Node imports in core.
- Never spawn with `shell: true` — args arrays only. Validate/normalize
  every URL before it reaches an engine.
- Verify every external flag against the real binary (`--help`), never
  from memory. No new dependency without a `DECISIONS.md` justification.

## Workflow per change

1. Recon (read-only), then implement A → B → C → D per the phase plan.
2. Verify: gates above + `test:e2e` when the app shell changed + the
   yt-dlp regression (video, audio-only, playlist, cancel, retry).
3. Document: `DECISIONS.md` (ambiguous call → simplest option), `CHANGELOG.md`
   (Keep a Changelog), README only for user-facing changes.
4. Report: Done / Skipped (why) / Deviations / Known issues / Manual checklist.

## Bug reports

Use the bug template — it requires the redacted diagnostics export
(Settings → Logs). Reports without it will ask for it first.

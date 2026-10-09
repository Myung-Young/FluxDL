# Release Checklist

Manual pass before every release. Most of this is automated by gates, but
the items below need a human with a Windows PC (F8).

## 1. Gates (all green, in order)

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- `test` includes live yt-dlp integration (needs internet); a network
  timeout is environmental, a deterministic failure is a regression (D89/D97).
- Playwright smoke needs `pnpm build` first:
  `pnpm --filter @grabber/desktop test:e2e`.
- `pnpm audit` is advisory, not gated: triage per the DECISIONS audit
  posture (pinned Electron 36.x + dev-only findings). Record anything new.

## 2. Version + notes

- Bump `package.json` (root, `apps/desktop`, `packages/core`) together.
- Add a `CHANGELOG.md` section and mirror the highlights into
  `packages/core/src/changelog.ts` (in-app Changelog tab).
- Tag `vX.Y.Z` on the release commit.

## 3. Artifacts

```sh
pnpm fetch:binaries  # once per clean checkout
pnpm dist            # NSIS + portable into /release (gitignored)
```

- Keep only the newest installer + portable in `/release/`; delete older
  versioned artifacts first (GitHub keeps their history).
- Verify sizes (~190–210 MB each) and that both boot.

## 4. Packaged smoke (the historically-skipped pass)

Do this on the **portable** build at least once per release:

1. Launch from a path **containing spaces** (e.g. `C:\Users\<you>\My Apps\`).
2. Analyze one real video → check the preset chips + size estimates.
3. Download it → confirm the file lands on disk and Open file works.
4. Toggle one setting → restart → confirm it persisted.
5. Quit from the tray → confirm the tray icon is gone (no ghost).

Known gaps carried forward: builds are unsigned (SmartScreen expected),
yt-dlp prints non-ASCII paths as mojibake (recovery scan covers it).

## 5. Publish

Automated one-command publish:
```sh
pnpm release
```
This script automatically:
- Reads version from `package.json`
- Extracts the release section from `CHANGELOG.md`
- Tags `vX.Y.Z` in git & pushes to GitHub
- Uploads the installer (`FluxDL-Setup-*.exe`) and portable (`FluxDL-Portable-*.exe`) to the GitHub Release.

After publishing, launch the previous portable once and confirm the update reminder appears.

Notes for the in-app updater (v1.6.1+):
- The app force-reads the `releases/latest` endpoint: publish releases
  oldest-first, keep them full releases (drafts/prereleases are skipped by
  that endpoint), and use parseable tags (`v1.6.1`).
- Name the installer `FluxDL-Setup-<v>.exe`: the auto-installer discovers
  exactly that pattern. A portable-only release shows "no installer" in
  the popup instead of failing oddly. Needs `GH_TOKEN`/`GITHUB_TOKEN` with
  `contents:write` in the environment.


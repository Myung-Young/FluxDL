# PHASE 3 PLAN — Queue v2, subscriptions, library, templates

Source: docs/UPDATE_PLAN.md § Phase 3. Recon: two subagent surveys (2026-10-07).

## 0. What already exists (skip, don't rebuild)

- Queue: reorder (queued-only), per-job pause/resume, pauseAll/resumeAll,
  retry/retryAll, startAfter scheduling, backoff, FIFO pump, JSON persist.
- Watchlist: shape + manual check + queueFresh (global preset) + experimental
  launch check in Shell. No intervals, no auto-download, no per-sub settings.
- Library view: search, missing-file badge + Locate, trash delete,
  re-download (engine-preserving), VirtualList ≥200 rows. No filters/sort/grid.
- Tray (Show/Mini/Quit), single-instance, fluxdl:// protocol, clipboard
  poll (Home opt-in), launchAtLogin, renderer Notification (no actions),
  shortcuts + cheat sheet, density, Stats page, filenameTemplate + 3 presets
  + live preview/validation, backup export/import (settings+queue+history).
- Persist: plain atomic JSON/JSONL, no SQLite, no electron-store (D94).
- Missing: priorities, per-engine concurrency, time windows, per-job proxy,
  Plex/by-site templates, subscription polling, filters/sort, tray pause-all,
  notification actions, sleep resume, corrupt-store recovery, watchlist backup.

## 1. Tasks

### A. Core — DONE except per-sub preset/engine UI
- [x] Subscriptions (headline). Extend WatchChannel → per-sub
      `{mode, folder, preset, engine, intervalMin≥30,
      paused, failCount, autoDisabled}` (core `subscriptions.ts` pure:
      dueSubs(), cap-50 guard, backoff/auto-disable counters).
      Renderer-side poller hook (no new IPC: getInfo + enqueue exist),
      runs while app open, first check = baseline only, toast + confirm
      above cap, notice on auto-disable. Migration: old watchlist rows get
      defaults via normalizer.
- [x] Queue v2 gaps. Numeric `priority` (0 low / 1 normal / 2 high, default
      1): pump sorts (priority desc, createdAt asc); reorder still permutes
      createdAt (documented: works within a tier). Per-engine concurrency:
      settings `concurrencyGallery` (default 2, conservative);
      yt-dlp keeps the global cap. Card priority cycler. Tests for ordering.
      (Also fixed: settings caps never reached the pump — Shell syncs them.)
- [x] Scheduler & limits. Time window settings
      `{downloadWindowStart, downloadWindowEnd: "HH:MM"|null}`: pump skips
      starts outside the window (queued jobs wait, running jobs finish).
      Per-job proxy override (`proxyOverride?` on DownloadJobInput →
      jobArgs → `--proxy`, IPC validator + tests). Global speedLimit stays.
- [x] Naming templates. Add Plex/Jellyfin-friendly + By-site/uploader
      presets to the existing preset list + token buttons; pure + tests.
      Live preview + validation already exist — reuse.
- [ ] Per-sub preset/engine picker UI (types + enqueue path ready; Library
      exposes mode/interval/pause/folder) — deferred to keep the diff
      reviewable.

### B. Stability — DONE except suspend-pause
- [x] Corrupt-store recovery: persist load failure → rename to `*.corrupt-<ts>`
      + recreate + renderer notice (toast via consumeRecoveryNotices at boot).
      Covers settings/queue/watchlist (history is line-resilient already).
      Test with garbage fixtures.
- [x] Backup v2: include watchlist; EXCLUDE secrets on export
      (proxy URL, cookiesFile path, cookiesFromBrowser) with a `redacted`
      report; import re-sanitizes. Tests.
- [x] Sleep resume: renderer `online` event → `pump()`
      (cheap, no IPC). Suspend-pause deferred (main↔renderer desync risk,
      recorded D169).
- [x] Single-instance: exists, no change. Missing-file relink: exists.

### C. QoL — DONE except tray pause-all
- [x] Tray: add "Open downloads folder" (main-side, exists fn) to menu.
      "Pause all" DEFERRED (needs new IPC + queue desync risk) — recorded D169.
- [x] Notifications with actions: main-side Electron Notification in the
      engine finish path (Open file / Show in folder buttons), only when
      the window is unfocused; renderer Notification stays as the focused
      case (exactly-once split). No new IPC (main owns both finish
      detection and focus state).
- [x] Library filters (engine, kind, site) + sort (newest/oldest/title/size)
      + grid/list toggle (reuse density tokens). Search exists.
- [x] Clipboard watcher / protocol / shortcuts / auto-start: exist, no change.

### D. Polish — DONE
- [x] Library grid (plain, capped 300 — virtualization clips variable card
      heights) + list keeps VirtualList; skeleton/checking states exist;
      empty states per filter (emptySearch shows under filters); sidebar
      count badges (downloads queue + library last-known count).
- [ ] E (after DoD, low-risk only): user tags/favorites, library CSV export.
      Stats page exists — no change.

### Explicitly deferred (→ ROADMAP)

- SQLite migration (stays JSON: history cap 5000 JSONL append-only + queue
  tiny; zero native deps; 1000-row perf asserted by test — D-new).
- Cached video thumbnails (ffmpeg screenshots: main-side cost + cache
  invalidation; rows stay text + preview modal).
- PO-token/bgutil, per-domain concurrency, bandwidth schedule, global
  custom format string (prior Ds stand).

## 2. Files touched (surgical)

New: core `subscriptions.ts(+test)`; desktop `subscriptions.test.ts`? (renderer
hook tested via existing store fakes — hook itself untested, core pure fns
tested).
Edit: `types.ts`, `settings.ts(+test)`, `queue.ts(+test)`,
`queueController.ts`, `watchlist.ts`, `jobArgs.ts(+test)`, `ipc.ts`
(validator only), `persist.ts` (recovery + watchlist backup),
`backup.ts(+test)`, `desktopEngine.ts` (finish notify), `index.ts`
(tray item), `Library.tsx`, `Downloads.tsx` (priority cycler),
`SettingsScreen.tsx` (window/proxy/templates/subs UI), `Shell.tsx` (poller
hook + online→pump), `validate.ts` (HH:MM), `strings.ts` (EN+MS),
`e2e/smoke.e2e.ts` (settings mirror only if shape changes),
`DECISIONS.md`, `CHANGELOG.md`, `ROADMAP.md`.

No new IPC channels. No new dependencies.

## 3. Risks

- Pump ordering change → FIFO expectations in existing tests. Mitigate:
  default priority keeps old order; update only failing tests deliberately.
- Per-job proxyoverride dropped at a hop (R1 lesson) → Input + toStartInput
  + jobArgs + IPC validator + test together.
- Subscription polling hammers sites → min 30 min clamp, sequential checks,
  per-channel fail backoff, global cap, first-run baseline.
- Window settings hand-edit garbage → HH:MM cleaner falls back to null (off).
- Secrets in backup → redaction list reviewed in test (assert no proxy/cookies
  keys in export JSON).

## 4. Test plan

- New: subscriptions due/cap/backoff/disable; priority ordering; window
  gating (fake clock); proxyOverride argv; template presets; corrupt-store
  recovery; backup redaction; tray menu shape (if testable); notify action
  wiring (mock Notification).
- Existing: full gates + live archive test + yt-dlp regression
  (video/audio/playlist/cancel/retry) + 1000-row library perf assertion.

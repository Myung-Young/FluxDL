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

## M1.1

- D48: Two destination-tracking findings while verifying the Compatible preset. (a) FIXED: the engine only parsed `[download] Destination:` (per-stream temps), so merged YouTube downloads reported a deleted `.f*.mp4`/`.m4a` temp — now `[Merger] Merging formats into "…"` and `[ExtractAudio] Destination:` also update the destination. (b) KNOWN LIMITATION (honest attempt, rule 12): the frozen yt-dlp Windows binary prints non-ASCII path segments as mojibake (`münchen 輸入` → `m�nchen `) no matter what — `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1` both verified no-ops, and `--print-to-file "%(filepath)s"` yields `NA`. Recovery is impossible (chars are lossy-replaced), so for non-ASCII download dirs the reported destination may not resolve; Open/Reveal paths must existence-check (M1.3 `fileExists` guard covers the miss). No new dependency to fix this (no iconv); reverted the env experiments.

## M1.3

- D49: Duplicate guard stores `extractor`/`videoId` on the job (UI-known for singles, null otherwise) so `youtu.be/x` and `youtube.com/watch?v=x` match via `extractor::id`; pure-URL fallback otherwise. New optional persisted fields (`useArchive`, `extractor`, `videoId`) ride the existing loaders untouched (rule 2; backcompat test pins it). `useArchive` is decided UI-side (`skipArchived && playlist-target && !forceFresh`) so main stays playlist-agnostic; singles never touch `archive.txt`. `DesktopEngine.start()` rebuilds its input — the new field must be carried over explicitly (caught by the live archive test). Library "Download again" bypasses the guard (explicit intent = "Download anyway") and forces fresh. Engine grows `fileExists` + `clearArchive` (20 → 22 methods/channels); `openPath`/`revealInFolder`/`fileExists` share one `isAllowedPath` guard (download roots + active/history destinations). Live proof: second `--download-archive` run skips (`already been recorded`), `archive.txt` holds the id, `clearArchive` removes it.

## M1.4

- D50: Actionable errors. Cookie findings verified live: locked Chrome prints exactly "ERROR: Could not copy Chrome cookie database…", missing Firefox prints "could not find firefox cookies database in …", bogus browsers list the supported set (picker offers chrome/edge/firefox/brave/chromium/opera/vivaldi/whale). New categories `extractor-failed` (signature/403/unable-to-extract → update-and-retry), `cookie-unavailable` (picker with this-job/always scope), `engine-broken` (bad binary → repair). Failure message+category now ride the progress event (cards previously only ever saw "Download failed." — the mapper never reached them); stored as optional `errorCategory` on the job. Per-job cookie override (`setJobCookies`, no persistence churn) vs "always" (setting). `updateEngine` BLOCKS while jobs are active (clear message; pause→update→resume races the controller, so block was chosen) with a UI pre-check too. `repairEngine` re-copies yt-dlp into userData, hash-verifies it against versions.json, presence-checks ffmpeg/ffprobe (their ZIP-level pin can't verify extracted files — documented), then re-runs versions. cookies.txt is validated (must exist), never copied, never logged.

## M1.5

- D51: Taskbar progress. Renderer sends throttled aggregate (250ms gate, pure `shouldSendAggregate`); main owns window-local flags (error until show/focus, finished-while-hidden overlay dot) via a pure `resolveTaskbarCommand` (modes none/normal/indeterminate/error). Percent = mean of downloading jobs; null when only analyzing/processing (indeterminate) or idle (cleared). Speed strings parsed to Bps (`parseSpeedBps`: MiB/KiB/M variants) and summed. Overlay dot is a deterministic 16px PNG from `scripts/make-overlay-dot.mjs` (committed, shipped via extraResources). Engine 23 → 24 methods/channels.

## M1.6

- D52: Card context menu is core-rendered (role=menu, arrows/Home/End, Right-expand/Left-collapse one level, Esc, outside-click close, focus restore; opens on right-click and Shift+F10/Menu key from any focused control in the card — cards stay out of the tab order). Retry-with-preset is an inline-expanding parent (no nested windows). `remove` drops queue entries without history (new controller.remove; active downloads must Cancel first) and `delete` trashes only non-writing outputs (downloading/processing excluded — never pull a file from under the engine). Delete confirms, uses shell.trashItem (never unlink), and marks history via a new updateHistory engine method; `fileDeleted` shows in Library. Engine 24 → 26 methods/channels. Delete shows whenever a destination is known (no async pre-check); missing files surface the engine error via toast.

## M1.7

- D53: Bulk queue control + reorder with zero schema change: `reorder()` permutes createdAt (strictly increasing, ties nudged) so the FIFO selector, snapshots, and hydrate all honor the new order with no migration. Real bug found by the resume-all e2e: after pause, the controller ignored progress/done events (`paused` was missing from those transition sets), so resumed downloads showed "paused" forever — fixed in queue.ts with a regression test. `clearFinished` sweeps lingering error jobs into history (abandoning their retries); `cancelQueued` matches single-cancel semantics (history as cancelled). Drag uses pointer capture + 6px threshold (no handle, text selection intact for clicks), transform/opacity only, FLIP settle via a new `flipShift` motion helper; Alt+Up/Down and context-menu Move up/down are the keyboard paths. Controller.remove/reorder reject non-matching states (illegal transitions throw, tested).

## M1.8

- D54: Diagnostics report is pure (`buildDiagnostics` + redaction unit-tested against proxy creds, secret params, usernames-in-paths, cookie basenames). Secrets-in-URLs are masked ALWAYS; whole URLs only with the opt-in toggle. Platform details ride optional `EngineVersions` fields (no new channel; old mocks show "unknown"). Report headers come from strings.ts (localizable in v1.2); values are dynamic. Save uses a Blob download (no channel, no Node). E2E caught mock drift: the mock settings missed `cookiesFile` and crashed the builder — mock now mirrors DEFAULT_SETTINGS with a comment pointing at it.

## M1.9

- D55: Release v1.1.0. All gates green at tag time: typecheck, lint (0 warnings), 128 core + 30 desktop tests (incl. live-binary integration: analyze, kill/resume, Compatible ffprobe, selector proof, archive skip), build, 6/6 Playwright smoke. `pnpm dist` produced FluxDL-Setup-1.1.0.exe + FluxDL-Portable-1.1.0.exe (~198MB each, same class as 0.1.0). Gap (rule 12): the portable-from-spaces-path GUI pass did not complete in-session — the portable extract+boot exceeded automation timeouts repeatedly, so launch → analyze → real download on the packaged portable is UNVERIFIED; same code paths are live-tested, but run the portable once manually before distributing.

## M2.1

- D56: Command palette registry is data (id + strings key + keywords + when/run) with a hand-rolled fuzzy scorer (substring fast path, subsequence + prefix/consecutive bonuses) and usage-count recency boost; no new dependency. Shell owns open state + memoized context; Ctrl+K is ignored inside editable fields; combobox/listbox pattern with focus trap/restore and staggered entrance. Density toggle command lands in M2.5 (setting does not exist yet); availability predicates are covered by context tests.

## M2.2

- D57: Onboarding adds `onboardingDone` + `defaultPreset` settings (sanitized; Compatible MP4 is the default default). Wizard is non-blocking (Skip discards, Done commits), re-runnable from Settings, engine status shown on the preset step. Home/BatchPanel initialize their presets from the setting. Step machine lives in Onboarding.tsx — NOT onboarding.ts, which collides on Windows (walked straight into D26 and merged). E2E covers replay+skip; mock settings gained the new fields.

## M2.3

- D58: Analyze UX. LRU MediaInfo cache (30 entries, 10-min TTL, injected clock, tested) keyed by normalized URL in Home + BatchPanel; per-row/row-level "Re-analyze" bypasses it. Cancel via requestId: `getInfo(url, {requestId})` (optional — old callers untouched) + `engine.cancelAnalyze()` kills the proc (27 methods/channels); cancellations resolve silently via a cancelled-ids set (IPC only carries message text, so no string-matching on "cancelled"). Timeout is engine-side from `analyzeTimeoutSec` (default 60, clamped 10–300 in Settings). Skeleton is CSS-only shimmer with a reduced-motion kill. No partial/fake results — yt-dlp returns metadata at once. Timeout kill-path shares the cancel mechanism (live-tested via cancel); live timeout left out as flaky, noted here.

## M2.4

- D59: Dynamic thumbnail accent. Main fetches (https only, <=2 MB, 10 s timeout, image/* only, manual redirects blocked off https) and decodes via nativeImage to 32px; dominant colour is a small pure median-cut in core. toBitmap() byte order is BGRA on Windows — PROVEN with a red/green probe PNG in real Electron 36, converted here, unit-tested. deriveAccent clamps saturation then scans lightness for the closest variant reaching 4.5:1 on the card grounds (property-tested on dark themes); scoped to the preview card via --thumb-accent (global chrome keeps theme/user accent), GSAP RGB tween, reduced-motion sets directly. Live path verified in Electron (BBB thumb: 200 image/jpeg, avg 119,134,114). Engine 27 → 28 methods/channels. No renderer canvas (would taint cross-origin).

## M2.5

- D60: Density is a spacing/typography token switch (`[data-density]`) plus a horizontal list-row layout for Downloads/Library cards in compact; Shell sets the dataset like theme. Palette toggle-density command + Settings segmented control. Default comfortable; sanitized like other enums.

## M2.6

- D61: Accent picker. `deriveAccentScale` builds base/hover/active/ghost/on-accent from one hex; on-accent (white/black, higher contrast wins) is enforced to 4.5:1 by shifting lightness, `adjusted` marks auto-changes, `warning` flags the still-failing. 8 swatches + validated custom hex + reset-to-theme; Shell applies --accent/--accent-fg/--accent-soft/--accent-hover/--accent-active (primary buttons consume hover/active). User accent vs theme grounds is NOT second-guessed — only the on-accent text pair is enforced.

## M2.7

- D62: Smarter playlists. Archive format verified live (`youtube <id>` CRLF). Entry identity = parent extractor + entry id (flat-playlist ids ARE video ids), so archive/history matching works; legacy URL fallback retained. New engine methods fileExistsBulk + archiveHas (28 → 30); entries enqueued with extractor/videoId for future matches. Subfolders via sanitized `playlistSubdir` (UI-side sanitize, args-side traversal strip, --trim-filenames kept). Shared VirtualList (fixed rows, overscan, pure window maths) for entry lists and Library ≥200. Per-entry preset overrides, title filter, hide-downloaded toggle; shift range-select kept (operates on the filtered list).

## M2.8

- D63: i18n EN + MS. strings.ts split into EN source-of-truth + MS with a recursive Parity<> type (missing key fails typecheck) plus a runtime key-walk test. Screens read the active dict via useStrings(settings) (strings.ts itself stays dependency-free so main can import it); JobMenu takes it as a param, Toasts/DuplicatePrompt via props. Interpolation ({count}/{n}) on counts, plural() flat in Malay, Intl decimals/dates via localeTag, natural Malay (muat turun, baris gilir, tetapan; tech terms kept). Error mapper localized too (main resolves auto via app.getLocale). Desktop live tests need no changes (PATH binary path). E2E covers the Settings language switch end to end.

## M2.9

- D64: Library health. `deriveMissingIds` (destinations explicitly reported missing) + `chunkDestinations` (40/chunk, UI yields between) are pure and tested; the screen bulk-checks on open with a progress line. Missing badge + Locate (new pickFile engine method, 30 → 31 channels; record updated via updateHistory, fileDeleted cleared) + Remove + Re-download. VirtualList (shared with M2.7) kicks in at 200 rows with fixed 140px rows; search debounces 100 ms. History prune is enforced main-side in appendHistoryToDisk (keep last N, default 500, clamp 10–5000) with a round-trip trim test. (Note: health.ts, not library.ts — Library.tsx collides on Windows per D26.)

## M2.10

- D65: Release v1.2.0. Gates at tag: typecheck, lint (0 warnings), 171 core + 35 desktop tests (live-binary incl.), build, 9/9 Playwright smoke (palette, onboarding, Malay switch covered). Engine 26 → 31 methods/channels across v1.2 (cancelAnalyze, thumbnailColor, fileExistsBulk, archiveHas, pickFile). `pnpm dist` artifacts verified by size + resources; portable spaces-path GUI pass again deferred (same documented gap as v1.1 — long extraction exceeds automation budgets).

## M3.1

- D66: Destination recovery without new channels. Real bug: `extractor`/`videoId` were dropped twice (queueController.pump + DesktopEngine.start rebuilds input), so playlist identity never reached main — fixed both with a carry-over regression test. Mojibake fallback is main-side only when the reported path contains U+FFFD and is missing on disk (directory scan ≤500 files, `[id]` match then newest recent media); otherwise the Missing badge + Locate still owns the miss, so no false re-attribution. Pure picker lives in core `destination.ts` (tested).

## M3.2

- D67: Retry visibility + bulk retry, no new engine methods. `retryInSeconds(job, now)` (pure, tested) drives a 1s-ticking "Retrying in Ns · attempt A" line on error cards (past-due shows "Attempt A"); the ticking interval only mounts while a future deadline exists. `QueueController.retryAll()` re-queues every error job FIFO via the existing `retry()` (attempts reset), exposed through the queue store and as a palette command + bulk button. Strings added EN+MS in parity (downloads.retryAll/retryIn/attempt, commands.retryAll).

## M3.3

- D68: Mock-drift guard + spaces-path hardening. Real drift found: the e2e mock was missing 4 settings fields (`analyzeTimeoutSec`, `thumbnailAccent`, `playlistSubfolder`, `historyLimit`) and the `cancelAnalyze` method — fixed both. A pinned `DEFAULT_SETTINGS` key-list test now fails the suite the moment a new setting lands (comment points at the e2e mirror). Spaces-path: `--output` stays one argv element (new single-argv subfolder test) and the trust boundary explicitly allows spaces+unicode roots; the packaged-portable-from-spaces GUI pass stays a manual pre-distribute step (extraction exceeds automation budgets).

## M3.4

- D69: Settings search + a real duplicate-key bug it exposed. Filter is a pure matcher (`settingsFilter.ts`, tested: empty matches all, multi-word AND, label+id+English keywords so Malay labels still match "proxy") with a `hidden`-per-row UI, match count, and empty state. The new e2e caught ghost inputs: every empty setting shared React key `""` among siblings, so renders multiplied the inputs (5× `#set-proxy`); fixed with stable unique keys (`proxy:…`, `dir:…`, …). Also added a scoped `.settings-grid [hidden]` kill — author `display` rules (`.field-label`, `.url-row`) otherwise beat the UA hidden style and filtered rows stayed visible.

## M3.5

- D70: Shortcut help dialog. Bare `?` (new `isShortcutHelp` matcher, shift-agnostic, ignored inside editable fields like Ctrl+K/V) opens a focus-trapped `role=dialog` (Esc/outside close, focus restore, same pattern as the guard dialog) listing Ctrl+V / Ctrl+K / Ctrl+, / ? / Esc with `<kbd>` styling. Openable from the key, a new always-available palette command (`showShortcuts` added to `CommandContext`), and the Home hint line now mentions `?`. Strings EN+MS in parity; rows helper unit-tested, `?` open/close covered in the palette e2e.

## M3.6

- D71: Logs triage without new engine methods. Pure `logFilter.ts` (tested: empty matches all, multi-word AND, errors-only regex) drives a search box + clear, an errors-only toggle, a match-count/no-match status line, a Refresh button (re-fetch selected), a Copy-log button, and a follow-live pin (scrolls the tail on new text). Search filters the placeholder too, so the e2e needs no jobs. Two honest notes: (a) headless clipboard denies writes, so the e2e accepts either copy note via `.first()` (the diagnostics card shows the same text); (b) a mid-session full-suite flake (onboarding modal blocking tests 4–9, ~2.8 min timeout runs) was chased hard — probes proved the settings store clean (ready/true, zero saves, 3 mock loads), no app timers, no navigation code — and the suite has since gone 10/10 repeatedly; treated as environmental slowness, watching.

## M3.7

- D72: Inline settings validation, hints only. Pure `validate.ts` (tested): template needs `%(ext)s`, speed accepts empty or `4.2M`-style rates, preview substitutes sample metadata. Settings shows a live preview line under the template (draft-tracked, committed on blur as before) and error hints for bad template/speed; nothing blocks saving — the sanitizing merge stays authoritative. Strings EN+MS in parity.

## M3.8

- D73: Window title + finished-toast action. Pure `formatWindowTitle(active, APP_NAME)` (tested: `(N) App` when active, plain name when idle/NaN) applied by a tiny Shell effect over the aggregate count. Finished toasts now carry an Open-file action when a destination is known (ToastAction rendering already existed; the fail path already had Retry). No new channels, no new strings.

## M3.9

- D74: Small a11y pass, zero new strings. Progress bars expose `aria-valuetext` (`42%`); empty states (Downloads, Library incl. no-match, Batch, palette no-match) announce via `role=status`; the palette combobox declares `aria-keyshortcuts="Control+k"`. Motion audit: all six GSAP helpers already no-op/set-directly under `prefers-reduced-motion` (verified in `motion.ts`, no change). Global `:focus-visible` ring + skip-link + dialog focus traps already covered the rest.

## M3.10

- D75: Release v1.3.0. Gates at tag: typecheck, lint (0 warnings), 194 core + 36 desktop tests (live-binary incl.), build, 10/10 Playwright smoke (settings search, `?` dialog, log search covered). Engine stays at 31 methods/channels across v1.3 (no new IPC — all features rode existing channels). `pnpm dist` artifacts verified by size + resources; portable spaces-path GUI pass again deferred (same documented gap — long extraction exceeds automation budgets).

## M4.1

- D76: The queue only pumped on mutations, so boot-hydrated jobs stalled as queued forever and backoff auto-retries never fired on their own (defeating the backoff design). Fix with no new engine methods: `refresh()` pumps after hydrate, the queue store exposes `pump()`, and Shell runs a 1 s tick. The controller drops overlapping ticks via a reentrancy guard (two overlapping pumps could otherwise hand the same job to the engine twice). Timers stay outside the controller per its no-internal-timers design; the tick is cheap and cleaned up on unmount.

## M4.2

- D77: Onboarding Done/Skip buttons did nothing on first run: `finish()` deferred `onDone()` until the async `save({ onboardingDone: true })` resolved, but on first run `onDone()` only set `replayOnboarding(false)` — already false, a no-op. The modal relied entirely on the zustand store propagating `onboardingDone=true` back through Shell's selector, which could race or fail. Fix: `onDone()` fires immediately (optimistic dismiss), a new `onboardingDismissed` local state in Shell gates the first-run condition, and save runs fire-and-forget. Replay resets `onboardingDismissed` when re-opening. New e2e test covers the Done button path (navigate to last step, click Done, verify dismiss).

## M4.3

- D78: Quality-of-Life & Polish pass (Library 1-click open/reveal, Downloads clearFinished condition & queue sweep, Nav count badge). Library cards now expose "Open file" and "Show in folder" buttons for existing files (reusing existing strings S.downloads.openFile / showInFolder, zero new strings). Downloads toolbar clearFinished was previously disabled when !hasErrors; now correctly checks for any clearable items (error, done, cancelled), and queueController.clearFinished() sweeps all three terminal states into history. The Downloads navigation button now displays a live count badge when jobs exist in the queue.

## R0 (v1.4 baseline)

- D80: v1.4 baseline captured at `9405482`: typecheck + lint (0 warnings) + build green, 214 core + 36 desktop tests (8 live yt-dlp), 11/11 Playwright. Artifact baseline for the v1.4 size delta: portable 198,072,247 B / setup 198,280,803 B (v1.3.0); renderer bundle 1,066.05 kB JS + 19.46 kB CSS. Every v1.4 flag re-verified against the installed binary (yt-dlp 2026.08.19): `--parse-metadata`, `--split-chapters`, `--hls-use-mpegts`, `--wait-for-video`, `--live-from-start`, `--embed-metadata`, `--audio-format`, `--load-info-json`.
- D80b: Audio-metadata injection shape, proven empirically before writing code (offline via `--load-info-json` + `--print-to-file`, then ffprobe on a real mp3). `yt_dlp/postprocessor/metadataparser.py` splits `FROM:TO` on the first **unescaped** colon (regex `(?s)(?P<in>.*?)(?<!\\):(?P<out>.+)$`, then `.replace('\\:', ':')`), evaluates FROM as an **output template** (`%` is a format char, `%%` is a literal one), and compiles TO as a **Python regex** unless TO contains `%(field)s`. So each field is emitted as ``FROM + SENTINEL : (?P<meta_x>ESCAPED)SENTINEL`` with sentinel `~`: FROM escapes `%`→`%%` and **every** `:`→`\:`, TO regex-escapes ``\ ^ $ . | ? * + ( ) [ ] { }``. Four traps found by testing, all now covered by unit tests: (1) **every** literal colon must be escaped or the split lands in the wrong place; (2) a FROM that is a bare `[a-zA-Z_]+` word is treated as a *field reference* and silently evaluates to the `NA` placeholder — the sentinel also defeats this; (3) a FROM ending in `\` makes the FROM:TO regex find no separator and yt-dlp refuses to start; (4) yt-dlp's console/`to_screen` path drops non-ASCII, so tag assertions must read a UTF-8 file or ffprobe, never stdout. Round-trip verified for `:`, `%`, `\`, `\:` pairs, regex metacharacters, `%(title)s`, quotes, unicode + emoji, trailing backslash and empty.

## R1 (v1.4: make the M4.1/M4.2 flags real)

- D81: M4.1/M4.2 shipped UI-only. `--live-from-start`, `--wait-for-video`, `--hls-use-mpegts` and `--split-chapters` were built correctly by `buildDownloadArgs` and unit-tested *in isolation*, but three hand-written copy lists between the UI and the binary (`QueueController.pumpInner`, `ipc.parseJobInput`, `DesktopEngine.start`) each omitted them, so a packaged app never passed them to yt-dlp. Fix: one allow-list, one projection. `queue.ts` grows `pickJobOptions()` (shared by `makeJob` in-bound and `toStartInput` out-bound, so the two directions cannot drift) and `toStartInput()`, used by the controller and the engine. Unknown keys are dropped by design (the renderer is untrusted), which also makes the projection a second trust boundary. `LIVE_STATUSES`/`VIDEO_PRESETS`/`AUDIO_PRESETS` moved into `types.ts` so the IPC validator and `settings.ts` stop hand-copying the unions. The argv mapping moved out of `DesktopEngine.start()` into a pure `jobArgs.buildStartArgs()`, which is what finally makes this hop testable: 13 new desktop tests assert the flags per live status, plus 5 core tests for the projection (round trip, unknown-key drop, empty/false treated as absent). What is proven is the argv handed to `spawn` — the hop that was broken; yt-dlp's own handling of those flags is its documented contract.

## M4.3 (v1.4: audio metadata editor)

- D82: Editable title/artist/album/year for audio presets, applied with `--parse-metadata` + `--embed-metadata` using the D80b spec shape. New pure module `metadata.ts` owns the two escaping functions (`escapeTemplate` for the FROM template, `escapeRegex` for the TO regex) plus the `~` sentinel, so the two sides of every spec are derived from one value and cannot disagree; 21 unit tests pin the exact spec strings for all four R0 traps. `normalizeAudioMetadata()` is the trust boundary at the renderer edge (rebuild from primitives, non-strings become empty). Overrides are a `DownloadJob`/`DownloadJobInput` field carried by R1's projection, so chapters + metadata compose. Tags are only useful embedded, so a non-empty override forces `--embed-metadata` even when the setting is off (and emits it exactly once). Empty fields emit no flag at all — yt-dlp would otherwise write an empty tag. Verified live: a real mp3 downloaded through `DesktopEngine` carries `title="Live: One: 100% (Remaster) 🎵"`, `artist="AC/DC"`, `album="Hits: 1999 [Deluxe]"`, `date="1999"`, asserted with ffprobe. `MediaInfo.uploadDate` was added purely to seed the year field. Editor is hidden for playlists (one title/artist pair cannot describe N entries) and when a raw `-f` format overrides the preset.

## M4.4 (v1.4: mini mode)

- D83: Mini mode is the SAME window with a `[data-mini]` layout, not a second one: `QueueController` lives in the renderer, so a second window would duplicate queue state and contend for the single engine. Geometry therefore cannot live in core, so `DownloadEngine` grows exactly two members — `applyWindowChrome({mini, theme})` and an `onWindowChrome` push — mirroring the existing `setAggregateProgress`/`onProgress` pair. One channel carries both jobs (the M4.4 mini toggle and the M4.6 native titlebar/background colors that must follow a light theme); the theme push also fixes the window chrome on every theme switch. Bounds persist in `<userData>/window-state.json` (main-side), NOT in `AppSettings`: window size is not a user preference, and keeping it out of the settings shape means the pinned settings test and the e2e mock cannot drift. That file is sanitized on load like any other untrusted disk value. Entering mini centers on the current window and remembers the position; leaving restores the remembered normal size; `setAlwaysOnTop(true, "floating")` only while mini. The tray gains a checkbox that drives the same controller, and chrome pushes keep the checkbox and the UI in sync — a tray click cannot reach the renderer without a push channel. One real bug surfaced by the e2e test: `[hidden]` on the sidebar lost to `.grabber-nav { display: flex }`, so mini mode silently kept the sidebar; fixed with a global `[hidden] { display: none !important }` rule instead of a one-off. Tests: 12 core unit tests (metrics, row ordering), 13 desktop tests (geometry, sanitization, persistence) and 2 Playwright tests (keyboard toggle, tray-side push).

## M4.6 (v1.4: stats screen)

- D84: Stats derive entirely from history — nothing is stored twice, so "clearing history clears stats" is stated in the UI rather than enforced. The data model had a real gap: there was no `finishedAt`, and `createdAt` is enqueue time *and is rewritten by `reorder()`*, so day/week buckets keyed on it would drift every time the user dragged the queue. Three optional fields were added (`finishedAt`, `uploader`, `durationSec`); `finish()` stamps `finishedAt` from the injected clock, and Home passes uploader/duration at enqueue. Size is derived (`totalBytes`, else `downloadedBytes`) rather than stored again. Records predating v1.4 have none of these, so every aggregate reports `null`/an "unknown" count instead of a misleading zero — the counts are as load-bearing as the totals. `computeStats()` is pure (12 buckets, Monday-based local weeks, top 5 uploaders, preset mix across all outcomes) with 19 unit tests over mixed old/new records, including clock-skew and out-of-window cases. Charts are hand-rolled SVG/CSS bars — no chart library. The screen is `StatsScreen.tsx`, not `Stats.tsx`, because `stats.ts` + `Stats.tsx` collide on case-insensitive filesystems (the exact trap CLAUDE.md already records for `Settings.tsx`). Two test-only lessons: the e2e nav-count assertion had to move 5 → 6, and view switches animate (`fadeSwap`), so assertions must wait on the target view instead of sampling the DOM right after a click — an early version of the test read the DOM one navigation behind and looked like a data bug.

## M4.7 (v1.4: light theme + forced colors)

- D85: Fourth theme "Paper" (`#faf9f6` grounds, `#1d4ed8` accent, darkened danger/success/warning because `#fbbf24`-class values are invisible on white). D30 had admitted the original token grays were "spot-checked, not metered", so this milestone replaced that with a real test: `apps/desktop/src/main/tokens.test.ts` parses `tokens.css` and asserts 16 text pairs (4.5:1, 7:1 for body text) plus 3 separator pairs per theme, for all four themes — 76 assertions. It lives in the desktop package because core tests cannot read files (eslint bans `node:fs` there) and duplicating the palette into TypeScript would recreate the drift this milestone removes. It failed on the *existing* themes first (as expected): `--fg-2` was 3.55:1 on obsidian's card background and borders were ~1.26:1. `--fg-2` is real text (sidebar footer, placeholders, hints), so it was lifted to ≥4.5:1 and `--border`/`--border-soft` to 1.5/1.2:1 with a minimal hue-preserving nudge per theme (`#8b8b99`, `#8a8cae`, `#a08a74`; borders likewise). Every theme now passes the same bar, and hand-tuning without re-running the test would break the build. Theme names lived in five hand-written lists (types, settings sanitizer, Shell dots, Onboarding, SettingsScreen) — adding Paper to the union immediately broke three of them at compile time, which is exactly the drift risk; they now all read `themes.ts` (`THEMES`/`THEME_NAMES`). Native window chrome follows the theme through the M4.4 channel, and `createWindow()` now awaits the persisted chrome so a light theme no longer flashes dark window chrome at boot (verified by an e2e assertion that `applyWindowChrome` received `theme: "paper"`). A `@media (forced-colors: active)` pass re-expresses surfaces, borders, focus rings, progress fills, badges and skeletons with system colors (`Canvas`, `CanvasText`, `Highlight`, `ButtonFace`, `ButtonText`, `GrayText`), opting out with `forced-color-adjust: none` only where our own rendering carries meaning.

## M4.8 (v1.4: signing readiness)

- D86: Documentation and configuration only — **no signing exists and none is claimed**. `docs/SIGNING.md` explains why SmartScreen warns (publisher identity + download reputation, not a malware verdict), gives the four realistic options in cost order (unsigned + *More info → Run anyway*, SignPath for OSS, Azure Trusted Signing, OV/EV certificate), documents that electron-builder already reads `CSC_LINK` / `CSC_KEY_PASSWORD` / `CSC_IDENTITY_AUTO_DISCOVERY` so turning signing on needs **no code change and no committed secret**, and tells the reader to verify with `Get-AuthenticodeSignature`. The build config gained exactly one line, `"forceCodeSigning": false`, which makes the unsigned state explicit instead of implied by absence — and guarantees a build fails loudly rather than silently shipping unsigned if signing is later expected. README gained a SmartScreen note next to the release instructions plus a link in Further reading. `.gitignore` already excluded `.env*`, `*.pem`, `*.p12`, `*.pfx`; no key material is in the repo and none was added.

## M4.9 (v1.4: idle cost + upgrade regression)

- D87: The M4.1 pump tick called `pump()` every second, and `pumpInner()` emitted **and** persisted unconditionally — so an idle app re-rendered the shell once per second and rewrote `queue.json` once per second, forever. Both are now gated on an actual state change, and the store keeps the previous array identity when nothing changed (`jobsEqual`), so React can bail out. Measured, not assumed: with the app launched, window hidden, `queue.json` was rewritten **65 times in 65 seconds** before and **0 times** after (`scripts/soak.mjs` is committed so this is repeatable). CPU/RAM were already invisible to `app.getAppMetrics()` (0% average, max 0%, RAM flat) — the win is the eliminated churn, not a headline CPU number. Four controller tests pin it (60 idle pumps → 0 emits, 0 writes; a paused job stays silent; real work still emits and persists; a due backoff retry still persists). Idle soak over 10 minutes with the window hidden: Browser 0% cpu / 103.7→103.5 MB, Tab 0% / 98.6→96.9 MB, GPU 0% / 111.2 MB flat, Utility 0% / 48.2 MB flat — no leak.
- D88: v1.0→v1.4 upgrade tests (7 new) assert what the old two tests ignored: fractional progress, a `.part` destination, byte counters, `attempts: 3` + a future `nextRetryAt`, both preset kinds, and — importantly — that v1.4-only fields stay **absent** rather than being invented, so the stats screen can honestly say "unknown". Also pinned: a write-back + reload round trip with no drift, a settings round trip through the sanitizing merge, a malformed-file fallback, and loading from a path with spaces (the NSIS default). One scare worth recording: the round trip appeared to show `downloadDir` losing its backslashes on save, which would have been a severe corruption bug. It was my own test literal — a bash heredoc had eaten `\\` before TypeScript ever saw it. Verified electron-store/conf round-trips Windows paths, `%` and filename templates untouched. **Never write escaped Windows paths through a shell heredoc; use the editor.**
- D89: Test-suite flakiness observed twice in the live yt-dlp integration tests (`fetches metadata for a public video` timed out on the network, passed on re-run). Those 8 tests need internet and are not hermetic; the rest of the suite is. Worth remembering before blaming a code change.

## M4.5 (v1.4 M4.2)

- D79: Split by chapters. `parseChapters` in `media.ts` extracts chapter metadata (title, start/end times). Home preview surfaces chapters count, a toggle checkbox for non-playlist media with chapters, and a collapsible chapter list. When enabled, `buildDownloadArgs` passes `--split-chapters` and `--output chapter:...` with template `buildChapterOutputTemplate` organizing split files into a dedicated subfolder `.../<title>/<section_number>03d - <section_title>.<ext>`. `desktopEngine` parses the split chapter destination as the containing directory, and protects against trashing root paths. UI across Downloads, Library, and JobMenu adapts labels ("Open folder", "Delete folder") and actions for chapter-split directories. Unit tests verify chapter parsing, template construction, args, and job state.



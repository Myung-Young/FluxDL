# Changelog

All notable changes to FluxDL are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.6.1] — 2026-10-04

Update overhaul: the checker reads full release metadata, the button
force-refreshes (hammering it re-reads GitHub instead of the hourly
cache), and a new version opens a launch popup with version, sizes,
notes and publish date.

### Fixed

- "Check for updates" could keep showing the old version for up to an
  hour because of the cache; it now force-refreshes.
- Removed the temporary "Preview the reminder" demo button.
- The Library icon pointed upside-down; books now stand on their shelves.
- Side-by-side buttons had mismatched heights (Download vs Re-analyze,
  Check vs Repair); both tiers share fixed heights and bare buttons moved
  into proper rows.
- The X button left the process running (nothing called app.quit, so the
  graceful teardown never ran and only tray Quit worked). Closing now
  drives a real quit with teardown on both .exe and portable.

### Added

- Launch update popup: latest version, Setup/Portable sizes, release
  notes, publish date, Later / Skip-this-version / Download & install.
- In-app download with progress, then automatic silent install on
  completion. A `FluxDL-updated-to-<v>.txt` note is left in the download
  folder on the first boot of the new version.
- Release date shown on the Logs updates card.
- The auto-installer picks the `*-Setup-*.exe` asset; portable-only
  releases report "no installer" instead of failing oddly.
- Full in-app changelog: every version v0.1.0 to current with a read-more
  chevron per card (outside click or Escape folds it back).
- Themed scrollbars on every list, log and input.
- Settings regrouped into labelled section cards with even row rhythm.

## [1.6.0] — 2026-10-04

"Frictionless & Trustworthy": every control redesigned, the Home page
split into Single/Batch modes, original icons throughout, and the full
Smart Queue + Search + States + Workflow + OS + Data batches.

### Fixed

- Paste reported "invalid link" on freshly-copied YouTube URLs. Two real
  causes: the clipboard read was unbound (`Illegal invocation`, so it
  always failed) and could be denied inside the sandbox. Reads now go
  through the main process, with invisible characters and wrapping quotes
  stripped from pasted text.
- Tray icon could ghost after terminate; it is now destroyed on will-quit.
- Onboarding theme picks apply live (synchronous flip + persisted save).
- The X button quits by default; hiding to tray is opt-in.
- Playlist entries distinguish Archived from On-disk.

### Added

- Original hand-drawn SVG icon set (logo + every nav view).
- Home Single/Batch modes with auto-routing; maximize is disabled.
- Smart Queue: download-remaining, per-site presets, resume banner,
  scheduled downloads, upgrade hints, channel watchlist.
- Search & Command: fuzzy typo-tolerant search everywhere, unified palette
  content results, local-language intents, saved/recent searches, view
  history (Alt+Left/Right), pinned jobs, PiP + fullscreen preview.
- States & Undo: actionable empties, 5 s undo for sweeps, offline banner,
  disk-space precheck, executable-open guard, show-command, digest
  notifications with a preference toggle.
- Workflow: one-click profiles, remembered view/filter, multi-select bulk
  bar, quick download, filename token builder, dependent fields, backup &
  restore, copy-links.
- OS integration: screen-reader sparkline labels, preview focus trap,
  system theme sync, jump list, taskbar badge, auto-start, icon-only
  sidebar under 720 px, `.fluxdl` batch files.
- Data & performance: auto-sort folders, episode detection, storage
  insights with orphan cleaner, per-site + per-preset stats, lazy views,
  per-view error boundaries, experimental flag, release checklist.

## [1.5.1] — 2026-10-04

### Fixed

- The X button now quits for real by default instead of hiding to the
  system tray when the tray toggle is off. Hiding stays available as an
  explicit choice in Settings.
- Onboarding theme picks now preview live across the whole app instead of
  only applying after the wizard finishes.

### Added

- In-app **Changelog** tab (Ctrl+7): the release history from v0.1.0 to the
  current version, in English and Bahasa Melayu.

## [1.5.0] — 2026-10-04

### Fixed

- Native dialogs (confirmations, folder/file pickers) are now titled
  **FluxDL** instead of `@grabber/desktop`.
- Onboarding buttons no longer sit flush against the folder input.
- Subtitles now include auto-generated captions by default (most videos have
  no manual subtitles), and audio downloads pin the best quality level.
- Pasting or dropping several links at once no longer silently keeps only
  the first — they go to Batch instead.

### Added

- Single-instance lock: a second launch focuses the running window and
  forwards its link instead of racing it.
- `fluxdl://` links and `FluxDL.exe <url>` deep-link support.
- Graceful shutdown: quitting keeps `.part` files so downloads resume.
- Close-button choice (hide to tray or quit) and optional minimize-to-tray.
- Downloads search + status filters, quick speed throttle, whole-queue ETA,
  live bandwidth sparkline, and `Ctrl+1…6` view jumps.
- Update reminders for the app and yt-dlp (toast on launch + Logs screen),
  replacing the silent engine update.
- In-app audio/video preview in the Library.
- Reworked README with banner, feature tour, and architecture diagram.

## [1.4.1] — 2026-10-04

Bug fixes from the first manual pass on the portable build.

### Fixed

- **Settings never saved, in any released build.** The main process is
  CommonJS while electron-store is ESM-only, so every write threw
  `Store is not a constructor` and the UI swallowed the error — toggles looked
  clickable but changed nothing, with no message. Settings are now written as
  atomic JSON by us (same file, same shape, so existing settings still load).
  Your download folder, proxy, cookies, theme, density and every other setting
  now persist across restarts.
- A settings change that fails to save now says so instead of failing silently.
- Library → **Download again** now asks for confirmation, and it actually
  re-downloads: yt-dlp previously answered "has already been downloaded" and
  exited successfully without fetching anything. The same fix applies to Home's
  "Download anyway" and the batch panel.
- Downloads that use the download archive no longer fail with a missing-file
  error when the app's data folder has not been created yet.

### Added

- Real-engine settings tests: every control is verified to reach disk and
  survive a reload and a full app restart.

## [1.4.0] — 2026-10-04

Depth and polish: live streams and chapters that actually reach yt-dlp, an
audio tag editor, a mini window, download stats, a light theme with Windows
High Contrast support, and signing documentation.

### Fixed

- **Live-stream and chapter flags were silently dropped** (the important one).
  `--live-from-start`, `--wait-for-video`, `--hls-use-mpegts` and
  `--split-chapters` were built correctly and unit-tested in isolation, but
  three hand-written copy lists between the UI and the binary each omitted
  them, so a packaged app never passed them to yt-dlp. There is now one
  allow-list and one projection (`toStartInput`) used in both directions, the
  argv mapping moved into a pure, tested `buildStartArgs()`, and a test asserts
  the flags per live status.
- Sidebar stayed visible in mini mode: `[hidden]` lost to
  `.grabber-nav { display: flex }`. Fixed globally with
  `[hidden] { display: none !important }`.
- An idle app rewrote `queue.json` and re-rendered the shell once per second
  (the queue pump tick emitted and persisted unconditionally). Both are now
  gated on real state changes: **65 writes/65 s → 0** while idle.

### Added

- Audio metadata editor for audio presets: editable title/artist/album/year
  seeded from the analyzed media ("Artist - Title" heuristic + upload year),
  applied with `--parse-metadata` + `--embed-metadata`. Escaping is derived
  from yt-dlp's own `metadataparser.py` and verified against the real binary
  for colons, `%`, backslashes, regex metacharacters, `%(title)s` injection
  attempts, unicode and emoji — a live test asserts the tags on a real mp3
  with ffprobe.
- Mini mode: the same window becomes a compact always-on-top 360×520 panel
  (Ctrl+Shift+M, tray checkbox, command palette) showing active downloads,
  totals and pause/resume. Previous window bounds are restored on exit and the
  mini bounds persist.
- Stats screen derived from download history: totals (size, duration,
  completed, failed), a 12-week chart, top uploaders and preset mix, with
  hand-rolled SVG/CSS bars and no chart library. Old records report "unknown"
  rather than zero; clearing history clears these numbers.
- Fourth theme "Paper" — a light theme with darkened status colours.
- Windows High Contrast support via a `@media (forced-colors: active)` pass.
- `docs/SIGNING.md`: why SmartScreen warns, the realistic signing options, and
  how electron-builder consumes `CSC_LINK` / `CSC_KEY_PASSWORD`. **These
  builds are not signed.**

### Changed

- Every theme's contrast pairs are now unit-tested against `tokens.css`
  (16 text pairs at 4.5:1, 7:1 for body text, plus separator visibility). The
  three existing themes were nudged to pass: tertiary text `--fg-2` was as low
  as 3.55:1 on card backgrounds.
- Theme names live in one registry instead of five hand-written lists.
- The native window background and title-bar overlay follow the active theme
  from boot, so a light theme no longer flashes dark chrome.

### Known limitations

- Builds are unsigned, so SmartScreen shows "Windows protected your PC". Click
  **More info → Run anyway**. See `docs/SIGNING.md`.
- The portable build has still not been launched manually from a path
  containing spaces; run it once before distributing.
- yt-dlp prints non-ASCII path segments as mojibake (the UTF-8 env overrides
  remain verified no-ops), so a non-ASCII download folder can still report a
  destination that does not resolve. The recovery scan covers the common case.
- The live yt-dlp integration tests need internet and can time out on a slow
  network; the rest of the suite is hermetic.

## [1.3.0] — 2026-10-03

Bug fixes, quality of life, and polish: destination recovery, visible
retries, a drift-proof mock, settings search, shortcut help, log triage,
template validation, title count, and an accessibility pass.

### Added

- Destination recovery for non-ASCII folders: when yt-dlp reports a
  mojibake path, the engine scans the output dir (`[id]` match, else
  newest recent media) instead of leaving a dead destination.
- Retry countdown (`Retrying in Ns · attempt A`) with a 1 s tick on error
  cards, plus bulk Retry-all (button + palette command).
- Settings search: instant multi-word filter over labels/ids/keywords with
  match count, empty state, and hidden rows (anchors keep working).
- Shortcut help dialog (`?`, focus-trapped) listing every global shortcut,
  also openable from the palette.
- Log triage: text search + errors-only toggle + match counts, Refresh,
  Copy log, and a follow-live pin.
- Filename template preview with sample metadata plus inline hints for bad
  templates and speed limits (hints only, never blocking).
- Window title shows the active count (`(N) FluxDL`); finished toasts carry
  an Open-file action.
- Accessibility pass: progress `aria-valuetext`, live-region empty states,
  palette `aria-keyshortcuts`, verified reduced-motion guards.

### Fixed

- `extractor`/`videoId` no longer dropped on the queue→engine handoff
  (both rebuild sites), so playlist identity reaches the engine again.
- Settings inputs shared one React key (`""`) and multiplied into ghost
  copies after re-renders; every input now has a stable unique key.
- E2E mock drift fixed (4 missing settings fields + `cancelAnalyze`) with
  a pinned settings-shape test that fails loudly on the next drift.

### Known limitations

- yt-dlp prints non-ASCII path segments as mojibake (verified no-ops for
  the UTF-8 env overrides): the new recovery scan covers the common case,
  but genuinely unresolvable destinations still fall back to Locate.
- Portable spaces-path GUI pass not completed in-session again (packaging
  verified, same code live-tested); run the portable once manually before
  distributing.

## [1.2.0] — 2026-10-03

UX and UI polish: command palette, onboarding, faster analyze, dynamic
accents, density, accent picker, smarter playlists, Malay language,
library health.

### Added

- Command palette (Ctrl+K): fuzzy search with recency boost over paste/
  analyze, per-view navigation, theme switching, engine update, downloads
  folder, pause/resume all, clear finished, and Settings deep links.
  Combobox/listbox pattern, ignored inside text fields.
- First-run onboarding: 3 steps (folder, theme, default preset) with an
  engine status check; skippable, never blocking, re-runnable from
  Settings. New `defaultPreset` setting (Compatible MP4 out of the box).
- Faster-feeling analyze: LRU MediaInfo cache (30 entries, 10-min TTL),
  CSS skeleton shimmer, cancel (button/Esc, process killed), configurable
  timeout (default 60 s), manual Re-analyze bypass.
- Dynamic thumbnail accent: dominant colour extracted main-side (median-cut,
  BGRA order verified empirically), contrast-clamped to 4.5:1, scoped to
  the preview card with a smooth tween. Toggleable, default ON.
- Density toggle: comfortable/compact via tokens plus a horizontal list-row
  layout for Downloads/Library in compact. Palette command + Settings.
- Accent colour picker: 8 swatches + validated custom hex on top of the 3
  themes, full hover/active/ghost/on-accent scale with auto-adjust and a
  low-contrast warning. Reset to theme default.
- Smarter playlists: already-downloaded badges (archive + disk, bulk
  checked), hide toggle, title filter, per-entry preset overrides,
  automatic subfolders with Windows-sanitized names, virtualized entry
  lists at 200+.
- Bahasa Melayu + English: full locale dictionaries with key-parity
  typecheck, interpolation, plural helper, Intl dates/numbers, auto (system)
  language setting, localized error messages (main resolves via OS locale).
- Library health: bulk file checks in chunks on open, Missing badges with
  Locate (file picker, record updated) / Remove / Re-download, virtualized
  list at 200 rows, ~100 ms debounced search, keep-last-N history prune
  (default 500).

### Fixed

- Resume after pause now recovers on progress/done events (was: stuck
  "paused" forever).
- Merged/extracted destinations, trust-boundary path checks, and e2e mock
  fidelity (unique engine ids, pause/resume events, full settings mirror).

### Known limitations

- yt-dlp prints non-ASCII path segments as mojibake (verified no-ops for
  the UTF-8 env overrides): reported destinations may not resolve there.
- Portable spaces-path GUI pass not completed in-session again (packaging
  verified, same code live-tested); run the portable once manually before
  distributing.

## [1.1.0] — 2026-10-03

Quick wins: codec-aware downloads, batch queueing, duplicate protection,
clickable errors, taskbar progress, context menus, bulk control, diagnostics.

### Added

- Codec-aware presets: new "Compatible MP4" preset (H.264 + AAC, up to
  1080p, merged to mp4) plus a preferred-codec setting (auto/H.264/VP9/AV1)
  applied via yt-dlp `-S` format sort. Preset chips and the Advanced format
  list show per-preset size estimates (`estimatePresetSize`: exact filesize,
  else tbr × duration).
- Batch panel on Home: multi-line paste or dropped `.txt` (≤1 MB, ≤500
  lines, BOM/CRLF/comments/dupes handled), per-row status with concurrency-3
  analyze, one global preset with per-row overrides, playlist "Expand",
  "Queue all ready", retry/remove rows.
- Duplicate guard: extractor+id identity (normalized-URL fallback) checked
  against queue + history with a Skip / Download anyway / Open existing file
  dialog (focus-trapped, Esc = Skip). Playlist jobs honor
  `--download-archive` (`skipArchived`, default ON); "Download anyway" omits
  it; Settings can clear the archive.
- Actionable errors: every failure maps to buttons — Retry, Update engine &
  retry (blocked while downloads are active), per-download vs always cookie
  picker, Repair engine, open Settings section / Logs, choose folder. New
  categories: extractor failures, unreadable-browser-cookies (verified
  against real Chrome/Firefox stderr), broken binaries. `repairEngine`
  re-copies and hash-verifies binaries. Failure message + category now reach
  error cards (previously only "Download failed." did).
- Taskbar progress + aggregate status: sidebar footer and tray tooltip show
  "N active · X MB/s"; taskbar bar (normal/indeterminate/cleared/error
  until focus) plus a "finished while hidden" overlay dot; updates ≤4/s.
- Card context menu (Downloads + Library): Copy URL/path, Open, Show in
  folder, Retry with another preset…, Move up/down, Remove from list,
  Delete file (Recycle Bin via `shell.trashItem`, confirm, history marked
  "file deleted"). Themed, keyboard-operated (arrows, Esc, Shift+F10).
- Bulk queue control: Pause all, Resume all, Cancel queued (confirm), Clear
  finished; drag reorder (pointer events, FLIP settle, reduced-motion safe),
  Alt+Up/Down, Move up/down menu items. Order persists via createdAt.
- Diagnostics report on Logs: versions (app/yt-dlp/ffmpeg/OS/arch),
  redacted settings, recent errors, selected log tail. Secrets always
  redacted (proxy creds, token/sig/key params, usernames, cookie paths);
  URLs opt-in. Copy + Save .txt with preview.

### Fixed

- Merged/extracted downloads report the final file (was: deleted temp).
- Resume after pause recovers on progress/done events (was: stuck "paused").
- Renderer paths (open/reveal/exists/trash) are confined to the download
  roots or known destinations (trust boundary).

### Known limitations

- yt-dlp prints non-ASCII path segments as mojibake regardless of
  `PYTHONIOENCODING`/`PYTHONUTF8` (both verified no-ops): for non-ASCII
  download folders the reported destination may not resolve; Open/Reveal
  existence-check the miss.
- Portable spaces-path GUI pass (launch → analyze → real download) was not
  completed in-session (long extraction + GUI timeouts); the same engine
  code is covered by live-binary integration tests and the NSIS/portable
  artifacts build cleanly. Please run the portable once manually before
  distributing.

## [0.1.0] — 2026-10-02

Initial Windows release: Electron + React + TypeScript GUI for yt-dlp with
queueing, themes, self-updating engine binaries, persisted
settings/queue/history, tray behavior, NSIS + portable builds.

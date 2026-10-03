# Changelog

All notable changes to FluxDL are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

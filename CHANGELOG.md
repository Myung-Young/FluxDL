# Changelog

All notable changes to FluxDL are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

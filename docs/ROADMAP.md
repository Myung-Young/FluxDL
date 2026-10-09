# ROADMAP.md

Deferred items with a one-line rationale each.

## Phase 1 remainder (v1.8.5 images UI) — DONE 2026-10-09

Shipped: probe-backed gallery preview (count, lazy thumbs, select,
all/selected via `--range`), per-link + batch engine overrides,
Try-other/Download-both, live file counters, Images settings section
(+ raw config override), last-folder memory, repairable missing-binary
errors. Still deferred (E): per-site preset manager UI (silent
remember/apply already ships), metadata sidecar viewer, Test-engine
button (the preview IS the test), What's-new modal (Changelog tab
announces).

## Later phases (untouched)

- Phase 2: Tools & Engines page, Doctor, Deno/aria2c, first-run wizard update.
- Phase 3 remainder: per-sub preset/engine UI (types + enqueue ready),
  batch-level proxy, tray pause-all, suspend-pause, cached video thumbnails,
  tags/favorites + CSV export (E).
- Phase 4 remainder: hand-rolled zip for yt-dlp outputs, PDF packaging,
  lyrics, EXIF viewer, auto-rename, dHash duplicate finder (E), per-step
  progress chips, bulk convert/reprocess, worker_threads.
- Phase 5 remainder (E): user-supplied pack manifests (off by default, big
  warning), Doctor pack health.
- Phase 5 Tier B (document-only): Instaloader, TwitchDownloader CLI, tdl
  (needs secrets story), ExifTool, Real-ESRGAN/waifu2x, Demucs, Tesseract,
  MediaInfo — see PHASE_5_PLAN.md §5 for integration notes.
- Phase 5: Optional Tool Packs incl. Tier B notes.
- Phase 5: Optional Tool Packs incl. Tier B notes.
- Phase 6: Remote API / extension / PWA (loopback slice done in v1.12.0:
  local server + PWA + unpacked extension; LAN mode + notifiers pending the
  §6 threat review in PHASE_6_PLAN.md).
- Phase 7: Signing, auto-update, i18n beyond EN+MS, repo quality.

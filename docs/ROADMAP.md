# ROADMAP.md

Deferred items with a one-line rationale each (Phase 1 E + v1.8.5 UI).

## Phase 1 remainder (v1.8.5 images UI)

- Gallery preview before download (capped count, lazy thumbs, select) — needs
  a gallery-dl `--dump-json`/simulate probe verified against the binary first.
- "Try other engine" + "Download both" buttons — needs router probe cache +
  per-job engine switch plumbed through Home/Batch first.
- Images SettingsScreen section + raw config editor + reset — backend
  (settings.images, config generator, validation) is done; UI deferred to
  keep the foundation diff reviewable.
- Live thumbnail strip of finished files + per-file results UI — engine emits
  destination-per-file already; queue fileResults wiring deferred.
- "What's new" modal — deferred until the images UI ships (nothing to announce yet).
- Per-site presets + metadata sidecar viewer + "Test engine" button (Phase 1 E)
  — only after the DoD passes; low-risk only.

## Later phases (untouched)

- Phase 2: Tools & Engines page, Doctor, Deno/aria2c, first-run wizard update.
- Phase 3: Queue v2 DB, subscriptions from watchlist, templates.
- Phase 4: Post-processing pipeline (conversion, tagging, packaging).
- Phase 5: Optional Tool Packs incl. Tier B notes.
- Phase 6: Remote API / extension / PWA (needs separate threat review).
- Phase 7: Signing, auto-update, i18n beyond EN+MS, repo quality.

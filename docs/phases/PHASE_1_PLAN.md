# PHASE 1 PLAN — gallery-dl + engine/binary foundation (v1.8.0 → v1.8.5)

Split agreed 2026-10-06: foundation first (zero behaviour change), images second.
gallery-dl.exe BUNDLED. DoD sources: Wikimedia Commons, public Flickr/Imgur (SFW, no-login).

## 0. Recon summary (read-only done)

Exists: DesktopEngine spawn args-array shell:false, PROGRESS_TEMPLATE parser,
killProcessTree taskkill /T /F, pause keep .part / resume --continue,
userData→bundled→PATH resolve + SHA256 + repairEngine, queue machine +
pickJobOptions/toStartInput single allow-list, hydrate re-queue, errors.ts
16 categories + redactArgs/diagnostics redaction, Batch smart paste + dedupe,
archive toggle, notify, watchlist stub, strings EN+MS parity, vitest + e2e mock.

Missing: engine abstraction (no id/capabilities/probe), generic binary manager
(no manifest/rollback/channels), gallery-dl binary/config, router
(Auto/Video/Images + domain tables + probe), engineId on job/history + badge,
one-job-many-files + counters + partial/probing/interrupted, Images settings,
per-site safeStorage secrets, gallery preview/select.

Conflicts: PHASE2_NOTES.md archived (mobile cancelled, ignore Android).
docs/phases/, docs/ROADMAP.md, THIRD_PARTY_NOTICES.md don't exist yet.

## 1. Tasks

### v1.8.0 foundation (this pass, zero yt-dlp change) — DONE, all green
- [x] core `engines.ts` (new): EngineId, Capabilities, RouterMode, DomainRule,
      BUILTIN_ENGINE_RULES, resolveEngine() pure + tests.
- [x] core `galleryConfig.ts` (new): buildGalleryDlConfig(settings) pure + tests.
- [x] core `galleryProgress.ts` (new): parseGalleryDlLine + chunk buffer + tests.
- [x] `types.ts` (edit): + EngineId/RouterMode/FileResult/ImagesSettings,
      DownloadJob += engineId/fileResults/counters (optional, old rows default
      yt-dlp), JobStatus += probing|partial|interrupted.
- [x] `queue.ts` (edit): TRANSITIONS for new statuses (probing≈analyzing,
      partial terminal≈done, interrupted≈queued manual-only), pickJobOptions +
      makeJob/toStartInput carry engineId, hydrate in-flight → interrupted
      (never auto-start; pump skips interrupted).
- [x] `persist.ts` (edit): STATUSES += 3. Backcompat fixtures stay loadable.
- [x] `settings.ts` (edit): += routerMode, domainRules, images block,
      lastFolderByMedia; cleaners + DEFAULT_SETTINGS.
- [x] `strings.ts` (edit): engine.*, images.*, router.* EN+MS parity.
- [x] main `binaryManager.ts` (new): generic manifest {id,exe,version,url,sha256,
      license,required}, resolve/detect/atomic-replace/rollback/file-in-use,
      never block boot, offline-safe. Wrap binaries.ts (no rewrite).
- [x] main `jobArgs.ts` (edit): buildGalleryDlArgs() pure + tests.
- [x] `scripts/fetch-binaries.mjs` (edit): GALLERYDL_VERSION + sums verify,
      versions.json += galleryDl.
- [x] `desktopEngine.ts` (edit, guarded): if job.engineId==gallery-dl and binary
      present → spawn gallery-dl.exe args-array + config-file injection +
      galleryProgress parser + killProcessTree reuse; else yt-dlp path byte-identical.
      EngineVersions += galleryDl? optional. Missing binary → unsupported error
      with install guidance (no crash).
- [x] Router wiring (producer-side): Home/Batch enqueue resolves engineId;
      retries/re-downloads preserve it; watchlist + explicit-preset retry stay
      yt-dlp. Unknown hosts try yt-dlp first (D162).

### v1.8.5 images (same phase, after foundation green) — DONE 2026-10-09

Verified facts (live, gallery-dl 1.32.15, 2026-10-09 — not memory):
- Provenance corrected: dev moved to Codeberg; GitHub releases carry NO
  binaries and v1.26.12 never existed. Pinned 1.32.15 from the live Codeberg
  API; `gallery-dl.exe` (22,563,412 B) SHA256-verified against published
  `SHA256SUMS` (GPG-signed upstream). fetch-binaries.mjs updated; D154 amended.
- `--dest` alias WORKS (empirical). Download stdout = bare absolute path per
  saved file; `# <path>` = skipped (archive/exists). The shipped
  `[gallery-dl] save/skip` parser matches NOTHING real — rewritten this pass.
- `-j` alone never downloads (pure metadata probe). Tuples: `[2, dir]`,
  `[3, url, {filename,width,height,extension,size,…}]`, `[-1, {error,message}]`.
  Unsupported URL = exit 64 + `[gallery-dl][error] Unsupported URL` on stderr.
  `--range 1-N` caps `-j` enumeration. Probe cost ~24 s (Commons category).
- Danbooru unreachable from here (connect timeout×30 s) — environmental.
- DoD URLs (all live-verified this pass): Commons file
  `.../File:Albert_Einstein_Head.jpg`, Commons category
  `.../Category:Albert_Einstein`, Flickr `.../photos/nasacommons/`.

Tasks (all DONE 2026-10-09, gates green — E stays deferred per D192):
- [x] Core `galleryProbe.ts` (new, pure): `-j` tuple parser (type 2/3/-1,
      never throws, cap 50 items/8 MB), `buildProbeArgs()` pure,
      in-memory probe cache (host → ProbeResult, 24 h TTL, injected clock).
      Real-output fixtures (Commons + Flickr captures above).
- [x] `galleryProgress.ts` rewrite: bare-path = downloaded, `# path` =
      skipped, info lines ignored; DROP `TOTAL_RE`/`parseGalleryTotal`
      (no real output ever prints totals). Fixtures from the live captures.
- [x] `queue.ts`: gallery counters ride `downloadedBytes` today (a count,
      not bytes) — map to `downloadedCount/skippedCount/failedCount` when
      `job.engineId === "gallery-dl"` so cards stop showing "5 B". Pure + tests.
- [x] `images.customConfig: string | null` (raw JSON override; null =
      generated). Cleaner + reset. Shape-pin + e2e mirror.
- [x] Main `probeGallery(url, {requestId})` (new engine method, ONE channel
      57→58): `-j --range 1-50`, analyzeTimeoutSec budget, stdout cap,
      kill-tree on timeout/cancel (probes map; `cancelAnalyze` covers both).
      Unsupported → `{supported:false}` (exit 64 marker), never throws blind.
- [x] `writeGalleryConfigAtomic`: honor `customConfig` when valid JSON
      (fall back to generated + note on invalid).
- [x] Home: builtin-gallery URLs auto-probe → preview (count + lazy `<img>`
      thumbs over https:, select, Download all/selected); needs-probe hosts
      keep yt-dlp analyze + "Check image gallery" probe button on failure;
      per-job engine override (Auto/Video/Images) at enqueue.
- [x] BatchPanel: panel-level engine override (Auto/Video/Images) into
      resolveEngine (per-row switch deferred — rows share one mode).
- [x] Downloads error cards: "Try other engine" (flip yt-dlp↔gallery-dl,
      same ErrorAction pattern as Phase 5 try-with) + "Download both"
      (mixed hosts only). Uses existing tryOther/downloadBoth strings.
- [x] Downloads gallery cards: counters line + "Re-run (skips finished)"
      (archive makes re-run effectively failed-only).
- [x] Images SettingsScreen section (folder/file templates, sleeps, retries,
      proxy, archive, sidecar + raw editor + reset). lastFolderByMedia
      remember/apply in Home/Batch (settings exist, never wired).
- [ ] E (after DoD, low-risk only): per-site preset manager UI (silent
      behavior already ships), sidecar viewer, Test-engine button (Home
      preview IS the test), What's-new modal (Changelog tab already
      announces — likely stays deferred with rationale).

## 2. Files touched (surgical)

New: packages/core/src/engines.ts(+test), galleryConfig.ts(+test),
galleryProgress.ts(+test), apps/desktop/src/main/binaryManager.ts(+test),
THIRD_PARTY_NOTICES.md, docs/phases/PHASE_1_PLAN.md (this file).
Edit: types.ts, queue.ts(+test), persist.ts, settings.ts(+test), strings.ts(+test),
jobArgs.ts(+test), desktopEngine.ts, fetch-binaries.mjs, binaries.ts (additive),
SettingsScreen.tsx, Downloads.tsx, DECISIONS.md, CHANGELOG.md, README (user-facing only).

## 3. Risks

- JobStatus union growth → UI/persist/transition drift. Mitigate: STATUSES +
  TRANSITIONS + pinned tests + e2e mock untouched shape.
- gallery-dl flags differ per release → verify vs `gallery-dl --help` + docs
  before use; unknown flags fail closed with clear error.
- GPL-2.0 bundling → source-offer note + notices file, exe separable.
- Installer +~15MB → measure in dist step, record in DECISIONS.md.
- New optional fields dropped at renderer→engine hop (R1 lesson) → must ride
  pickJobOptions + toStartInput + IPC validator together.

## 4. Test plan

- Vitest: router (user-table > built-in > probe-cache > unsupported; overlapping
  sites X/Reddit/Tumblr/Instagram defaults), gallery progress (CRLF, split
  chunks, UTF-8), error classifier shared (real stderr samples), binary manager
  (mock fs/net, checksum-mismatch hard-fail, rollback, file-in-use), config
  generator (defaults + overrides + reset), queue transitions for new statuses,
  settings merge for new block, strings parity.
- Fake-engine integration: multi-file job counters + partial.
- Gates: pnpm typecheck && lint && test && build. E2E smoke unchanged.
- yt-dlp regression (every phase end): video, audio-only, playlist, cancel, retry.
- Manual: Auto-mode Commons/Flickr/Imgur URLs (record exact URLs in report),
  cancel → no orphans, restart mid-download → interrupted, badge visible.

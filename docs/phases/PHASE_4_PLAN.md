# PHASE 4 PLAN — Post-processing pipeline

Source: docs/UPDATE_PLAN.md § Phase 4. Recon 2026-10-08 (flags verified live
against ffmpeg N-125875 + gallery-dl official docs; yt-dlp/ffmpeg/ffprobe on
PATH; gallery-dl NOT installed locally).

## 0. Verified facts (not memory)

- ffmpeg: `-vf scale`, `-q:v`, `-map_metadata -1`, `-progress pipe:1`,
  `-hwaccels`, `-encoders` (nvenc/qsv/amf present here), metadata `-c copy`
  rewrite, ffprobe `-of json` — all exercised live today.
- gallery-dl (official docs): `--zip`, `--cbz`, `--ugoira FMT`
  (webm/mp4/gif/vp8/vp9/vp9-lossless/copy/zip, via FFmpeg). So gallery
  packaging + ugoira = argv flags, NOT hand-rolled zip code.
- gallery-dl needs an `ffmpeg` binary findable by the child: prepend the
  bundled ffmpeg dir to PATH in the gallery spawn env.
- No zip muxer in ffmpeg → IF yt-dlp-side zipping is ever needed it must be
  hand-rolled (deferred: plan only requires per-gallery packaging).
- MusicBrainz answered a live query with its standard busy-JSON (endpoint
  shape confirmed); all MB/CAA work uses fixtures + short timeouts, never
  live calls in tests.

## 1. Tasks

### A. Core — DONE

- [x] core `postprocess.ts` (new, pure): PostStep ids
      (`convert-image`|`tag-audio`|`compress-video` — gallery-native steps
      ride argv, only their *settings* live here), PostOptions, step
      applicability (`stepsFor(kind, engine,
      files)`), MB query builder + response parser + confidence pick,
      ffprobe JSON parser → MediaSummary, hwaccel parser
      (`parseHwaccels`, `pickH264Encoder`), size-savings formatter. Tests +
      fixtures (ffprobe sample, MB sample, encoders sample).
- [x] types+settings: `postProcess` block
      `{convertImages, imageFormat jpg|png, imageQuality 1-100,
      imageMaxDim, stripExif, packageGallery off|zip|cbz,
      ugoiraFormat off|mp4|gif|webm, autoTagAudio, compressVideo
      off|small|balanced|archive, keepOriginals=true}` + cleaners +
      shape-pin + e2e mirror. `JobStatus += "postfailed"` (terminal,
      history-bound, reprocessable).
- [x] `queue.ts`: QueueEvent `postfail` (from done|processing, no attempt
      bump, error kept), `retry` accepts postfailed (re-downloads),
      applyEngineProgress stage `postfailed`. persist STATUSES += 1,
      backup STATUSES += 1 (else restores drop them).
- [x] main `postprocess.ts` (new): step runner — temp-in-same-dir →
      spawn ffmpeg (args array, `-progress pipe:1` → rawLog lines,
      2 h timeout, killProcessTree) → verify (ffprobe/size>0) → atomic
      rename. Disk-space check first (2× input). Steps:
      convert-image (scale/quality/strip), tag-audio (skip when
      title+artist tagged; MB ≥85 auto-apply + CAA front cover; below →
      skip with rawLog note + report candidates), compress-video
      (small/balanced/archive, HW h264 when detected else libx264 + retry
      fallback proven live on NVENC),
      ugoira/package are gallery-argv (no runner code). Never deletes
      originals unless keepOriginals=false (+ confirm UI-side).
- [x] gallery argv: `--zip`/`--cbz` (packageGallery), `--ugoira FMT`
      (ugoiraFormat) in buildGalleryDlArgs + tests; ffmpeg-dir-on-PATH for
      the gallery child. Auto convert-image runs only when package is off
      (else files are zipped — noted in rawLog).
- [x] ONE new channel `postProcess` (discriminated request):
      `{action:"run", files, steps, options}` → PostReport (manual actions +
      Reprocess); `{action:"media-info", path}` → MediaSummary|null
      (PreviewModal Details); `{action:"apply-tag", path, mbid}` →
      force-applies a low-confidence match. Preload + e2e mock + pin 54→55.
- [x] Engine auto-run: download done → relevant auto steps (gallery→
      convert if unpackaged; audio→tag; video→compress) run inline while
      the job still owns its slot (stage `processing`, indeterminate) →
      done (finish to history) or `postfailed` (finish to history + error).
      Archive-skip and missing files skip silently. Manual run guarded by
      an in-flight set (reject "busy", no second channel for cancel —
      timeouts only). Live-verified: 1 MB video → done + .fluxdl-small.mp4.

### B. Stability — DONE

- [x] Temp→verify→atomic for every step; idempotent reruns (output name
      derived, overwrite only via explicit replace); worker crash =
      step error, never app crash; 2 h ffmpeg timeout; MB 15 s + 1 req/s
      spacing + UA `FluxDL/<ver>`.
- [x] keepOriginals=false trashes (never unlinks) the original; UI-side the
      toggle carries the Recycle-Bin hint (no extra confirm — the toggle
      itself is explicit + reversible).

### C. QoL — DONE except bulk convert

- [x] Settings "After download" section (toggles + selects; chips reuse).
- [x] Menus: `post-run` (Convert/Tag/Compress per kind, destination-gated),
      `post-reprocess` (postfailed only), `media-info` (PreviewModal
      Details section). Bulk "Reprocess selected" dropped: selections are
      queue jobs, postfailed lives in history (no multi-select there yet).
- [x] Report toast with actual savings ("Saved 1.2 MB"); low-confidence
      tag → toast with "Apply best match anyway" (manual flow returns
      candidates through the channel).

### D. Polish — DONE (per-step chips deferred)

- [x] Job cards show `processing` during the pipeline (indeterminate);
      postfailed cards reuse the error card + Reprocess. EN+MS strings. No per-step
      chips (deferred — needs renderer step events).

### Explicitly deferred (→ ROADMAP)

- Hand-rolled zip for yt-dlp outputs, PDF packaging, lyrics, EXIF viewer,
  auto-rename by metadata, dHash duplicate finder (Phase 4 E), per-step
  progress chips, process-priority lowering, bulk convert, worker_threads
  (child_process satisfies isolation).

## 2. Files touched (surgical)

New: core `postprocess.ts(+test)`, main `postprocess.ts(+test)`.
Edit: types.ts, settings.ts(+test), queue.ts(+test), persist.ts(+test),
backup.ts(+test), engine.ts (+channel), jobArgs.ts(+test), ipc.ts,
preload, e2e mock, desktopEngine.ts (auto-run + notify), menu.ts,
JobMenu.ts, Downloads.tsx, Library.tsx, PreviewModal.tsx,
SettingsScreen.tsx, strings.ts(+parity), index.ts exports,
DECISIONS.md, CHANGELOG.md, ROADMAP.md.

One new IPC channel (54→55). No new dependencies.

## 3. Risks

- New JobStatus ripples (persist/backup/menus/UI/e2e). Mitigate: STATUSES
  in both files + transition tests + shape assertions.
- MB/CAA flakiness → short timeouts, fixtures-only tests, skip-on-failure
  (tag never fails a download), 1 req/s spacing.
- HW encoder quality variance → same CRF/CQ across encoders, CPU fallback
  tested by parser fixtures (no live encode matrix).
- Convert-then-package ordering → rule enforced in stepsFor + rawLog note.
- Long transcodes block the slot → acceptable (slot owned); 2 h timeout.

## 4. Test plan

- New pure: stepsFor matrix, MB parse/pick, ffprobe parse, hwaccel pick,
  window… (existing), gallery zip/ugoira argv, postfail transitions.
- Runner: temp→verify→atomic with a real ffmpeg (tiny lavfi fixtures),
  idempotent rerun, missing-binary error, timeout kill (short fake? —
  use a real 1 s vs 100 ms timeout to assert kill, fast).
- Existing: full gates + live archive test + yt-dlp regression set.

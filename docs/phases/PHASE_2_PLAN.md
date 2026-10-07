# PHASE 2 PLAN — Tool management & yt-dlp hardening (still v1.8.0 Unreleased)

All phases stay in v1.8.0 until the user calls the version. No version bump.

## 0. Recon summary

Exists: yt-dlp/ffmpeg/gallery-dl resolve + SHA256 + repairEngine, updateEngine
(-U, blocked while active), checkForUpdates hourly cache + force, app
Setup-download + silent /S install, onboarding 3 steps (folder/theme/preset +
engine status line), presets Best..Compatible + full audio set + per-job
rawFormat/container, embed/subs/chapters/SponsorBlock(all,-filler)/pacing/
proxy/cookies/archive, queue backoff + retryAll, error mapper incl.
extractor-failed + update-retry action, Logs versions/update/repair cards,
redacted diagnostics, .part cleanup on cancel, outputBytes on done.

Missing: generic tool registry/manifests, Tools & Engines UI, Doctor,
channels, last-checked, JS-runtime auto-wire, aria2c toggle, concurrent
fragments, retries/socket timeout settings, trim sections, SponsorBlock
categories, playlist reverse, stalled watchdog, output verify, outdated
auto-retry-once, 24h throttle, auto-update opt-in, rollback wiring.

Verified vs bundled yt-dlp 2026.08.19 --help: --js-runtimes/--no-js-runtimes,
--impersonate + --list-impersonate-targets (curl_cffi targets present),
-N/--concurrent-fragments, -R/--retries, --fragment-retries, --retry-sleep,
--extractor-retries, --socket-timeout, --downloader/--downloader-args,
--update-to. ffmpeg is a GPL build (matches THIRD_PARTY_NOTICES).

## 1. Tasks

### A. Core — engine DONE, UI OPEN
- [x] core `tools.ts` (new): ToolManifest {id,exe,version,url,sha256,license,
      size,required,installMode bundled|external}, TOOL_MANIFESTS (yt-dlp,
      ffmpeg, gallery-dl bundled; deno, aria2c external/detect-only),
      compareVersions(), channel type. No new dep.
- [x] types+settings: ytdlpChannel stable|nightly, autoUpdateTools false,
      useAria2c false, concurrentFragments null, downloadRetries null,
      socketTimeoutSec null, stalledTimeoutSec 120, sponsorBlockCategories
      "all,-filler", impersonateClient null (experimental E),
      lastToolCheckAt null; job: trimStart/trimEnd null, outdatedRetried.
      Cleaners + DEFAULT_SETTINGS + shape-pin test + e2e mock mirror.
- [x] args: --js-runtimes (auto, detected only), --downloader aria2c (toggle
      + binary present, default yt-dlp args, no custom tuning — unverified),
      -N, -R + --fragment-retries, --socket-timeout, --sponsorblock-remove
      <cats>, --download-sections + --force-keyframes-at-cuts,
      --impersonate (E). All off by default → default argv byte-identical.
- [x] main detect: deno/node/aria2c presence (PATH + userData/bin, exec
      --version short timeout, never throws); wire into buildStartArgs deps.
- [x] EngineVersions += deno?, aria2c?, toolPaths?; getEngineVersion fills
      them best-effort.
- [x] New engine methods + channels (3): runDoctor, rollbackTool,
      reinstallTool (bundled re-copy + verify; external → guidance error).
      Preload mirror + e2e mock stubs.
- [ ] Tools & Engines section in SettingsScreen: rows (name/version/path/
      status), Update/Reinstall/Rollback, channel select, Update-all,
      last-checked, Doctor card (Run, per-check rows, fix buttons, export).
- [x] Doctor: core pure helpers (compareVersions, check shapes) + main
      runDoctor (exec versions, minimums, dirs writable, free disk, GitHub
      reachable, runtimes, ffmpeg; offline-safe). Report exportable (copy).
- [ ] Wizard: keep 3 steps; folder step += optional cookies; preset step
      engine line → tools check with versions + Update/Repair actions.

### B. Stability — engine DONE, UI OPEN
- [x] Controller auto-retry-once when sole unfinished job fails
      extractor-outdated (job.outdatedRetried flag, updateEngine via widened
      QueueEngine Pick, failures fall through, never loops).
- [ ] Outdated banner in Downloads (extractor-failed errors → Update &
      retry-all).
- [x] Throttle 24h (was 1h), persisted lastToolCheckAt.
- [ ] autoUpdateTools opt-in (setting persists; launch check → updateEngine
      when idle + toggle UI still open).
- [x] Integrity: done-path verify output exists + non-empty else error
      (archive-skip exempt via ARCHIVE_SKIP_RE, D160); clean .part/.ytdl
      siblings on success; runBinary timeouts (versions 30s, update 10min).
- [x] Watchdog: lastActivity per job, unref interval, stalledTimeoutSec
      (0=off), single "stalled" emit; queue keeps downloading + stage.
- [ ] Card shows Stalled + Restart (pause→resume) — engine emits `stalled`
      stage; no card UI yet.
- [x] Tests: registry shapes, args per flag (default argv unchanged test),
      detect (mock PATH), doctor helpers, rollback mismatch, throttle,
      auto-retry-once (fake engine), stalled helper, verify-output.

### C. QoL (gaps only; rest exists)
- [ ] Trim section inputs (Home Advanced, single only) + validateTrimTime.
- [ ] SponsorBlock categories text input (sanitized allow-list chars).
- [ ] Playlist reverse (UI-side entry reorder, no engine flag).
- [ ] Retries/fragments/socket-timeout Network inputs; aria2c toggle
      (disabled with guidance when binary absent).
- [ ] Custom global format string: DEFERRED (per-job rawFormat exists).
- [ ] Smallest preset: DEFERRED (preset-union churn vs demand).
- [ ] Preset summary chip under URL input (if missing).

### D. Polish
- Busy states on tool buttons, status badges, title tooltips.
- E (after DoD, low-risk only): --impersonate experimental UI.
- E deferred: PO-token/bgutil (new binary+dep), yt-dlp.conf import.

## 2. Files touched

New: core tools.ts(+test), doctor.ts(+test helpers), docs/phases/PHASE_2_PLAN.md.
Edit: types, settings(+test), validate(+test), args(+test), queue(+test: outdatedRetried carry),
queueController(+test), engine (versions+3 methods), desktopEngine, jobArgs(+test),
binaries/binaryManager (detect fns+tests), ipc (job fields), preload, e2e mock,
SettingsScreen, Onboarding, Downloads (banner), Home (trim/reverse/chip),
Logs (versions rows), stores fakes, DECISIONS, CHANGELOG, README, ROADMAP.

## 3. Risks

- Default argv must stay byte-identical (pin test: all new flags off → old argv).
- updateEngine while active throws; auto-retry only when sole job + catches.
- Aria2c custom tuning unverified → ship bare --downloader only.
- Deno wiring is detect+flag, not bundled runtime (size + maintenance).
- Nightly channel: check honors it via releases list; updateEngine uses
  --update-to when nightly (verify flag) else -U.
- 3 new IPC methods → update preload + e2e mock + fakes together.

## 4. Test plan

- Vitest: tools/doctor helpers, args (each flag + default-unchanged),
  settings merge/shape, queue transitions, controller auto-retry-once +
  no-loop, rollback mismatch/success, throttle helper, trim validator.
- Gates: typecheck + lint + test + build. Live yt-dlp regression
  (desktop integration ran in Phase 1; re-run here).
- Manual: wizard on fresh userData, Doctor green, corrupt yt-dlp →
  Doctor red → Repair/Reinstall → green, rollback restores, outdated
  banner on 403/signature sample, stalled Stadium (long timeout hard —
  unit-tested + code-reviewed), aria2c toggle without binary → guidance.

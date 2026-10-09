# PHASE 5 PLAN — Optional Tool Packs

Source: docs/UPDATE_PLAN.md § Phase 5. Recon 2026-10-08: Tier A release
research (live GitHub API) + codebase recon (two subagents).

## 0. Verified facts (not memory)

- Streamlink: portable `streamlink-8.6.2-1-py314-x86_64.zip` (~84 MB) in
  `streamlink/windows-builds`, BSD-2-Clause, NO checksums file (API digest
  only). Flags: `--json`, `best -o FILE`, `--force`, `--progress`.
- N_m3u8DL-RE v0.6.0-beta: `N_m3u8DL-RE_v0.6.0-beta_win-x64_20260629.zip`
  (~5.5 MB), MIT, NO checksums file. Flags: `--save-dir/--save-name/
  --tmp-dir`, `--auto-select`, `-M format=mp4`, `--ffmpeg-binary-path`,
  `--log-level`, `--del-after-done`.
- whisper.cpp moved to `ggml-org/whisper.cpp`; stables carry NO binaries —
  pin nightly `b5454` (`whisper-bin-x64.zip`, 8.9 MB, `whisper-cli.exe`,
  digest verified today), MIT, NO checksums file. Models (HF):
  tiny 75 / base 142 / small 466 MiB. Flags: `-m`, `-f`, `-osrt -of`.
  Update discovery: newest nightly containing `whisper-bin-x64.zip`.
- rclone v1.75.1: `rclone-v1.75.1-windows-amd64.zip`, MIT, **`SHA256SUMS`
  published** (full verification). Flags: `listremotes`, `copyto`,
  `--auto-confirm`. rclone owns its config; FluxDL stores only `remote:path`.
- No filename sanitizer exists in core (will add `sanitizeFileStem`).
- gallery-dl license re-confirmed GPL-2.0 (existing notices pattern stands).

## 1. Tasks

### A. Framework — DONE

- [x] core `packs.ts` (new, pure): PackKind (`engine|postprocessor|
      utility`), PackManifest {id,name,exe,version,pinnedUrl,sizeBytes,
      license,homepage,capabilities,requiresFfmpeg}, PACK_MANIFESTS (4 Tier
      A, pinned URLs/versions above), asset pickers per repo
      (parseStreamlinkAsset, parseNm3u8dlAsset, parseWhisperAsset,
      parseRcloneAsset + parseSha256sums), revoke check
      (`isRevoked(revoked, id, version)`), sanitizeFileStem, manifest URL
      allowlist (github.com + huggingface.co only). Tests + fixtures.
- [x] settings: `dismissedPackHints: string[]` (suggestion memory).
      `transcribeAudio: bool` + `whisperModel: tiny|base|small` and
      `rcloneRemote: string|null` + `autoUpload: bool` in the postProcess
      block (cleaners + shape-pin + e2e mirror).
- [x] `EngineId += "streamlink" | "n-m3u8dl-re"` + ripple: queue
      allow-list/defaults, ipc validator, engines router (no auto rule —
      domainRules + suggestion only; `.m3u8/.mpd` path rule in Home/Batch
      when installed), badges/labels/menus, settings domainRules cleaner,
      tools registry entry, JobMenu kind mapping, e2e mirror.
- [x] main `packManager.ts` (new): layout `userData/packs/<id>/<version>/`
      + `installed.json`; ops install/update/uninstall/status/progress;
      download (fetch stream + size cap + abort, progress state for the
      500 ms UI poll); rclone SHA256SUMS verify; no-checksum packs =
      explicit consent + size check (D-new); hand-rolled unzip (system tar
      is GNU tar under git-bash and chokes on `C:\` — verified live;
      central-directory parser, Zip-Slip + CRC guards); exe locate by walk
      (≤3 levels); atomic swap keeping the previous version dir (cheap
      rollback); uninstall removes all versions; du with entry cap;
      per-pack timeouts (install/update 30 min); revoke gate on
      install/update/use (`resources/packs-revoked.json`, helper mirroring
      bundledBinDir); models dir for whisper (+size check, no checksums
      published — consent). Tests: local HTTP server + hand-made zips,
      checksum mismatch hard-fail, partial-install cleanup,
      revoked block, offline failure, busy-guard + cancel, model flow.
- [x] ONE channel `packs` (op-based: status/install/uninstall/check-update/
      update/progress/install-model/remove-model). Preload + e2e mock +
      pin 55→56. No new dependencies (hand-rolled unzip; tar abandoned —
      see D170-neighbor entry).

### B. Engine packs — DONE (live-verified where account-free)

- [x] Streamlink spawn path: `streamlink <url> best -o <stem>.ts --force`,
      indeterminate progress (format unverified — no fake percentages),
      destination known upfront, kill-tree pause/resume (relaunch; live-edge
      caveat recorded). Suggestion chip in Home when live/upcoming + installed
      + not dismissed (enqueue with engineId). LIVE: installed 8.6.2-1
      (~84 MB) + `--can-handle-url twitch.tv` exit 0 + uninstalled (216 s).
- [x] N_m3u8DL-RE spawn path: `<url> --save-dir --save-name -M format=mp4
      --ffmpeg-binary-path <ours> --auto-select --tmp-dir <tmp>
      --del-after-done --log-level INFO`, indeterminate progress, destination
      known upfront. Direct `.m3u8/.mpd` routing in Home/Batch when installed
      (else yt-dlp as today). "Try with N_m3u8DL-RE" ErrorAction when
      installed (re-enqueue same job, engine flipped). LIVE: installed
      v0.6.0-beta + downloaded the Mux test HLS stream to done + uninstalled.
- [x] Live-verify DoD pieces that don't need accounts: rclone install
      (SHA256SUMS-verified) + `listremotes` + uninstall; whisper b5454
      install + `--version` + tiny-model fetch + remove + uninstall. A real
      stream capture and a real transcription stay manual-checklist items
      (need a live-up source / long CPU run).

### C. Postprocessor packs — DONE (transcription run is manual-checklist)

- [x] PostStep += `transcribe-audio` | `upload-remote`; stepsFor (audio→
      transcribe when on; upload when autoUpload + remote set); runner:
      whisper (ensure model — missing = guidance error;
      16 kHz wav via ffmpeg → `-osrt -of <sidecar>` → cleanup wav; CPU
      default, experimental tag in UI); rclone (`copyto <file> <remote>`,
      `--auto-confirm`, exit-code checked, never reads rclone.conf).
      Settings UI chips. Tests (argv builders pure; runner guidance paths;
      live whisper --version + model fetch above).
- [x] Menus: `post-run` mapping extends (audio→tag then transcribe? one
      step per menu item — offer Transcribe/Upload items). Manual "Upload
      via rclone" (remote from settings; missing remote = guidance toast).

### D. Store UI + polish — DONE

- [x] Settings "Tool Packs" section: rows (name/version/size/status/path),
      Install/Update/Remove, Update-all, consent checkbox + notes, model
      picker for whisper (sizes shown), disk usage. Install progress:
      polled bytes + cancel. (License inline + explicit consent instead of
      a modal — same explicitness, less chrome.)
- [x] THIRD_PARTY_NOTICES.md: 4 pack licenses (BSD-2/MIT×3) + no-checksum
      rationale + source links.
- [x] E (after DoD): user-supplied manifests, Doctor pack health.
      Tier B → ROADMAP one-liners (below).

## 2. Files touched (surgical)

New: core `packs.ts(+test)`, main `packManager.ts(+test)`,
`resources/packs-revoked.json`.
Edit: types.ts (EngineId, settings, PostStep), settings.ts(+test),
queue.ts(+test), engines.ts(+test), tools.ts, ipc.ts (validator + handler),
preload, e2e mock, index.test.ts (pin), engine.ts (+channel),
desktopEngine.ts (2 spawn paths + auto-run? no — packs are manual/router
  only, no auto), jobArgs.ts(+test, 2 argv builders), Home.tsx (chip +
  m3u8 rule), BatchPanel.tsx (m3u8 rule), ErrorActions.tsx (try-with button,
  component-level — no errors.ts change), menus/JobMenu/Downloads/Library
  (labels/runner mapping), SettingsScreen.tsx (packs section via PackStore.tsx
  + post chips), strings.ts(+parity), backup? (no —
  packs reinstall on demand; record), DECISIONS.md, CHANGELOG.md, ROADMAP.md.

One new IPC channel (55→56). No new dependencies.

## 5. Tier B (document only, per master plan)

- Instaloader (Instagram galleries — overlaps gallery-dl; evaluate if
  gallery-dl's instagram extractor regresses).
- TwitchDownloader CLI (VOD chapters/chat render — complements the
  streamlink live-capture pack).
- tdl (Telegram bulk media — needs API credentials the app must never hold;
  needs a secrets story first).
- ExifTool (metadata read/write beyond ffmpeg's tags — Perl runtime
  bundling cost).
- Real-ESRGAN / waifu2x-ncnn-vulkan (image upscale postprocessor — 30-100 MB
  weights per model, GPU-dependent).
- Demucs (stem separation postprocessor — PyTorch weight downloads,
  outside the CPU-only comfort zone).
- Tesseract (OCR sidecars for comics/manga — language-data downloads).
- MediaInfo (richer technical reports than ffprobe — overlaps existing
  ffprobe panel; weakest case).

## 3. Risks

- Nightly-only whisper binary (no stable asset): pin b5454 + discovery of
  newer nightlies with the same asset; revoked-list covers a bad build.
- No published checksums (3/4 packs): explicit consent + size check; rclone
  proves the strict path. Recorded in D + notices.
- Streamlink/N_m3u8DL-RE progress formats unverified → indeterminate only;
  watchdog covers stalls (stderr activity).
- 84 MB streamlink + 466 MB small model: disk-space gate before download;
  size shown upfront; uninstall reclaims.
- EngineId widening ripples: compiler catches; tests enumerate (menu,
  queue allow-list, router).
- Live verification needs live sources: DoD pieces that need accounts or
  live-up streams are recorded as manual-checklist, not faked.

## 4. Test plan

- New pure: asset parsers (release fixtures), revoke check, sanitize stem,
  argv builders, stepsFor additions, try-with rule.
- Manager: local HTTP server serving hand-made zips; mismatch hard-fail;
  partial cleanup; revoked block; update swap + rollback pointer; du cap.
- Runner: stub whisper-cli/rclone scripts asserting argv (no network).
- Existing: full gates + live archive test + yt-dlp regression set.
- Live (best effort): N_m3u8DL-RE HLS; streamlink can-handle + capture.

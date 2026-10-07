# FluxDL — Update Master Plan (Phase 1–7)

## MASTER BRIEF (for the AI)

### 1. Context

FluxDL is a Windows desktop app (Electron + React + TypeScript monorepo, internal scope @grabber/*, display name via the single APP_NAME constant). It is a GUI for yt-dlp. It is publicly released on GitHub and has real users, so regressions are expensive.

Goal of this plan: evolve FluxDL into a stable multi-engine media + image downloader. Order: gallery-dl and the engine foundation → tool management → queue/automation/library → post-processing → optional tool packs → remote/integrations → release hardening.

### 2. Non-negotiable rules

- Read first: CLAUDE.md, DECISIONS.md, PHASE2_NOTES.md and the existing code. Existing conventions win over this document. If they conflict, flag it. (The Android/.apk plan is dropped; ignore Android scope.)
- Surgical changes. Do not rewrite working modules. Wrap, extend, deprecate. Refactor only when the phase requires it, and keep diffs small and reviewable. One logical commit per task, conventional commit messages.
- Never break the existing yt-dlp flow. Every phase ends with a yt-dlp regression check: video, audio-only, playlist, cancel, retry.
- Do not trust this document for CLI flags or library APIs. Verify against the bundled binary's --help, official docs and installed package versions before using anything. If something does not exist, adapt and log it in DECISIONS.md.
- No new dependency without justification (size, maintenance, license, Windows support) recorded in DECISIONS.md. Prefer built-ins and existing deps.
- Do not invent. If an ambiguity blocks you, ask one short question. Otherwise pick the safest default, record it, continue.
- UI: match the existing dark premium design system. Reuse existing CSS custom properties/tokens and GSAP patterns. No new UI framework. Honour prefers-reduced-motion. Route all new user-facing strings through the existing string mechanism (or one central constants module if none exists).
- Keep @grabber/* identifiers. Use APP_NAME for display.
- Privacy-first: no telemetry. Network calls only for engine/tool updates (GitHub releases) and explicit user actions.
- No DRM circumvention features. Keep the README disclaimer: users are responsible for site ToS and copyright.
- Reports are direct and concise. No filler.

### 3. Workflow for every phase

- Step 0 — Recon (read-only). Map the relevant code. List what already exists vs what is missing (some items may already be done: skip them and say so). Write a short plan to docs/phases/PHASE_N_PLAN.md (tasks, files touched, risks, test plan). Then proceed without waiting, unless a blocking question exists.
- Step 1 — Implement in order A → B → C → D. Do E (Recommended) only after the Definition of Done is met and only items that are low-risk. Unimplemented E items go to docs/ROADMAP.md with a one-line rationale.
- Step 2 — Verify: typecheck, lint, unit tests, build, app smoke run, yt-dlp regression, phase manual checklist.
- Step 3 — Document: DECISIONS.md, CHANGELOG.md (Keep a Changelog, under Unreleased), README (user-facing changes only), THIRD_PARTY_NOTICES.md when binaries are added.
- Step 4 — Report and STOP. Format: Done / Skipped (why) / Deviations from plan / Known issues / Manual test checklist for me / Suggested adjustments to the next phase. Do not start the next phase.

### 4. Global standards (apply to every phase)

Process & security: Spawn with an args array, shell: false. Put -- before user-supplied URLs. Never string-interpolate into a shell. Electron: contextIsolation on, nodeIntegration off, minimal typed preload API, validate every IPC payload (zod or the existing validator). Secrets only via Electron safeStorage. Redact secrets and URL tokens in logs, UI-visible commands and diagnostics. URLs: http/https only, length cap, trimmed and normalized.

Windows: Kill whole process trees on cancel/quit. Handle long paths, reserved names (CON, NUL, …), trailing dots/spaces, illegal characters, Unicode normalization, locked files, antivirus interference. Force UTF-8 for child processes where supported. Handle CRLF and partial chunks when parsing output.

Reliability: Nothing blocks the UI thread or startup. Every external call has a timeout. Every long operation is cancellable. Crashes in a child process never crash the app. Temp-then-atomic-move for any file the app writes.

Observability: Structured logs with rotation, tagged by engine and job id. "Export diagnostics" produces a redacted zip (logs, versions, OS, settings without secrets).

Testing: Vitest for unit tests, with real captured stdout/stderr fixtures. Fake-engine integration tests. GitHub Actions CI on windows-latest (install, typecheck, lint, test, build).

UX: Every error is translated into plain language with 1–2 action buttons and an expandable raw-details section. Keyboard navigable, visible focus rings, aria-live for progress, no layout shift, virtualize long lists.

### 5. Phase map

| Phase | Theme |
|-------|-------|
| 1 | gallery-dl + engine/binary foundation |
| 2 | Tool management + yt-dlp hardening (ffmpeg, JS runtime, aria2c, Doctor) |
| 3 | Queue v2, subscriptions, library, templates |
| 4 | Post-processing pipeline (conversion, tagging, packaging, compress) |
| 5 | Optional Tool Packs (Streamlink, N_m3u8DL-RE, whisper.cpp, rclone) |
| 6 | Remote API, browser extension, mobile web UI, notifiers |
| 7 | Release hardening, signing, auto-update, i18n, repo quality |

## PHASE 1 — gallery-dl & the engine foundation

Goal: a user pastes a link to an image/gallery site and gets the images reliably, through a clean multi-engine architecture that every later phase builds on.

### A. Core

- Engine abstraction. Define a DownloadEngine interface in the shared package: id, label, capabilities (video / audio / images / live), probe(url), getInfo(url, opts), start(job, hooks), cancel(jobId), parseProgress, getVersion(), checkUpdate()/update(). Write characterization tests for current yt-dlp behaviour first, then wrap the existing code as YtDlpEngine with zero behaviour change.
- Binary manager (generic, reused in Phases 2 and 5): resolve path (bundled resources → userData/bin override), detect version, update from official GitHub releases, verify SHA-256 against published checksums, atomic replace (download to temp → verify → rename), keep the previous version for rollback, handle Windows file-in-use, support update channels where the tool has them, never block startup, never crash when offline.
- GalleryDlEngine. Bundle the official standalone Windows gallery-dl.exe. Use an app-owned config file in userData, generated from FluxDL settings. Never read or modify the user's global gallery-dl config unless they opt in ("use my config"). Verify every flag against gallery-dl --help and the official docs before use (directory, filename templates, config, range, simulate/dump-json, cookies, archive, sleep, retries, rate limit, proxy, metadata sidecar).
- Router (deterministic and explainable). Modes: Auto / Video (yt-dlp) / Images (gallery-dl), with per-job override. Auto resolution order: user rule table by domain (editable), built-in default table, cached probe with short timeout (gallery-dl support check, then yt-dlp), neither supports it → clear "unsupported" error with suggestions. For sites both engines handle (Twitter/X, Reddit, Tumblr, Instagram, …): document the default per site in DECISIONS.md, offer "Try other engine" on failure and a "Download both" option. Show an engine badge on every job and store the engine id in job and history records.
- Job model: one job → many files. Counters (downloaded / skipped / failed / total if known), per-file results (path, size, status), and a status machine: queued → probing → running → completed | partial | failed | cancelled. partial is a first-class state.
- Progress. Robust stdout parsing into events (line buffering across chunks, CRLF, UTF-8). UI shows an indeterminate bar, live counters and a live thumbnail strip of finished files. No fake percentages.
- Settings → "Images" section: default folder, folder-template presets, filename-template presets, sleep/rate limit, retries, proxy, archive toggle, metadata sidecar toggle. Advanced: raw config editor with JSON validation and "reset to defaults".
- Auth. cookies.txt import with Netscape-format validation. Cookies-from-browser (Firefox, Chrome, Edge, …). When a Chromium cookie DB is locked or encrypted in a way the engine cannot read, show clear guidance: close the browser, use Firefox, or export cookies.txt. Per-site username/password via safeStorage only. Secrets never appear in argv shown in the UI, logs or diagnostics. Prefer config-file injection over argv where the tool supports it.

### B. Stability

- Kill the child process tree on cancel and on app quit. On startup, clean orphan processes and partial/temp files from crashed sessions.
- Persist the queue. After a restart, interrupted jobs come back as interrupted (never auto-start blindly).
- Concurrency limits: global, per-engine, per-domain (conservative defaults for gallery-dl). Exponential backoff on 429/rate-limit signals.
- Error classifier + translator, shared by both engines. Categories: unsupported URL, login required, rate-limited, geo/region blocked, anti-bot/Cloudflare, not found/deleted, network/DNS/timeout, disk full, permission denied, path too long/invalid filename, engine outdated, missing dependency (ffmpeg/JS runtime), unknown. Each maps to a friendly message and 1–2 action buttons (Update engine & retry, Add cookies, Open in browser, Change folder, Copy diagnostics).
- Windows path hardening: use the engine's path-restriction options (verify) plus app-side validation of final paths. Before starting, check the output dir is writable and free space is sufficient.
- Settings schema versioning and migrations (back up settings before migrating). Old history rows default to engine yt-dlp.
- Structured logging, "Export diagnostics".
- Tests: router, progress parser (fixtures including split chunks), error classifier (real stderr samples), binary manager (mocked fs/network; checksum mismatch; rollback), config generator, fake-engine integration. CI workflow on windows-latest.

### C. QoL

- Smart paste: multi-line / multi-URL paste, drag-and-drop URLs, .txt URL lists, in-batch de-duplication.
- Gallery preview before download: item count (capped, show "20+" when capped), lazy thumbnails, select/deselect, "Download all / selected".
- "Retry failed items only", "Try other engine", "Open folder", "Open first file", "Copy URL", "Copy command (redacted)".
- Remember the last-used folder per media type. Default for images: Downloads/FluxDL/Images.
- Download-archive toggle (skip already downloaded) with "Clear archive".
- Native notification on completion/failure (default: only when the window is unfocused).

### D. Polish

- Image job cards in the existing dark premium style: thumbnail strip, counters, engine badge. Subtle GSAP micro-interactions (card enter, counter tick, thumbnail stagger), each ≤ 300 ms, with a reduced-motion fallback.
- Skeleton loaders for probing, designed empty and error states, virtualized long file lists.
- One-time dismissible "What's new" modal.
- Consistent microcopy, all strings centralized.

### E. Recommended (only after DoD)

- Per-site presets.
- Metadata sidecar viewer.
- "Test engine" button in settings (runs --version plus a dry probe).

### Definition of Done

- Images from at least 3 different public, no-login, SFW sources download correctly in Auto mode (e.g. Wikimedia Commons, public Flickr/Imgur albums). Tell me which URLs you used.
- Cancel leaves no orphan processes. Restarting mid-download recovers the job as interrupted.
- yt-dlp regression passes. CI is green. CHANGELOG, DECISIONS and THIRD_PARTY_NOTICES (gallery-dl is GPL-2.0, review the rest) are updated.

Out of scope: ffmpeg/aria2/JS runtime management (Phase 2), image conversion (Phase 4).

## PHASE 2 — Tool management & yt-dlp hardening

Goal: every external tool is managed in one place, first run is painless, and yt-dlp works reliably on current YouTube.

### A. Core

- Tool registry (extends the Phase 1 binary manager). Manifest per tool: id, version, source URL, checksum, license, size, required/optional, install mode (bundled / on-demand). Tools: ffmpeg + ffprobe (if not already handled). JS runtime (Deno) for yt-dlp's YouTube extraction. Verify yt-dlp's current docs for supported runtimes and flags, then wire it up automatically. aria2c as an optional downloader (--downloader aria2c with tuned args). Decide bundled vs on-demand per tool to protect installer size. Record the decision in DECISIONS.md.
- "Tools & Engines" settings page: name, version, path, status, Update / Reinstall / Rollback, channel (yt-dlp stable/nightly), "Update all", last-checked time.
- Doctor (health check): each tool executes, versions meet minimums, dirs writable, free disk, GitHub reachable, JS runtime present, ffmpeg present. One-click fix where possible. Result exportable.
- First-run wizard (max 3 steps, skippable): download folder, tool check/install, optional cookies.

### B. Stability

- Detect "engine outdated" patterns (extractor/signature errors, YouTube 403s) → banner "Update yt-dlp" with one-click update and one automatic retry (never a retry loop).
- Update checks: throttled (≤ 1/day), background, non-blocking, cancellable. Default is notify; auto-update is opt-in.
- Integrity: handle ffmpeg merge failures, clean leftover .part/.ytdl files, verify the output exists and is non-empty, optional ffprobe sanity check.
- Stalled-process watchdog (no output for N seconds → surface "stalled", offer restart). Per-tool timeouts.
- Rollback and offline behaviour covered by tests.

### C. QoL

- Format presets: Best, 4K/1440p/1080p/720p, Audio (MP3/M4A/Opus/FLAC), Smallest. Remembers the last choice. Advanced custom format string with validation and a docs link.
- Toggles: embed thumbnail, embed metadata, subtitles (language choice, embed or sidecar, auto-subs), chapters, SponsorBlock (mark/remove categories), trim sections (start–end time inputs with validation).
- Playlists: range select, item checklist, reverse, skip existing, "playlist as folder" template.
- Speed limit, retries, proxy, concurrent fragments, aria2c toggle.
- Shared cookies-from-browser component reused in the video flow.

### D. Polish

- Tool install progress UI with smooth GSAP progress, consistent status badges, tooltips explaining each toggle, a preset summary chip under the URL input.

### E. Recommended

- --impersonate support as an "Anti-bot mode (experimental)" (verify the bundled yt-dlp build supports it and what it needs).
- PO-token provider (bgutil) as an experimental opt-in, documented.
- Import an existing yt-dlp.conf and show what it changes.

### Definition of Done

Fresh install → wizard → YouTube video download works with merged formats. Doctor is all green. Deliberately corrupting a tool triggers a clear fix path. Rollback works. Regression and CI pass.

## PHASE 3 — Queue v2, subscriptions, library

Goal: FluxDL becomes something people keep open.

### A. Core

- Queue v2: priorities, drag-reorder, pause/resume all, per-job pause where the engine allows, concurrency settings, persisted in a DB (use what exists, or SQLite with WAL and migrations; justify any new dependency).
- History/Library DB and Library view: grid/list, search, filters (site, type, date, engine), sort, cached thumbnails (ffmpeg for video, sharp/nativeImage for images), open/reveal, delete to Recycle Bin (shell.trashItem), re-download, copy URL.
- Subscriptions/monitor for channels, playlists, artists/users: interval checks (minimum 30 min), new-item detection via download archive (verify yt-dlp/gallery-dl options), modes "auto-download" or "notify only", per-subscription folder/preset/engine, pause, last-run status, exponential backoff and auto-disable after N consecutive failures with a notice. Runs while the app is open or in tray. No hidden background service.
- Scheduler & limits: time windows, global bandwidth cap, per-job proxy override.
- Naming/template engine: presets (Default, By site/uploader, Plex/Jellyfin-friendly, Flat, Date-based), live preview from sample metadata, validated templates, mapped to each engine's template syntax.

### B. Stability

- DB integrity check on start. Automatic backup before migrations. A corrupted DB is renamed and recreated with a notice, never a crash.
- Export/import settings, history and subscriptions (secrets excluded).
- Guard against runaway subscriptions (cap new items per check, e.g. 50, with confirmation above the cap).
- Missing/moved library files are marked "missing" with a "relink" option.
- Resume correctly after sleep/hibernate. Enforce a single-instance lock (requestSingleInstanceLock).

### C. QoL

- Clipboard watcher: opt-in, off by default, only matches supported-site URLs, shows a toast "Add to queue?", never reads other content.
- Tray icon, minimize-to-tray, tray menu (pause all, open folder, quit).
- Completion notifications with actions (open file / folder).
- Keyboard shortcuts plus a cheat sheet. Opt-in auto-start with Windows.
- fluxdl://add?url= protocol handler (always confirm before adding).

### D. Polish

- Virtualized library grid with smooth scrolling, subtle GSAP view transitions, skeleton thumbnails, empty states, density toggle (compact/comfortable), count badges in the sidebar.

### E. Recommended

- User tags and favorites, library CSV export, a small stats page (downloaded this week, space used).

### Definition of Done

A subscription detects and downloads a new item end-to-end. The library survives a restart with 1,000+ items without lag. A corrupted DB recovers gracefully. Regression and CI pass.

## PHASE 4 — Post-processing pipeline

Goal: optional automatic processing after download, configurable per preset, never destroying originals by default.

### A. Core

- Pipeline framework: ordered steps, per-preset enablement, keep-original option (default: keep), progress and errors per step, cancellable, runs in a worker/child process. A failed post-process does not mark the download failed; it becomes "post-process failed" with a retry action.
- Image conversion/optimization: WebP/AVIF → JPG/PNG, max-size resize, quality, strip EXIF/GPS (privacy toggle). Use sharp (verify Windows prebuilds and asar-unpack) or fall back to ffmpeg.
- Ugoira (animated Pixiv) → GIF/WebM/MP4 via ffmpeg (verify gallery-dl's ugoira options).
- Gallery packaging: ZIP/CBZ per gallery. PDF only if a lightweight library fits, otherwise roadmap.
- Audio auto-tagging: MusicBrainz lookup (respect the 1 req/s limit, descriptive User-Agent with app name/version) plus Cover Art Archive. Ask the user when match confidence is low. Skip already-tagged files. Lyrics → roadmap (licensing).
- Media info panel from ffprobe (codec, bitrate, resolution, duration, size) in the library item drawer.
- Compress/transcode actions with ffmpeg presets (Small / Balanced / Archive) and hardware-acceleration detection (NVENC/QSV/AMF) with a safe CPU fallback. This replaces bundling HandBrake.

### B. Stability

- Write to temp, verify output (ffprobe / sharp metadata), then atomic move. Disk-space check first.
- Never delete originals unless the user explicitly picks "replace original" and confirms (goes to Recycle Bin).
- Timeouts, cancellation kills the process tree, worker crashes are isolated, steps are idempotent. Concurrency 1–2 at lower process priority.

### C. QoL

- "After download" chips per preset. Batch actions on library multi-select (convert, tag, compress, package). Before/after size-saving preview. "Reprocess" action.

### D. Polish

- Per-step progress chips on the job card, estimated savings, subtle animations, clear error copy.

### E. Recommended

- Duplicate image finder: perceptual hash (dHash) in a worker thread, grouped results, keep-best suggestion, delete to Recycle Bin, never automatic.
- EXIF viewer, auto-rename by metadata.

### Definition of Done

A gallery job with "convert WebP→JPG + strip EXIF + CBZ" completes end-to-end with originals preserved. An audio file gets correct tags and cover art. A failed step is retryable. Regression and CI pass.

## PHASE 5 — Optional Tool Packs

Goal: power features without bloating the installer. Packs download on demand, with consent.

### A. Core

- Pack framework: manifest schema (id, name, version, platform, URL, sha256, size, license, homepage, capabilities, requires). Install to userData/packs/<id>/<version>. Verify checksum, show and accept the license, uninstall, update, show disk usage. Sandboxed execution (args arrays, restricted working dir, no secrets in the environment). Pack types: engine (plugs into the router), postprocessor (plugs into the pipeline), utility.
- Pack Store UI: list, details (size, license, purpose, risk notes), install/remove/update, status.
- Implement these packs: Streamlink (live-stream engine with a router rule). N_m3u8DL-RE (fallback engine for stubborn HLS/DASH, offered as "Try with N_m3u8DL-RE" on yt-dlp failure, plus direct .m3u8 input). whisper.cpp (post-processor for transcript/subtitles, with on-demand model download (tiny/base/small, sizes shown), CPU default, marked experimental). rclone (post-processor that uploads to a configured remote. rclone owns its config; FluxDL never stores those credentials).
- Tier B (document only, do not implement) in docs/ROADMAP.md with integration notes: Instaloader, TwitchDownloader CLI, tdl, ExifTool, Real-ESRGAN/waifu2x (ncnn-vulkan), Demucs, Tesseract, MediaInfo.

### B. Stability

- A crashing pack never crashes the app. Per-pack timeouts. Compatibility range with the FluxDL version. Checksum mismatch is a hard fail. Partial installs are cleaned up.
- Ship a bundled revoke-list (json, updated with app releases) to disable a flagged pack version. No remote kill-switch call.

### C. QoL

- Contextual, dismissible suggestions (live URL detected → suggest Streamlink), remembered so they never nag. "Try with …" buttons in error actions.

### D. Polish

- Pack cards consistent with the design system, install progress, license modal.

### E. Recommended

- Advanced, off-by-default, big-warning support for user-supplied pack manifests. Pack health in Doctor.

### Definition of Done

Install → use → update → uninstall works for each Tier A pack. A deliberately broken pack is isolated. Checksum mismatch blocks install. Regression and CI pass.

## PHASE 6 — Remote & integrations

Goal: send links from phone or browser to FluxDL safely. This replaces the dropped .apk with far less work.

### A. Core

- Local API server (disabled by default). Binds to 127.0.0.1. Endpoints: add URL(s), list queue/status, pause/resume/cancel, health. Schema validation, token auth (random ≥ 32 bytes, rotate/revoke), CORS locked to known origins, rate limiting, body-size cap. No endpoint exposes arbitrary filesystem paths or executes commands.
- LAN mode: explicit opt-in with a big warning, QR pairing with a one-time token, optional IP allowlist, optional auto-disable after N hours. Evaluate HTTPS options and record the decision in DECISIONS.md.
- Mobile web UI (tiny PWA served by the app): paste/share a URL, see queue and progress, pause/cancel, styled consistently with the app. Use the PWA share target where supported.
- Browser extension (Chromium + Firefox, MV3) in /extension: context menu and toolbar button "Send to FluxDL". Talks to the local API with a token (or native messaging; evaluate and pick the lower-risk option in DECISIONS.md). Build script only, no store publishing.
- Notifiers: Discord webhook and Telegram bot for completion/failure. Opt-in, secrets via safeStorage.

### B. Stability

- Clean start/stop with the app. Port conflict handling (auto-pick, show the port). A bind failure never crashes the app.
- Redacted audit log of API calls. Validation tests and fuzzing on the API. Protect against CSRF and DNS rebinding (check Host header, Origin allowlist).

### C. QoL

- "Copy pairing link", connection status, "Test connection" button, fluxdl:// deep link.

### D. Polish

- Pairing flow with a QR animation, clear status indicators.

### E. Recommended

- Tiny fluxdl add <url> CLI on the same API. Docs for ShareX / automation integrations.

### Definition of Done

A link sent from a phone on the same Wi-Fi (LAN mode) and from the browser extension lands in the queue and downloads. Server off by default. Security checks pass. Regression and CI pass.

## PHASE 7 — Release hardening & public-project quality

Goal: trustworthy public releases.

### A. Core

- App auto-update via electron-updater + GitHub Releases: verified, user-controlled channel (stable/beta), release notes shown, rollback instructions.
- Windows code signing: evaluate SignPath Foundation (free for OSS), Azure Trusted Signing, or a paid certificate. Verify eligibility for the maintainer's country (Malaysia) before committing. Wire it into CI. If signing is not possible, document SmartScreen behaviour in the README and publish SHA-256 checksums.
- Installer + portable builds (NSIS + portable zip): per-user install without admin, clean uninstall (option to keep settings), reversible protocol/file-association registration.
- Release pipeline (GitHub Actions): tag → build → test → sign → draft release with notes from the CHANGELOG, checksums file, SBOM (CycloneDX), provenance attestation if feasible.
- Compliance: complete THIRD_PARTY_NOTICES.md shipped in-app (linked from About). Review license implications of every bundled binary (gallery-dl GPL-2.0; check ffmpeg build type LGPL vs GPL; check yt-dlp's release-binary license). Add a source-offer note where required and a README legal disclaimer.
- Repo hygiene: README (demo GIF, features, install, FAQ, troubleshooting: SmartScreen, antivirus false positives, browser cookie issues), SECURITY.md, CONTRIBUTING.md, issue templates (bug report requires "Export diagnostics"), PR template, Dependabot/Renovate.

### B. Stability

- Playwright-for-Electron e2e tests with fake engines. Soak test (50-job queue, cancel storms). Idle CPU/memory profiling. Measurable startup budget (set a target and record the baseline). Bundle-size audit and asar/unpack review.
- Opt-in local-only crash report file (never auto-upload). npm audit and a license checker in CI.

### C. QoL

- English + Malay localization: i18n scaffold (reuse what exists or react-i18next), extract all strings, language setting.
- Accessibility pass: WCAG AA contrast, keyboard-only flows, screen-reader labels.
- About dialog listing all tool versions. "Report a bug" button → prefilled GitHub issue with redacted diagnostics (user confirms before sending anything).

### D. Polish

- Crisp icons at all DPIs (app + tray), loading/splash polish, consistent window chrome, GSAP performance audit with reduced-motion verified, final UI consistency sweep, fresh docs screenshots.

### E. Recommended

- winget / scoop / Chocolatey manifests. A landing page on GitHub Pages in the same dark premium style. In-app changelog view.

### Definition of Done

A tagged release produces installer + portable + checksums + SBOM automatically. Auto-update works from the previous version. e2e and soak tests pass. Docs are complete.

---

## Execution agreements (v1.8.0+ brainstorming, 2026-10-06)

- gallery-dl.exe: BUNDLED in installer (user choice). GPL-2.0 source-offer + THIRD_PARTY_NOTICES required.
- Phase 1 split: v1.8.0 foundation (engine abstraction + BinaryManager + router skeleton + yt-dlp wrap, zero behaviour change) then v1.8.5 images (GalleryDlEngine + preview + badges).
- DoD image sources: Wikimedia Commons, public Flickr/Imgur albums (SFW, no-login).
- Android/.apk scope stays dropped. Mobile handled via Phase 6 remote/PWA, not native.

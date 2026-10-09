![FluxDL](docs/banner.svg)

[![GitHub release](https://img.shields.io/github/v/release/Myung-Young/FluxDL?label=latest)](https://github.com/Myung-Young/FluxDL/releases)
[![Windows](https://img.shields.io/badge/Windows-10%2F11%20x64-0078D6?logo=windows&logoColor=white)](https://github.com/Myung-Young/FluxDL/releases)
[![yt-dlp](https://img.shields.io/badge/engine-yt--dlp-ff7f50)](https://github.com/yt-dlp/yt-dlp)
[![pnpm](https://img.shields.io/badge/pnpm-workspaces-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![No telemetry](https://img.shields.io/badge/telemetry-none-success)](https://github.com/Myung-Young/FluxDL)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/Myung-Young/FluxDL/blob/main/LICENSE)
[![Download latest](https://img.shields.io/badge/Download-latest-brightgreen?logo=windows&logoColor=white)](https://github.com/Myung-Young/FluxDL/releases/latest)

**FluxDL** is a fast, private desktop downloader for video, audio and
image galleries on Windows — a friendly face over the battle-tested
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and
[gallery-dl](https://codeberg.org/mikf/gallery-dl) CLIs, with queueing,
playlists, batch paste, live streams, post-processing, and a compact
always-on-top mini window.

- 🔒 **Local-first** — no accounts, no telemetry, no remote content. Your
  links never leave your PC except to fetch the media itself.
- 📦 **Zero setup** — yt-dlp + ffmpeg + gallery-dl ship inside, SHA-256
  verified. No admin rights needed.
- 🌍 **English + Bahasa Melayu** — full UI in both languages.

> You are responsible for respecting copyright and each site's terms.
> Only download content you own or are allowed to keep.

## Download

Get the latest release for **Windows 10/11 x64** from the
[Releases page](https://github.com/Myung-Young/FluxDL/releases):

| File                        | Best for                                                          |
| --------------------------- | ----------------------------------------------------------------- |
| **`FluxDL-Setup-*.exe`**    | Most users — per-user installer wizard, changeable install folder |
| **`FluxDL-Portable-*.exe`** | USB sticks & no-install use — single file, runs from any folder   |

Every release also ships **`SHA256SUMS.txt`** (verify before running)
and **`bom.json`** (software bill of materials).

> **"Windows protected your PC"?** These builds are not code-signed, so
> SmartScreen shows a warning on first run. That is an identity check,
> not a malware verdict — click **More info → Run anyway**.
> Details in [`docs/SIGNING.md`](docs/SIGNING.md).

## Quick start

1. **Paste a link** on the Home tab (`Ctrl+V` works anywhere) and hit
   **Analyze** — or press **Quick download** to skip the preview.
2. Pick a preset (**Compatible MP4**, 1080p, 4K, MP3…) and hit Download.
3. Track everything in **Downloads**, rewatch from the **Library**, and
   inspect any failure in **Logs** with one click.

Pasting **multiple links**? They route to the **Batch** tab automatically
(up to 500 links, playlists expandable per video).

## What's new in v1.8.x

- **Image galleries** — gallery-dl engine with preview (count, thumbnails,
  select), per-link Auto/Video/Images override, Try-other-engine on
  failures, live file counters.
- **Managed tools** — Tools & Engines page (versions, Update / Reinstall /
  Rollback, yt-dlp channel, health check with one-click fixes), outdated
  banner, Smallest preset, custom `-f` selector, trim sections.
- **Queue that lives** — priorities, subscriptions (auto-download or
  notify), download windows, Library filters and health, tray and
  notifications.
- **Post-processing** — convert, auto-tag, compress, gallery ZIP/CBZ,
  transcription sidecars, rclone upload.
- **Tool packs & remote** — Streamlink, N_m3u8DL-RE, whisper, rclone
  (on-demand); loopback API + opt-in LAN, PWA, browser extension, CLI,
  Discord/Telegram pings.
- **Trust** — SHA-256 checksums + SBOM on every release, opt-in local-only
  crash reports, Report-a-bug with prefilled form.

Full notes: [`CHANGELOG.md`](CHANGELOG.md) (also in-app under Changelog).

## Screenshots

| Home                               | Downloads                                    | Settings                                   |
| ---------------------------------- | -------------------------------------------- | ------------------------------------------ |
| ![Home](docs/screenshots/home.png) | ![Downloads](docs/screenshots/downloads.png) | ![Settings](docs/screenshots/settings.png) |

![FluxDL feature overview](docs/features.svg)

## Features

| Area                   | What you get                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 📥 Downloading         | Single links, playlists with entry picker, batch paste, duplicate guard + download archive, pause / resume / cancel / retry, priorities, concurrency 1–5, speed limiter, trim sections                                 |
| 🖼️ Images              | gallery-dl engine for image galleries (Wikimedia Commons, Flickr, Imgur…): gallery preview with select, per-link Auto/Video/Images override, Try-other-engine on failures, live file counters, Images settings section |
| 🎞️ Formats             | Compatible MP4 (H.264 + AAC), 480p–4K caps, Smallest preset, custom `-f` selector, top-quality audio (MP3 / M4A / Opus / FLAC), manual + auto subtitles, SponsorBlock removal, chapter splitting, audio tag editor     |
| 📡 Live & upcoming     | Stream status detection, record-from-start, wait-for-scheduled-start, Streamlink capture suggestion                                                                                                                    |
| 📬 Subscriptions       | Watch channels/playlists: auto-download or notify-only, per-channel folder/preset/engine, backoff + auto-disable, runaway cap                                                                                          |
| 🛠️ Post-processing     | Convert, auto-tag (MusicBrainz), compress (HW auto-pick), gallery ZIP/CBZ, transcription `.srt`, rclone upload — failures stay reprocessable, originals kept                                                           |
| 🧰 Tool packs          | Streamlink, N_m3u8DL-RE, whisper.cpp (+models), rclone — on-demand, verified-or-consent, atomic updates, revoke list                                                                                                   |
| 🔧 Tools & Doctor      | Tool versions/paths, Update / Reinstall / Rollback, yt-dlp channel, Update-all, health check with one-click fixes                                                                                                      |
| 📲 Remote & automation | Loopback API + opt-in LAN (allowlist, auto-disable), PWA, browser extension, `fluxdl.mjs` CLI, Discord/Telegram finish/fail pings                                                                                      |
| 🪟 Mini window         | Always-on-top compact view with overall progress, per-download pause / resume / cancel, failed retry-all — toggle from the titlebar, `Ctrl+Shift+M`, palette, or tray                                                  |
| 🖥️ Desktop             | Tray with live tooltip, taskbar progress, single-instance, `fluxdl://` links + CLI URLs, quit-confirmation when downloads run, graceful shutdown (`.part` files resume)                                                |
| 🍪 Logins & blocks     | Browser-cookie import (Chrome / Edge / Firefox / …) or `cookies.txt`, clear bot-verification guidance, actionable error cards (retry, update engine, repair)                                                           |
| 📚 Library             | Search, filters/sorts/views, missing-file health check with relocate, in-app audio/video preview, re-download, Recycle-Bin delete                                                                                      |
| 📊 Insight             | Bandwidth sparkline, whole-queue ETA, history stats, raw engine logs with search, one-click diagnostics report, opt-in local crash reports                                                                             |
| ⌨️ Speed               | Command palette (`Ctrl+K`), view jumps, drag-and-drop links, clipboard watcher                                                                                                                                         |
| 🎨 Feel                | Four themes (dark + light + High Contrast), accent picker, comfortable/compact density                                                                                                                                 |

### Keyboard shortcuts

| Keys           | Action                                    |
| -------------- | ----------------------------------------- |
| `Ctrl+V`       | Paste link & analyze (multi-link → Batch) |
| `Ctrl+K`       | Command palette                           |
| `Ctrl+,`       | Settings                                  |
| `Ctrl+1…7`     | Jump between views                        |
| `Ctrl+Shift+M` | Mini mode                                 |
| `?`            | Shortcut list                             |

### Send links from your browser

Register once (automatic on install), then open links like
`fluxdl://https%3A%2F%2Fyoutu.be%2F…` — or run `FluxDL.exe <url>` — and
the running app picks the video up, even from a second launch.

### Remote access (same machine)

Settings → Remote access starts a loopback-only server (`127.0.0.1`, token
auth): paste a link from your browser or the unpacked extension in
`extension/` and the app picks it up; the served page doubles as a tiny
remote (queue, pause/cancel). Off by default. LAN mode is an explicit
opt-in on the same screen (big warning first): binds all interfaces with
an optional IP allowlist and auto-disable timer, and rotates the token on
enable. Plain HTTP — token guards every call, prefer loopback when you can.

### Automation: CLI, LAN, notifiers

- CLI: `node scripts/fluxdl.mjs add <url>...` (or `status`, `pause` /
  `resume` / `cancel <id>`) talks to a running app over the same API —
  token via `--token` or `FLUXDL_TOKEN`. Same mechanism suits ShareX and
  other automation (POST JSON to `/api/add` with a Bearer token).
- LAN mode is an explicit opt-in in Settings → Remote access (big warning
  shown first): binds all interfaces with an optional IP allowlist and
  auto-disable timer, and rotates the token on enable. Plain HTTP: the
  token guards every call, but prefer loopback when you can.
- Discord webhooks and Telegram bot messages fire on finish/fail when
  enabled (Settings → Remote access → Notifications). Webhook URL and bot
  token are stored OS-encrypted, never in settings or logs.

## Troubleshooting

**Windows Defender flags the download?**
Packaged `yt-dlp` binaries trip heuristic scanners on occasion. Verify the
SHA-256 published on the Releases page; if it matches, it is a false
positive — allow the file and report it to Microsoft to help everyone.

**"Sign in to confirm you're not a bot"?**
YouTube rate-limits datacenter IPs and unknown clients. Fixes, in order:

1. **Settings → Cookies from browser** (e.g. `chrome`) and retry.
2. **Logs → Check for update** to refresh the yt-dlp engine.
3. As a last resort, export a `cookies.txt` from your browser and point
   Settings at it. FluxDL walks you through each step on the error card.

**Download stalls or fails?**
Open **Logs**, pick the job, and read the raw engine output (search +
errors-only filter included). The **Copy diagnostics** button bundles
versions, redacted settings, and recent errors for a bug report.

**Something else?**
Check [`CHANGELOG.md`](CHANGELOG.md) for known limitations, then open an
issue with the diagnostics report attached.

## Develop

Requirements: Node 20+, pnpm 10+. Windows 10/11 x64 for packaging (dev
tooling is cross-platform, but binaries and installers target win64).

```sh
pnpm install        # all workspaces
pnpm dev            # desktop dev window (electron-vite)
pnpm typecheck      # tsc, all workspaces
pnpm lint           # eslint, zero warnings
pnpm test           # vitest unit + integration (integration skips without a PATH yt-dlp)
pnpm build          # production bundles (out/)
```

Desktop extras:

```sh
pnpm --filter @grabber/desktop test:e2e   # Playwright smoke (needs pnpm build first)
pnpm fetch:binaries  # yt-dlp + ffmpeg win64-gpl + gallery-dl into apps/desktop/resources/bin
pnpm make:icon       # regenerate tray PNG + app ICO (deterministic, no deps)
```

## Release

```sh
pnpm fetch:binaries  # once per clean checkout (gitignored output)
pnpm build
pnpm dist            # NSIS + portable into /release (also gitignored)
```

First run copies `yt-dlp.exe` into userData so self-update (`-U`) works under
Program Files; `ffmpeg`/`ffprobe` resolve from the bundled copy with a PATH
fallback. Packaged `appId` (`app.fluxdl.desktop`) doubles as the Windows
toast `appUserModelId`.

## Architecture

```mermaid
flowchart LR
    UI["packages/core\nReact UI + state"] -->|"DownloadEngine\n(typed IPC)"| MAIN["apps/desktop\nElectron main"]
    MAIN -->|"spawns (args array, never shell)"| YT["yt-dlp.exe\nffmpeg / ffprobe"]
    MAIN -->|"spawns (args array, never shell)"| GDL["gallery-dl.exe\n+ on-demand packs"]
    MAIN -->|"serves (opt-in)"| API["loopback API · PWA"]
    MAIN -->|"atomic JSON / JSONL"| DISK[("userData\nsettings · queue · history")]
```

- `packages/core/src/branding.ts` — `APP_NAME`, the one display-name constant
- `packages/core/src/types.ts` — `MediaInfo`, `FormatOption`, `DownloadJob`, `AppSettings`, presets
- `packages/core/src/engine.ts` — `DownloadEngine` interface + `IPC_CHANNELS` single channel map
- `apps/desktop/src/main/` — window, CSP, tray/taskbar, single-instance, protocol, `media://` previews, IPC handlers
- `apps/desktop/src/preload/` — typed `window.grabber` bridge only
- `extension/` — unpacked MV3 browser extension (context menu + popup → local API)
- `scripts/fetch-binaries.mjs` — SHA-256-verified yt-dlp + ffmpeg + gallery-dl at build time (never committed)

Rules that keep this codebase healthy: TypeScript strict with no `any`,
zero Electron/Node imports in core (eslint-enforced), every URL validated
before it reaches the engine, `yt-dlp` flags verified against the real
binary, and `typecheck + lint + test + build` green after every milestone.

Further reading: `CHANGELOG.md` (release notes),
[`docs/SIGNING.md`](docs/SIGNING.md) (code signing + SmartScreen).

## Contributing

Issues and pull requests are welcome. Conventional commits (`feat:`,
`fix:`, `chore:`, `docs:`, `test:` …), surgical diffs, and please keep the
four gates green before pushing. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md);
security reports go through [`SECURITY.md`](SECURITY.md), never a public issue.

## Legal & responsible use

FluxDL is a **neutral, general-purpose front end for `yt-dlp`**. It carries no
third-party brand names or logos, and it is not affiliated with, endorsed by,
or derived from any platform.

- **Licence** — MIT, including the full "AS IS" warranty disclaimer and the
  authors' limitation of liability. See [`LICENSE`](LICENSE).
- **Neutral branding** — "FluxDL" only. No platform names appear in the app
  name, icons or UI copy; `yt-dlp` is credited as the engine it drives.
- **No DRM circumvention** — the app only uses `yt-dlp`'s standard
  capabilities for media that is publicly accessible. It contains nothing for
  defeating Widevine, FairPlay, PlayReady or any other encryption, and never
  will. That keeps it firmly in the dual-use category rather than the
  circumvention category.
- **Zero telemetry** — no URLs, titles or history ever leave your machine
  for analytics: there is none. The app itself only ever talks to the
  network for the GitHub Releases update check (`api.github.com`), the
  thumbnail fetches for media you asked to preview, engine/tool downloads
  you trigger, and — only if you switch them on — the notifiers you
  configure (Discord/Telegram) and the loopback/LAN API you enable.
  Crash reports are opt-in and never leave your disk except inside a
  diagnostics export _you_ copy-paste into a bug report.
- **You are responsible** — you are responsible for respecting copyright and
  each site's terms of service, and for having the right to keep whatever you
  download. Only download content you own or are allowed to keep. The in-app
  Logs screen repeats this notice.

### Reducing the chance of an IP block

Platforms rate-limit by IP, and HTTP 429 is what a burst of parallel requests
looks like from the other side.

- **Concurrency** — default **2** simultaneous downloads (`Settings ▸ Downloads`,
  max 5). Staying at 1–2 is the single biggest factor.
- **Polite pacing** — `Settings ▸ Network ▸ Polite pacing` maps 1:1 onto
  `yt-dlp`'s documented flags (`--sleep-requests`,
  `--min-sleep-interval` / `--max-sleep-interval`, `--sleep-subtitles`), so
  requests and downloads are spaced out like ordinary viewing instead of a
  scrape. Off by default; "Light" or "Standard" presets fill it in.
- **Proxy / VPN support** — `Settings ▸ Network ▸ Proxy` accepts any
  HTTP/HTTPS/SOCKS proxy (credentials are redacted before the command line is
  ever shown or logged). Point it at your own proxy, or just run your VPN.
- **Cookies** — for media that needs a signed-in session, use your own browser
  cookie jar (`Settings ▸ Network`). It is read locally and never uploaded.
- **Clear your history** — `Library ▸ Clear all` wipes the local download
  history whenever you want it gone.

None of these make downloading someone else's content legal; they only keep a
legitimate download from looking like an attack.

# THIRD_PARTY_NOTICES.md

FluxDL bundles third-party tools. Their licenses apply to the binaries;
FluxDL itself stays MIT (see LICENSE).

## yt-dlp

- Project: https://github.com/yt-dlp/yt-dlp
- License: Unlicense (public domain). Verify per release.
- Binary: `resources/bin/yt-dlp.exe` (pinned, SHA256-verified at build time).

## FFmpeg / FFprobe (yt-dlp FFmpeg-Builds, win64-gpl)

- Project: https://github.com/yt-dlp/FFmpeg-Builds
- License: GPL (gpl build). Review the build type before each release.
- Binaries: `resources/bin/ffmpeg.exe`, `resources/bin/ffprobe.exe`.

## gallery-dl (Phase 1, v1.8.x)

- Project: https://github.com/mikf/gallery-dl
- License: **GPL-2.0-only**. Bundling `gallery-dl.exe` makes the binary
  (not FluxDL's own code) subject to GPL-2.0.
- Binary: `resources/bin/gallery-dl.exe` (pinned `GALLERYDL_VERSION`,
  SHA256-verified at build time; optional — the app runs yt-dlp-only
  without it).
- Source offer: the gallery-dl source for the pinned version is available
  from the project link above (release tag `v<GALLERYDL_VERSION>`).
  If you received FluxDL without the binary, request it and we will point
  you at the exact upstream tag + checksum in `resources/bin/versions.json`.
- Config: FluxDL generates its own `gallery-dl.conf.json` in userData and
  never reads or modifies your global gallery-dl config unless you opt in.

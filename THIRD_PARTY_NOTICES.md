# THIRD_PARTY_NOTICES.md

FluxDL bundles third-party tools. Their licenses apply to the binaries;
FluxDL itself stays MIT (see LICENSE).

## yt-dlp

- Project: https://github.com/yt-dlp/yt-dlp
- License: Unlicense (public domain). Verify per release.
- Binary: `resources/bin/yt-dlp.exe` (pinned, SHA256-verified at build time).

## FFmpeg / FFprobe (yt-dlp FFmpeg-Builds, win64-gpl)

- Project: https://github.com/yt-dlp/FFmpeg-Builds
- License: GPL (gpl build — reviewed for v1.8.0: the pinned
  `ffmpeg-master-latest-win64-gpl.zip` enables GPL components, so the
  binaries are GPL-licensed; complete corresponding source is available
  from the project link above).
- Binaries: `resources/bin/ffmpeg.exe`, `resources/bin/ffprobe.exe`.

## gallery-dl (Phase 1, v1.8.x)

- Project: https://codeberg.org/mikf/gallery-dl (development moved from
  GitHub; GitHub releases carry no binaries)
- License: **GPL-2.0-only**. Bundling `gallery-dl.exe` makes the binary
  (not FluxDL's own code) subject to GPL-2.0.
- Binary: `resources/bin/gallery-dl.exe` (pinned 1.32.15,
  SHA256-verified at build time against the published SHA256SUMS;
  optional — the app runs yt-dlp-only without it).
- Source offer: the gallery-dl source for the pinned version is available
  from the project link above (release tag `v1.32.15`).
  If you received FluxDL without the binary, request it and we will point
  you at the exact upstream tag + checksum in `resources/bin/versions.json`.
- Config: FluxDL generates its own `gallery-dl.conf.json` in userData and
  never reads or modifies your global gallery-dl config unless you opt in.

## Optional Tool Packs (Phase 5, on-demand — never bundled)

Packs download into `userData/packs/<id>/<version>/` only with your explicit
action in Settings → Tool Packs. Only rclone publishes a checksums file
(verified on install; mismatch is a hard fail). The other three publish no
checksums file, so the UI requires explicit consent and checks the download
size instead — this is stated on each pack row before you install.

## Streamlink (pack, 8.6.2-1)

- Project: https://github.com/streamlink/streamlink (binaries:
  https://github.com/streamlink/windows-builds)
- License: BSD-2-Clause.
- Binary: portable `streamlink-*-py*-x86_64.zip` (embedded Python + FFmpeg).

## N_m3u8DL-RE (pack, v0.6.0-beta)

- Project: https://github.com/nilaoda/N_m3u8DL-RE
- License: MIT.
- Binary: `N_m3u8DL-RE_*_win-x64_*.zip`.

## whisper.cpp (pack, nightly b5454)

- Project: https://github.com/ggml-org/whisper.cpp
- License: MIT.
- Binary: `whisper-bin-x64.zip` from a nightly release (stables ship no
  binaries; the pinned nightly is recorded in code). Speech models come
  from https://huggingface.co/ggerganov/whisper.cpp (tiny/base/small).

## rclone (pack, v1.75.1)

- Project: https://rclone.org/ (https://github.com/rclone/rclone)
- License: MIT.
- Binary: `rclone-v*-windows-amd64.zip`, SHA256SUMS-verified on install.
- Config: rclone owns its config file. FluxDL stores only the `remote:path`
  string you type — never credentials.

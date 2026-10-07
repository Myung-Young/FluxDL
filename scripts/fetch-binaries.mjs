#!/usr/bin/env node
/**
 * M1 binary fetcher (build time only, never committed).
 * Downloads yt-dlp.exe + ffmpeg/ffprobe (win64) from official GitHub
 * releases, verifies SHA256, extracts to apps/desktop/resources/bin/.
 *
 * Sources (verified 2026-10-02):
 * - yt-dlp: https://github.com/yt-dlp/yt-dlp/releases/download/<VER>/yt-dlp.exe
 *   + SHA2-256SUMS (pinned YTDLP_VERSION, default 2026.08.19 = installed binary)
 * - ffmpeg: https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip
 *   + checksums.sha256
 *
 * Usage: YTDLP_VERSION=2026.08.19 node scripts/fetch-binaries.mjs
 */

import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "apps", "desktop", "resources", "bin");

const YTDLP_VERSION = process.env["YTDLP_VERSION"] ?? "2026.08.19";
const YTDLP_EXE_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp.exe`;
const YTDLP_SUMS_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/SHA2-256SUMS`;
const FFMPEG_ZIP_URL =
  "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
const FFMPEG_SUMS_URL =
  "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/checksums.sha256";
// gallery-dl standalone Windows exe (Phase 1, GPL-2.0 — see THIRD_PARTY_NOTICES.md).
// Pinned version verified against https://github.com/mikf/gallery-dl/releases.
const GALLERYDL_VERSION = process.env["GALLERYDL_VERSION"] ?? "1.26.12";
const GALLERYDL_EXE_URL = `https://github.com/mikf/gallery-dl/releases/download/v${GALLERYDL_VERSION}/gallery-dl.exe`;
const GALLERYDL_SUMS_URL = `https://github.com/mikf/gallery-dl/releases/download/v${GALLERYDL_VERSION}/gallery-dl_SHA256SUM.txt`;

function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    import("node:fs").then(({ createReadStream }) => {
      const s = createReadStream(path);
      s.on("data", (d) => h.update(d));
      s.on("end", () => resolve(h.digest("hex")));
      s.on("error", reject);
    });
  });
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return res.text();
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok || res.body === null) throw new Error(`download ${url}: HTTP ${res.status}`);
  await mkdir(dirname(dest), { recursive: true });
  await pipeline(res.body, createWriteStream(dest));
}

function parseSums(text, name) {
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{64})\s+[*/]?(.+?)\s*$/.exec(line.trim());
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  throw new Error(`checksum entry missing for ${name}`);
}

function tarBinary() {
  // PATH tar is often GNU tar (no zip); Windows ships bsdtar that reads zips.
  if (process.platform === "win32") {
    return "C:\\Windows\\System32\\tar.exe";
  }
  return "tar";
}

function runTar(args, cwd) {
  return new Promise((resolve, reject) => {
    // No shell:true — args array only.
    const p = spawn(tarBinary(), args, { cwd, stdio: "inherit", shell: false, windowsHide: true });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar exit ${code}`))));
  });
}

async function findFiles(dir, names, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await findFiles(p, names, acc);
    else if (names.has(e.name.toLowerCase())) acc.push(p);
  }
  return acc;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const tmp = join(tmpdir(), `grabber-bins-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  try {
    console.log(`[bins] yt-dlp ${YTDLP_VERSION}`);
    const sums = await fetchText(YTDLP_SUMS_URL);
    const wantExe = parseSums(sums, "yt-dlp.exe");
    const exeTmp = join(tmp, "yt-dlp.exe");
    await download(YTDLP_EXE_URL, exeTmp);
    const gotExe = await sha256File(exeTmp);
    if (gotExe !== wantExe)
      throw new Error(`yt-dlp.exe SHA256 mismatch:\n want ${wantExe}\n got  ${gotExe}`);
    await copyFile(exeTmp, join(outDir, "yt-dlp.exe"));
    console.log("[bins] yt-dlp.exe OK");

    console.log("[bins] ffmpeg win64-gpl");
    const fsums = await fetchText(FFMPEG_SUMS_URL);
    const wantZip = parseSums(fsums, "ffmpeg-master-latest-win64-gpl.zip");
    const zipTmp = join(tmp, "ffmpeg.zip");
    await download(FFMPEG_ZIP_URL, zipTmp);
    const gotZip = await sha256File(zipTmp);
    if (gotZip !== wantZip) throw new Error("ffmpeg zip SHA256 mismatch");
    const extDir = join(tmp, "ff");
    await mkdir(extDir, { recursive: true });
    // Relative names only: bsdtar parses `C:` as a remote host otherwise.
    await runTar(["-xf", "ffmpeg.zip", "-C", "ff"], tmp);
    const found = await findFiles(extDir, new Set(["ffmpeg.exe", "ffprobe.exe"]));
    for (const name of ["ffmpeg.exe", "ffprobe.exe"]) {
      const src = found.find((p) => p.toLowerCase().endsWith(name));
      if (!src) throw new Error(`missing ${name} in ffmpeg zip`);
      await copyFile(src, join(outDir, name));
      console.log(`[bins] ${name} OK`);
    }

    console.log(`[bins] gallery-dl ${GALLERYDL_VERSION} (GPL-2.0)`);
    let galleryDlVersion = GALLERYDL_VERSION;
    let galleryDlSha = null;
    try {
      const gsums = await fetchText(GALLERYDL_SUMS_URL);
      galleryDlSha = parseSums(gsums, "gallery-dl.exe");
      const gTmp = join(tmp, "gallery-dl.exe");
      await download(GALLERYDL_EXE_URL, gTmp);
      const gotG = await sha256File(gTmp);
      if (gotG !== galleryDlSha) throw new Error("gallery-dl.exe SHA256 mismatch");
      await copyFile(gTmp, join(outDir, "gallery-dl.exe"));
      console.log("[bins] gallery-dl.exe OK");
    } catch (err) {
      // gallery-dl is optional for the yt-dlp-only build; the engine reports
      // a clear "not installed" error when the binary is absent.
      console.warn(`[bins] gallery-dl skipped: ${err instanceof Error ? err.message : err}`);
    }
    await writeFile(
      join(outDir, "versions.json"),
      JSON.stringify(
        {
          ytdlp: YTDLP_VERSION,
          ytdlpSha256: wantExe,
          ffmpegSha256: wantZip,
          galleryDl: galleryDlVersion,
          galleryDlSha256: galleryDlSha,
          fetchedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(`[bins] done -> ${outDir}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`[bins] FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

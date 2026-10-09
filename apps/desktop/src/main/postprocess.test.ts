import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  listPostFiles,
  mediaInfoFor,
  postBinaries,
  runCompressVideo,
  runConvertImage,
  runFfmpeg,
  runTagAudio,
  runTranscribeAudio,
  runUploadRemote,
} from "./postprocess.js";

const FFMPEG = postBinaries("").ffmpeg;

function hasFfmpeg(): boolean {
  try {
    const r = spawnSync(FFMPEG, ["-version"], { timeout: 15000, encoding: "utf8" });
    return r.status === 0;
  } catch {
    return false;
  }
}

function dir(suffix: string): string {
  return mkdtempSync(join(tmpdir(), `fluxdl-post-${suffix}-`));
}

function makeImage(d: string, name: string): string {
  const out = join(d, name);
  const r = spawnSync(
    FFMPEG,
    ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1", "-frames:v", "1", out],
    { timeout: 60000 },
  );
  if (r.status !== 0) throw new Error("fixture ffmpeg failed");
  return out;
}

function makeAudio(d: string, name: string): string {
  const out = join(d, name);
  const r = spawnSync(
    FFMPEG,
    ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", out],
    { timeout: 60000 },
  );
  if (r.status !== 0) throw new Error("fixture ffmpeg failed");
  return out;
}

describe("postprocess runner", () => {
  it.runIf(hasFfmpeg())("converts webp to jpg with temp-verify-atomic", async () => {
    const d = dir("convert");
    const src = makeImage(d, "a.webp");
    const outcome = await runConvertImage(
      { bundledBinDir: "", appVersion: "test" },
      src,
      { format: "jpg", quality: 85, maxDim: 2048, stripExif: true, keepOriginals: true },
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.output?.endsWith(".fluxdl.jpg")).toBe(true);
    // Original kept by default.
    const { existsSync } = await import("node:fs");
    expect(existsSync(src)).toBe(true);
  });

  it.runIf(hasFfmpeg())("reruns are idempotent (same output path)", async () => {
    const d = dir("idem");
    const src = makeImage(d, "a.png");
    const deps = { bundledBinDir: "", appVersion: "test" };
    const opts = { format: "jpg" as const, quality: 80, maxDim: 64, stripExif: false, keepOriginals: true };
    const first = await runConvertImage(deps, src, opts);
    const second = await runConvertImage(deps, src, opts);
    expect(first.ok && second.ok).toBe(true);
    expect(first.output).toBe(second.output);
  });

  it.runIf(hasFfmpeg())("compresses a video and keeps the original", async () => {
    const d = dir("compress");
    const src = makeImage(d, "clip.mp4").replace(".mp4", ".mp4");
    // Real video fixture: 1s color bars with audio.
    const r = spawnSync(
      FFMPEG,
      [
        "-hide_banner", "-y",
        "-f", "lavfi", "-i", "color=c=green:s=160x120:d=1",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-shortest", src,
      ],
      { timeout: 60000 },
    );
    expect(r.status).toBe(0);
    const outcome = await runCompressVideo(
      { bundledBinDir: "", appVersion: "test" },
      src,
      { preset: "small", keepOriginals: true },
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.output?.endsWith(".fluxdl-small.mp4")).toBe(true);
  });

  it.runIf(hasFfmpeg())("kills ffmpeg on timeout and reports it", async () => {
    const d = dir("timeout");
    const src = makeAudio(d, "a.m4a");
    const outcome = await runConvertImage(
      { bundledBinDir: "", appVersion: "test", stepTimeoutMs: 1 },
      src,
      { format: "jpg", quality: 85, maxDim: 64, stripExif: false, keepOriginals: true },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.note ?? "").toMatch(/timed out/i);
  });

  it("reports a missing binary as a step error, never a throw", async () => {
    const d = dir("nobin");
    const fake = join(d, "a.webp");
    writeFileSync(fake, "not an image");
    const outcome = await runConvertImage(
      { bundledBinDir: join(d, "no-such-dir"), appVersion: "test", stepTimeoutMs: 5000 },
      fake,
      { format: "jpg", quality: 85, maxDim: 64, stripExif: false, keepOriginals: true },
    );
    expect(outcome.ok).toBe(false);
    expect(typeof outcome.note).toBe("string");
  });

  it.runIf(hasFfmpeg())("reads media summaries for the details panel", async () => {
    const d = dir("info");
    const src = makeAudio(d, "a.m4a");
    const summary = await mediaInfoFor("", src);
    expect(summary?.audio?.codec).toBe("aac");
    expect(summary?.durationSec).toBeGreaterThan(0);
    expect(await mediaInfoFor("", join(d, "missing.m4a"))).toBeNull();
  });

  it.runIf(hasFfmpeg())("tag-audio skips already-tagged files without network", async () => {
    const d = dir("tagged");
    const tagged = join(d, "tagged.m4a");
    let r = spawnSync(
      FFMPEG,
      ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", tagged],
      { timeout: 60000 },
    );
    expect(r.status).toBe(0);
    r = spawnSync(
      FFMPEG,
      ["-hide_banner", "-y", "-i", tagged, "-c", "copy", "-metadata", "title=T", "-metadata", "artist=A", join(d, "out.m4a")],
      { timeout: 60000 },
    );
    expect(r.status).toBe(0);
    const outcome = await runTagAudio(
      { bundledBinDir: "", appVersion: "test" },
      join(d, "out.m4a"),
      { title: "T", artist: "A" },
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.note ?? "").toMatch(/already tagged/i);
  });

  it("lists media files one level deep", async () => {
    const d = dir("list");
    writeFileSync(join(d, "a.mp3"), "x");
    writeFileSync(join(d, "b.txt"), "x");
    writeFileSync(join(d, "c.webp"), "x");
    expect(await listPostFiles(d)).toEqual([join(d, "a.mp3"), join(d, "c.webp")]);
    expect(await listPostFiles(join(d, "missing"))).toEqual([]);
  });

  it.runIf(hasFfmpeg())("runFfmpeg rejects on non-zero exit", async () => {
    await expect(
      runFfmpeg(FFMPEG, ["-hide_banner", "-i", "no-such-file-xyz.mp4", "out.mp4"], {
        bundledBinDir: "",
        appVersion: "test",
      }),
    ).rejects.toThrow();
  });

  it("transcribe/upload fail with install guidance, never throws", async () => {
    const deps = { bundledBinDir: "", appVersion: "test" };
    const tag = await runTranscribeAudio(deps, "C:\\dl\\a.mp3", { model: "tiny", modelPath: null, whisperExe: null });
    expect(tag.ok).toBe(false);
    expect(tag.note ?? "").toMatch(/whisper pack/i);
    const up = await runUploadRemote(deps, "C:\\dl\\a.mp4", { remote: null, rclonePath: null });
    expect(up.ok).toBe(false);
    expect(up.note ?? "").toMatch(/rclone pack/i);
    const up2 = await runUploadRemote(deps, "C:\\dl\\a.mp4", { remote: "  ", rclonePath: __filename });
    expect(up2.ok).toBe(false);
    expect(up2.note ?? "").toMatch(/remote/i);
  });
});

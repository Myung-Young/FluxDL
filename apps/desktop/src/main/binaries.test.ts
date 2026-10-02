import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  repairBinaries,
  resolveFfmpegDir,
  resolveYtDlpPath,
  ensureUserDataBinary,
} from "./binaries.js";

function freshDirs(): { userData: string; bundled: string } {
  const base = mkdtempSync(join(tmpdir(), "grabber-bin-"));
  return { userData: join(base, "user"), bundled: join(base, "bundled") };
}

describe("binaries", () => {
  it("prefers the userData copy over bundled", () => {
    const { userData, bundled } = freshDirs();
    mkdirSync(userData, { recursive: true });
    mkdirSync(bundled, { recursive: true });
    writeFileSync(join(userData, "yt-dlp.exe"), "user");
    writeFileSync(join(bundled, "yt-dlp.exe"), "bundled");
    expect(resolveYtDlpPath(userData, bundled)).toBe(join(userData, "yt-dlp.exe"));
  });

  it("falls back to bundled then PATH", () => {
    const { userData, bundled } = freshDirs();
    mkdirSync(bundled, { recursive: true });
    writeFileSync(join(bundled, "yt-dlp.exe"), "bundled");
    expect(resolveYtDlpPath(userData, bundled)).toBe(join(bundled, "yt-dlp.exe"));
    expect(resolveYtDlpPath(userData, join(bundled, "missing"))).toBe("yt-dlp.exe");
  });

  it("copies bundled binary into userData on first run", async () => {
    const { userData, bundled } = freshDirs();
    mkdirSync(bundled, { recursive: true });
    writeFileSync(join(bundled, "yt-dlp.exe"), "binary-bytes");
    const out = await ensureUserDataBinary(userData, bundled);
    expect(out).toBe(join(userData, "yt-dlp.exe"));
    expect(resolveYtDlpPath(userData, bundled)).toBe(join(userData, "yt-dlp.exe"));
  });

  it("resolves ffmpeg dir only when bundled", () => {
    const { bundled } = freshDirs();
    expect(resolveFfmpegDir(bundled)).toBeNull();
    mkdirSync(bundled, { recursive: true });
    writeFileSync(join(bundled, "ffmpeg.exe"), "x");
    expect(resolveFfmpegDir(bundled)).toBe(bundled);
  });

  it("repairs a deliberately corrupted userData binary from the bundle", async () => {
    const { userData, bundled } = freshDirs();
    mkdirSync(bundled, { recursive: true });
    mkdirSync(userData, { recursive: true });
    const pristine = Buffer.from("pristine-binary-bytes");
    writeFileSync(join(bundled, "yt-dlp.exe"), pristine);
    writeFileSync(join(bundled, "ffmpeg.exe"), "ffmpeg");
    writeFileSync(join(bundled, "ffprobe.exe"), "ffprobe");
    const sha = createHash("sha256").update(pristine).digest("hex");
    writeFileSync(
      join(bundled, "versions.json"),
      JSON.stringify({ ytdlpSha256: sha, ffmpegSha256: "ziphash" }),
    );
    // Corrupt the userData copy, then repair.
    writeFileSync(join(userData, "yt-dlp.exe"), "corrupted!!");
    const result = await repairBinaries(userData, bundled);
    expect(result.failed).toEqual([]);
    expect(result.repaired).toEqual(["yt-dlp.exe"]);
    expect(readFileSync(join(userData, "yt-dlp.exe"))).toEqual(pristine);
  });

  it("reports failure when the bundle itself is missing", async () => {
    const { userData } = freshDirs();
    const result = await repairBinaries(userData, join(userData, "no-bundle"));
    expect(result.repaired).toEqual([]);
    expect(result.failed).toContain("yt-dlp.exe");
  });
});

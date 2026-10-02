import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveFfmpegDir, resolveYtDlpPath, ensureUserDataBinary } from "./binaries.js";

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
});

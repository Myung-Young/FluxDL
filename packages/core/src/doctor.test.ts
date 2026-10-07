import { describe, expect, it } from "vitest";
import { compareVersions, MIN_TOOL_VERSIONS, TOOL_MANIFESTS, toolManifest } from "./tools.js";
import { buildDoctorReport, isCheckDue, isStalled, versionCheck } from "./doctor.js";

describe("tools registry", () => {
  it("has one manifest per tool with install modes", () => {
    expect(TOOL_MANIFESTS.map((t) => t.id).sort()).toEqual(
      ["aria2c", "deno", "ffmpeg", "gallery-dl", "yt-dlp"].sort(),
    );
    expect(toolManifest("yt-dlp")?.installMode).toBe("bundled");
    expect(toolManifest("deno")?.installMode).toBe("external");
    expect(toolManifest("missing")).toBe(null);
  });

  it("compares versions numerically", () => {
    expect(compareVersions("2026.08.19", "2026.08.19")).toBe(0);
    expect(compareVersions("2026.08.20", "2026.08.19")).toBe(1);
    expect(compareVersions("1.26.12", "1.26.9")).toBe(1);
    expect(compareVersions("unknown", "1.0")).toBe(0);
    expect(MIN_TOOL_VERSIONS["yt-dlp"]).toBe("2026.08.19");
  });
});

describe("doctor helpers", () => {
  it("throttles to one check per day", () => {
    expect(isCheckDue(null, 1000)).toBe(true);
    expect(isCheckDue(1000, 1000 + 60_000)).toBe(false);
    expect(isCheckDue(1000, 1000 + 86_400_000)).toBe(true);
  });

  it("gates versions (missing fails, old warns)", () => {
    expect(versionCheck("yt-dlp", "yt-dlp", null, "2026.08.19").status).toBe("fail");
    expect(versionCheck("yt-dlp", "yt-dlp", "2025.01.01", "2026.08.19").status).toBe("warn");
    expect(versionCheck("yt-dlp", "yt-dlp", "2026.08.19", "2026.08.19").status).toBe("ok");
    expect(versionCheck("ffmpeg", "ffmpeg", "7.1", null).status).toBe("ok");
  });

  it("builds ok only when every check passes", () => {
    const ok = buildDoctorReport(
      [{ id: "a", label: "a", status: "ok", detail: "1" }],
      5,
    );
    expect(ok.ok).toBe(true);
    const bad = buildDoctorReport(
      [{ id: "a", label: "a", status: "ok", detail: "1" }, { id: "b", label: "b", status: "warn", detail: "x" }],
      5,
    );
    expect(bad.ok).toBe(false);
  });

  it("detects stalls (0 disables)", () => {
    expect(isStalled(1000, 1000 + 121_000, 120)).toBe(true);
    expect(isStalled(1000, 1000 + 10_000, 120)).toBe(false);
    expect(isStalled(null, 2000, 120)).toBe(false);
    expect(isStalled(1000, 200000, 0)).toBe(false);
  });
});

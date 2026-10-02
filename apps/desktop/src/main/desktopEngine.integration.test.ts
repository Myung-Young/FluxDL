import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DesktopEngine } from "./desktopEngine.js";
import type { EngineProgress } from "@grabber/core/engine.js";

function hasYtDlp(): boolean {
  try {
    const r = spawnSync("yt-dlp", ["--version"], { timeout: 15000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

function hasFfprobe(): boolean {
  try {
    const r = spawnSync("ffprobe", ["-version"], { timeout: 15000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

const HAS_YTDLP = hasYtDlp();
const HAS_FFPROBE = hasFfprobe();

function makeEngine(plain = false) {
  const base = mkdtempSync(join(tmpdir(), "fluxdl-m6-"));
  // Spaces + unicode on purpose: the engine must survive them end to end.
  // plain=true skips non-ASCII (yt-dlp mangles those in printed paths: D48).
  const userData = plain ? join(base, "userdata") : join(base, "user data münchen 輸入");
  const outputDir = plain ? join(base, "out put") : join(base, "out put münchen 輸入");
  const events: EngineProgress[] = [];
  const engine = new DesktopEngine({
    userDataDir: userData,
    bundledBinDir: join(base, "bundled-missing"),
    appVersion: "0.0.0-m6",
    defaultOutputDir: outputDir,
    broadcast: () => undefined,
  });
  return { engine, events, outputDir, base };
}

async function waitFor(
  events: EngineProgress[],
  match: (e: EngineProgress) => boolean,
  timeoutMs: number,
  label: string,
): Promise<EngineProgress> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = events.find(match);
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe.skipIf(!HAS_YTDLP)("desktop engine live (real yt-dlp)", () => {
  it("reports versions", async () => {
    const { engine } = makeEngine();
    const v = await engine.getEngineVersion();
    expect(v.ytdlp).toMatch(/\d{4}\.\d{2}\.\d{2}/);
    expect(v.app).toBe("0.0.0-m6");
  });

  it("fetches metadata for a public video", async () => {
    const { engine } = makeEngine();
    const info = await engine.getInfo("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    expect(info.title).toContain("Big Buck Bunny");
    expect(info.formats.length).toBeGreaterThan(0);
  });

  it("kills mid-download then resumes to a complete file", async () => {    const { engine, events, outputDir, base } = makeEngine();
    const unsub = engine.onProgress((e) => {
      events.push(e);
    });
    try {
      const id = await engine.start({
        url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
        title: "M6 probe",
        preset: { kind: "video", videoPreset: "480", audioPreset: "MP3", rawFormat: null },
        outputDir,
      });
      const only = (e: EngineProgress): boolean => e.id === id;
      await waitFor(
        events,
        (e) => only(e) && e.stage === "downloading" && e.percent > 0,
        60_000,
        "first progress",
      );
      await engine.pause(id);
      const paused = await waitFor(
        events,
        (e) => only(e) && e.stage === "paused",
        30_000,
        "paused",
      );
      expect(paused.destination !== null || paused.percent >= 0).toBe(true);
      await engine.resume(id);
      const finished = await waitFor(events, (e) => only(e) && e.stage === "done", 90_000, "done");
      expect(finished.percent).toBe(100);
      expect(finished.destination?.endsWith(".mp4")).toBe(true);
      const files = readdirSync(outputDir).filter((f) => f.endsWith(".mp4"));
      expect(files.length).toBeGreaterThan(0);
    } finally {
      unsub();
      rmSync(base, { recursive: true, force: true });
    }
  }, 180_000);

  it("Compatible preset downloads H.264 + AAC in mp4 (ffprobe-verified)", async () => {
    if (!HAS_FFPROBE) return;
    // ASCII-spaces dir (D48: yt-dlp mangles non-ASCII in printed paths).
    const { engine, events, outputDir, base } = makeEngine(true);
    const unsub = engine.onProgress((e) => {
      events.push(e);
    });
    try {
      // "Me at the zoo": tiny (~1 MB), stable, multi-format manifest.
      const id = await engine.start({
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        title: "M1.1 compatible probe",
        preset: { kind: "video", videoPreset: "Compatible", audioPreset: "MP3", rawFormat: null },
        outputDir,
      });
      const finished = await waitFor(
        events,
        (e) => e.id === id && e.stage === "done",
        120_000,
        "compatible done",
      );
      expect(finished.destination?.endsWith(".mp4")).toBe(true);
      const probe = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_name",
          "-of",
          "csv=p=0",
          finished.destination ?? "",
        ],
        { timeout: 30000, encoding: "utf8" },
      );
      expect(probe.status).toBe(0);
      const codecs = probe.stdout.split("\n").map((s) => s.trim());
      expect(codecs).toContain("h264");
      expect(codecs).toContain("aac");
    } finally {
      unsub();
      rmSync(base, { recursive: true, force: true });
    }
  }, 180_000);

  it("Compatible selector resolves to avc1+mp4a on a multi-codec video", async () => {
    const { buildDownloadArgs } = await import("@grabber/core/args.js");
    const full = buildDownloadArgs({
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      preset: { kind: "video", videoPreset: "Compatible", audioPreset: "MP3", rawFormat: null },
      outputDir: tmpdir(),
      filenameTemplate: "%(title)s [%(id)s].%(ext)s",
      ffmpegDir: null,
      mergeContainer: "mp4",
      embedThumbnail: false,
      embedMetadata: false,
      writeSubs: false,
      subLangs: "en",
      embedSubs: false,
      sponsorBlock: false,
      speedLimit: null,
      proxy: null,
      cookiesFromBrowser: null,
      codecPreference: "auto",
      noPlaylist: true,
    });
    const target = full[full.length - 1] ?? "";
    const probe = spawnSync(
      "yt-dlp",
      [...full.slice(0, -1), "--simulate", "--print", "%(vcodec)s %(acodec)s", target],
      { timeout: 90000, encoding: "utf8" },
    );
    expect(probe.status).toBe(0);
    const picked = probe.stdout.trim();
    expect(picked.startsWith("avc1")).toBe(true);
    expect(picked).toContain("mp4a");
  }, 120_000);
});

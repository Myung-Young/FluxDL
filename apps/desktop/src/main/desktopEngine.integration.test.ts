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

const HAS_YTDLP = hasYtDlp();

function makeEngine() {
  const base = mkdtempSync(join(tmpdir(), "fluxdl-m6-"));
  // Spaces + unicode on purpose: the engine must survive them end to end.
  const userData = join(base, "user data münchen 輸入");
  const outputDir = join(base, "out put münchen 輸入");
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

  it("kills mid-download then resumes to a complete file", async () => {
    const { engine, events, outputDir, base } = makeEngine();
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
});

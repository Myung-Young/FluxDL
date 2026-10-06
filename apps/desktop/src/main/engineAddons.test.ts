import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopEngine, extractJsonPayload, killProcessTree } from "./desktopEngine.js";

function makeEngine() {
  const base = mkdtempSync(join(tmpdir(), "fluxdl-addons-"));
  const links: string[] = [];
  const engine = new DesktopEngine({
    userDataDir: join(base, "userdata"),
    bundledBinDir: join(base, "bundled-missing"),
    appVersion: "9.9.9-test",
    defaultOutputDir: join(base, "dl"),
    broadcast: () => undefined,
    broadcastDeepLink: (url) => {
      links.push(url);
    },
    broadcastBatchLink: () => undefined,
    onAggregate: () => undefined,
  });
  return { engine, base, links };
}

describe("engine addons (lifecycle/deeplink/media/updates)", () => {
  it("shutdown resolves with nothing running", async () => {
    const { engine } = makeEngine();
    await expect(engine.shutdown()).resolves.toBeUndefined();
  });

  it("emitDeepLink notifies local listeners and broadcasts", () => {
    const { engine, links } = makeEngine();
    const seen: string[] = [];
    const unsub = engine.onDeepLink((u) => {
      seen.push(u);
    });
    engine.emitDeepLink("https://youtu.be/aqz-KE-bpKQ");
    expect(seen).toEqual(["https://youtu.be/aqz-KE-bpKQ"]);
    expect(links).toEqual(["https://youtu.be/aqz-KE-bpKQ"]);
    unsub();
    engine.emitDeepLink("https://youtu.be/aqz-KE-bpKQ");
    expect(seen).toHaveLength(1);
  });

  it("getMediaUrl serves allowlisted audio, rejects the rest", async () => {
    const { engine, base } = makeEngine();
    const dl = join(base, "dl");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dl, { recursive: true });
    const song = join(dl, "song.mp3");
    writeFileSync(song, "fake-mp3");
    await expect(engine.getMediaUrl(song)).resolves.toBe(
      `media://play/${encodeURIComponent(song)}`,
    );
    // Outside the roots.
    await expect(engine.getMediaUrl(join(base, "..", "evil.mp3"))).resolves.toBeNull();
    // Disallowed extension inside the root.
    const exe = join(dl, "run.exe");
    writeFileSync(exe, "x");
    await expect(engine.getMediaUrl(exe)).resolves.toBeNull();
    // Missing file.
    await expect(engine.getMediaUrl(join(dl, "ghost.mp3"))).resolves.toBeNull();
  });

  it("serveMediaRequest round-trips an allowlisted file", async () => {
    const { engine, base } = makeEngine();
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(base, "dl"), { recursive: true });
    const song = join(base, "dl", "a.mp3");
    writeFileSync(song, "audio-bytes");
    const url = (await engine.getMediaUrl(song)) ?? "";
    const served = await engine.serveMediaRequest(url);
    expect(served?.status).toBe(200);
    expect(served?.headers["Content-Type"]).toBe("audio/mpeg");
    // Byte ranges are what make <audio>/<video> show a real duration (v1.7.2).
    expect(served?.headers["Accept-Ranges"]).toBe("bytes");
    expect(served?.headers["Content-Length"]).toBe("11");
    expect(served?.path).toBe(song);
    expect(served?.start).toBe(0);
    expect(served?.end).toBe(10);

    const partial = await engine.serveMediaRequest(url, "bytes=0-4");
    expect(partial?.status).toBe(206);
    expect(partial?.headers["Content-Range"]).toBe("bytes 0-4/11");
    expect(partial?.headers["Content-Length"]).toBe("5");
    expect(partial?.start).toBe(0);
    expect(partial?.end).toBe(4);

    const bad = await engine.serveMediaRequest(url, "bytes=99-");
    expect(bad?.status).toBe(416);
    expect(bad?.headers["Content-Range"]).toBe("bytes */11");

    expect(await engine.serveMediaRequest("media://play/%2Fetc%2Fpasswd")).toBeNull();
    expect(await engine.serveMediaRequest("https://evil.example/a.mp3")).toBeNull();
  });

  it("fileSizesBulk measures allowlisted outputs and refuses the rest", async () => {
    const { engine, base } = makeEngine();
    const { mkdirSync } = await import("node:fs");
    const dl = join(base, "dl");
    mkdirSync(dl, { recursive: true });
    await engine.saveSettings({ downloadDir: dl });
    writeFileSync(join(dl, "a.mp3"), "12345678");
    const sizes = await engine.fileSizesBulk([
      join(dl, "a.mp3"),
      join(dl, "ghost.mp3"),
      join(base, "..", "evil.mp3"),
    ]);
    expect(sizes[0]).toBe(8);
    expect(sizes[1]).toBeNull();
    expect(sizes[2]).toBeNull();
  });

  it("writeClipboard resolves a boolean, never throws", async () => {
    const { engine } = makeEngine();
    // Outside a real Electron runtime the clipboard stub refuses, so only the
    // contract (a boolean, no throw) is pinned here — the e2e suite proves the
    // happy path end to end.
    const ok = await engine.writeClipboard("fluxdl");
    expect(typeof ok).toBe("boolean");
  });

  it("openExternal rejects non-Releases URLs", async () => {
    const { engine } = makeEngine();
    await expect(engine.openExternal("https://evil.example/")).rejects.toThrow(/not allowed/);
  });

  it("readClipboard resolves null-or-text, never throws", async () => {
    const { engine } = makeEngine();
    const text = await engine.readClipboard();
    expect(text === null || typeof text === "string").toBe(true);
  });

  it("update download starts idle and refuses without release info", async () => {
    const { engine } = makeEngine();
    await expect(engine.getUpdateDownloadProgress()).resolves.toMatchObject({
      state: "idle",
      receivedBytes: 0,
    });
    await expect(engine.cancelUpdateDownload()).resolves.toBeUndefined();
    await expect(engine.startUpdateDownload()).rejects.toThrow(/Check for updates/);
  });

  it("scans storage totals and orphans (F2)", async () => {
    const { engine, base } = makeEngine();
    const { mkdirSync } = await import("node:fs");
    const dl = join(base, "dl");
    mkdirSync(dl, { recursive: true });
    writeFileSync(join(dl, "song.mp3"), "12345678");
    writeFileSync(join(dl, "movie.mp4"), "1234567890123456");
    writeFileSync(join(dl, "movie.mp4.part"), "xyz");
    writeFileSync(join(dl, "notes.txt"), "hi");
    await engine.saveSettings({ downloadDir: dl });
    const insights = await engine.getStorageInsights();
    expect(insights.audioFiles).toBe(1);
    expect(insights.audioBytes).toBe(8);
    expect(insights.videoFiles).toBe(1);
    expect(insights.otherFiles).toBe(1);
    expect(insights.orphans).toHaveLength(1);
    expect(insights.orphanBytes).toBe(3);
  });

  it("activeCount starts at zero", () => {
    const { engine } = makeEngine();
    expect(engine.activeCount()).toBe(0);
  });

  it("extractJsonPayload tolerates warning preamble and trailing text", () => {
    expect(extractJsonPayload('{"id":"x"}')).toBe('{"id":"x"}');
    expect(
      extractJsonPayload('WARNING: [youtube] hello\n{"id":"x","title":"t"}\nDone.\n'),
    ).toBe('{"id":"x","title":"t"}');
    expect(extractJsonPayload("no json here")).toBeNull();
    expect(extractJsonPayload("} {")).toBeNull();
  });

  it("killProcessTree tolerates null", () => {
    expect(() => {
      killProcessTree(null);
    }).not.toThrow();
  });

  it("checkForUpdates resolves the status shape (best-effort network)", async () => {
    const { engine } = makeEngine();
    const status = await engine.checkForUpdates();
    expect(status.appCurrent).toBe("9.9.9-test");
    expect(status.appUrl).toContain("github.com/Myung-Young/FluxDL/releases");
    expect(typeof status.appUpdate).toBe("boolean");
    expect(typeof status.ytdlpUpdate).toBe("boolean");
    expect(typeof status.checkedAt).toBe("number");
    // Hourly cache: second call returns the same object without refetching.
    await expect(engine.checkForUpdates()).resolves.toBe(status);
  }, 30_000);
});

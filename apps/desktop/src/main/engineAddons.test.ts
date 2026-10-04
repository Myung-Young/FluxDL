import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopEngine } from "./desktopEngine.js";

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
    expect(served?.mime).toBe("audio/mpeg");
    expect(served?.body.toString()).toBe("audio-bytes");
    expect(await engine.serveMediaRequest("media://play/%2Fetc%2Fpasswd")).toBeNull();
    expect(await engine.serveMediaRequest("https://evil.example/a.mp3")).toBeNull();
  });

  it("openExternal rejects non-Releases URLs", async () => {
    const { engine } = makeEngine();
    await expect(engine.openExternal("https://evil.example/")).rejects.toThrow(/not allowed/);
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

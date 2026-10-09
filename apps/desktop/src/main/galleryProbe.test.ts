import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopEngine } from "./desktopEngine.js";

function makeEngine() {
  const base = mkdtempSync(join(tmpdir(), "fluxdl-gdl-probe-"));
  const engine = new DesktopEngine({
    userDataDir: join(base, "userdata"),
    // No binary here: gallery-dl resolution falls through to the exe name.
    bundledBinDir: join(base, "bundled-missing"),
    appVersion: "9.9.9-test",
    defaultOutputDir: join(base, "dl"),
    broadcast: () => undefined,
    broadcastDeepLink: () => undefined,
    broadcastBatchLink: () => undefined,
    onAggregate: () => undefined,
  });
  return engine;
}

describe("probeGallery (hermetic)", () => {
  it("rejects with a repairable engine-broken error when the binary is absent", async () => {
    const engine = makeEngine();
    try {
      await engine.probeGallery("https://commons.wikimedia.org/wiki/File:X.jpg");
      expect.unreachable("probe should reject without a binary");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/missing or damaged/i);
    }
    await engine.shutdown();
  });

  it("rejects invalid URLs without spawning", async () => {
    const engine = makeEngine();
    await expect(engine.probeGallery("not a url")).rejects.toThrow();
    await engine.shutdown();
  });

  it("cancelAnalyze tolerates unknown ids (probes share the map)", async () => {
    const engine = makeEngine();
    await expect(engine.cancelAnalyze("no-such-request")).resolves.toBeUndefined();
    await engine.shutdown();
  });
});

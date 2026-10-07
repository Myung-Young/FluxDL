import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GALLERYDL_EXE,
  detectTool,
  installToolAtomic,
  isToolPresent,
  reinstallBundledTool,
  resolveToolPath,
  rollbackTool,
} from "./binaryManager.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "fluxdl-bin-"));
}

describe("binaryManager", () => {
  it("resolves userData/bin → bundled → PATH", () => {
    const user = tempDir();
    const bundled = tempDir();
    expect(resolveToolPath(user, bundled, GALLERYDL_EXE)).toBe(GALLERYDL_EXE);
    expect(isToolPresent(user, bundled, GALLERYDL_EXE)).toBe(false);
    writeFileSync(join(bundled, GALLERYDL_EXE), "x");
    expect(isToolPresent(user, bundled, GALLERYDL_EXE)).toBe(true);
  });

  it("rejects checksum mismatch (hard fail)", async () => {
    const user = tempDir();
    const tmp = join(tempDir(), "dl.exe");
    writeFileSync(tmp, "corrupt");
    await expect(installToolAtomic(user, GALLERYDL_EXE, tmp, "0".repeat(64))).rejects.toThrow(
      /Checksum mismatch/,
    );
  });

  it("installs atomically and rolls back", async () => {
    const user = tempDir();
    const v1 = join(tempDir(), "v1.exe");
    writeFileSync(v1, "v1");
    await installToolAtomic(user, GALLERYDL_EXE, v1, null);
    const v2 = join(tempDir(), "v2.exe");
    writeFileSync(v2, "v2");
    await installToolAtomic(user, GALLERYDL_EXE, v2, null);
    expect(await rollbackTool(user, GALLERYDL_EXE)).toBe(true);
  });

  it("reinstalls from bundled resources (missing bundled throws)", async () => {
    const user = tempDir();
    const bundled = tempDir();
    writeFileSync(join(bundled, GALLERYDL_EXE), "bundled");
    const dest = join(user, "bin");
    const installed = await reinstallBundledTool(dest, bundled, GALLERYDL_EXE, null);
    expect(installed).toBe(join(dest, GALLERYDL_EXE));
    await expect(reinstallBundledTool(dest, tempDir(), GALLERYDL_EXE, null)).rejects.toThrow(
      /missing/,
    );
  });

  it("detects absent tools as nulls (never throws)", async () => {
    const found = await detectTool(tempDir(), "definitely-not-a-tool-xyz.exe");
    expect(found).toEqual({ binary: null, version: null });
  });
});

import { describe, expect, it } from "vitest";
import { APP_NAME } from "./branding.js";
import { IPC_CHANNELS } from "./engine.js";

describe("core M0", () => {
  it("keeps the app name in one constant", () => {
    expect(APP_NAME).toBe("FluxDL");
  });

  it("exposes a fixed single IPC channel map", () => {
    // v1.7.2 added `writeClipboard` (main-side copy), `fileSizesBulk`
    // (Stats back-fill) and `restoreHistory` (atomic backup restore), so the
    // pinned count is 50.
    expect(Object.keys(IPC_CHANNELS)).toHaveLength(50);
    expect(new Set(Object.values(IPC_CHANNELS)).size).toBe(50);
  });
});

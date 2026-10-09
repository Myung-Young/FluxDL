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
    // pinned count was 50. Phase 2 adds `rollbackTool`, `reinstallTool` and
    // `runDoctor`: 53. Phase 3 adds `consumeRecoveryNotices`: 54.
    // Phase 4 adds `postProcess`: 55. Phase 5 adds `packs`: 56.
    // Phase 6A adds `remoteApi`: 57. Phase 1 v1.8.5 adds `probeGallery`: 58.
    // Phase 6B adds `notifiers`: 59.
    expect(Object.keys(IPC_CHANNELS)).toHaveLength(59);
    expect(new Set(Object.values(IPC_CHANNELS)).size).toBe(59);
  });
});

import { describe, expect, it } from "vitest";
import { APP_NAME } from "./branding.js";
import { IPC_CHANNELS } from "./engine.js";

describe("core M0", () => {
  it("keeps the app name in one constant", () => {
    expect(APP_NAME).toBe("Grabber");
  });

  it("exposes a fixed single IPC channel map", () => {
    expect(Object.keys(IPC_CHANNELS)).toHaveLength(20);
    expect(new Set(Object.values(IPC_CHANNELS)).size).toBe(20);
  });
});

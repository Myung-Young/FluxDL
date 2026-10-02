import { describe, expect, it } from "vitest";
import { resolveTaskbarCommand } from "./taskbar.js";

describe("resolveTaskbarCommand", () => {
  it("clears the bar when idle (overlay dot survives for hidden finishes)", () => {
    expect(
      resolveTaskbarCommand(
        { active: 0, percent: null },
        { error: false, finishedHidden: true },
        "Ready",
      ),
    ).toEqual({ mode: "none", value: 0, overlay: true, tooltip: "Ready" });
    expect(
      resolveTaskbarCommand(
        { active: 0, percent: null },
        { error: false, finishedHidden: false },
        "Ready",
      ).mode,
    ).toBe("none");
  });

  it("shows normal progress while downloading", () => {
    const cmd = resolveTaskbarCommand(
      { active: 2, percent: 42 },
      { error: false, finishedHidden: false },
      "2 active",
    );
    expect(cmd.mode).toBe("normal");
    expect(cmd.value).toBeCloseTo(0.42, 5);
  });

  it("goes indeterminate when only analyzing/processing", () => {
    expect(
      resolveTaskbarCommand(
        { active: 1, percent: null },
        { error: false, finishedHidden: false },
        "1 active",
      ).mode,
    ).toBe("indeterminate");
  });

  it("holds error mode until focus clears it", () => {
    const cmd = resolveTaskbarCommand(
      { active: 0, percent: null },
      { error: true, finishedHidden: false },
      "Failed",
    );
    expect(cmd.mode).toBe("error");
  });
});

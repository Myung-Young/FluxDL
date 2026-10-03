import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  isFirstStep,
  isLastStep,
  nextStep,
  prevStep,
  stepIndex,
} from "./Onboarding.js";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings.js";

describe("onboarding steps", () => {
  it("walks folder -> theme -> preset exactly once", () => {
    expect(ONBOARDING_STEPS).toEqual(["folder", "theme", "preset"]);
    expect(stepIndex("folder")).toBe(0);
    expect(nextStep("folder")).toBe("theme");
    expect(nextStep("theme")).toBe("preset");
    expect(nextStep("preset")).toBeNull();
    expect(prevStep("preset")).toBe("theme");
    expect(prevStep("folder")).toBeNull();
    expect(isFirstStep("folder")).toBe(true);
    expect(isFirstStep("theme")).toBe(false);
    expect(isLastStep("preset")).toBe(true);
    expect(isLastStep("folder")).toBe(false);
  });
});

describe("onboarding settings", () => {
  it("defaults to undone with a Compatible default preset", () => {
    expect(DEFAULT_SETTINGS.onboardingDone).toBe(false);
    expect(DEFAULT_SETTINGS.defaultPreset).toEqual({
      kind: "video",
      videoPreset: "Compatible",
      audioPreset: "MP3",
      rawFormat: null,
    });
  });

  it("sanitizes the default preset without throwing", () => {
    const m = mergeSettings(DEFAULT_SETTINGS, {
      defaultPreset: {
        kind: "video",
        videoPreset: "720",
        audioPreset: "Opus",
        rawFormat: null,
      },
    });
    expect(m.defaultPreset.videoPreset).toBe("720");
    const bad = mergeSettings(DEFAULT_SETTINGS, {
      defaultPreset: { kind: "clip", videoPreset: "8K", audioPreset: "XX" } as never,
    });
    expect(bad.defaultPreset).toEqual(DEFAULT_SETTINGS.defaultPreset);
    expect(mergeSettings(DEFAULT_SETTINGS, { onboardingDone: true }).onboardingDone).toBe(true);
  });
});

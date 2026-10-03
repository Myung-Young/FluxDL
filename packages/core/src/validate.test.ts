import { describe, expect, it } from "vitest";
import { previewFilename, validateFilenameTemplate, validateSpeedLimit } from "./validate.js";

describe("field validation", () => {
  it("requires a non-empty template with an extension slot", () => {
    expect(validateFilenameTemplate("%(title)s [%(id)s].%(ext)s")).toBe(true);
    expect(validateFilenameTemplate("%(title)s")).toBe(false);
    expect(validateFilenameTemplate("   ")).toBe(false);
  });

  it("accepts empty (unlimited) or numeric rates with optional suffix", () => {
    expect(validateSpeedLimit(null)).toBe(true);
    expect(validateSpeedLimit("")).toBe(true);
    expect(validateSpeedLimit("4.2M")).toBe(true);
    expect(validateSpeedLimit("500K")).toBe(true);
    expect(validateSpeedLimit("100")).toBe(true);
    expect(validateSpeedLimit("fast")).toBe(false);
    expect(validateSpeedLimit("4.2M/s")).toBe(false);
  });

  it("previews templates with sample metadata", () => {
    expect(previewFilename("%(title)s [%(id)s].%(ext)s")).toBe("Sample Video [abc123].mp4");
    expect(previewFilename("%(upload_date)s - %(title)s")).toBe("20260101 - Sample Video");
    expect(previewFilename("%(unknown)s")).toBe("%(unknown)s");
  });
});

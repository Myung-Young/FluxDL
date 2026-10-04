import { describe, expect, it } from "vitest";
import { extractDeepLinkTarget, parseFluxDlUrl } from "./deeplink.js";

describe("parseFluxDlUrl", () => {
  it("accepts an encoded fluxdl:// target", () => {
    expect(parseFluxDlUrl("fluxdl://https%3A%2F%2Fyoutu.be%2Faqz-KE-bpKQ")).toBe(
      "https://youtu.be/aqz-KE-bpKQ",
    );
  });

  it("accepts an unencoded fluxdl:// target", () => {
    expect(parseFluxDlUrl("fluxdl://https://youtu.be/aqz-KE-bpKQ")).toBe(
      "https://youtu.be/aqz-KE-bpKQ",
    );
  });

  it("accepts a bare https URL (CLI arg)", () => {
    expect(parseFluxDlUrl("https://youtu.be/aqz-KE-bpKQ")).toBe(
      "https://youtu.be/aqz-KE-bpKQ",
    );
  });

  it("rejects empty targets, other schemes, and garbage", () => {
    expect(parseFluxDlUrl("fluxdl://")).toBeNull();
    expect(parseFluxDlUrl("fluxdl://not a url")).toBeNull();
    expect(parseFluxDlUrl("file:///C:/vids/a.mp4")).toBeNull();
    expect(parseFluxDlUrl("just some text")).toBeNull();
    expect(parseFluxDlUrl("")).toBeNull();
  });

  it("strips surrounding quotes (Windows argv quoting)", () => {
    expect(parseFluxDlUrl('"https://youtu.be/aqz-KE-bpKQ"')).toBe(
      "https://youtu.be/aqz-KE-bpKQ",
    );
  });
});

describe("extractDeepLinkTarget", () => {
  it("finds the URL among Electron argv noise", () => {
    expect(
      extractDeepLinkTarget([
        "C:\\Program Files\\FluxDL\\FluxDL.exe",
        "--no-sandbox",
        "--",
        "fluxdl://https%3A%2F%2Fyoutu.be%2Faqz-KE-bpKQ",
      ]),
    ).toBe("https://youtu.be/aqz-KE-bpKQ");
  });

  it("returns null when no URL is present", () => {
    expect(extractDeepLinkTarget(["C:\\App\\FluxDL.exe", "--no-sandbox"])).toBeNull();
    expect(extractDeepLinkTarget([])).toBeNull();
  });
});

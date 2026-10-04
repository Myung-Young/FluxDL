import { describe, expect, it } from "vitest";
import { parseIntent } from "./intent.js";

describe("parseIntent", () => {
  it("matches bulk actions in both languages", () => {
    expect(parseIntent("jeda semua")).toEqual({ kind: "pauseAll" });
    expect(parseIntent("pause everything")).toEqual({ kind: "pauseAll" });
    expect(parseIntent("sambung semua")).toEqual({ kind: "resumeAll" });
    expect(parseIntent("cuba semula semua")).toEqual({ kind: "retryAll" });
    expect(parseIntent("padam yang siap")).toEqual({ kind: "clearFinished" });
  });

  it("matches go-to views", () => {
    expect(parseIntent("pergi ke pustaka")).toEqual({ kind: "go", view: "library" });
    expect(parseIntent("open logs")).toEqual({ kind: "go", view: "logs" });
    expect(parseIntent("buka log perubahan")).toEqual({ kind: "go", view: "changelog" });
    expect(parseIntent("go somewhere")).toBeNull();
  });

  it("matches themes and throttles", () => {
    expect(parseIntent("tema paper")).toEqual({ kind: "theme", theme: "paper" });
    expect(parseIntent("laju tanpa had")).toEqual({ kind: "throttle", limit: null });
    expect(parseIntent("speed 4.5m")).toEqual({ kind: "throttle", limit: "4.5M" });
    expect(parseIntent("laju")).toBeNull();
  });

  it("routes URLs with an action verb", () => {
    expect(parseIntent("mp3 https://youtu.be/aqz-KE-bpKQ")).toEqual({
      kind: "analyze",
      url: "https://youtu.be/aqz-KE-bpKQ",
    });
    // A bare URL is not an intent (that is the Home input's job).
    expect(parseIntent("https://youtu.be/aqz-KE-bpKQ")).toBeNull();
    expect(parseIntent("xy")).toBeNull();
  });
});

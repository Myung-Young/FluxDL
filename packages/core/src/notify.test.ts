import { describe, expect, it } from "vitest";
import { sendNotification } from "./notify.js";

describe("notify", () => {
  it("no-ops without a Notification API (node)", () => {
    expect(sendNotification("Done", "file.mp4")).toBe(false);
  });
});

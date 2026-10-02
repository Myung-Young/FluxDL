import { describe, expect, it, vi } from "vitest";
import { createToastStore } from "./toast.js";

describe("toast store", () => {
  it("pushes, caps at three, and dismisses", () => {
    vi.useFakeTimers();
    try {
      const store = createToastStore(10_000);
      const a = store.getState().push("one");
      store.getState().push("two");
      store.getState().push("three");
      store.getState().push("four");
      const ids = store.getState().toasts.map((t) => t.id);
      expect(ids).toHaveLength(3);
      expect(ids).not.toContain(a);
      store.getState().dismiss(ids[0] ?? "");
      expect(store.getState().toasts).toHaveLength(2);
      store.getState().clear();
      expect(store.getState().toasts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-dismisses after the TTL", () => {
    vi.useFakeTimers();
    try {
      const store = createToastStore(1000);
      store.getState().push("hi", "success");
      expect(store.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(1001);
      expect(store.getState().toasts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("carries an optional action", () => {
    vi.useFakeTimers();
    try {
      const store = createToastStore(10_000);
      let ran = 0;
      store.getState().push("failed", "error", {
        label: "Retry",
        run: () => {
          ran += 1;
        },
      });
      const action = store.getState().toasts[0]?.action;
      expect(action?.label).toBe("Retry");
      action?.run();
      expect(ran).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

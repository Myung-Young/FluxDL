import { useCallback, useEffect, useState } from "react";
import type { DownloadEngine } from "./engine.js";

export interface PackInstalled {
  readonly streamlink: boolean;
  readonly nm3u8dl: boolean;
  readonly whisper: boolean;
  readonly rclone: boolean;
  /** Re-query pack status (call after installs/removals). */
  readonly refresh: () => void;
}

/**
 * Which packs are installed (Phase 5). One status call on mount; callers
 * refresh after pack changes. Never throws — unknown reads as absent so
 * pack features degrade to guidance instead of breaking screens.
 */
export function usePackInstalled(engine: Pick<DownloadEngine, "packs">): PackInstalled {
  const [state, setState] = useState<Omit<PackInstalled, "refresh">>({
    streamlink: false,
    nm3u8dl: false,
    whisper: false,
    rclone: false,
  });
  const refresh = useCallback(() => {
    void engine
      .packs({ op: "status" })
      .then((res) => {
        if (res.kind !== "status") return;
        const has = (id: string): boolean =>
          res.rows.some((r) => r.id === id && r.installed !== null && r.exePath !== null);
        setState({
          streamlink: has("streamlink"),
          nm3u8dl: has("n-m3u8dl-re"),
          whisper: has("whisper"),
          rclone: has("rclone"),
        });
      })
      .catch(() => undefined);
  }, [engine]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { ...state, refresh };
}

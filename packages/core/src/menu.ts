import type {
  AudioPreset,
  DownloadPreset,
  JobStatus,
  VideoPreset,
} from "./types.js";

/**
 * Card/Library context-menu matrix (M1.6). Pure: which item ids appear for
 * a job, given its status and whether a destination file is known. Labels
 * and execution live in the screens.
 */

export type CardMenuId =
  | "copy-url"
  | "copy-path"
  | "open"
  | "reveal"
  | "retry-preset"
  | "move-up"
  | "move-down"
  | "remove"
  | "delete-file";

export interface MenuMove {
  readonly up: boolean;
  readonly down: boolean;
}

const REMOVABLE: readonly JobStatus[] = ["queued", "paused", "error", "cancelled"];
const RETRYABLE: readonly JobStatus[] = ["error", "cancelled"];
/** Actively writing outputs must not be trashed out from under the engine. */
const WRITING: readonly JobStatus[] = ["downloading", "processing"];

export const MENU_VIDEO_PRESETS: readonly VideoPreset[] = [
  "Compatible",
  "Best",
  "2160",
  "1440",
  "1080",
  "720",
  "480",
];
export const MENU_AUDIO_PRESETS: readonly AudioPreset[] = ["MP3", "M4A", "Opus", "FLAC"];

export function presetForMenu(kind: "video" | "audio", name: string): DownloadPreset | null {
  if (kind === "video" && (MENU_VIDEO_PRESETS as readonly string[]).includes(name)) {
    return { kind, videoPreset: name as VideoPreset, audioPreset: "MP3", rawFormat: null };
  }
  if (kind === "audio" && (MENU_AUDIO_PRESETS as readonly string[]).includes(name)) {
    return { kind, videoPreset: "Best", audioPreset: name as AudioPreset, rawFormat: null };
  }
  return null;
}

export function menuItemsFor(
  status: JobStatus,
  hasDestination: boolean,
  move: MenuMove = { up: false, down: false },
): readonly CardMenuId[] {
  const items: CardMenuId[] = ["copy-url"];
  if (hasDestination) {
    items.push("copy-path", "open", "reveal");
  }
  if (RETRYABLE.includes(status)) {
    items.push("retry-preset");
  }
  if (status === "queued") {
    if (move.up) items.push("move-up");
    if (move.down) items.push("move-down");
  }
  if (REMOVABLE.includes(status)) {
    items.push("remove");
  }
  if (hasDestination && !WRITING.includes(status)) {
    items.push("delete-file");
  }
  return items;
}

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isMediaFile } from "@grabber/core/destination.js";

/**
 * Authoritative output size on disk (v1.7.2).
 *
 * yt-dlp's progress line is the wrong source of truth for the final size: it
 * reports the bytes of the *pre-merge / pre-extract* streams, post-processing
 * lines carry no byte fields at all, and plenty of sites never print a total.
 * Reading the finished output back off disk is exact, costs one stat, and is
 * what the Stats "total size" tile should have been showing all along.
 *
 * Chapter-split jobs produce a folder, so directories are summed (one level
 * deep is enough: yt-dlp writes the chapter files flat inside it).
 */
export const MAX_SIZED_FILES = 500;

export function outputBytes(destination: string | null): number | null {
  if (destination === null || destination.length === 0) return null;
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(destination);
  } catch {
    return null;
  }
  if (info.isFile()) return info.size > 0 ? info.size : null;
  if (!info.isDirectory()) return null;
  let total = 0;
  let seen = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(destination);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (!isMediaFile(name)) continue;
    if (seen >= MAX_SIZED_FILES) break;
    seen += 1;
    try {
      const child = statSync(join(destination, name));
      if (child.isFile()) total += child.size;
    } catch {
      // A file disappearing mid-scan is not worth failing the download over.
    }
  }
  return total > 0 ? total : null;
}
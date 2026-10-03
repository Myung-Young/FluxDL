import type { DownloadJob } from "./types.js";
import { STRINGS } from "./strings.js";
import {
  MENU_AUDIO_PRESETS,
  MENU_VIDEO_PRESETS,
  menuItemsFor,
  presetForMenu,
  type MenuMove,
} from "./menu.js";
import type { MenuItemDef } from "./ContextMenu.js";

export interface JobMenuHandlers {
  readonly copyUrl: (text: string) => void;
  readonly copyPath: (text: string) => void;
  readonly openFile: () => void;
  readonly reveal: () => void;
  readonly retryWithPreset: (preset: DownloadJob["preset"]) => void;
  readonly moveUp?: () => void;
  readonly moveDown?: () => void;
  readonly remove: () => void;
  readonly deleteFile: () => void;
}

/** Build themed-menu defs for one job (Downloads cards + Library rows). */
export function buildJobMenu(
  job: DownloadJob,
  h: JobMenuHandlers,
  move: MenuMove = { up: false, down: false },
): MenuItemDef[] {
  const defs: MenuItemDef[] = [];
  for (const id of menuItemsFor(job.status, job.destination !== null, move)) {
    switch (id) {
      case "copy-url":
        defs.push({
          id,
          label: STRINGS.menu.copyUrl,
          run: () => {
            h.copyUrl(job.url);
          },
        });
        break;
      case "copy-path":
        if (job.destination !== null) {
          const dest = job.destination;
          defs.push({
            id,
            label: STRINGS.menu.copyPath,
            run: () => {
              h.copyPath(dest);
            },
          });
        }
        break;
      case "open":
        defs.push({
          id,
          label: STRINGS.downloads.openFile,
          run: () => {
            h.openFile();
          },
        });
        break;
      case "reveal":
        defs.push({
          id,
          label: STRINGS.downloads.showInFolder,
          run: () => {
            h.reveal();
          },
        });
        break;
      case "retry-preset": {
        const names = job.preset.kind === "video" ? MENU_VIDEO_PRESETS : MENU_AUDIO_PRESETS;
        defs.push({
          id,
          label: STRINGS.menu.retryPreset,
          children: names.map((name) => {
            const preset = presetForMenu(job.preset.kind, name);
            return {
              id: `preset:${name}`,
              label: name === "Compatible" ? STRINGS.home.presetCompatible : name,
              run: () => {
                if (preset !== null) h.retryWithPreset(preset);
              },
            };
          }),
        });
        break;
      }
      case "remove":
        defs.push({
          id,
          label: STRINGS.menu.remove,
          run: () => {
            h.remove();
          },
        });
        break;
      case "move-up": {
        const up = h.moveUp;
        if (up !== undefined) {
          defs.push({
            id,
            label: STRINGS.menu.moveUp,
            run: () => {
              up();
            },
          });
        }
        break;
      }
      case "move-down": {
        const down = h.moveDown;
        if (down !== undefined) {
          defs.push({
            id,
            label: STRINGS.menu.moveDown,
            run: () => {
              down();
            },
          });
        }
        break;
      }
      case "delete-file":
        defs.push({
          id,
          label: STRINGS.menu.deleteFile,
          run: () => {
            h.deleteFile();
          },
        });
        break;
    }
  }
  return defs;
}

import type { DownloadJob } from "./types.js";
import type { PostStep } from "./postprocess.js";
import type { Strings } from "./strings.js";
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
  /** Manual pipeline run with explicit steps (Phase 4). */
  readonly postRun?: (steps: readonly PostStep[]) => void;
  /** Re-run the failed pipeline (Phase 4, postfailed only). */
  readonly postReprocess?: () => void;
  /** Show the ffprobe details (Phase 4; Library modal, Downloads omits). */
  readonly showMediaInfo?: () => void;
}

/**
 * Steps offered for a manual run: one per content class present on the job.
 * Gallery jobs convert, audio jobs tag, video jobs compress.
 */
export function postStepsForJob(job: DownloadJob): PostStep[] {
  if (job.preset.kind === "audio") return ["tag-audio"];
  if (job.engineId === "gallery-dl") return ["convert-image"];
  return ["compress-video"];
}

/** Build themed-menu defs for one job (Downloads cards + Library rows). */
export function buildJobMenu(
  job: DownloadJob,
  h: JobMenuHandlers,
  move: MenuMove = { up: false, down: false },
  strings: Strings,
): MenuItemDef[] {
  const defs: MenuItemDef[] = [];
  for (const id of menuItemsFor(job.status, job.destination !== null, move)) {
    switch (id) {
      case "copy-url":
        defs.push({
          id,
          label: strings.menu.copyUrl,
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
            label: strings.menu.copyPath,
            run: () => {
              h.copyPath(dest);
            },
          });
        }
        break;
      case "open":
        defs.push({
          id,
          label: job.splitChapters === true ? strings.downloads.showFolder : strings.downloads.openFile,
          run: () => {
            h.openFile();
          },
        });
        break;
      case "reveal":
        defs.push({
          id,
          label: strings.downloads.showInFolder,
          run: () => {
            h.reveal();
          },
        });
        break;
      case "retry-preset": {
        const names = job.preset.kind === "video" ? MENU_VIDEO_PRESETS : MENU_AUDIO_PRESETS;
        defs.push({
          id,
          label: strings.menu.retryPreset,
          children: names.map((name) => {
            const preset = presetForMenu(job.preset.kind, name);
            return {
              id: `preset:${name}`,
              label: name === "Compatible" ? strings.home.presetCompatible : name,
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
          label: strings.menu.remove,
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
            label: strings.menu.moveUp,
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
            label: strings.menu.moveDown,
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
          label: job.splitChapters === true ? strings.menu.deleteFolder : strings.menu.deleteFile,
          run: () => {
            h.deleteFile();
          },
        });
        break;
      case "post-run": {
        const run = h.postRun;
        if (run === undefined) break;
        const steps = postStepsForJob(job);
        const label =
          steps[0] === "tag-audio"
            ? strings.downloads.postMenuTag
            : steps[0] === "convert-image"
              ? strings.downloads.postMenuConvert
              : strings.downloads.postMenuCompress;
        defs.push({
          id,
          label,
          run: () => {
            run(steps);
          },
        });
        break;
      }
      case "post-reprocess": {
        const reprocess = h.postReprocess;
        if (reprocess === undefined) break;
        defs.push({
          id,
          label: strings.downloads.postMenuReprocess,
          run: () => {
            reprocess();
          },
        });
        break;
      }
      case "post-transcribe": {
        const run = h.postRun;
        if (run === undefined || job.preset.kind !== "audio") break;
        defs.push({
          id,
          label: strings.downloads.postMenuTranscribe,
          run: () => {
            run(["transcribe-audio"]);
          },
        });
        break;
      }
      case "post-upload": {
        const run = h.postRun;
        if (run === undefined) break;
        defs.push({
          id,
          label: strings.downloads.postMenuUpload,
          run: () => {
            run(["upload-remote"]);
          },
        });
        break;
      }
      case "media-info": {
        const show = h.showMediaInfo;
        if (show === undefined) break;
        defs.push({
          id,
          label: strings.downloads.postMenuMediaInfo,
          run: () => {
            show();
          },
        });
        break;
      }
    }
  }
  return defs;
}

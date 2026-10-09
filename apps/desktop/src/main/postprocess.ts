import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { shell } from "electron";
import {
  buildCompressArgs,
  buildConvertArgs,
  buildRcloneArgs,
  buildRecordingQuery,
  buildWhisperArgs,
  classifyPostFile,
  convertOutputPath,
  hasBasicTags,
  hintFromFilename,
  parseHwaccels,
  parseMediaSummary,
  parseRecordingDetail,
  parseRecordingResponse,
  pickH264Encoder,
  pickTagCandidate,
  rcloneDest,
  srtBasePath,
  TAG_AUTO_SCORE,
  type MediaSummary,
  type PostStep,
  type TagCandidate,
} from "@grabber/core/postprocess.js";
import type { CompressPreset, ConvertFormat, PostProcessSettings } from "@grabber/core/types.js";
import { resolveFfmpegPath, resolveFfprobePath } from "./binaries.js";

/**
 * Post-processing runner (Phase 4, main-side only). ffmpeg child processes,
 * args arrays, never shell. Every step: temp-in-same-dir → verify →
 * atomic rename. Failures are step errors, never app crashes.
 */

export interface PostRunnerDeps {
  readonly bundledBinDir: string;
  readonly appVersion: string;
  /** Lines for the job raw log (progress + step notes). */
  readonly onLog?: (line: string) => void;
  /** ffmpeg step timeout (default 2 h; tests inject milliseconds). */
  readonly stepTimeoutMs?: number;
  /** Current ffmpeg child (pause/cancel/quit kills it). */
  readonly track?: (proc: ChildProcess | null) => void;
  /** True when the user cancelled mid-pipeline (aborts, not a step error). */
  readonly isCancelled?: () => boolean;
}

/** Thrown when pause/cancel/quit interrupts a pipeline (not a failure). */
export class PostAbortedError extends Error {
  constructor() {
    super("Post-processing was cancelled.");
  }
}

export interface StepOutcome {
  readonly step: PostStep;
  readonly ok: boolean;
  readonly output: string | null;
  readonly savedBytes: number | null;
  readonly note: string | null;
}

export interface TagHint {
  readonly title: string;
  readonly artist: string | null;
  /** Force this MB recording id (manual "apply anyway" flow). */
  readonly forceMbid?: string;
}

const DEFAULT_STEP_TIMEOUT_MS = 2 * 3_600_000;
const MB_TIMEOUT_MS = 15_000;
const COVER_TIMEOUT_MS = 20_000;
/** MusicBrainz demands ≥1 s between requests (and a descriptive UA). */
const MB_SPACING_MS = 1_100;

let lastMbCall = 0;
let cachedEncoder: string | null = null;

function log(deps: PostRunnerDeps, line: string): void {
  deps.onLog?.(`[post] ${line}`);
}

/** Run ffmpeg, streaming human log lines; rejects on non-zero exit/timeout. */
export function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  deps: PostRunnerDeps,
): Promise<void> {
  const timeoutMs = deps.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  return new Promise<void>((resolve, reject) => {
    let proc;
    try {
      proc = spawn(ffmpegPath, [...args], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let settled = false;
    const finish = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      deps.track?.(null);
      if (err === null) resolve();
      else reject(err);
    };
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Already gone.
      }
      finish(new Error(`Post-processing timed out after ${String(Math.round(timeoutMs / 1000))}s.`));
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    let rest = "";
    const pump = (chunk: Buffer): void => {
      rest += chunk.toString("utf8");
      const lines = rest.split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        // -progress lines are machine noise; keep only the tail-worthy bits.
        if (t.length > 0 && !t.includes("=")) log(deps, t.slice(0, 300));
      }
    };
    proc.stdout.on("data", pump);
    proc.stderr.on("data", pump);
    deps.track?.(proc);
    proc.on("error", (err) => {
      finish(err instanceof Error ? err : new Error(String(err)));
    });
    proc.on("close", (code) => {
      if (rest.trim().length > 0) log(deps, rest.trim().slice(0, 300));
      if (code === 0) finish(null);
      else if (deps.isCancelled?.() === true) finish(new PostAbortedError());
      else finish(new Error(`ffmpeg exited with code ${String(code ?? "unknown")}.`));
    });
  });
}

function tempPath(inputPath: string, ext: string): string {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return join(dirname(inputPath), `${basename(inputPath, extname(inputPath))}.fluxdl-tmp-${rand}${ext}`);
}

/** Free-space gate: refuse before burning time on a doomed step. */
async function ensureFreeSpace(file: string, factor: number): Promise<number> {
  const size = (await stat(file)).size;
  let free = 0;
  try {
    const fs = statfsSync(dirname(file));
    free = fs.bfree * fs.bsize;
  } catch {
    free = Number.MAX_SAFE_INTEGER;
  }
  if (free < size * factor) {
    throw new Error(
      `Not enough free space for post-processing (need ${String(size * factor)}, have ${String(free)}).`,
    );
  }
  return size;
}

async function verifyMedia(ffprobePath: string, path: string): Promise<MediaSummary> {
  const out = await new Promise<string>((resolve, reject) => {
    let proc;
    try {
      proc = spawn(
        ffprobePath,
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", path],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false },
      );
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let text = "";
    proc.stdout.on("data", (c: Buffer) => {
      text += c.toString("utf8");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(text);
      else reject(new Error(`ffprobe exited with code ${String(code ?? "unknown")}.`));
    });
  });
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(out) as unknown;
  } catch {
    throw new Error("Post-processing produced an unreadable file.");
  }
  const summary = parseMediaSummary(parsed);
  if (summary === null || (summary.video === null && summary.audio === null)) {
    throw new Error("Post-processing produced a file with no streams.");
  }
  return summary;
}

/** ffmpeg/ffprobe resolution (bundled first, PATH fallback). */
export function postBinaries(bundledBinDir: string): { ffmpeg: string; ffprobe: string } {
  return { ffmpeg: resolveFfmpegPath(bundledBinDir), ffprobe: resolveFfprobePath(bundledBinDir) };
}

async function pickEncoder(deps: PostRunnerDeps): Promise<string> {
  if (cachedEncoder !== null) return cachedEncoder;
  const { ffmpeg } = postBinaries(deps.bundledBinDir);
  const run = (args: string[]): Promise<string> =>
    new Promise<string>((resolve) => {
      let proc;
      try {
        proc = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
      } catch {
        resolve("");
        return;
      }
      let text = "";
      proc.stdout.on("data", (c: Buffer) => {
        text += c.toString("utf8");
      });
      proc.stderr.on("data", (c: Buffer) => {
        text += c.toString("utf8");
      });
      const kill = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // Gone.
        }
        resolve("");
      }, 30_000);
      proc.on("close", () => {
        clearTimeout(kill);
        resolve(text);
      });
      proc.on("error", () => {
        clearTimeout(kill);
        resolve("");
      });
    });
  const [hw, enc] = await Promise.all([
    run(["-hide_banner", "-hwaccels"]),
    run(["-hide_banner", "-encoders"]),
  ]);
  cachedEncoder = pickH264Encoder(parseHwaccels(hw), enc);
  return cachedEncoder;
}

export interface ConvertOpts {
  readonly format: ConvertFormat;
  readonly quality: number;
  readonly maxDim: number;
  readonly stripExif: boolean;
  readonly keepOriginals: boolean;
}

/** Convert one image; returns the output path + bytes saved (may be negative). */
export async function runConvertImage(
  deps: PostRunnerDeps,
  file: string,
  opts: ConvertOpts,
): Promise<StepOutcome> {
  const step: PostStep = "convert-image";
  try {
    const { ffmpeg, ffprobe } = postBinaries(deps.bundledBinDir);
    const before = await ensureFreeSpace(file, 2);
    const output = convertOutputPath(file, opts.format);
    const tmp = tempPath(file, opts.format === "jpg" ? ".jpg" : ".png");
    await mkdir(dirname(tmp), { recursive: true });
    await runFfmpeg(
      ffmpeg,
      buildConvertArgs(file, tmp, {
        format: opts.format,
        quality: opts.quality,
        maxDim: opts.maxDim,
        stripExif: opts.stripExif,
      }),
      deps,
    );
    await verifyMedia(ffprobe, tmp);
    await rename(tmp, output);
    const after = (await stat(output)).size;
    if (!opts.keepOriginals) {
      await shell.trashItem(file).catch(() => undefined);
    }
    return { step, ok: true, output, savedBytes: before - after, note: null };
  } catch (err) {
    return { step, ok: false, output: null, savedBytes: null, note: err instanceof Error ? err.message : String(err) };
  }
}

export interface CompressOpts {
  readonly preset: Exclude<CompressPreset, "off">;
  readonly keepOriginals: boolean;
}

/** Transcode one video with the picked encoder (HW when present). */
export async function runCompressVideo(
  deps: PostRunnerDeps,
  file: string,
  opts: CompressOpts,
): Promise<StepOutcome> {
  const step: PostStep = "compress-video";
  try {
    const { ffmpeg, ffprobe } = postBinaries(deps.bundledBinDir);
    const before = await ensureFreeSpace(file, 2);
    const picked = await pickEncoder(deps);
    const dot = file.lastIndexOf(".");
    const base = dot >= 0 ? file.slice(0, dot) : file;
    const output = `${base}.fluxdl-${opts.preset}.mp4`;
    const tmp = tempPath(file, ".mp4");
    // Hardware encoders can refuse odd inputs (tiny dimensions, odd
    // pix-fmts): try HW first, fall back to libx264 on failure.
    let encoder = picked;
    log(deps, `compressing with ${encoder} (${opts.preset})`);
    try {
      await runFfmpeg(ffmpeg, buildCompressArgs(file, tmp, opts.preset, encoder), deps);
    } catch (err) {
      if (encoder === "libx264") throw err;
      log(deps, `${encoder} failed (${err instanceof Error ? err.message : String(err)}); retrying with libx264`);
      encoder = "libx264";
      await runFfmpeg(ffmpeg, buildCompressArgs(file, tmp, opts.preset, encoder), deps);
    }
    const summary = await verifyMedia(ffprobe, tmp);
    if (summary.video === null) throw new Error("Compressed file has no video stream.");
    await rename(tmp, output);
    const after = (await stat(output)).size;
    if (!opts.keepOriginals) {
      await shell.trashItem(file).catch(() => undefined);
    }
    return { step, ok: true, output, savedBytes: before - after, note: null };
  } catch (err) {
    return { step, ok: false, output: null, savedBytes: null, note: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Audio tagging (MusicBrainz + Cover Art Archive, main-side fetching).
// ---------------------------------------------------------------------------

async function mbFetchJson(url: string, appVersion: string, timeoutMs: number): Promise<unknown> {
  if (Date.now() - lastMbCall < MB_SPACING_MS) {
    await new Promise((r) => setTimeout(r, MB_SPACING_MS - (Date.now() - lastMbCall)));
  }
  lastMbCall = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": `FluxDL/${appVersion} (+https://github.com/Myung-Young/FluxDL)`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`MusicBrainz answered ${String(res.status)}.`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCoverFile(releaseMbid: string, workDir: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, COVER_TIMEOUT_MS);
  try {
    const res = await fetch(`https://coverartarchive.org/release/${releaseMbid}/front-500`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "FluxDL" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return null;
    const path = join(workDir, `fluxdl-cover-${Date.now().toString(36)}.jpg`);
    await mkdir(workDir, { recursive: true });
    await writeFile(path, buf);
    return path;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function tagArgs(file: string, tmp: string, c: TagCandidate, cover: string | null): string[] {
  const args = ["-hide_banner", "-y", "-i", file];
  if (cover !== null) args.push("-i", cover);
  args.push("-map", "0");
  if (cover !== null) {
    args.push("-map", "1", "-c", "copy", "-disposition:v", "attached_pic");
  } else {
    args.push("-c", "copy");
  }
  args.push("-metadata", `title=${c.title}`, "-metadata", `artist=${c.artist}`);
  if (c.release !== null) args.push("-metadata", `album=${c.release}`);
  if (c.date !== null) args.push("-metadata", `date=${c.date.slice(0, 4)}`);
  args.push(tmp);
  return args;
}

/**
 * Tag one audio file. Skips already-tagged files (unless forced), auto-applies
 * at threshold, and returns low-confidence candidates for the manual flow.
 */
export async function runTagAudio(
  deps: PostRunnerDeps,
  file: string,
  hint: TagHint,
): Promise<StepOutcome & { candidates: TagCandidate[] }> {
  const step: PostStep = "tag-audio";
  const fail = (note: string, candidates: TagCandidate[] = []): StepOutcome & { candidates: TagCandidate[] } => ({
    step,
    ok: false,
    output: null,
    savedBytes: null,
    note,
    candidates,
  });
  try {
    const { ffmpeg, ffprobe } = postBinaries(deps.bundledBinDir);
    await ensureFreeSpace(file, 2);
    let candidate: TagCandidate | null = null;
    let candidates: TagCandidate[] = [];
    if (hint.forceMbid !== undefined) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hint.forceMbid)) {
        return fail("Invalid recording id.");
      }
      const detail = await mbFetchJson(
        `https://musicbrainz.org/ws/2/recording/${hint.forceMbid}?fmt=json&inc=artists+releases`,
        deps.appVersion,
        MB_TIMEOUT_MS,
      );
      candidate = parseRecordingDetail(detail);
      if (candidate === null) return fail("Recording not found.");
    } else {
      const summary = await verifyMedia(ffprobe, file);
      if (summary.audio === null) return fail("No audio stream found.");
      if (hasBasicTags(summary)) {
        return { step, ok: true, output: null, savedBytes: null, note: "Already tagged — skipped.", candidates: [] };
      }
      const query = encodeURIComponent(buildRecordingQuery(hint.title, hint.artist));
      const payload = await mbFetchJson(
        `https://musicbrainz.org/ws/2/recording/?query=${query}&fmt=json&limit=5`,
        deps.appVersion,
        MB_TIMEOUT_MS,
      );
      candidates = parseRecordingResponse(payload);
      const picked = pickTagCandidate(candidates);
      if (picked.auto === null) {
        const best = picked.bestBelow;
        return {
          step,
          ok: false,
          output: null,
          savedBytes: null,
          note:
            best === null
              ? "No MusicBrainz match found."
              : `Best match "${best.title} — ${best.artist}" scores ${String(best.score)} (needs ${String(TAG_AUTO_SCORE)}).`,
          candidates,
        };
      }
      candidate = picked.auto;
    }
    const workDir = join(tmpdir(), "fluxdl-post");
    const cover = candidate.releaseMbid === null ? null : await fetchCoverFile(candidate.releaseMbid, workDir);
    const before = (await stat(file)).size;
    const ext = extname(file).toLowerCase();
    const tmp = tempPath(file, ext.length > 0 ? ext : ".m4a");
    const runArgs = tagArgs(file, tmp, candidate, cover);
    await runFfmpeg(ffmpeg, runArgs, deps);
    await verifyMedia(ffprobe, tmp);
    await rename(tmp, file);
    if (cover !== null) await rm(cover, { force: true }).catch(() => undefined);
    const after = (await stat(file)).size;
    log(deps, `tagged "${candidate.title} — ${candidate.artist}"`);
    return {
      step,
      ok: true,
      output: file,
      savedBytes: before - after,
      note: cover !== null ? "Tags + cover art applied." : "Tags applied (no cover art found).",
      candidates: [],
    };
  } catch (err) {
    return {
      step,
      ok: false,
      output: null,
      savedBytes: null,
      note: err instanceof Error ? err.message : String(err),
      candidates: [],
    };
  }
}

/** ffprobe summary for the PreviewModal Details section. */
export async function mediaInfoFor(bundledBinDir: string, path: string): Promise<MediaSummary | null> {
  if (!existsSync(path)) return null;
  try {
    return await verifyMedia(resolveFfprobePath(bundledBinDir), path);
  } catch {
    return null;
  }
}

/** List media files directly inside a directory (one level, no recursion). */
export async function listPostFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries.slice(0, 2000)) {
      if (!e.isFile()) continue;
      const full = join(dir, e.name);
      if (classifyPostFile(full).class !== "other") out.push(full);
    }
    return out.sort();
  } catch {
    return [];
  }
}

export interface RunStepsOpts {
  readonly settings: PostProcessSettings;
  readonly tagHint?: TagHint | ((file: string) => TagHint);
  /** Resolved whisper model file (null = guidance error, never auto-download here). */
  readonly whisperModelPath?: string | null;
  /** Resolved whisper-cli exe (null = guidance error). */
  readonly whisperExe?: string | null;
  /** Resolved rclone exe (null = guidance error). */
  readonly rclonePath?: string | null;
}

/** Execute the applicable steps for already-resolved files (sequential). */
export async function runPostSteps(
  deps: PostRunnerDeps,
  files: readonly string[],
  steps: readonly PostStep[],
  opts: RunStepsOpts,
): Promise<{ outcomes: StepOutcome[]; candidates: TagCandidate[] }> {
  const outcomes: StepOutcome[] = [];
  let candidates: TagCandidate[] = [];
  const s = opts.settings;
  for (const file of files.slice(0, 500)) {
    if (deps.isCancelled?.() === true) throw new PostAbortedError();
    const cls = classifyPostFile(file).class;
    if (steps.includes("convert-image") && cls === "image") {
      outcomes.push(
        await runConvertImage(deps, file, {
          format: s.imageFormat,
          quality: s.imageQuality,
          maxDim: s.imageMaxDim,
          stripExif: s.stripExif,
          keepOriginals: s.keepOriginals,
        }),
      );
    }
    if (steps.includes("tag-audio") && cls === "audio") {
      const hint =
        typeof opts.tagHint === "function" ? opts.tagHint(file) : (opts.tagHint ?? hintFromFilename(file));
      const outcome = await runTagAudio(deps, file, hint);
      candidates = outcome.candidates;
      outcomes.push({
        step: outcome.step,
        ok: outcome.ok,
        output: outcome.output,
        savedBytes: outcome.savedBytes,
        note: outcome.note,
      });
    }
    if (steps.includes("compress-video") && cls === "video" && s.compressVideo !== "off") {
      outcomes.push(
        await runCompressVideo(deps, file, { preset: s.compressVideo, keepOriginals: s.keepOriginals }),
      );
    }
    if (steps.includes("transcribe-audio") && cls === "audio") {
      outcomes.push(
        await runTranscribeAudio(deps, file, {
          model: s.whisperModel,
          modelPath: opts.whisperModelPath ?? null,
          whisperExe: opts.whisperExe ?? null,
        }),
      );
    }
    if (steps.includes("upload-remote") && (cls === "video" || cls === "audio")) {
      outcomes.push(
        await runUploadRemote(deps, file, {
          remote: s.rcloneRemote,
          rclonePath: opts.rclonePath ?? null,
        }),
      );
    }
  }
  return { outcomes, candidates };
}

export interface TranscribeOpts {
  readonly model: "tiny" | "base" | "small";
  /** Resolved ggml-*.bin (null = install-guidance failure, no silent fetch). */
  readonly modelPath: string | null;
  /** Resolved whisper-cli exe (null = install-guidance failure). */
  readonly whisperExe: string | null;
}

/**
 * Transcribe one audio file to an .srt sidecar (whisper pack, CPU).
 * Converts to 16 kHz mono wav first (whisper's native diet), then runs
 * whisper-cli. The wav temp is always deleted; the srt stays next to the
 * audio (keepOriginals only governs conversions, never sidecars).
 */
export async function runTranscribeAudio(
  deps: PostRunnerDeps,
  file: string,
  opts: TranscribeOpts,
): Promise<StepOutcome> {
  const step: PostStep = "transcribe-audio";
  try {
    if (opts.modelPath === null || !existsSync(opts.modelPath)) {
      throw new Error(
        `Install the whisper pack and the ${opts.model} model first (Settings → Tool Packs).`,
      );
    }
    const { ffmpeg } = postBinaries(deps.bundledBinDir);
    await ensureFreeSpace(file, 2);
    const wav = tempPath(file, ".wav");
    await runFfmpeg(
      ffmpeg,
      ["-hide_banner", "-y", "-i", file, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
      deps,
    );
    try {
      const srtBase = srtBasePath(file);
      if (opts.whisperExe === null || !existsSync(opts.whisperExe)) {
        throw new Error("Install the whisper pack first (Settings → Tool Packs).");
      }
      await runFfmpeg(opts.whisperExe, buildWhisperArgs(opts.modelPath, wav, srtBase), deps);
      const srt = `${srtBase}.srt`;
      const st = await stat(srt).catch(() => null);
      if (st === null || st.size === 0) throw new Error("Transcription produced no subtitles.");
      return { step, ok: true, output: srt, savedBytes: null, note: `Subtitles written (${(st.size / 1024).toFixed(1)} KB).` };
    } finally {
      await rm(wav, { force: true }).catch(() => undefined);
    }
  } catch (err) {
    return { step, ok: false, output: null, savedBytes: null, note: err instanceof Error ? err.message : String(err) };
  }
}

export interface UploadOpts {
  /** rclone remote target (`remote:path/`); null = guidance failure. */
  readonly remote: string | null;
  /** Resolved rclone exe; null = guidance failure. */
  readonly rclonePath: string | null;
}

/**
 * Upload one file via rclone (the pack owns its config — FluxDL only
 * stores the `remote:path` string, never credentials).
 */
export async function runUploadRemote(
  deps: PostRunnerDeps,
  file: string,
  opts: UploadOpts,
): Promise<StepOutcome> {
  const step: PostStep = "upload-remote";
  try {
    if (opts.rclonePath === null || !existsSync(opts.rclonePath)) {
      throw new Error("Install the rclone pack first (Settings → Tool Packs).");
    }
    if (opts.remote === null || opts.remote.trim().length === 0) {
      throw new Error("Set an rclone remote first (Settings → After download).");
    }
    const dest = rcloneDest(opts.remote, file);
    await runFfmpeg(
      opts.rclonePath,
      buildRcloneArgs(file, opts.remote),
      deps,
    );
    log(deps, `uploaded to ${dest}`);
    return { step, ok: true, output: null, savedBytes: null, note: `Uploaded to ${dest}.` };
  } catch (err) {
    return { step, ok: false, output: null, savedBytes: null, note: err instanceof Error ? err.message : String(err) };
  }
}

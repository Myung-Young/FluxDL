import { describe, expect, it } from "vitest";
import {
  activeCount,
  activeGalleryCount,
  applyEngineProgress,
  canTransition,
  clampConcurrency,
  computeBackoffMs,
  filterHistory,
  isFinished,
  isInDownloadWindow,
  jobsEqual,
  makeJob,
  priorityOf,
  pruneHistory,
  reorder,
  retryInSeconds,
  searchHistory,
  selectNextToStart,
  shouldRetry,
  sortHistory,
  toStartInput,
  transition,
} from "./queue.js";
import type { DownloadWindow } from "./queue.js";
import type { DownloadJob, DownloadJobInput } from "./types.js";

const input: DownloadJobInput = {
  url: "https://youtu.be/aqz-KE-bpKQ",
  title: "Big Buck Bunny",
  preset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
  outputDir: "C:\\Vids",
};

function jobAt(status: DownloadJob["status"], createdAt = 1, id = "j1"): DownloadJob {
  return {
    ...makeJob(id, input, createdAt),
    status,
  };
}

describe("queue state machine", () => {
  it("covers the happy path queued -> downloading -> processing -> done", () => {
    let j = makeJob("a", input, 1);
    expect(j.status).toBe("queued");
    j = transition(j, "start");
    expect(j.status).toBe("downloading");
    j = transition(j, "process");
    expect(j.status).toBe("processing");
    j = transition(j, "done");
    expect(j.status).toBe("done");
    expect(j.progress).toBe(100);
    expect(isFinished(j)).toBe(true);
  });

  it("covers pause/resume/cancel from every active state", () => {
    for (const from of ["queued", "analyzing", "downloading", "processing"] as const) {
      expect(canTransition(from, "pause")).toBe(true);
      const paused = transition(jobAt(from), "pause");
      expect(paused.status).toBe("paused");
      expect(transition(paused, "resume").status).toBe("downloading");
      expect(transition(paused, "cancel").status).toBe("cancelled");
    }
    expect(canTransition("done", "pause")).toBe(false);
    expect(() => transition(jobAt("done"), "pause")).toThrow();
  });

  it("covers fail -> retry with attempts and backoff", () => {
    let j = transition(jobAt("downloading"), "fail", { error: "boom", now: 1000 });
    expect(j.status).toBe("error");
    expect(j.attempts).toBe(1);
    expect(j.nextRetryAt).toBe(1000 + computeBackoffMs(1));
    expect(shouldRetry(j, 3, 1000)).toBe(false);
    expect(shouldRetry(j, 3, (j.nextRetryAt ?? 0) + 1)).toBe(true);
    j = transition(j, "retry");
    expect(j.status).toBe("queued");
    expect(j.error).toBeNull();
  });

  it("applies engine progress stages to queue state", () => {
    let j = transition(jobAt("queued"), "start");
    j = applyEngineProgress(j, {
      percent: 12.5,
      speed: "1M/s",
      eta: "00:01",
      downloadedBytes: 10,
      totalBytes: 100,
      stage: "downloading",
      destination: null,
    });
    expect(j.progress).toBe(12.5);
    j = applyEngineProgress(j, {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: 100,
      totalBytes: 100,
      stage: "processing",
      destination: "C:\\Vids\\a.mp4",
    });
    expect(j.status).toBe("processing");
    expect(j.destination).toBe("C:\\Vids\\a.mp4");
    j = applyEngineProgress(j, {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: 100,
      totalBytes: 100,
      stage: "done",
      destination: null,
    });
    expect(j.status).toBe("done");
    expect(j.destination).toBe("C:\\Vids\\a.mp4");
  });

  it("never downgrades a known byte count to null (v1.7.2)", () => {
    // yt-dlp's post-processing lines ([ExtractAudio], [Merger], [Fixup], …)
    // carry no byte fields, and the final `done` event did too. Writing those
    // nulls through is what left every audio job with no size at all, so the
    // Stats "total size" tile read "Unknown" for most libraries.
    let j = transition(jobAt("queued"), "start");
    j = applyEngineProgress(j, {
      percent: 42,
      speed: "1M/s",
      eta: "00:10",
      downloadedBytes: 420,
      totalBytes: 1000,
      stage: "downloading",
      destination: "C:\\Vids\\a.webm",
    });
    expect(j.totalBytes).toBe(1000);

    // [ExtractAudio] Destination: …
    j = applyEngineProgress(j, {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: "processing",
      destination: "C:\\Vids\\a.mp3",
    });
    expect(j.status).toBe("processing");
    expect(j.totalBytes).toBe(1000);
    expect(j.downloadedBytes).toBe(420);

    // The done event, still without byte fields.
    j = applyEngineProgress(j, {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: "done",
      destination: null,
    });
    expect(j.status).toBe("done");
    expect(j.totalBytes).toBe(1000);
    expect(j.downloadedBytes).toBe(420);
    expect(j.destination).toBe("C:\\Vids\\a.mp3");
  });

  it("lets a later event overwrite the byte counts", () => {
    let j = transition(jobAt("queued"), "start");
    j = applyEngineProgress(j, {
      percent: 42,
      speed: null,
      eta: null,
      downloadedBytes: 420,
      totalBytes: 1000,
      stage: "downloading",
      destination: null,
    });
    // The engine measures the finished output and reports the real size.
    j = applyEngineProgress(j, {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: 733,
      totalBytes: 733,
      stage: "done",
      destination: null,
    });
    expect(j.totalBytes).toBe(733);
    expect(j.downloadedBytes).toBe(733);
  });

  it("keeps the byte counts through a failure", () => {
    let j = transition(jobAt("queued"), "start");
    j = applyEngineProgress(j, {
      percent: 42,
      speed: null,
      eta: null,
      downloadedBytes: 420,
      totalBytes: 1000,
      stage: "downloading",
      destination: null,
    });
    j = applyEngineProgress(j, {
      percent: 42,
      speed: null,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: "error",
      destination: null,
      errorMessage: "boom",
    });
    expect(j.status).toBe("error");
    expect(j.totalBytes).toBe(1000);
  });

  it("folds gallery file counters without touching yt-dlp snapshots (v1.8.5)", () => {
    // Gallery progress carries per-file counts (downloadedBytes is a count,
    // not bytes, on that path). Cards render "N files" from these fields.
    let g = transition(jobAt("queued"), "start");
    g = applyEngineProgress(g, {
      percent: null,
      speed: null,
      eta: null,
      downloadedBytes: 7,
      totalBytes: null,
      stage: "downloading",
      destination: "C:\\Pics",
      downloadedCount: 7,
      skippedCount: 2,
      failedCount: 1,
    });
    expect(g.downloadedCount).toBe(7);
    expect(g.skippedCount).toBe(2);
    expect(g.failedCount).toBe(1);
    // A counter-less fold keeps known counters (monotonic, like bytes).
    g = applyEngineProgress(g, {
      percent: null,
      speed: null,
      eta: null,
      downloadedBytes: 7,
      totalBytes: null,
      stage: "downloading",
      destination: "C:\\Pics",
    });
    expect(g.downloadedCount).toBe(7);
    // yt-dlp jobs never gain the keys: snapshots stay byte-identical.
    let v = transition(jobAt("queued"), "start");
    v = applyEngineProgress(v, {
      percent: 50,
      speed: "1M/s",
      eta: "00:01",
      downloadedBytes: 50,
      totalBytes: 100,
      stage: "downloading",
      destination: null,
    });
    expect("downloadedCount" in v).toBe(false);
    expect("skippedCount" in v).toBe(false);
    expect("failedCount" in v).toBe(false);
  });

  it("resumes accept progress and done events after pause (D53)", () => {
    const paused = transition(jobAt("downloading"), "pause");
    expect(paused.status).toBe("paused");
    const resumed = applyEngineProgress(paused, {
      percent: 50,
      speed: "1M/s",
      eta: "00:01",
      downloadedBytes: 50,
      totalBytes: 100,
      stage: "downloading",
      destination: null,
    });
    expect(resumed.status).toBe("downloading");
    const finished = applyEngineProgress(paused, {
      percent: 100,
      speed: null,
      eta: null,
      downloadedBytes: 100,
      totalBytes: 100,
      stage: "done",
      destination: "C:\\Vids\\a.mp4",
    });
    expect(finished.status).toBe("done");
  });

  it("enforces FIFO with concurrency 1-5 and backoff gating", () => {
    const a = jobAt("queued", 1, "a");
    const b = jobAt("queued", 2, "b");
    expect(selectNextToStart([b, a], 5, 0)?.id).toBe("a");
    expect(activeCount([jobAt("downloading"), jobAt("processing"), a])).toBe(2);
    expect(selectNextToStart([jobAt("downloading"), a], 1, 0)).toBeNull();
    const waiting = { ...a, nextRetryAt: 9999 };
    expect(selectNextToStart([waiting], 5, 0)).toBeNull();
    expect(selectNextToStart([waiting], 5, 9999)?.id).toBe("a");
    // Scheduled jobs wait for their time (A4).
    const later = { ...a, startAfter: 5000 };
    expect(selectNextToStart([later, b], 5, 1000)?.id).toBe("b");
    expect(selectNextToStart([later], 5, 1000)).toBeNull();
    expect(selectNextToStart([later], 5, 5000)?.id).toBe("a");
    expect(selectNextToStart([{ ...a, startAfter: null }], 5, 0)?.id).toBe("a");
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(99)).toBe(5);
  });

  it("computes capped exponential backoff", () => {
    expect(computeBackoffMs(1)).toBe(2000);
    expect(computeBackoffMs(2)).toBe(4000);
    expect(computeBackoffMs(3)).toBe(8000);
    expect(computeBackoffMs(99)).toBe(30_000);
  });

  it("moves a failed pipeline to postfailed without burning attempts (Phase 4)", () => {
    const active = { ...jobAt("processing"), attempts: 2, destination: "C:\\Vids\\a.mp4" };
    const failed = applyEngineProgress(active, {
      percent: null,
      speed: null,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: "postfailed",
      destination: null,
      errorMessage: "tag: no match",
    });
    expect(failed.status).toBe("postfailed");
    expect(failed.attempts).toBe(2);
    expect(failed.error).toBe("tag: no match");
    expect(failed.destination).toBe("C:\\Vids\\a.mp4");
    expect(isFinished(failed)).toBe(true);
    // Re-download works; a fresh done must not accept a postfail.
    expect(transition(failed, "retry").status).toBe("queued");
    const done = { ...jobAt("done"), error: null };
    expect(applyEngineProgress(done, {
      percent: null,
      speed: null,
      eta: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: "postfailed",
      destination: null,
    }).status).toBe("postfailed");
    expect(canTransition("queued", "postfail")).toBe(false);
  });

  it("orders by priority tier first, then FIFO (Phase 3)", () => {
    const lo = { ...jobAt("queued", 1, "lo"), priority: 0 as const };
    const hi = { ...jobAt("queued", 3, "hi"), priority: 2 as const };
    const mid = jobAt("queued", 2, "mid");
    expect(priorityOf(mid)).toBe(1);
    expect(priorityOf({})).toBe(1);
    expect(priorityOf({ priority: 9 as never })).toBe(1);
    // High jumps the queue even when created last.
    expect(selectNextToStart([lo, mid, hi], 5, 0)?.id).toBe("hi");
    expect(selectNextToStart([lo, mid], 5, 0)?.id).toBe("mid");
    // makeJob defaults to normal and carries an explicit tier.
    expect(makeJob("x", input, 1).priority).toBe(1);
    expect(toStartInput({ ...input, priority: 2 }).priority).toBe(2);
  });

  it("caps gallery-dl jobs separately from the global cap (Phase 3)", () => {    const gal = (id: string, createdAt: number, status: DownloadJob["status"] = "queued") => ({
      ...jobAt(status, createdAt, id),
      engineId: "gallery-dl" as const,
    });
    const running = gal("g0", 0, "downloading");
    const g1 = gal("g1", 1);
    const v1 = jobAt("queued", 2, "v1");
    expect(activeGalleryCount([running, g1, v1])).toBe(1);
    // Gallery slot full (cap 1): the video job still starts.
    expect(selectNextToStart([g1, v1, running], 5, 0, 1)?.id).toBe("v1");
    // Gallery slot free: gallery job starts.
    expect(selectNextToStart([g1, v1], 5, 0, 1)?.id).toBe("g1");
    // Default cap 2 keeps old callers working.
    expect(selectNextToStart([g1, v1], 5, 0)?.id).toBe("g1");
  });

  it("holds starts outside the download window (Phase 3)", () => {
    // Noon and midnight UTC; local-time assertions would be flaky, so the
    // window checks use full-day vs empty vs overnight ranges instead.
    expect(isInDownloadWindow(0, null)).toBe(true);
    expect(isInDownloadWindow(0, { start: null, end: null })).toBe(true);
    expect(isInDownloadWindow(0, { start: "abc", end: null })).toBe(true);
    expect(isInDownloadWindow(0, { start: "09:00", end: "09:00" })).toBe(true);
    // A window covering the whole day is open at any instant.
    expect(isInDownloadWindow(Date.now(), { start: "00:00", end: "23:59" })).toBe(true);
    // Closed window starts nothing but leaves queued jobs queued.
    const a = jobAt("queued", 1, "a");
    const closed: DownloadWindow = { start: "00:00", end: "00:01" };
    const atNoon = new Date(2026, 5, 15, 12, 0).getTime();
    expect(isInDownloadWindow(atNoon, closed)).toBe(false);
    expect(selectNextToStart([a], 5, atNoon, 2, closed)).toBeNull();
    expect(selectNextToStart([a], 5, atNoon, 2, null)?.id).toBe("a");
    // Overnight wrap: 22:00 -> 06:00 is open at 23:00 and 05:00.
    const night: DownloadWindow = { start: "22:00", end: "06:00" };
    expect(isInDownloadWindow(new Date(2026, 5, 15, 23, 0).getTime(), night)).toBe(true);
    expect(isInDownloadWindow(new Date(2026, 5, 15, 5, 0).getTime(), night)).toBe(true);
    expect(isInDownloadWindow(new Date(2026, 5, 15, 12, 0).getTime(), night)).toBe(false);
  });

  it("searches and prunes history", () => {
    const h = [jobAt("done", 3, "c"), jobAt("error", 1, "a"), jobAt("cancelled", 2, "b")];
    expect(searchHistory(h, "buck")).toHaveLength(3);
    expect(searchHistory(h, "youtu.be")).toHaveLength(3);
    expect(searchHistory(h, "nope")).toHaveLength(0);
    expect(pruneHistory(h, 2).map((j) => j.id)).toEqual(["c", "b"]);
  });

  it("filters history by kind, engine and site (Phase 3)", () => {
    const video: DownloadJob = { ...jobAt("done", 1, "v"), extractor: "youtube" };
    const audio: DownloadJob = {
      ...jobAt("done", 2, "a"),
      preset: { kind: "audio", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
      extractor: "soundcloud",
    };
    const gallery: DownloadJob = {
      ...jobAt("done", 3, "g"),
      engineId: "gallery-dl",
      extractor: "flickr",
    };
    const all = [video, audio, gallery];
    const base = { kind: "all", engine: "all", site: "" } as const;
    expect(filterHistory(all, base)).toHaveLength(3);
    expect(filterHistory(all, { ...base, kind: "audio" }).map((j) => j.id)).toEqual(["a"]);
    expect(filterHistory(all, { ...base, engine: "gallery-dl" }).map((j) => j.id)).toEqual([
      "g",
    ]);
    expect(filterHistory(all, { ...base, site: "tube" }).map((j) => j.id)).toEqual(["v"]);
    expect(filterHistory(all, { ...base, site: "  " })).toHaveLength(3);
    // Old rows without an engine read as yt-dlp.
    expect(
      filterHistory(all, { ...base, engine: "yt-dlp" }).map((j) => j.id).sort(),
    ).toEqual(["a", "v"]);
  });

  it("sorts history newest/oldest/title/size (Phase 3)", () => {    const a: DownloadJob = { ...jobAt("done", 1, "a"), title: "Banana", totalBytes: 100 };
    const b: DownloadJob = {
      ...jobAt("done", 2, "b"),
      title: "apple",
      totalBytes: null,
      downloadedBytes: 50,
    };
    const c: DownloadJob = { ...jobAt("done", 3, "c"), title: "Cherry", totalBytes: 300 };
    const all = [a, b, c];
    expect(sortHistory(all, "newest").map((j) => j.id)).toEqual(["c", "b", "a"]);
    expect(sortHistory(all, "oldest").map((j) => j.id)).toEqual(["a", "b", "c"]);
    expect(sortHistory(all, "title").map((j) => j.id)).toEqual(["b", "a", "c"]);
    // Unknown sizes sink to the bottom.
    const d: DownloadJob = { ...jobAt("done", 4, "d"), title: "Date", totalBytes: null };
    expect(sortHistory([d, a, c], "size").map((j) => j.id)).toEqual(["c", "a", "d"]);
  });

  it("filters + sorts 1500 history rows well inside a frame budget (Phase 3 DoD)", () => {
    const big: DownloadJob[] = [];
    for (let i = 0; i < 1500; i += 1) {
      big.push({
        ...jobAt("done", i, `h${String(i)}`),
        title: `Video ${String(i)} rust compilation`,
        extractor: i % 3 === 0 ? "youtube" : "vimeo",
      });
    }
    const started = Date.now();
    const out = sortHistory(
      filterHistory(searchHistory(big, "rust"), { kind: "all", engine: "all", site: "tube" }),
      "size",
    );
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.length).toBeGreaterThan(0);
  });

  it("reorders queued jobs by permuting createdAt (FIFO honors it)", () => {
    const a = jobAt("queued", 1, "a");
    const b = jobAt("queued", 2, "b");
    const c = jobAt("queued", 3, "c");
    const active = jobAt("downloading", 0, "z");
    const moved = reorder([a, b, c, active], "c", 0);
    // createdAt multiset preserved, strictly increasing in the new order.
    expect(moved.map((j) => j.createdAt).sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);
    const queuedOrder = moved
      .filter((j) => j.status === "queued")
      .sort((x, y) => x.createdAt - y.createdAt)
      .map((j) => j.id);
    expect(queuedOrder).toEqual(["c", "a", "b"]);
    expect(selectNextToStart(moved, 5, 0)?.id).toBe("c");
    expect(moved.find((j) => j.id === "z")?.createdAt).toBe(0);
  });

  it("reorder clamps, ignores unknown ids and non-queued jobs", () => {
    const a = jobAt("queued", 1, "a");
    const b = jobAt("queued", 2, "b");
    expect(reorder([a, b], "zzz", 0).map((j) => j.id)).toEqual(["a", "b"]);
    expect(reorder([a, b], "a", 0)).toEqual([a, b]);
    const toEnd = reorder([a, b], "a", 99);
    expect(toEnd.find((j) => j.id === "a")?.createdAt).toBeGreaterThan(
      toEnd.find((j) => j.id === "b")?.createdAt ?? 0,
    );
    const first = reorder([a, b], "b", 0);
    expect(first[0]?.id).toBe("a");
    expect(first[1]?.id).toBe("b");
    // b now sorts first by createdAt.
    expect(first[1]?.createdAt).toBeLessThan(first[0]?.createdAt ?? 0);
    const paused = jobAt("paused", 5, "p");
    expect(reorder([a, paused], "p", 0).map((j) => j.id)).toEqual(["a", "p"]);
  });

  it("reorder breaks createdAt ties so batch-enqueued jobs keep an order", () => {
    const a = jobAt("queued", 7, "a");
    const b = jobAt("queued", 7, "b");
    const c = jobAt("queued", 7, "c");
    const moved = reorder([a, b, c], "c", 0);
    const times = moved.map((j) => j.createdAt);
    expect(new Set(times).size).toBe(3);
    expect(selectNextToStart(moved, 5, 0)?.id).toBe("c");
  });

  it("reports retry countdown seconds only for future backoff deadlines", () => {
    const failed = transition(jobAt("downloading", 1, "f"), "fail", { error: "x", now: 0 });
    expect(failed.nextRetryAt).toBe(2000);
    expect(retryInSeconds(failed, 0)).toBe(2);
    expect(retryInSeconds(failed, 1500)).toBe(1);
    expect(retryInSeconds(failed, 2000)).toBeNull();
    expect(retryInSeconds(jobAt("queued"), 0)).toBeNull();
  });

  it("preserves splitChapters option in makeJob (M4.2)", () => {
    const job = makeJob("j-split", { ...input, splitChapters: true }, 1);
    expect(job.splitChapters).toBe(true);

    const normal = makeJob("j-normal", input, 1);
    expect(normal.splitChapters).toBeUndefined();
  });
});

/**
 * R1 regression guard. The M4.1/M4.2 flags were built correctly by
 * `buildDownloadArgs` but every job -> engine hop kept its own hand-written
 * copy list, so `--live-from-start`, `--wait-for-video`, `--hls-use-mpegts`
 * and `--split-chapters` never reached yt-dlp. These tests pin the round trip.
 */
describe("toStartInput", () => {
  const full: DownloadJobInput = {
    ...input,
    useArchive: true,
    extractor: "youtube",
    videoId: "aqz-KE-bpKQ",
    cookiesFromBrowser: "firefox",
    playlistSubdir: "Playlist/Sub",
    liveStatus: "is_live",
    liveFromStart: true,
    waitForVideo: true,
    splitChapters: true,
    engineId: "gallery-dl",
    priority: 2,
    range: "2-4,7",
  };

  it("carries every optional flag back out of a queued job (R1)", () => {
    const projected = toStartInput(makeJob("j1", full, 1));
    expect(projected).toEqual(full);
  });

  it("keeps makeJob and toStartInput on one allow-list (R1)", () => {
    // Anything makeJob accepts must survive the projection, and vice versa.
    // Minimal inputs default to the yt-dlp engine (Phase 1 back-compat).
    expect(toStartInput(makeJob("j1", full, 1))).toEqual(full);
    expect(toStartInput(makeJob("j2", input, 1))).toEqual({
      ...input,
      engineId: "yt-dlp",
      priority: 1,
    });
  });

  it("drops unknown keys from the untrusted renderer payload (R1)", () => {
    const smuggled = { ...input, evil: "rm -rf" } as unknown as DownloadJobInput;
    expect(toStartInput(makeJob("j3", smuggled, 1))).toEqual({
      ...input,
      engineId: "yt-dlp",
      priority: 1,
    });
  });

  it("omits flags that were never set (older snapshots stay clean)", () => {
    const projected = toStartInput(makeJob("j4", input, 1));
    expect(projected).not.toHaveProperty("splitChapters");
    expect(projected).not.toHaveProperty("liveStatus");
    expect(projected).not.toHaveProperty("useArchive");
  });

  it("treats empty strings and false flags as absent", () => {
    const job = makeJob(
      "j5",
      {
        ...input,
        extractor: "",
        videoId: "",
        cookiesFromBrowser: "",
        playlistSubdir: "",
        liveStatus: null,
        liveFromStart: false,
        waitForVideo: false,
        splitChapters: false,
        useArchive: false,
      },
      1,
    );
    expect(toStartInput(job)).toEqual({ ...input, engineId: "yt-dlp", priority: 1 });
  });

  it("carries a valid gallery --range and drops flag smuggling (v1.8.5)", () => {
    expect(toStartInput(makeJob("jr", { ...input, range: "2-4,7" }, 1)).range).toBe("2-4,7");
    expect(toStartInput(makeJob("jx", { ...input, range: "--config x" }, 1))).not.toHaveProperty(
      "range",
    );
  });
});


describe("jobsEqual", () => {
  it("is true for the same objects in the same order", () => {
    const a = [makeJob("a", input, 1), makeJob("b", input, 2)];
    expect(jobsEqual(a, a)).toBe(true);
    expect(jobsEqual(a, [...a])).toBe(true);
  });

  it("is false when a job object was replaced", () => {
    const a = [makeJob("a", input, 1)];
    const b = [transition(a[0] as DownloadJob, "start")];
    expect(jobsEqual(a, b)).toBe(false);
  });

  it("is false when the order or length differs", () => {
    const a = [makeJob("a", input, 1), makeJob("b", input, 2)];
    expect(jobsEqual(a, [a[1] as DownloadJob, a[0] as DownloadJob])).toBe(false);
    expect(jobsEqual(a, [])).toBe(false);
    expect(jobsEqual([], [])).toBe(true);
  });
});

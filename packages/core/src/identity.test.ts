import { describe, expect, it } from "vitest";
import {
  filterDuplicates,
  findDuplicate,
  identityKey,
} from "./identity.js";
import type { DownloadJob } from "./types.js";

function job(over: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "job-1",
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    title: "Big Buck Bunny",
    preset: { kind: "video", videoPreset: "1080", audioPreset: "MP3", rawFormat: null },
    outputDir: "C:\\Vids",
    status: "done",
    progress: 100,
    speed: null,
    eta: null,
    downloadedBytes: 1,
    totalBytes: 1,
    stage: "done",
    error: null,
    createdAt: 1759365600000,
    attempts: 0,
    nextRetryAt: null,
    destination: "C:\\Vids\\Big Buck Bunny [aqz-KE-bpKQ].mp4",
    ...over,
  };
}

describe("identityKey", () => {
  it("prefers extractor+id when known, else the normalized URL", () => {
    expect(
      identityKey({
        url: "https://youtu.be/aqz-KE-bpKQ",
        extractor: "Youtube",
        videoId: "aqz-KE-bpKQ",
      }),
    ).toBe("youtube::aqz-KE-bpKQ");
    expect(
      identityKey({ url: "youtu.be/aqz-KE-bpKQ", extractor: null, videoId: null }),
    ).toBe("https://youtu.be/aqz-KE-bpKQ");
  });

  it("matches varied URLs for the same video via stored ids", () => {
    const stored = job({ extractor: "youtube", videoId: "aqz-KE-bpKQ" });
    const hit = findDuplicate(
      { url: "https://youtu.be/aqz-KE-bpKQ?si=xyz", extractor: "youtube", videoId: "aqz-KE-bpKQ" },
      [],
      [stored],
    );
    expect(hit?.job.id).toBe("job-1");
  });
});

describe("findDuplicate", () => {
  it("prefers queue hits over history hits", () => {
    const queued = job({ id: "q", status: "downloading" });
    const done = job({ id: "h", status: "done" });
    const target = {
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      extractor: null,
      videoId: null,
    };
    expect(findDuplicate(target, [queued], [done])?.scope).toBe("queue");
    expect(findDuplicate(target, [], [done])?.scope).toBe("history");
    expect(
      findDuplicate({ url: "https://example.com/other", extractor: null, videoId: null }, [queued], [done]),
    ).toBeNull();
  });
});

describe("filterDuplicates", () => {
  const base = {
    queueJobs: [] as DownloadJob[],
    historyJobs: [] as DownloadJob[],
    fileExists: (_p: string): Promise<boolean> => Promise.resolve(false),
    onOpen: (_p: string): Promise<void> => Promise.resolve(),
  };

  it("passes clean targets through with forceFresh=false", async () => {
    const out = await filterDuplicates(
      [{ url: "https://example.com/a", title: "A", extractor: null, videoId: null, fromPlaylist: false }],
      { ...base, ask: () => Promise.reject(new Error("must not ask")) },
    );
    expect(out).toEqual([
      {
        url: "https://example.com/a",
        title: "A",
        extractor: null,
        videoId: null,
        fromPlaylist: false,
        forceFresh: false,
      },
    ]);
  });

  it("skip drops, anyway forces fresh, open opens and drops", async () => {
    const done = job({});
    const targets = [
      { url: done.url, title: "S", extractor: null, videoId: null, fromPlaylist: true },
      { url: done.url, title: "A", extractor: null, videoId: null, fromPlaylist: true },
      { url: done.url, title: "O", extractor: null, videoId: null, fromPlaylist: false },
    ];
    const choices = ["skip", "anyway", "open"] as const;
    let n = 0;
    const opened: string[] = [];
    const out = await filterDuplicates(targets, {
      ...base,
      historyJobs: [done],
      fileExists: () => Promise.resolve(true),
      onOpen: (p) => {
        opened.push(p);
        return Promise.resolve();
      },
      ask: () => {
        const c = choices[n];
        n += 1;
        return Promise.resolve(c ?? "skip");
      },
    });
    expect(out.map((t) => t.title)).toEqual(["A"]);
    expect(out[0]).toMatchObject({ forceFresh: true, fromPlaylist: true });
    expect(opened).toEqual([done.destination]);
  });
});

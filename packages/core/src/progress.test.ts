import { describe, expect, it } from "vitest";
import { parseProgressLine, PROGRESS_TEMPLATE } from "./progress.js";

describe("parseProgressLine", () => {
  it("exposes a machine-parseable template", () => {
    expect(PROGRESS_TEMPLATE).toContain("[GRABBER]");
    expect(PROGRESS_TEMPLATE).toContain("progress.downloaded_bytes");
    expect(PROGRESS_TEMPLATE).toContain("progress._percent_str");
  });

  it("parses our --progress-template lines", () => {
    const p = parseProgressLine(
      "[GRABBER] downloaded:123456 total:987654 percent: 12.5% speed: 2.10MiB/s eta: 00:07",
    );
    expect(p).toMatchObject({
      percent: 12.5,
      downloadedBytes: 123456,
      totalBytes: 987654,
      speed: "2.10MiB/s",
      eta: "00:07",
      stage: "downloading",
    });
  });

  it("maps NA fields to null", () => {
    const p = parseProgressLine("[GRABBER] downloaded:NA total:NA percent: 3.1% speed: NA eta: NA");
    expect(p).toMatchObject({
      percent: 3.1,
      downloadedBytes: null,
      totalBytes: null,
      speed: null,
      eta: null,
    });
  });

  it("handles real-world padding and Unknown values", () => {
    const p = parseProgressLine(
      "[GRABBER] downloaded:1024 total:991017 percent:  0.1% speed: Unknown B/s eta:Unknown",
    );
    expect(p).toMatchObject({ percent: 0.1, speed: null, eta: null });
    const q = parseProgressLine(
      "[GRABBER] downloaded:991017 total:991017 percent:100.0% speed:   1.06MiB/s eta:00:00",
    );
    expect(q).toMatchObject({ percent: 100, speed: "1.06MiB/s", eta: "00:00" });
  });

  it("falls back to classic [download] lines", () => {
    const p = parseProgressLine("[download]  12.3% of ~ 10.00MiB in 00:05 at 2.00MiB/s ETA 00:33");
    expect(p?.percent).toBeCloseTo(12.3);
    expect(p?.stage).toBe("downloading");
  });

  it("detects destination, post-processing, and already-downloaded", () => {
    expect(
      parseProgressLine("[download] Destination: C:\\Vids\\ünicode video – test.mp4")?.stage,
    ).toBe("downloading");
    expect(parseProgressLine('[Merger] Merging formats into "out.mkv"')?.stage).toBe("processing");
    expect(parseProgressLine("[ExtractAudio] Destination: song.mp3")?.stage).toBe("processing");
    expect(parseProgressLine("[SplitChapters] Splitting video by chapters")?.stage).toBe("processing");
    expect(parseProgressLine("[ModifyChapters] Removing chapters from original")?.stage).toBe("processing");
    expect(parseProgressLine("[download] C:\\a.mp4 has already been downloaded")?.stage).toBe(
      "done",
    );
  });

  it("ignores extractor chatter", () => {
    expect(parseProgressLine("[youtube] Extracting URL: https://...")).toBeNull();
    expect(parseProgressLine("")).toBeNull();
    expect(parseProgressLine("[info] Available subtitles")).toBeNull();
  });

  it("parses template line with elapsed field (M4.1)", () => {
    const p = parseProgressLine(
      "[GRABBER] downloaded:5242880 total:10485760 percent: 50.0% speed: 1.00MiB/s eta: 00:05 elapsed: 00:05",
    );
    expect(p).toMatchObject({
      percent: 50.0,
      speed: "1.00MiB/s",
      eta: "00:05",
      elapsed: "00:05",
      stage: "downloading",
    });
  });

  it("treats NA percent as recording with null percent (M4.1)", () => {
    const p = parseProgressLine(
      "[GRABBER] downloaded:1048576 total:NA percent: NA speed: 512.00KiB/s eta: NA elapsed: 00:01:23",
    );
    expect(p).toMatchObject({
      percent: null,
      downloadedBytes: 1048576,
      totalBytes: null,
      speed: "512.00KiB/s",
      eta: null,
      elapsed: "00:01:23",
      stage: "recording",
    });
  });

  it("handles classic live download lines (M4.1)", () => {
    const p = parseProgressLine("[download] 4.50MiB at 1.00MiB/s (00:04:30)");
    expect(p).toMatchObject({
      percent: null,
      speed: "1.00MiB/s",
      elapsed: "00:04:30",
      stage: "recording",
    });
  });
});

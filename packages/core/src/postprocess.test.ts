import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings.js";
import {
  buildCompressArgs,
  buildConvertArgs,
  buildRcloneArgs,
  buildRecordingQuery,
  buildWhisperArgs,
  classifyPostFile,
  convertOutputPath,
  hasBasicTags,
  hasEncoder,
  hintFromFilename,
  isAudioFile,
  isImageFile,
  isVideoFile,
  parseHwaccels,
  parseMediaSummary,
  parseRecordingResponse,
  pickH264Encoder,
  pickTagCandidate,
  rcloneDest,
  srtBasePath,
  stepsFor,
  wavTempPath,
} from "./postprocess.js";
import type { PostProcessSettings } from "./types.js";

const POST: PostProcessSettings = DEFAULT_SETTINGS.postProcess;

describe("postprocess file classes", () => {
  it("detects image/audio/video by extension", () => {
    expect(isImageFile("C:\\dl\\a.webp")).toBe(true);
    expect(isImageFile("C:\\dl\\a.avif")).toBe(true);
    expect(isImageFile("C:\\dl\\a.mp3")).toBe(false);
    expect(isAudioFile("C:\\dl\\a.flac")).toBe(true);
    expect(isVideoFile("C:\\dl\\a.mkv")).toBe(true);
    expect(classifyPostFile("C:\\dl\\a.zip").class).toBe("other");
    expect(classifyPostFile("C:\\dl\\noext").class).toBe("other");
  });
});

describe("stepsFor", () => {
  const img = classifyPostFile("a.jpg");
  const aud = classifyPostFile("a.mp3");
  const vid = classifyPostFile("a.mp4");
  const on: PostProcessSettings = {
    ...POST,
    convertImages: true,
    autoTagAudio: true,
    compressVideo: "balanced",
  };

  it("selects steps per kind and engine", () => {
    expect(
      stepsFor({ kind: "video", engine: "gallery-dl", files: [img], settings: on, packaged: false }),
    ).toEqual(["convert-image"]);
    expect(
      stepsFor({ kind: "audio", engine: "yt-dlp", files: [aud], settings: on, packaged: false }),
    ).toEqual(["tag-audio"]);
    expect(
      stepsFor({ kind: "video", engine: "yt-dlp", files: [vid], settings: on, packaged: false }),
    ).toEqual(["compress-video"]);
  });

  it("skips convert when gallery already packaged the outputs", () => {
    expect(
      stepsFor({ kind: "video", engine: "gallery-dl", files: [img], settings: on, packaged: true }),
    ).toEqual([]);
  });

  it("is empty when everything is off", () => {
    expect(
      stepsFor({ kind: "video", engine: "yt-dlp", files: [img, aud, vid], settings: POST, packaged: false }),
    ).toEqual([]);
  });
});

describe("convert/compress argv", () => {
  it("derives a sibling output path with the target format", () => {
    expect(convertOutputPath("C:\\dl\\a.webp", "jpg")).toBe("C:\\dl\\a.fluxdl.jpg");
    expect(convertOutputPath("C:\\dl\\a.png", "png")).toBe("C:\\dl\\a.fluxdl.png");
  });

  it("builds a verified image-convert command", () => {
    const argv = buildConvertArgs("in.webp", "out.fluxdl.jpg", {
      format: "jpg",
      quality: 85,
      maxDim: 2048,
      stripExif: true,
    });
    expect(argv.slice(0, 4)).toEqual(["-hide_banner", "-y", "-i", "in.webp"]);
    expect(argv).toContain("-map_metadata");
    expect(argv).toContain("-1");
    expect(argv[argv.length - 1]).toBe("out.fluxdl.jpg");
    expect(argv.join(" ")).toContain("min(2048,iw)");
  });

  it("builds compress commands per preset with the picked encoder", () => {
    const small = buildCompressArgs("in.mp4", "out.mp4", "small", "libx264");
    expect(small).toContain("-crf");
    expect(small.join(" ")).toContain("min(1280,iw)");
    const hw = buildCompressArgs("in.mp4", "out.mp4", "balanced", "h264_nvenc");
    expect(hw).toContain("h264_nvenc");
    expect(hw).toContain("-cq");
    const archive = buildCompressArgs("in.mp4", "out.mp4", "archive", "libx264");
    expect(archive).toContain("libx265");
  });
});

describe("musicbrainz", () => {
  it("builds a lucene recording query", () => {
    expect(buildRecordingQuery("Bohemian Rhapsody", "Queen")).toBe(
      'recording:"Bohemian Rhapsody" AND artist:"Queen"',
    );
    expect(buildRecordingQuery("X", null)).toBe('recording:"X"');
    expect(buildRecordingQuery('a"b', "c")).toBe('recording:"ab" AND artist:"c"');
  });

  it("derives a search hint from a finished filename", () => {
    expect(hintFromFilename("C:\\Vids\\My Song [abc123].mp3")).toEqual({
      title: "My Song",
      artist: null,
    });
    expect(hintFromFilename("/dl/track.flac")).toEqual({ title: "track", artist: null });
  });

  it("builds whisper + rclone commands", () => {
    expect(buildWhisperArgs("m.bin", "a.wav", "C:\\dl\\t.fluxdl")).toEqual([
      "-m",
      "m.bin",
      "-f",
      "a.wav",
      "-osrt",
      "-of",
      "C:\\dl\\t.fluxdl",
    ]);
    expect(rcloneDest("remote:backups/", "C:\\Vids\\a.mp4")).toBe("remote:backups/a.mp4");
    expect(rcloneDest("remote:backups", "C:\\Vids\\a.mp4")).toBe("remote:backups/a.mp4");
    expect(buildRcloneArgs("C:\\Vids\\a.mp4", "remote:backups")).toEqual([
      "copyto",
      "C:\\Vids\\a.mp4",
      "remote:backups/a.mp4",
      "--auto-confirm",
      "-q",
    ]);
    expect(wavTempPath("C:\\dl\\a.mp3")).toBe("C:\\dl\\a.fluxdl-16k.wav");
    expect(srtBasePath("C:\\dl\\a.mp3")).toBe("C:\\dl\\a.fluxdl");
  });

  // Shape mirrors a real ws/2/recording response (captured 2026-10-08 shape).
  const payload = {
    recordings: [
      {
        id: "mbid-low",
        title: "Song",
        score: 62,
        "artist-credit": [{ name: "Someone" }],
        releases: [{ id: "r1", title: "Album", date: "2020-01-01" }],
      },
      {
        id: "mbid-high",
        title: "Song (Remastered)",
        score: 97,
        "artist-credit": [{ name: "Band" }, { name: "Feat" }],
        releases: [],
      },
      { nope: true },
    ],
  };

  it("parses candidates best-first and drops garbage", () => {
    const out = parseRecordingResponse(payload);
    expect(out.map((c) => c.mbid)).toEqual(["mbid-high", "mbid-low"]);
    expect(out[0]).toMatchObject({
      title: "Song (Remastered)",
      artist: "Band, Feat",
      score: 97,
      release: null,
    });
    expect(out[1]).toMatchObject({ release: "Album", releaseMbid: "r1", date: "2020-01-01" });
    expect(parseRecordingResponse(null)).toEqual([]);
    expect(parseRecordingResponse({})).toEqual([]);
  });

  it("auto-applies at threshold, surfaces best-below otherwise", () => {
    const out = parseRecordingResponse(payload);
    expect(pickTagCandidate(out).auto?.mbid).toBe("mbid-high");
    expect(pickTagCandidate(out, 99).auto).toBeNull();
    expect(pickTagCandidate(out, 99).bestBelow?.mbid).toBe("mbid-high");
    expect(pickTagCandidate([])).toEqual({ auto: null, bestBelow: null });
  });
});

describe("media summary", () => {
  // Shape mirrors real `ffprobe -show_format -show_streams -of json`.
  const payload = {
    format: {
      filename: "a.mp4",
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: "65.5",
      size: "1234567",
      tags: { title: "T", artist: "A" },
    },
    streams: [
      { index: 0, codec_name: "h264", codec_type: "video", width: 1280, height: 720, avg_frame_rate: "30/1" },
      { index: 1, codec_name: "aac", codec_type: "audio", bit_rate: "128000", sample_rate: "44100" },
    ],
  };

  it("parses streams, format and tags", () => {
    const s = parseMediaSummary(payload);
    expect(s).toMatchObject({
      durationSec: 65.5,
      sizeBytes: 1234567,
      video: { codec: "h264", width: 1280, height: 720, fps: "30/1" },
      audio: { codec: "aac", bitrate: 128000, sampleRate: 44100 },
    });
    expect(s?.tags["title"]).toBe("T");
    expect(hasBasicTags(s ?? null as never)).toBe(true);
  });

  it("never throws on garbage and reports missing tags", () => {
    expect(parseMediaSummary(null)).toBeNull();
    expect(parseMediaSummary({ streams: "x" })).toMatchObject({ video: null, audio: null });
    const bare = parseMediaSummary({ format: {}, streams: [] });
    expect(bare !== null && hasBasicTags(bare)).toBe(false);
  });
});

describe("hw encoder pick", () => {
  const encoders = [
    " V....D av1_nvenc            NVIDIA NVENC av1 encoder (codec av1)",
    " V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)",
    " V..... h264_qsv             H.264 / AVC (codec h264)",
    " V..... libx264              libx264 H.264 / AVC / MPEG-4 AVC",
  ].join("\n");

  it("parses hwaccels output", () => {
    expect(parseHwaccels("Hardware acceleration methods:\ncuda\nqsv\n")).toEqual(["cuda", "qsv"]);
  });

  it("prefers NVENC, then QSV, then AMF, else libx264", () => {
    expect(hasEncoder(encoders, "h264_nvenc")).toBe(true);
    expect(hasEncoder(encoders, "h264_amf")).toBe(false);
    expect(pickH264Encoder(["cuda", "qsv"], encoders)).toBe("h264_nvenc");
    expect(pickH264Encoder(["qsv"], encoders)).toBe("h264_qsv");
    expect(pickH264Encoder(["vulkan"], encoders)).toBe("libx264");
    expect(pickH264Encoder([], "")).toBe("libx264");
  });
});

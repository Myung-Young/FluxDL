import { describe, expect, it } from "vitest";
import {
  PACK_MANIFESTS,
  discoverNm3u8dl,
  discoverRclone,
  discoverStreamlink,
  discoverWhisper,
  isAllowedPackUrl,
  isManifestUrl,
  isRevoked,
  packManifest,
  parseSha256sums,
  sanitizeFileStem,
  whisperModel,
} from "./packs.js";
function release(tag: string, names: readonly (readonly [string, string, number])[], draft = false) {
  return {
    tag_name: tag,
    draft,
    assets: names.map(([name, url, size]) => ({
      name,
      browser_download_url: url,
      size,
    })),
  };
}

describe("pack manifests", () => {
  it("pins four Tier A packs with verified URLs", () => {
    expect(PACK_MANIFESTS.map((p) => p.id)).toEqual([
      "streamlink",
      "n-m3u8dl-re",
      "whisper",
      "rclone",
    ]);
    for (const p of PACK_MANIFESTS) {
      expect(isAllowedPackUrl(p.url)).toBe(true);
      expect(p.version.length).toBeGreaterThan(0);
    }
    expect(packManifest("rclone")?.sumsAsset).toBe("SHA256SUMS");
    expect(packManifest("nope")).toBeNull();
  });

  it("knows whisper model files and sizes", () => {
    expect(whisperModel("tiny")?.sizeBytes).toBe(75_000_000);
    expect(whisperModel("small")?.url).toContain("ggml-small.bin");
    expect(isAllowedPackUrl(whisperModel("base")?.url ?? "")).toBe(true);
    expect(whisperModel("xl")).toBeNull();
  });

  it("allowlists only GitHub + Hugging Face", () => {    expect(isAllowedPackUrl("https://github.com/a/b.zip")).toBe(true);
    expect(isAllowedPackUrl("https://objects.githubusercontent.com/x")).toBe(true);
    expect(isAllowedPackUrl("https://huggingface.co/a/b.bin")).toBe(true);
    expect(isAllowedPackUrl("https://cdn-lfs.huggingface.co/x")).toBe(true);
    expect(isAllowedPackUrl("https://evil.com/a.zip")).toBe(false);
    expect(isAllowedPackUrl("not a url")).toBe(false);
    expect(isAllowedPackUrl("http://127.0.0.1:9/a.zip")).toBe(true);
  });

  it("spots direct stream manifests", () => {
    expect(isManifestUrl("https://cdn.example.com/live/stream.m3u8")).toBe(true);
    expect(isManifestUrl("https://cdn.example.com/live/stream.m3u8?token=abc")).toBe(true);
    expect(isManifestUrl("https://cdn.example.com/v.mpd#frag")).toBe(true);
    expect(isManifestUrl("https://www.youtube.com/watch?v=x")).toBe(false);
    expect(isManifestUrl("https://example.com/a.m3u8x")).toBe(false);
  });
});

describe("release discovery", () => {
  const mixed = [
    release("8.6.2-1", [
      ["streamlink-8.6.2-1-py314-x86_64.zip", "https://dl/1", 84_000_000],
      ["streamlink-8.6.2-1-py314-x86_64.exe", "https://dl/2", 64_000_000],
    ]),
    release("v0.6.0-beta", [
      ["N_m3u8DL-RE_v0.6.0-beta_win-x64_20260629.zip", "https://dl/3", 5_500_000],
      ["N_m3u8DL-RE_v0.6.0-beta_win-arm64_20260629.zip", "https://dl/4", 5_000_000],
    ]),
    release("b5454", [["whisper-bin-x64.zip", "https://dl/5", 8_900_000]], false),
  ];

  it("picks the portable streamlink zip", () => {
    const found = discoverStreamlink(mixed);
    expect(found).toMatchObject({ version: "8.6.2-1", url: "https://dl/1" });
  });

  it("picks win-x64 over arm64 for N_m3u8DL-RE (version = tag)", () => {
    const found = discoverNm3u8dl(mixed);
    expect(found).toMatchObject({ version: "v0.6.0-beta", url: "https://dl/3" });
  });

  it("picks the whisper CPU x64 nightly", () => {
    const found = discoverWhisper(mixed);
    expect(found).toMatchObject({ version: "b5454", url: "https://dl/5" });
  });

  it("picks the rclone zip plus its SHA256SUMS sibling", () => {
    const rels = [
      release("v1.75.1", [
        ["rclone-v1.75.1-windows-amd64.zip", "https://dl/6", 20_000_000],
        ["SHA256SUMS", "https://dl/sums", 999],
      ]),
    ];
    expect(discoverRclone(rels)).toMatchObject({
      version: "v1.75.1",
      url: "https://dl/6",
      sumsUrl: "https://dl/sums",
    });
    expect(discoverRclone([])).toBeNull();
  });

  it("skips drafts and garbage", () => {
    expect(discoverStreamlink([{ tag_name: "", draft: false, assets: [] }])).toBeNull();
    expect(discoverStreamlink("nope")).toBeNull();
    const drafted = [
      release("9.9.9", [["streamlink-9.9.9-9-py314-x86_64.zip", "https://dl/9", 1]], true),
    ];
    expect(discoverStreamlink(drafted)).toBeNull();
  });
});

describe("checksums + revoke", () => {
  it("parses SHA256SUMS entries", () => {
    const text = [
      "abc123  other.zip",
      "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb *whisper-bin-x64.zip",
    ].join("\n");
    expect(parseSha256sums(text, "whisper-bin-x64.zip")).toBe(
      "6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb",
    );
    expect(parseSha256sums(text, "missing.zip")).toBeNull();
  });

  it("blocks revoked versions only", () => {
    const revoked = { packs: { whisper: ["b0000"] } };
    expect(isRevoked(revoked, "whisper", "b0000")).toBe(true);
    expect(isRevoked(revoked, "whisper", "b5454")).toBe(false);
    expect(isRevoked(revoked, "rclone", "b0000")).toBe(false);
  });
});

describe("sanitizeFileStem", () => {
  it("makes Windows-safe output stems", () => {
    expect(sanitizeFileStem("Big Buck Bunny [abc]")).toBe("Big Buck Bunny [abc]");
    expect(sanitizeFileStem('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(sanitizeFileStem("trailing...   ")).toBe("trailing");
    expect(sanitizeFileStem("CON")).toBe("_CON");
    expect(sanitizeFileStem("   ")).toBe("download");
    expect(sanitizeFileStem("x".repeat(200)).length).toBe(120);
    expect(sanitizeFileStem("a\u0007b")).toBe("ab");
  });
});

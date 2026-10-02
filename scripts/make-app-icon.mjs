#!/usr/bin/env node
/**
 * M7 app icon (deterministic, no deps).
 * Renders the FluxDL chip + down-arrow at 16/32/48/256px and packs them
 * as PNG-compressed entries in apps/desktop/resources/icons/app.ico
 * (Vista+ compatible). Installer/portable art beyond this lands only
 * if installer UX demands it.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZES = [16, 32, 48, 256];
const BG = [26, 26, 30, 255];
const FG = [228, 228, 231, 255];

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const TABLE = crcTable();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function insideChip(x, y, s) {
  const r = Math.round(s * 0.22);
  if (x >= r && x < s - r) return true;
  if (y >= r && y < s - r) return true;
  const corners = [
    [r, r],
    [s - 1 - r, r],
    [r, s - 1 - r],
    [s - 1 - r, s - 1 - r],
  ];
  return corners.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
}

function isArrow(x, y, s) {
  const cx = Math.floor(s / 2);
  const w = Math.max(1, Math.round(s * 0.0625));
  const yTop = Math.round(s * 0.56);
  const yBot = Math.round(s * 0.75);
  if (x >= cx - w && x <= cx + w - 1 && y >= Math.round(s * 0.19) && y <= yTop) {
    return true;
  }
  if (y >= yTop && y <= yBot) {
    const half = Math.max(
      1,
      Math.round(((yBot - y + 1) * Math.round(s * 0.22)) / (yBot - yTop + 1)),
    );
    return x >= cx - half && x <= cx + half - 1;
  }
  return false;
}

function renderPng(s) {
  const raw = Buffer.alloc(s * (1 + s * 4));
  let o = 0;
  for (let y = 0; y < s; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < s; x += 1) {
      const px = !insideChip(x, y, s) ? [0, 0, 0, 0] : isArrow(x, y, s) ? FG : BG;
      raw[o] = px[0];
      raw[o + 1] = px[1];
      raw[o + 2] = px[2];
      raw[o + 3] = px[3];
      o += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function toIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  const bodies = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    bodies.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...bodies]);
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "apps", "desktop", "resources", "icons");
await mkdir(outDir, { recursive: true });
const images = SIZES.map((size) => ({ size, png: renderPng(size) }));
await writeFile(join(outDir, "app.ico"), toIco(images));
console.log(`[icon] wrote app.ico (${images.map((i) => i.size).join("/")})`);

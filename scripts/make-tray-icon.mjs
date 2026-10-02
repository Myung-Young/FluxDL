#!/usr/bin/env node
/**
 * M3 tray icon generator (deterministic, no deps).
 * Draws a 32x32 dark chip + light down-arrow and writes a real PNG
 * (manual zlib + CRC) to apps/desktop/resources/icons/tray.png.
 * Full app icon set (.ico, installer art) lands in M7.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 32;
const RADIUS = 7;
// dark chip, light glyph — visible on light and dark taskbars
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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function insideChip(x, y) {
  const r = RADIUS;
  const s = SIZE;
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

function isArrow(x, y) {
  // shaft
  if (x >= 14 && x <= 17 && y >= 6 && y <= 18) return true;
  // down-triangle head, rows 18..24
  if (y >= 18 && y <= 24) {
    const half = 25 - y;
    return x >= 16 - half && x <= 15 + half;
  }
  return false;
}

function render() {
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  let o = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < SIZE; x += 1) {
      const px = !insideChip(x, y) ? [0, 0, 0, 0] : isArrow(x, y) ? FG : BG;
      raw[o] = px[0];
      raw[o + 1] = px[1];
      raw[o + 2] = px[2];
      raw[o + 3] = px[3];
      o += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png;
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "apps", "desktop", "resources", "icons", "tray.png");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, render());
console.log(`[icon] wrote ${out}`);

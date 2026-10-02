#!/usr/bin/env node
/**
 * M1.5 taskbar overlay-dot generator (deterministic, no deps).
 * Draws a 16x16 success-green dot and writes a real PNG (manual zlib + CRC)
 * to apps/desktop/resources/icons/overlay-dot.png. Shown in the Windows
 * taskbar overlay slot when downloads finish while the window is hidden.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const SIZE = 16;
const DOT = [74, 222, 128, 255]; // green-400: visible on light and dark chrome

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

function render() {
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  const c = SIZE / 2 - 0.5;
  const r = SIZE / 2 - 1;
  let o = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[o] = 0;
    o += 1;
    for (let x = 0; x < SIZE; x += 1) {
      const inside = (x - c) ** 2 + (y - c) ** 2 <= r * r;
      const px = inside ? DOT : [0, 0, 0, 0];
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
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "apps", "desktop", "resources", "icons", "overlay-dot.png");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, render());
console.log(`[icon] wrote ${out}`);

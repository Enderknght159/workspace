import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SIZE = 256;
const pixels = Buffer.alloc(SIZE * SIZE * 4);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function roundedDistance(x, y, inset, radius) {
  const cx = clamp(x, inset + radius, SIZE - inset - radius);
  const cy = clamp(y, inset + radius, SIZE - inset - radius);
  return Math.hypot(x - cx, y - cy);
}

function segmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / lengthSquared, 0, 1);
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

const W_POINTS = [
  [70, 78],
  [99, 178],
  [128, 108],
  [157, 178],
  [186, 78],
];

const BG_TOP = [14, 24, 19];
const BG_BOTTOM = [22, 36, 29];
const GOLD = [217, 184, 120];

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const index = (y * SIZE + x) * 4;
    const edgeDistance = roundedDistance(x, y, 10, 46);
    if (edgeDistance > 46) {
      pixels[index + 3] = 0;
      continue;
    }
    const bg = mix(BG_TOP, BG_BOTTOM, y / SIZE);
    pixels[index] = bg[0];
    pixels[index + 1] = bg[1];
    pixels[index + 2] = bg[2];
    pixels[index + 3] = 255;

    const borderAlpha = edgeDistance > 43 ? clamp((edgeDistance - 43) / 3, 0, 1) * 0.55 : 0;
    if (borderAlpha > 0) {
      pixels[index] = Math.round(bg[0] + (GOLD[0] - bg[0]) * borderAlpha);
      pixels[index + 1] = Math.round(bg[1] + (GOLD[1] - bg[1]) * borderAlpha);
      pixels[index + 2] = Math.round(bg[2] + (GOLD[2] - bg[2]) * borderAlpha);
    }

    let distance = Number.POSITIVE_INFINITY;
    for (let segment = 0; segment < W_POINTS.length - 1; segment += 1) {
      const [ax, ay] = W_POINTS[segment];
      const [bx, by] = W_POINTS[segment + 1];
      distance = Math.min(distance, segmentDistance(x, y, ax, ay, bx, by));
    }
    const half = 7.5;
    if (distance <= half + 1.5) {
      const alpha = clamp(half + 1.5 - distance, 0, 1);
      pixels[index] = Math.round(pixels[index] + (GOLD[0] - pixels[index]) * alpha);
      pixels[index + 1] = Math.round(pixels[index + 1] + (GOLD[1] - pixels[index + 1]) * alpha);
      pixels[index + 2] = Math.round(pixels[index + 2] + (GOLD[2] - pixels[index + 2]) * alpha);
    }
  }
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = join(process.cwd(), 'build');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'icon.png');
writeFileSync(outFile, png);
console.log(`wrote ${outFile} (${png.length} bytes)`);

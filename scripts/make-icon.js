'use strict';

/**
 * Generates build/icon.ico with no image dependencies.
 *
 * The artwork is drawn into a raw RGBA buffer at 4x and box-downsampled for
 * anti-aliasing. Sizes up to 64px are stored as BMP (widest tooling support,
 * including NSIS); 128 and 256 are stored as PNG to keep the file small.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SS = 4; // supersample factor
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ------------------------------------------------------------- drawing */

function draw(size) {
  const n = size * SS;
  const px = new Float64Array(n * n * 4);

  const put = (x, y, r, g, b, a) => {
    if (a <= 0) return;
    const i = (y * n + x) * 4;
    const inv = 1 - a;
    px[i] = px[i] * inv + r * a;
    px[i + 1] = px[i + 1] * inv + g * a;
    px[i + 2] = px[i + 2] * inv + b * a;
    px[i + 3] = px[i + 3] * inv + a;
  };

  // Rounded-square background with a vertical blue gradient.
  const radius = n * 0.22;
  const inRounded = (x, y) => {
    const dx = Math.max(radius - x, 0, x - (n - 1 - radius));
    const dy = Math.max(radius - y, 0, y - (n - 1 - radius));
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < n; y++) {
    const t = y / (n - 1);
    const r = 74 + (47 - 74) * t;
    const g = 127 + (92 - 127) * t;
    const b = 181 + (143 - 181) * t;
    for (let x = 0; x < n; x++) {
      if (inRounded(x, y)) put(x, y, r, g, b, 1);
    }
  }

  // Quadrant cross — the Eisenhower matrix motif.
  const mid = n / 2;
  const lineHalf = Math.max(n * 0.008, SS * 0.5);
  const inset = n * 0.17;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!inRounded(x, y)) continue;
      const onV = Math.abs(x - mid) <= lineHalf && y > inset && y < n - inset;
      const onH = Math.abs(y - mid) <= lineHalf && x > inset && x < n - inset;
      if (onV || onH) put(x, y, 255, 255, 255, 0.38);
    }
  }

  // Two "cards": a large one in the urgent+important quadrant, a small one
  // in the opposite corner.
  const disc = (cx, cy, rad, alpha) => {
    for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y++) {
      for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rad * rad) put(x, y, 255, 255, 255, alpha);
      }
    }
  };
  disc(n * 0.68, n * 0.32, n * 0.16, 0.96);
  disc(n * 0.34, n * 0.67, n * 0.095, 0.62);

  // Box-downsample to the target size.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * n + (x * SS + sx)) * 4;
          r += px[i];
          g += px[i + 1];
          b += px[i + 2];
          a += px[i + 3];
        }
      }
      const count = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / count);
      out[o + 1] = Math.round(g / count);
      out[o + 2] = Math.round(b / count);
      out[o + 3] = Math.round((a / count) * 255);
    }
  }
  return out;
}

/* ---------------------------------------------------------------- PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function toPng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------- BMP */

function toBmp(rgba, size) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR image + AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = ((size - 1 - y) * size + x) * 4; // BMP rows are bottom-up
      xor[dst] = rgba[src + 2]; // B
      xor[dst + 1] = rgba[src + 1]; // G
      xor[dst + 2] = rgba[src]; // R
      xor[dst + 3] = rgba[src + 3]; // A
    }
  }

  // 1bpp AND mask, rows padded to 4 bytes. Fully transparent pixels are masked.
  const rowBytes = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (rgba[(y * size + x) * 4 + 3] === 0) {
        and[(size - 1 - y) * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return Buffer.concat([header, xor, and]);
}

/* ---------------------------------------------------------------- ICO */

function buildIco(images) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e[2] = 0; // palette size
    e[3] = 0;
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += img.data.length;
  }
  return Buffer.concat([dir, ...entries, ...images.map((i) => i.data)]);
}

/* --------------------------------------------------------------- main */

const images = SIZES.map((size) => {
  const rgba = draw(size);
  return { size, data: size >= 128 ? toPng(rgba, size) : toBmp(rgba, size) };
});

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });

const icoPath = path.join(outDir, 'icon.ico');
fs.writeFileSync(icoPath, buildIco(images));

// A 256px PNG is handy for docs and for any non-Windows packaging.
fs.writeFileSync(path.join(outDir, 'icon.png'), toPng(draw(256), 256));

console.log(`wrote ${icoPath} (${SIZES.join(', ')}px)`);

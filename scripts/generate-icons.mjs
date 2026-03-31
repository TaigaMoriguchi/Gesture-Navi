import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ICON_SIZES = [16, 32, 48, 128];

const BG_COLOR = [10, 122, 90, 255];
const RING_COLOR = [230, 255, 247, 255];
const DOT_COLOR = [120, 246, 210, 255];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const iconDir = path.join(rootDir, 'assets/icons');

function setPixel(buffer, size, x, y, rgba) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return;
  }
  const idx = (y * size + x) * 4;
  buffer[idx] = rgba[0];
  buffer[idx + 1] = rgba[1];
  buffer[idx + 2] = rgba[2];
  buffer[idx + 3] = rgba[3];
}

function insideRoundedRect(x, y, size, radius) {
  const px = x + 0.5;
  const py = y + 0.5;
  const min = radius;
  const max = size - radius;

  if (px >= min && px <= max) {
    return py >= 0 && py <= size;
  }
  if (py >= min && py <= max) {
    return px >= 0 && px <= size;
  }

  const cx = px < min ? min : max;
  const cy = py < min ? min : max;
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
}

function paintRect(buffer, size, cx, cy, width, height, rgba) {
  const halfW = width / 2;
  const halfH = height / 2;
  const x0 = Math.floor(cx - halfW);
  const x1 = Math.ceil(cx + halfW);
  const y0 = Math.floor(cy - halfH);
  const y1 = Math.ceil(cy + halfH);

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      setPixel(buffer, size, x, y, rgba);
    }
  }
}

function createIconRgba(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.2;
  const center = (size - 1) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!insideRoundedRect(x, y, size, radius)) {
        continue;
      }
      setPixel(rgba, size, x, y, BG_COLOR);

      const px = x + 0.5;
      const py = y + 0.5;
      const distance = Math.hypot(px - center, py - center);
      const inner = size * 0.24;
      const outer = size * 0.34;
      if (distance >= inner && distance <= outer) {
        setPixel(rgba, size, x, y, RING_COLOR);
      }
    }
  }

  const tickLong = Math.max(2, Math.round(size * 0.12));
  const tickShort = Math.max(2, Math.round(size * 0.05));
  const tickOffset = size * 0.32;

  paintRect(rgba, size, center, center - tickOffset, tickShort, tickLong, RING_COLOR);
  paintRect(rgba, size, center, center + tickOffset, tickShort, tickLong, RING_COLOR);
  paintRect(rgba, size, center - tickOffset, center, tickLong, tickShort, RING_COLOR);
  paintRect(rgba, size, center + tickOffset, center, tickLong, tickShort, RING_COLOR);

  const dotRadius = Math.max(1, Math.round(size * 0.07));
  for (let y = -dotRadius; y <= dotRadius; y += 1) {
    for (let x = -dotRadius; x <= dotRadius; x += 1) {
      if (x * x + y * y <= dotRadius * dotRadius) {
        setPixel(rgba, size, Math.round(center + x), Math.round(center + y), DOT_COLOR);
      }
    }
  }

  return rgba;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

export async function generateIcons() {
  await mkdir(iconDir, { recursive: true });

  await Promise.all(
    ICON_SIZES.map(async (size) => {
      const rgba = createIconRgba(size);
      const png = encodePng(size, size, rgba);
      const outPath = path.join(iconDir, `icon${size}.png`);
      await writeFile(outPath, png);
    })
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateIcons().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

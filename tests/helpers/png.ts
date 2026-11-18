import { deflateSync, crc32 } from 'zlib';

/** Minimal RGBA PNG encoder (test fixtures only). */
export function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/** Deterministic 16x16 test texture: a flat colour derived from the name, with a darker frame and a diagonal so orientation is visible. */
export function swatch(name: string, size = 16, alphaCut = false): Uint8Array {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  const r = 70 + ((h >>> 0) % 150), g = 70 + ((h >>> 8) % 150), b = 70 + ((h >>> 16) % 150);
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
    const diag = x === y;
    const k = edge ? 0.55 : diag ? 1.25 : 1;
    px[o] = Math.min(255, r * k); px[o + 1] = Math.min(255, g * k); px[o + 2] = Math.min(255, b * k); px[o + 3] = 255;
    if (alphaCut && !edge && (x + y) % 5 === 0) px[o + 3] = 0;
  }
  return px;
}

import { inflate } from './zip';

/** Decoded RGBA8 image (row 0 = top). */
export interface RawImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Decode a PNG (non-interlaced; 1/2/4/8/16-bit; all colour types) to RGBA8. */
export async function decodePng(bytes: Uint8Array): Promise<RawImage> {
  if (!PNG_SIG.every((b, i) => bytes[i] === b)) throw new Error('Not a PNG file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let w = 0, h = 0, depth = 8, ctype = 6, interlace = 0;
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12);
      depth = bytes[p + 16]; ctype = bytes[p + 17]; interlace = bytes[p + 20];
    } else if (type === 'PLTE') plte = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const total = idat.reduce((n, c) => n + c.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const c of idat) { joined.set(c, o); o += c.length; }
  const raw = await inflate(joined, 'deflate');

  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (!channels) throw new Error(`Unsupported PNG colour type ${ctype}`);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  const out = new Uint8Array(w * h * 4);

  /** Undo the scanline filters of a (sub-)image of pw × ph pixels starting at `off` in `raw`. */
  const unfilter = (off: number, stride: number, ph: number): Uint8Array => {
    const pix = new Uint8Array(stride * ph);
    for (let y = 0; y < ph; y++) {
      const f = raw[off + y * (stride + 1)];
      const src = off + y * (stride + 1) + 1;
      const dst = y * stride;
      for (let x = 0; x < stride; x++) {
        const v = raw[src + x];
        const a = x >= bpp ? pix[dst + x - bpp] : 0;
        const b = y > 0 ? pix[dst - stride + x] : 0;
        const c = x >= bpp && y > 0 ? pix[dst - stride + x - bpp] : 0;
        let r: number;
        switch (f) {
          case 0: r = v; break;
          case 1: r = v + a; break;
          case 2: r = v + b; break;
          case 3: r = v + ((a + b) >> 1); break;
          case 4: {
            const pp = a + b - c;
            const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
            r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            break;
          }
          default: throw new Error(`Bad PNG filter ${f}`);
        }
        pix[dst + x] = r & 255;
      }
    }
    return pix;
  };

  // [x0, y0, dx, dy] of each pass: a single full pass, or Adam7
  const passes: [number, number, number, number][] = interlace
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]];
  let off = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((w - x0) / dx), ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = (pw * channels * depth + 7) >> 3;
    const pix = unfilter(off, stride, ph);
    off += ph * (stride + 1);
    const sample = (row: number, idx: number): number => {
      // idx-th sample of a row for depths 1/2/4/8/16 (16 → high byte)
      if (depth === 8) return pix[row + idx];
      if (depth === 16) return pix[row + idx * 2];
      const bitPos = idx * depth;
      const byte = pix[row + (bitPos >> 3)];
      return (byte >> (8 - depth - (bitPos & 7))) & ((1 << depth) - 1);
    };
    for (let y = 0; y < ph; y++) {
      const row = y * stride;
      for (let x = 0; x < pw; x++) {
        const i = ((y0 + y * dy) * w + (x0 + x * dx)) * 4;
        if (ctype === 6) {
          out[i] = sample(row, x * 4); out[i + 1] = sample(row, x * 4 + 1);
          out[i + 2] = sample(row, x * 4 + 2); out[i + 3] = sample(row, x * 4 + 3);
        } else if (ctype === 2) {
          out[i] = sample(row, x * 3); out[i + 1] = sample(row, x * 3 + 1); out[i + 2] = sample(row, x * 3 + 2);
          out[i + 3] = 255;
          if (trns && trns.length >= 6 && depth === 8 &&
              out[i] === trns[1] && out[i + 1] === trns[3] && out[i + 2] === trns[5]) out[i + 3] = 0;
        } else if (ctype === 0) {
          const g = sample(row, x);
          const gv = Math.round(g * scale);
          out[i] = out[i + 1] = out[i + 2] = gv; out[i + 3] = 255;
          if (trns && trns.length >= 2 && g === trns[1]) out[i + 3] = 0;
        } else if (ctype === 4) {
          const g = sample(row, x * 2);
          out[i] = out[i + 1] = out[i + 2] = g; out[i + 3] = sample(row, x * 2 + 1);
        } else {
          const idx = sample(row, x);
          if (!plte) throw new Error('PNG palette missing');
          out[i] = plte[idx * 3]; out[i + 1] = plte[idx * 3 + 1]; out[i + 2] = plte[idx * 3 + 2];
          out[i + 3] = trns && idx < trns.length ? trns[idx] : 255;
        }
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** Decode a TGA (types 2/3 uncompressed, 10/11 RLE; 8/24/32 bpp). */
export function decodeTga(b: Uint8Array): RawImage {
  const idLen = b[0], cmapType = b[1], type = b[2];
  if (cmapType !== 0 || ![2, 3, 10, 11].includes(type)) throw new Error('Unsupported TGA variant');
  const w = b[12] | (b[13] << 8), h = b[14] | (b[15] << 8), bpp = b[16], desc = b[17];
  const bytesPP = bpp >> 3;
  if (![1, 3, 4].includes(bytesPP)) throw new Error('Unsupported TGA bit depth');
  const topFirst = (desc & 0x20) !== 0;
  const rle = type >= 10;
  const px = new Uint8Array(w * h * bytesPP);
  let p = 18 + idLen, o = 0;
  while (o < px.length) {
    if (rle) {
      const hd = b[p++]; const n = (hd & 127) + 1;
      if (hd & 128) { for (let i = 0; i < n; i++) for (let k = 0; k < bytesPP; k++) px[o++] = b[p + k]; p += bytesPP; }
      else for (let i = 0; i < n * bytesPP; i++) px[o++] = b[p++];
    } else { px.set(b.subarray(p, p + px.length)); break; }
  }
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = topFirst ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const s = (sy * w + x) * bytesPP, d = (y * w + x) * 4;
      if (bytesPP === 1) { out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = 255; }
      else { out[d] = px[s + 2]; out[d + 1] = px[s + 1]; out[d + 2] = px[s]; out[d + 3] = bytesPP === 4 ? px[s + 3] : 255; }
    }
  }
  return { width: w, height: h, data: out };
}

export async function decodeImage(bytes: Uint8Array): Promise<RawImage> {
  if (PNG_SIG.every((b, i) => bytes[i] === b)) return decodePng(bytes);
  return decodeTga(bytes);
}

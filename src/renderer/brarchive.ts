/**
 * Reader for Mojang's `.brarchive` container, used by the vanilla Bedrock
 * resource pack shipped with the game.
 *
 * Layout (little-endian):
 *   u64  magic            0x267052B1A025277D
 *   u32  entryCount
 *   u32  version          (1)
 *   entryCount × 256-byte records:
 *       u8   nameLength
 *       u8[247] name      (UTF-8, zero padded)
 *       u32  offset       (relative to the end of the record table)
 *       u32  size
 *   data
 */
export const BRARCHIVE_MAGIC = [0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26];
const RECORD = 256;
const HEADER = 16;

export interface BrarchiveEntry {
  name: string;
  data: Uint8Array;
}

export function isBrarchive(bytes: Uint8Array): boolean {
  return bytes.length >= HEADER && BRARCHIVE_MAGIC.every((b, i) => bytes[i] === b);
}

export function readBrarchive(bytes: Uint8Array): BrarchiveEntry[] {
  if (!isBrarchive(bytes)) throw new Error('Not a .brarchive file (bad magic)');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(8, true);
  const base = HEADER + count * RECORD;
  if (base > bytes.length) throw new Error('Corrupt .brarchive: record table exceeds file size');
  const dec = new TextDecoder();
  const out: BrarchiveEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = HEADER + i * RECORD;
    const nameLen = bytes[o];
    const name = dec.decode(bytes.subarray(o + 1, o + 1 + nameLen));
    const off = dv.getUint32(o + 248, true);
    const size = dv.getUint32(o + 252, true);
    if (base + off + size > bytes.length) throw new Error(`Corrupt .brarchive: entry "${name}" out of range`);
    out.push({ name, data: bytes.subarray(base + off, base + off + size) });
  }
  return out;
}

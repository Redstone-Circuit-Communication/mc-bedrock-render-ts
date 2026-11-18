/**
 * Minimal little-endian NBT reader (the flavour used by Bedrock Edition files)
 * and a small writer (used by tests / tooling to create .mcstructure files).
 */

export type NbtValue =
  | number
  | bigint
  | string
  | NbtValue[]
  | NbtCompound
  | Int8Array
  | Int32Array
  | BigInt64Array;
export interface NbtCompound {
  [key: string]: NbtValue;
}

export const TAG = {
  End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6,
  ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12,
} as const;

const utf8 = new TextDecoder('utf-8');

class Reader {
  private view: DataView;
  pos = 0;
  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8() { return this.view.getUint8(this.pos++); }
  i8() { return this.view.getInt8(this.pos++); }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  i64() { const v = this.view.getBigInt64(this.pos, true); this.pos += 8; return v; }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  str() {
    const n = this.u16();
    const s = utf8.decode(this.bytes.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
  payload(type: number): NbtValue {
    switch (type) {
      case TAG.Byte: return this.i8();
      case TAG.Short: return this.i16();
      case TAG.Int: return this.i32();
      case TAG.Long: return this.i64();
      case TAG.Float: return this.f32();
      case TAG.Double: return this.f64();
      case TAG.ByteArray: {
        const n = this.i32();
        const a = new Int8Array(n);
        for (let i = 0; i < n; i++) a[i] = this.i8();
        return a;
      }
      case TAG.String: return this.str();
      case TAG.List: {
        const t = this.u8();
        const n = this.i32();
        const out: NbtValue[] = new Array(Math.max(n, 0));
        for (let i = 0; i < n; i++) out[i] = this.payload(t);
        return out;
      }
      case TAG.Compound: {
        const o: NbtCompound = {};
        for (;;) {
          const t = this.u8();
          if (t === TAG.End) break;
          const k = this.str();
          o[k] = this.payload(t);
        }
        return o;
      }
      case TAG.IntArray: {
        const n = this.i32();
        const a = new Int32Array(n);
        for (let i = 0; i < n; i++) a[i] = this.i32();
        return a;
      }
      case TAG.LongArray: {
        const n = this.i32();
        const a = new BigInt64Array(n);
        for (let i = 0; i < n; i++) a[i] = this.i64();
        return a;
      }
      default:
        throw new Error(`Unknown NBT tag type ${type} at byte ${this.pos - 1}`);
    }
  }
}

/** Parse a little-endian NBT document. Returns the root name and value. */
export function readNbtLE(data: Uint8Array): { name: string; value: NbtCompound } {
  const r = new Reader(data);
  const t = r.u8();
  if (t !== TAG.Compound) throw new Error(`Root NBT tag must be a compound, got ${t}`);
  const name = r.str();
  return { name, value: r.payload(TAG.Compound) as NbtCompound };
}

// ---------------------------------------------------------------- writer ---

/** Tagged values for the writer (plain JS numbers are ambiguous in NBT). */
export type Tagged =
  | { t: 'byte' | 'short' | 'int' | 'float' | 'double'; v: number }
  | { t: 'long'; v: bigint }
  | { t: 'string'; v: string }
  | { t: 'intarray'; v: number[] }
  | { t: 'list'; of: Tagged['t']; v: Tagged[] }
  | { t: 'compound'; v: { [k: string]: Tagged } };

export const T = {
  byte: (v: number): Tagged => ({ t: 'byte', v }),
  short: (v: number): Tagged => ({ t: 'short', v }),
  int: (v: number): Tagged => ({ t: 'int', v }),
  float: (v: number): Tagged => ({ t: 'float', v }),
  double: (v: number): Tagged => ({ t: 'double', v }),
  long: (v: bigint): Tagged => ({ t: 'long', v }),
  string: (v: string): Tagged => ({ t: 'string', v }),
  intArray: (v: number[]): Tagged => ({ t: 'intarray', v }),
  list: (of: Tagged['t'], v: Tagged[]): Tagged => ({ t: 'list', of, v }),
  compound: (v: { [k: string]: Tagged }): Tagged => ({ t: 'compound', v }),
};

const TYPE_ID: Record<Tagged['t'], number> = {
  byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, string: 8,
  list: 9, compound: 10, intarray: 11,
};

export function writeNbtLE(root: { [k: string]: Tagged }, rootName = ''): Uint8Array {
  const out: number[] = [];
  const enc = new TextEncoder();
  const buf = new DataView(new ArrayBuffer(8));
  const push = (n: number) => { for (let i = 0; i < n; i++) out.push(buf.getUint8(i)); };
  const wStr = (s: string) => {
    const b = enc.encode(s);
    buf.setUint16(0, b.length, true); push(2);
    for (const x of b) out.push(x);
  };
  const wPayload = (tag: Tagged): void => {
    switch (tag.t) {
      case 'byte': buf.setInt8(0, tag.v); push(1); break;
      case 'short': buf.setInt16(0, tag.v, true); push(2); break;
      case 'int': buf.setInt32(0, tag.v, true); push(4); break;
      case 'long': buf.setBigInt64(0, tag.v, true); push(8); break;
      case 'float': buf.setFloat32(0, tag.v, true); push(4); break;
      case 'double': buf.setFloat64(0, tag.v, true); push(8); break;
      case 'string': wStr(tag.v); break;
      case 'intarray':
        buf.setInt32(0, tag.v.length, true); push(4);
        for (const n of tag.v) { buf.setInt32(0, n, true); push(4); }
        break;
      case 'list':
        out.push(TYPE_ID[tag.of]);
        buf.setInt32(0, tag.v.length, true); push(4);
        for (const e of tag.v) wPayload(e);
        break;
      case 'compound':
        for (const [k, v] of Object.entries(tag.v)) {
          out.push(TYPE_ID[v.t]); wStr(k); wPayload(v);
        }
        out.push(0);
        break;
    }
  };
  out.push(TAG.Compound);
  wStr(rootName);
  wPayload({ t: 'compound', v: root });
  return Uint8Array.from(out);
}

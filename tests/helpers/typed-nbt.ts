/** A little-endian NBT reader that keeps every tag's type, for comparing written files with game-saved ones. */
export type TypedTag =
  | { t: 'byte' | 'short' | 'int' | 'float' | 'double'; v: number }
  | { t: 'long'; v: bigint }
  | { t: 'string'; v: string }
  | { t: 'bytearray' | 'intarray' | 'longarray'; v: (number | bigint)[] }
  | { t: 'list'; of: string; v: TypedTag[] }
  | { t: 'compound'; v: Record<string, TypedTag> };

const NAMES = ['end', 'byte', 'short', 'int', 'long', 'float', 'double', 'bytearray', 'string', 'list', 'compound', 'intarray', 'longarray'];

export function readTypedNbt(bytes: Uint8Array): TypedTag {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const str = () => { const n = view.getUint16(p, true); p += 2; const s = new TextDecoder().decode(bytes.subarray(p, p + n)); p += n; return s; };
  const payload = (type: number): TypedTag => {
    const t = NAMES[type] as any;
    switch (type) {
      case 1: return { t, v: view.getInt8(p++) };
      case 2: { const v = view.getInt16(p, true); p += 2; return { t, v }; }
      case 3: { const v = view.getInt32(p, true); p += 4; return { t, v }; }
      case 4: { const v = view.getBigInt64(p, true); p += 8; return { t, v }; }
      case 5: { const v = view.getFloat32(p, true); p += 4; return { t, v }; }
      case 6: { const v = view.getFloat64(p, true); p += 8; return { t, v }; }
      case 8: return { t, v: str() };
      case 7: case 11: case 12: {
        const n = view.getInt32(p, true); p += 4;
        const v: (number | bigint)[] = [];
        for (let i = 0; i < n; i++) {
          if (type === 7) v.push(view.getInt8(p++));
          else if (type === 11) { v.push(view.getInt32(p, true)); p += 4; }
          else { v.push(view.getBigInt64(p, true)); p += 8; }
        }
        return { t, v };
      }
      case 9: {
        const of = view.getUint8(p++); const n = view.getInt32(p, true); p += 4;
        const v: TypedTag[] = [];
        for (let i = 0; i < n; i++) v.push(payload(of));
        return { t: 'list', of: NAMES[of], v };
      }
      case 10: {
        const v: Record<string, TypedTag> = {};
        for (;;) { const tt = view.getUint8(p++); if (tt === 0) break; const k = str(); v[k] = payload(tt); }
        return { t: 'compound', v };
      }
      default: throw new Error(`NBT tag ${type} at ${p}`);
    }
  };
  const root = view.getUint8(p++); str();
  return payload(root);
}

/** A compound's fields. */
export const fields = (tag: TypedTag | undefined): Record<string, TypedTag> => (tag?.t === 'compound' ? tag.v : {});
/** A list's items. */
export const items = (tag: TypedTag | undefined): TypedTag[] => (tag?.t === 'list' ? tag.v : []);

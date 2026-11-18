import { NbtCompound, NbtValue, T, Tagged, readNbtLE, writeNbtLE } from './nbt';

export type StateValue = string | number;

export interface PaletteEntry {
  /** Full identifier, e.g. `minecraft:observer` */
  name: string;
  states: Record<string, StateValue>;
  version?: number;
}

/**
 * A parsed Bedrock `.mcstructure`.
 *
 * Blocks are stored as palette indices in `layers[layer][index]` where
 * `index = (x * sizeY + y) * sizeZ + z`. A value of `-1` means "no block here"
 * (layer 0: leave untouched / air, layer 1: no liquid / waterlogging).
 */
export class McStructure {
  constructor(
    public readonly size: [number, number, number],
    public readonly origin: [number, number, number],
    public readonly formatVersion: number,
    public readonly palette: PaletteEntry[],
    public readonly layers: Int32Array[],
    public readonly blockEntities: Map<number, NbtCompound>,
    public readonly entities: NbtCompound[],
  ) {}

  index(x: number, y: number, z: number): number {
    return (x * this.size[1] + y) * this.size[2] + z;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.size[0] && y < this.size[1] && z < this.size[2];
  }

  /** Palette index at a position, or -1 when empty / out of bounds. */
  paletteIndexAt(x: number, y: number, z: number, layer = 0): number {
    if (!this.inBounds(x, y, z)) return -1;
    const l = this.layers[layer];
    return l ? l[this.index(x, y, z)] : -1;
  }

  blockAt(x: number, y: number, z: number, layer = 0): PaletteEntry | null {
    const i = this.paletteIndexAt(x, y, z, layer);
    return i >= 0 ? this.palette[i] ?? null : null;
  }

  blockEntityAt(x: number, y: number, z: number): NbtCompound | undefined {
    return this.blockEntities.get(this.index(x, y, z));
  }

  /** Iterate every non-empty cell of a layer. */
  forEachBlock(cb: (x: number, y: number, z: number, entry: PaletteEntry, paletteIndex: number) => void, layer = 0): void {
    const [sx, sy, sz] = this.size;
    const l = this.layers[layer];
    if (!l) return;
    for (let x = 0; x < sx; x++)
      for (let y = 0; y < sy; y++)
        for (let z = 0; z < sz; z++) {
          const pi = l[(x * sy + y) * sz + z];
          if (pi < 0) continue;
          const e = this.palette[pi];
          if (e) cb(x, y, z, e, pi);
        }
  }
}

const isObj = (v: NbtValue | undefined): v is NbtCompound =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);

function asInts(v: NbtValue | undefined, n: number, what: string): number[] {
  if (!Array.isArray(v) || v.length < n) throw new Error(`Invalid .mcstructure: "${what}" must be a list of ${n} ints`);
  return v.slice(0, n).map(Number);
}

/** Decode a little-endian-NBT `.mcstructure` file (already gunzipped). */
export function parseMcStructure(data: ArrayBuffer | Uint8Array): McStructure {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const { value: root } = readNbtLE(bytes);

  const size = asInts(root.size, 3, 'size') as [number, number, number];
  const origin = (Array.isArray(root.structure_world_origin)
    ? asInts(root.structure_world_origin, 3, 'structure_world_origin')
    : [0, 0, 0]) as [number, number, number];
  const formatVersion = typeof root.format_version === 'number' ? root.format_version : 1;

  const s = root.structure;
  if (!isObj(s)) throw new Error('Invalid .mcstructure: missing "structure" compound');

  // --- palette (prefer "default")
  const palettes = s.palette;
  if (!isObj(palettes)) throw new Error('Invalid .mcstructure: missing "structure.palette"');
  const chosen = isObj(palettes.default) ? palettes.default : (Object.values(palettes).find(isObj) as NbtCompound | undefined);
  if (!chosen) throw new Error('Invalid .mcstructure: no palette found');
  const rawPalette = chosen.block_palette;
  if (!Array.isArray(rawPalette)) throw new Error('Invalid .mcstructure: missing "block_palette"');
  const palette: PaletteEntry[] = rawPalette.map((e) => {
    const c = e as NbtCompound;
    const states: Record<string, StateValue> = {};
    if (isObj(c.states)) {
      for (const [k, v] of Object.entries(c.states)) {
        if (typeof v === 'number' || typeof v === 'string') states[k] = v;
        else if (typeof v === 'bigint') states[k] = Number(v);
      }
    }
    return { name: String(c.name), states, version: typeof c.version === 'number' ? c.version : undefined };
  });

  // --- layers
  const volume = size[0] * size[1] * size[2];
  const rawLayers = s.block_indices;
  if (!Array.isArray(rawLayers)) throw new Error('Invalid .mcstructure: missing "block_indices"');
  const layers = rawLayers.map((l) => {
    const arr = Int32Array.from(l as number[]);
    if (arr.length !== volume) throw new Error(`Invalid .mcstructure: layer has ${arr.length} entries, expected ${volume}`);
    return arr;
  });

  // --- block entities
  const blockEntities = new Map<number, NbtCompound>();
  const posData = chosen.block_position_data;
  if (isObj(posData)) {
    for (const [k, v] of Object.entries(posData)) {
      if (isObj(v) && isObj(v.block_entity_data)) blockEntities.set(Number(k), v.block_entity_data);
    }
  }

  const entities = Array.isArray(s.entities) ? (s.entities.filter(isObj) as NbtCompound[]) : [];
  return new McStructure(size, origin, formatVersion, palette, layers, blockEntities, entities);
}

/** Same as {@link parseMcStructure} but also accepts gzip-compressed input. */
export async function loadMcStructure(data: ArrayBuffer | Uint8Array): Promise<McStructure> {
  let bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(bytes as unknown as BufferSource);
    w.close();
    bytes = new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  return parseMcStructure(bytes);
}

// ---------------------------------------------------------------- builder ---

export interface BuildOptions {
  size: [number, number, number];
  origin?: [number, number, number];
  /** Block for each cell; return `null`/`undefined` for air. */
  blockAt: (x: number, y: number, z: number) => { name: string; states?: Record<string, StateValue> } | null | undefined;
  /** Optional block entity data (stored under `block_position_data`). */
  blockEntityAt?: (x: number, y: number, z: number) => Record<string, Tagged> | null | undefined;
  /** Optional entity compounds (`identifier`, `Pos`, `Rotation`, …). */
  entities?: Record<string, Tagged>[];
  /** Optional liquid layer (e.g. waterlogging). */
  liquidAt?: (x: number, y: number, z: number) => { name: string; states?: Record<string, StateValue> } | null | undefined;
}

/** Create the bytes of a valid `.mcstructure` file. Handy for tests and demos. */
export function buildMcStructure(opts: BuildOptions): Uint8Array {
  const [sx, sy, sz] = opts.size;
  const palette: { name: string; states: Record<string, StateValue> }[] = [];
  const lookup = new Map<string, number>();
  const intern = (b: { name: string; states?: Record<string, StateValue> }) => {
    const states = b.states ?? {};
    const key = b.name + JSON.stringify(Object.entries(states).sort());
    let i = lookup.get(key);
    if (i === undefined) { i = palette.length; palette.push({ name: b.name, states }); lookup.set(key, i); }
    return i;
  };
  const air = intern({ name: 'minecraft:air' });
  const l0: number[] = [];
  const l1: number[] = [];
  const posData: { [k: string]: Tagged } = {};
  for (let x = 0; x < sx; x++)
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++) {
        const be = opts.blockEntityAt?.(x, y, z);
        if (be) posData[String((x * sy + y) * sz + z)] = T.compound({ block_entity_data: T.compound(be) });
        const b = opts.blockAt(x, y, z);
        l0.push(b ? intern(b) : air);
        const w = opts.liquidAt?.(x, y, z);
        l1.push(w ? intern(w) : -1);
      }
  const stateTag = (v: StateValue): Tagged =>
    typeof v === 'string' ? T.string(v) : T.byte(v);
  const paletteTag = T.list('compound', palette.map((p) =>
    T.compound({
      name: T.string(p.name),
      states: T.compound(Object.fromEntries(Object.entries(p.states).map(([k, v]) => [k, stateTag(v)]))),
      version: T.int(18168865),
    })));
  return writeNbtLE({
    format_version: T.int(1),
    size: T.list('int', opts.size.map((n) => T.int(n))),
    structure: T.compound({
      block_indices: T.list('list', [
        T.list('int', l0.map((n) => T.int(n))),
        T.list('int', l1.map((n) => T.int(n))),
      ]),
      entities: T.list('compound', (opts.entities ?? []).map((e) => T.compound(e))),
      palette: T.compound({
        default: T.compound({
          block_palette: paletteTag,
          block_position_data: T.compound(posData),
        }),
      }),
    }),
    structure_world_origin: T.list('int', (opts.origin ?? [0, 0, 0]).map((n) => T.int(n))),
  });
}

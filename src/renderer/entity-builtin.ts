import { BlockRegistry } from './blockutil';
import { M, GeoBone, GeoCube, Geometry, GeometryLibrary, IDENT, mulM, rotYM, scaleM, translateM } from './geometry';
import { Dir, V3 } from './models';
import { NbtCompound } from './nbt';
import { ResourceStack } from './resources';
import type { EntityDraw, EntityInstance } from './entity';

/**
 * Entities Bedrock draws from code instead of a pack model: boats, paintings, dropped items, falling blocks and
 * primed TNT. The shapes are the vanilla outlines; every texture comes from the resource pack.
 */

const ALL: Dir[] = ['north', 'south', 'east', 'west', 'up', 'down'];
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : d);
const isObj = (v: unknown): v is NbtCompound => typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);

type FaceMap = Partial<Record<Dir, { uv: [number, number]; uv_size: [number, number] }>>;
const cube = (origin: V3, size: V3, uv: GeoCube['uv']): GeoCube => ({ origin, size, uv, inflate: 0, mirror: false });
const bone = (name: string, cubes: GeoCube[], extra: Partial<GeoBone> = {}): GeoBone =>
  ({ name, pivot: [0, 0, 0], rotation: [0, 0, 0], bindPose: [0, 0, 0], neverRender: false, cubes, ...extra });

/** Box-UV rectangles of Bedrock's cube layout for a box of size (dx, dy, dz) at texture offset (u, v). */
function boxRects(u: number, v: number, dx: number, dy: number, dz: number) {
  return {
    n: { uv: [u + dz, v + dz] as [number, number], uv_size: [dx, dy] as [number, number] },
    s: { uv: [u + 2 * dz + dx, v + dz] as [number, number], uv_size: [dx, dy] as [number, number] },
    e: { uv: [u + dz + dx, v + dz] as [number, number], uv_size: [dz, dy] as [number, number] },
    w: { uv: [u, v + dz] as [number, number], uv_size: [dz, dy] as [number, number] },
    u: { uv: [u + dz, v] as [number, number], uv_size: [dx, dz] as [number, number] },
    d: { uv: [u + dz + dx, v] as [number, number], uv_size: [dx, dz] as [number, number] },
  };
}

// ------------------------------------------------------------------- boat ---

/**
 * `geometry.boat` — not shipped in the pack. Ported from the vanilla model: a 28×16×3 bottom plank and four walls
 * (two long ones, a 16-wide bow and an 18-wide stern), texture 128×64. Built along +x and turned so the bow is
 * the entity's front (−z). On every plank the inside uses the texture's "north" rectangle and the outside its "south".
 */
export function boatGeometry(chest = false): Geometry {
  const R = (u: number, v: number, dx: number, dy: number, dz: number, m: Partial<Record<Dir, 'n' | 's' | 'e' | 'w' | 'u' | 'd'>>): GeoCube['uv'] => {
    const r = boxRects(u, v, dx, dy, dz);
    const out: FaceMap = {};
    for (const d of ALL) { const k = m[d]; if (k) out[d] = r[k]; }
    return out;
  };
  const bottom = cube([-14, 0, -8], [28, 3, 16], R(0, 0, 28, 16, 3, { up: 'n', down: 's', north: 'u', south: 'd', east: 'e', west: 'w' }));
  const right = cube([-14, 3, 8], [28, 6, 2], R(0, 35, 28, 6, 2, { north: 'n', south: 's', up: 'u', down: 'd', east: 'e', west: 'w' }));
  const left = cube([-14, 3, -10], [28, 6, 2], R(0, 43, 28, 6, 2, { south: 'n', north: 's', up: 'u', down: 'd', east: 'e', west: 'w' }));
  const bow = cube([14, 3, -8], [2, 6, 16], R(0, 27, 16, 6, 2, { west: 'n', east: 's', up: 'u', down: 'd', north: 'e', south: 'w' }));
  const stern = cube([-16, 3, -9], [2, 6, 18], R(0, 19, 18, 6, 2, { east: 'n', west: 's', up: 'u', down: 'd', north: 'e', south: 'w' }));
  const parts: [string, GeoCube[]][] = [['bottom', [bottom]], ['right', [right]], ['left', [left]], ['bow', [bow]], ['stern', [stern]]];
  // The rest of the model is placed exactly as the vanilla Java model parts (ModelPart offset + rotation) are. This frame is
  // Java's turned 180° about x and raised 6 px — (x, y, z) → (x, 6 − y, −z), the walls above follow it — so a part's pivot is
  // its offset mapped that way, its cubes are mapped about the pivot, and a Java rotation (a, b, c) is rotM(−a, −b, c).
  // On a cube the texture's north rectangle lands on the +z face (box UV, the same mapping as the walls').
  const J: Partial<Record<Dir, 'n' | 's' | 'e' | 'w' | 'u' | 'd'>> = { north: 's', south: 'n', up: 'u', down: 'd', east: 'e', west: 'w' };
  const deg = 180 / Math.PI;
  const part = (u: number, v: number, offset: V3, rot: V3, boxes: [V3, V3][]): GeoCube[] => {
    const pivot: V3 = [offset[0], 6 - offset[1], -offset[2]];
    return boxes.map(([from, size]) => ({
      ...cube([pivot[0] + from[0], pivot[1] - from[1] - size[1], pivot[2] - from[2] - size[2]], size, R(u, v, size[0], size[1], size[2], J)),
      ...(rot.some((a) => a !== 0) ? { rotation: [-rot[0] * deg, -rot[1] * deg, rot[2] * deg] as V3, pivot } : {}),
    }));
  };
  // Paddles (BoatModel `left_paddle` / `right_paddle`: an 18 px shaft and a 6×7 blade, tilted 11.25°) at the angle a boat that is
  // not being rowed shows: BoatModel.animatePaddle with rowing time 0 gives x = lerp(−60°, −15°, ½) and y = lerp(−45°, 45°, (sin 1 + 1) / 2),
  // the right one turned round (180° − y). They were missing.
  const restX = -37.5 / deg, restY = (-45 + 90 * ((Math.sin(1) + 1) / 2)) / deg, tilt = 0.19634955;
  parts.push(
    ['left_paddle', part(62, 0, [3, -5, 9], [restX, restY, tilt], [[[-1, 0, -5], [2, 2, 18]], [[-1.001, -3, 8], [1, 6, 7]]])],
    ['right_paddle', part(62, 20, [3, -5, -9], [restX, Math.PI - restY, tilt], [[[-1, 0, -5], [2, 2, 18]], [[0.001, -3, 8], [1, 6, 7]]])],
  );
  // Chest boat (ChestBoatModel): the chest stands toward the stern, turned −90° so its front and the 2×4 lock face the rider; the lid's
  // box UV starts at (0, 59) (it was read one row too high, at 58, and the chest sat 4 px forward with its front turned sideways)
  if (chest) parts.push(
    ['chest_bottom', part(0, 76, [-2, -5, -6], [0, -Math.PI / 2, 0], [[[0, 0, 0], [12, 8, 12]]])],
    ['chest_lid', part(0, 59, [-2, -9, -6], [0, -Math.PI / 2, 0], [[[0, 0, 0], [12, 4, 12]]])],
    ['chest_lock', part(0, 59, [-1, -6, -1], [0, -Math.PI / 2, 0], [[[0, 0, 0], [2, 4, 1]]])],
  );
  return {
    id: chest ? 'geometry.chest_boat' : 'geometry.boat', texW: 128, texH: chest ? 128 : 64,
    bones: [bone('boat', [], { rotation: [0, 90, 0] }), ...parts.map(([n, c]) => bone(n, c, { parent: 'boat' }))],
  };
}

/** `Variant` of a boat → wood key. Newer packs name their textures `<wood>_boat`, `boat_<wood>`, `chest_boat_<wood>`, `bamboo_raft`. */
const BOAT_VARIANTS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'darkoak', 'mangrove', 'bamboo', 'cherry', 'paleoak', 'poplar'];

/** An existing boat texture for a wood key, whatever naming the pack uses; `undefined` when none exists. */
export function boatTexturePath(stack: ResourceStack, key: string, chest: boolean): string | undefined {
  const wood = key.replace(/^dark_oak$/, 'darkoak').replace(/^pale_oak$/, 'paleoak');
  const alt = wood.replace('darkoak', 'dark_oak').replace('paleoak', 'pale_oak');
  const names = chest
    ? [`chest_boat_${wood}`, `chest_boat_${alt}`, `${wood}_chest_boat`, `${alt}_chest_boat`]
    : [`boat_${wood}`, `${wood}_boat`, `${alt}_boat`, `boat_${alt}`, ...(wood === 'bamboo' ? ['bamboo_raft'] : [])];
  for (const n of names) if (stack.get(`textures/entity/boat/${n}.png`) || stack.get(`textures/entity/boat/${n}.tga`)) return `textures/entity/boat/${n}`;
  return undefined;
}

// --------------------------------------------------------------- painting ---

/** Vanilla paintings: [x, y, w, h] in atlas pixels (16 px per block) of `textures/painting/kz`. */
const PAINTINGS: Record<string, [number, number, number, number]> = {
  kebab: [0, 0, 16, 16], aztec: [16, 0, 16, 16], alban: [32, 0, 16, 16], aztec2: [48, 0, 16, 16], bomb: [64, 0, 16, 16], plant: [80, 0, 16, 16], wasteland: [96, 0, 16, 16],
  pool: [0, 32, 32, 16], courbet: [32, 32, 32, 16], sea: [64, 32, 32, 16], sunset: [96, 32, 32, 16], creebet: [128, 32, 32, 16],
  wanderer: [0, 64, 16, 32], graham: [16, 64, 16, 32], fighters: [0, 96, 64, 32],
  match: [0, 128, 32, 32], bust: [32, 128, 32, 32], stage: [64, 128, 32, 32], void: [96, 128, 32, 32], skullandroses: [128, 128, 32, 32], wither: [160, 128, 32, 32],
  earth: [0, 160, 32, 32], wind: [32, 160, 32, 32], fire: [64, 160, 32, 32], water: [96, 160, 32, 32],
  skeleton: [192, 64, 64, 48], donkeykong: [192, 112, 64, 48],
  pointer: [0, 192, 64, 64], pigscene: [64, 192, 64, 64], burningskull: [128, 192, 64, 64],
};

function paintingGeometry(motive: string): Geometry | null {
  const r = PAINTINGS[motive.toLowerCase().replace(/^minecraft:/, '').replace(/[_\s]/g, '')];
  if (!r) return null;
  const [x, y, w, h] = r;
  const back = { uv: [200, 8] as [number, number], uv_size: [4, 4] as [number, number] };
  const front = { uv: [x, y] as [number, number], uv_size: [w, h] as [number, number] };
  const uv: FaceMap = { north: front, south: back, east: back, west: back, up: back, down: back };
  return { id: `painting.${motive}`, texW: 256, texH: 256, bones: [bone('painting', [cube([-w / 2, -h / 2, -0.5], [w, h, 1], uv)])] };
}

// ----------------------------------------------------------- flat sprites ---

function spriteGeometry(size: number): Geometry {
  const full = { uv: [0, 0] as [number, number], uv_size: [16, 16] as [number, number] };
  const uv: FaceMap = { north: full, south: full };
  return { id: 'sprite', texW: 16, texH: 16, bones: [bone('sprite', [cube([-size / 2, 0, -0.5], [size, size, 1], uv)])] };
}

/** `textures/items/<icon>` for an item identifier, through `item_texture.json` when the pack has it. */
export function itemTexturePath(stack: ResourceStack, name: string): string | null {
  const n = name.replace(/^minecraft:/, '');
  const table = itemTable(stack);
  const e = table.get(n) ?? table.get(n.replace(/_/g, ''));
  if (e && stack.get(e + '.png')) return e;
  for (const cand of [`textures/items/${n}`, `textures/items/${n}_item`]) if (stack.get(cand + '.png') || stack.get(cand + '.tga')) return cand;
  return null;
}

const itemTables = new WeakMap<ResourceStack, Map<string, string>>();
function itemTable(stack: ResourceStack): Map<string, string> {
  let t = itemTables.get(stack);
  if (t) return t;
  t = new Map();
  for (const p of stack.packs) {
    let j: any;
    try { j = p.json('textures/item_texture.json'); } catch { continue; }
    for (const [k, v] of Object.entries<any>(j?.texture_data ?? {})) {
      const tex = v?.textures;
      const path = typeof tex === 'string' ? tex : Array.isArray(tex) ? (typeof tex[0] === 'string' ? tex[0] : tex[0]?.path) : tex?.path;
      if (typeof path === 'string') t.set(k.toLowerCase(), path);
    }
  }
  itemTables.set(stack, t);
  return t;
}

// ------------------------------------------------------ block-shaped bodies ---

/**
 * A block model turned into one geometry per texture file (falling blocks, TNT, block items). Only axis-aligned
 * elements are converted; anything fancier falls back to a plain cube textured with the first face's texture.
 */
function blockBodies(stack: ResourceStack, registry: BlockRegistry, name: string, states: Record<string, any>, size: number): { path: string; geometry: Geometry }[] {
  const ctx = { name: name.replace(/^minecraft:/, ''), states, x: 0, y: 0, z: 0, neighbor: () => null, isOpaque: () => false, resources: stack };
  let model: any;
  // the registry's own box models (HoloPrint's free quads are not converted to entity cubes)
  try { model = registry.resolveOwn(ctx as any); } catch { model = undefined; }
  const groups = new Map<string, GeoCube[]>();
  const add = (path: string, c: GeoCube) => { (groups.get(path) ?? groups.set(path, []).get(path)!).push(c); };
  const k = size / 16;
  const els: any[] = model?.elements?.length ? model.elements : [];
  for (const el of els) {
    if (el.rotation) continue;
    const from = el.from as V3, to = el.to as V3;
    const perFace: Record<string, FaceMap> = {};
    for (const d of ALL) {
      const f = el.faces[d];
      if (!f) continue;
      const path = stack.resolveTexturePath(f.tex);
      if (!path) continue;
      const [u0, v0, u1, v1] = f.uv ?? [0, 0, 16, 16];
      (perFace[path] ??= {})[d] = { uv: [u0, v0], uv_size: [u1 - u0, v1 - v0] };
    }
    for (const [path, uv] of Object.entries(perFace)) {
      add(path, cube([(from[0] - 8) * k, (from[1] - 8) * k, (from[2] - 8) * k], [(to[0] - from[0]) * k, (to[1] - from[1]) * k, (to[2] - from[2]) * k], uv));
    }
  }
  if (!groups.size) {
    const ref = (els[0]?.faces && Object.values<any>(els[0].faces)[0]?.tex) ?? name.replace(/^minecraft:/, '');
    const path = stack.resolveTexturePath(ref);
    if (!path) return [];
    const full = { uv: [0, 0] as [number, number], uv_size: [16, 16] as [number, number] };
    add(path, cube([-size / 2, -size / 2, -size / 2], [size, size, size], { north: full, south: full, east: full, west: full, up: full, down: full }));
  }
  return [...groups].map(([path, cubes]) => ({ path, geometry: { id: `block.${name}`, bones: [bone('b', cubes)] } as Geometry }));
}

// ------------------------------------------------------------------- plans ---

const DIRECTION_YAW = [0, 90, 180, 270]; // Bedrock `Direction`: 0 south, 1 west, 2 north, 3 east

/**
 * Draw calls for a hard-coded entity, or `null` when `inst` is not one. `nbt` is the entity's compound from the
 * structure. `uvUnit16` draws are sampled in 0..16 units of the first square frame of their image.
 */
export function builtinDraws(inst: EntityInstance, stack: ResourceStack, registry: BlockRegistry): EntityDraw[] | null {
  const id = inst.identifier.toLowerCase().replace(/^minecraft:/, '');
  const nbt = inst.nbt ?? {};
  const [px, py, pz] = inst.pos;
  const base = (geometry: Geometry, texturePath: string, world: M, extra: Partial<EntityDraw> = {}): EntityDraw => ({
    texturePath, geometry, poses: new Map(), isVisible: () => true, color: [1, 1, 1], alpha: 1, emissive: false, alphaIsGlow: false, layer: 'solid', world, ...extra,
  });
  const yawM = (deg: number) => rotYM(-deg);
  const s = 1 / 16;

  if (id === 'painting') {
    const motive = str(nbt.Motive) || str(nbt.variant) || str(nbt.Variant);
    const g = paintingGeometry(motive || 'kebab');
    if (!g) return [];
    const d = DIRECTION_YAW[num(nbt.Direction, 2) & 3];
    return [base(g, 'textures/painting/kz', mulM(translateM(px, py, pz), mulM(yawM(d), scaleM(s, s, -s))))];
  }

  if (id === 'item' || id === 'xp_bottle' ) {
    const item = isObj(nbt.Item) ? nbt.Item : {};
    const name = str(item.Name) || str(nbt.Name);
    if (!name) return [];
    const icon = itemTexturePath(stack, name);
    const yaw = inst.yaw ?? 0;
    if (icon) return [base(spriteGeometry(8), icon, mulM(translateM(px, py + 0.1, pz), mulM(yawM(yaw), scaleM(s, s, -s))), { uvUnit16: true, layer: 'solid' })];
    // an item that is a block: a quarter-size block
    return blockBodies(stack, registry, name, {}, 4).map((b) => base(b.geometry, b.path, mulM(translateM(px, py + 0.15, pz), mulM(yawM(yaw), scaleM(s, s, -s))), { uvUnit16: true }));
  }

  if (id === 'falling_block' || id === 'tnt') {
    const fb = isObj(nbt.FallingBlock) ? nbt.FallingBlock : {};
    const name = id === 'tnt' ? 'tnt' : str(fb.name) || str(fb.Name) || 'sand';
    const states = isObj(fb.states) ? (fb.states as Record<string, any>) : {};
    return blockBodies(stack, registry, name, states, 15.6).map((b) => base(b.geometry, b.path, mulM(translateM(px, py + 0.49, pz), scaleM(s, s, -s)), { uvUnit16: true }));
  }

  return null;
}

/**
 * A sulfur cube that has swallowed a block (its `minecraft:sulfur_cube_archetype` property is not `none`; the block is the
 * item in its main hand) shows that block inside its see-through shell; the client draws it at the `rightItem` bone, which
 * the resource pack has no item renderer for. Drawn here as a 10 px block in the middle of the 18 px shell.
 * UNVERIFIED against the game: size and placement are an approximation of what the shell shows.
 */
export function heldBlockDraws(inst: EntityInstance, stack: ResourceStack, registry: BlockRegistry): EntityDraw[] {
  const id = inst.identifier.toLowerCase().replace(/^minecraft:/, '');
  if (id !== 'sulfur_cube') return [];
  const nbt = inst.nbt ?? {};
  const props = isObj(nbt.properties) ? (nbt.properties as Record<string, unknown>) : {};
  const archetype = props['minecraft:sulfur_cube_archetype'];
  if (archetype === undefined || archetype === 'none') return [];
  const hands = Array.isArray(nbt.Mainhand) ? nbt.Mainhand : [];
  const item = (hands.find((h) => isObj(h) && str((h as any).Name)) ?? {}) as Record<string, any>;
  const block = isObj(item.Block) ? item.Block : {};
  const name = str(block.name) || str(item.Name);
  if (!name) return [];
  const states = isObj(block.states) ? (block.states as Record<string, any>) : {};
  const [px, py, pz] = inst.pos;
  const s = 1 / 16;
  return blockBodies(stack, registry, name, states, 10).map((b) => ({
    texturePath: b.path, geometry: b.geometry, poses: new Map(), isVisible: () => true, color: [1, 1, 1], alpha: 1, emissive: false, alphaIsGlow: false,
    layer: 'solid', world: mulM(translateM(px, py + 9 * s, pz), scaleM(s, s, -s)), uvUnit16: true,
  }) as EntityDraw);
}

/** Geometry ids the pack lacks but the game provides; added to the geometry library on creation. */
export function installBuiltinGeometries(lib: GeometryLibrary): void {
  if (!lib.has('geometry.boat')) lib.addBuiltin(boatGeometry());
  if (!lib.has('geometry.chest_boat')) lib.addBuiltin(boatGeometry(true));
}

/** Texture key (from the client entity definition) for a boat's `Variant`. */
export const boatTextureKey = (nbt: NbtCompound | undefined): string => BOAT_VARIANTS[Math.max(0, Math.min(5, num(nbt?.Variant, 0)))] ?? 'oak';
void IDENT;

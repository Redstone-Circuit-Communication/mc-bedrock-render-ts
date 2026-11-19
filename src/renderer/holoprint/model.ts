/**
 * HoloPrint geometry as the renderer's primary block-shape source.
 *
 * `holoprintHandler()` returns a `BlockRegistry` primary handler: it asks HoloPrint's shape data (geo.ts) for the faces of a
 * block, resolves their textures against the resource stack (textures.ts), mirrors them from Bedrock geometry space into world
 * space and returns a `BlockModel` made of free quads. The registry's own handlers stay in charge of
 *   - everything HoloPrint cannot know from one block: connections that depend on the neighbours (fences, panes and bars,
 *     redstone dust, double chests) and liquids (flow heights, faces hidden between water blocks);
 *   - blocks the registry draws as nothing (air, barriers, light blocks …) or through the entity renderer (beds, skulls,
 *     shulker boxes, moving blocks);
 *   - material flags HoloPrint does not have: render layer (stained glass, ice …), alpha, `cullSame`, emissive. These are
 *     copied from the registry's model of the same block; `opaque` is kept only when HoloPrint's shape is a full cube too.
 * When HoloPrint has no texture for any face of a block (a block the pack's blocks.json does not list), the registry's model
 * is used instead.
 */
import { FACING6, PISTON_FACING6, facingDirection } from '../blockutil';
import { blockGeometryModel } from '../blockgeo';
import type { BlockContext, BlockRef } from '../blockutil';
import type { StateValue } from '../structure';
import { BlockModel, DIR_VEC, Dir, DIRS, Quad, V3 } from '../models';
import type { NbtCompound, NbtValue } from '../nbt';
import { perStack, type ResourceStack } from '../resources';
import blockEigenvariants from './data/blockEigenvariants.json';
import blockShapeGeos from './data/blockShapeGeos.json';
import blockShapes from './data/blockShapes.json';
import blockStateDefinitions from './data/blockStateDefinitions.json';
import { HoloGeometry, HpBlock, HpFace, splitSpecialTexture } from './geo';
import { HoloTextures } from './textures';
import { modernBlock } from './legacy';
export { modernBlock } from './legacy';

let shared: HoloGeometry | undefined;
/** The bundled HoloPrint shape data, parsed once. */
export function holoGeometry(): HoloGeometry {
  return (shared ??= new HoloGeometry({ blockShapes, blockShapeGeos, blockStateDefinitions, blockEigenvariants } as any));
}

/** Shapes the registry keeps: they depend on neighbours, liquids, or HoloPrint has only a placeholder for them. */
export const KEEP_SHAPES = new Set(['fence', 'bamboo_fence', 'glass_pane', 'metal_bars', 'redstone_dust', 'chest', 'liquid', 'air', 'bubble_column']);
/** Block names the registry keeps regardless of their HoloPrint shape. */
export const KEEP_BLOCKS = /^(water|flowing_water|lava|flowing_lava|redstone_wire|.*piston_arm_collision|moving_block|movingblock)$/;

export interface HoloOptions {
  /** Block names (without namespace) to leave to the registry. */
  keep?: (name: string) => boolean;
}

/** NBT compound → plain JSON-like object (what HoloPrint reads as `block_entity_data`). */
export function plainNbt(v: NbtValue | undefined): unknown {
  if (v === undefined || v === null) return v;
  if (typeof v === 'bigint') return Number(v);
  if (ArrayBuffer.isView(v)) return Array.from(v as ArrayLike<number | bigint>, (x) => Number(x));
  if (Array.isArray(v)) return v.map((x) => plainNbt(x));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as NbtCompound).map(([k, x]) => [k, plainNbt(x)]));
  return v;
}

const EPS = 1e-4;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

/** The cell boundary a quad lies on, facing outwards (`null` when it is inside the cell or not axis-aligned). */
function boundaryDir(pos: V3[], n: V3): Dir | false {
  for (const d of DIRS) {
    const v = DIR_VEC[d];
    if (!near(n[0], v[0]) || !near(n[1], v[1]) || !near(n[2], v[2])) continue;
    const axis = v[0] ? 0 : v[1] ? 1 : 2, plane = (v[axis] > 0 ? 16 : 0);
    // on the plane AND inside the cell: the head plate of an extended piston has faces on x = 16 that reach y = 32, in the
    // NEXT cell, and the neighbour that culled them was the wrong one
    return pos.every((p) => near(p[axis], plane) && p.every((c) => c > -0.01 && c < 16.01)) ? d : false;
  }
  return false;
}

/** HoloPrint face → renderer quad (x mirrored: HoloPrint's +x is west). `null` when its texture cannot be resolved. */
function toQuad(f: HpFace, textures: HoloTextures): Quad | null {
  const tex = textures.resolve(f.tex);
  if (!tex) return null;
  const byCorner = [...f.vertices].sort((a, b) => a.corner - b.corner);
  const loop = [byCorner[0], byCorner[1], byCorner[3], byCorner[2]]; // texture TL, TR, BR, BL
  const [u0, v0] = f.tex.uv, [du, dv] = f.tex.uv_size;
  // snapped to 1/64 px = 1/1024 block, the precision of the mesh core's quantised positions: rotations leave float noise
  // (28.999999…) that the wasm builder and the TypeScript core would otherwise round to different grid steps
  const snap = (x: number) => Math.round(x * 64) / 64 + 0;
  const pos = loop.map((v) => [snap(16 - v.pos[0]), snap(v.pos[1]), snap(v.pos[2])] as V3) as Quad['pos'];
  const uv = loop.map((v) => [(u0 + du * (v.corner & 1)) * 16, (v0 + dv * (v.corner >> 1)) * 16] as [number, number]) as Quad['uv'];
  let normal: V3 = [-f.normal[0], f.normal[1], f.normal[2]];
  if (!Number.isFinite(normal[0] + normal[1] + normal[2])) normal = [0, 1, 0];
  const q: Quad = { pos, uv, tex: tex.tex, normal, cull: f.flat ? false : boundaryDir(pos, normal) };
  if (f.flat) q.flat = true;
  else if (f.open) q.twoSided = true;
  if (tex.tint != null) q.tint = tex.tint;
  if (f.fullbright) q.shade = false;
  if (/(^|\/)(still_water|water_still|water|cauldron_water|still_water_grey)(_grey)?$/.test(tex.tex.slice(1).replace(/\|.*$/, ''))) { q.layer = 'translucent'; q.alpha = 0.8; }
  return q;
}

/** Is the HoloPrint geometry exactly one full, unrotated cube (six faces on the cell boundaries)? */
function isFullCube(quads: Quad[]): boolean {
  if (quads.length !== 6) return false;
  const seen = new Set<Dir>();
  for (const q of quads) {
    if (!q.cull) return false;
    const axis = DIR_VEC[q.cull][0] ? 0 : DIR_VEC[q.cull][1] ? 1 : 2;
    const others = [0, 1, 2].filter((a) => a !== axis);
    for (const a of others) {
      const vals = q.pos.map((p) => p[a]);
      if (!near(Math.min(...vals), 0) || !near(Math.max(...vals), 16)) return false;
    }
    seen.add(q.cull);
  }
  return seen.size === 6;
}


/**
 * Defaults for block states a structure leaves out. A structure the game writes carries every state of every block, but
 * hand-made ones and the generated examples often have `{}` — and HoloPrint's conditions (`repeater_delay == 2`,
 * `open_bit == 1`, `facing_direction == 1` …) are TRUE for a missing state, so a repeater drew the torches of all four
 * delays, a door every one of its open / hinge variants, a dropper the front of every facing, on top of each other.
 * Only real Bedrock states are listed (the shapes also read variables the adapter computes itself; those are left alone).
 * Everything numeric or a bit is 0 in the game's default permutation; the string ones are named here.
 */
const STATE_DEFAULTS: Record<string, string | number> = {
  attachment: 'standing', bamboo_leaf_size: 'no_leaves', bamboo_stalk_thickness: 'thin', cauldron_liquid: 'water',
  'minecraft:vertical_half': 'bottom', portal_axis: 'x', sea_grass_type: 'default', torch_facing_direction: 'top', turtle_egg_count: 'one_egg',
  dripstone_thickness: 'tip',
};
const ZERO_STATES = new Set([
  'age', 'attached_bit', 'bite_counter', 'books_stored', 'button_pressed_bit', 'candles', 'cluster_count', 'composter_fill_level', 'conditional_bit',
  'dead_bit', 'direction', 'end_portal_eye_bit', 'extinguished', 'facing_direction', 'fill_level', 'growth', 'hanging', 'has_bottle', 'head_piece_bit',
  'height', 'in_wall_bit', 'kelp_age', 'liquid_depth', 'lit', 'multi_face_direction_bits', 'open_bit', 'output_subtract_bit', 'powered_bit',
  'powered_shelf_type', 'propagule_stage', 'rail_data_bit', 'rail_direction', 'redstone_signal', 'repeater_delay', 'sculk_sensor_phase',
  'update_bit', 'upper_block_bit', 'upside_down_bit', 'vine_direction_bits', 'wall_post_bit', 'door_hinge_bit', 'output_lit_bit', 'toggle_bit',
  'triggered_bit', 'big_dripleaf_head', 'brewing_stand_slot_a_bit', 'brewing_stand_slot_b_bit', 'brewing_stand_slot_c_bit',
]);
/** The default of a state a shape's conditions read, or `undefined` when it is not a state this knows (a computed variable). */
export function stateDefault(name: string): string | number | undefined {
  if (name in STATE_DEFAULTS) return STATE_DEFAULTS[name];
  if (/^(wall_connection_type_|pale_moss_carpet_side_)/.test(name)) return 'none';
  return ZERO_STATES.has(name) ? 0 : undefined;
}

/**
 * The old coral ids (`coral` + `coral_color` / `dead_bit`, `coral_fan`, `coral_fan_dead`, `coral_fan_hang` …): the modern id,
 * or `undefined` for anything else. Kept for callers of 1.3; the general translation (flowers, double plants, saplings …)
 * is `modernBlock` in legacy.ts.
 */
export function modernCoral(ctx: Pick<BlockContext, 'name' | 'states'>): string | undefined {
  return /^coral(_fan(_dead|_hang[23]?)?)?$/.test(ctx.name) ? modernBlock(ctx.name, ctx.states)?.name : undefined;
}

/**
 * The HoloPrint block for a name and its states, as the geometry should see it: old ids translated (legacy.ts), and every
 * state the shape's conditions read filled with its default. HoloPrint evaluates a condition on a MISSING state as true,
 * so without the defaults a slab without `top_slot_bit` drew both halves and a door without its states drew every
 * hinge and swing at once. Block-entity data is added by the caller (it needs the neighbours).
 */
export function holoBlock(name: string, states: Record<string, unknown>, geo: HoloGeometry = holoGeometry()): HpBlock {
  const modern = modernBlock(name, states);
  const block: HpBlock = { name: modern?.name ?? name, states: { ...(modern?.states ?? states) } };
  if (PISTON.test(block.name) && typeof block.states!.facing_direction !== 'number') {
    // string-valued `minecraft:facing_direction` (hand-made structures): the game writes the integer, and only the integer
    // table is right for a piston (its model points up, HoloPrint's string table assumes a model that points north)
    const dir = facingDirection(block.states as Record<string, StateValue>, PISTON_FACING6);
    const i = dir ? PISTON_FACING6.indexOf(dir) : -1;
    if (i >= 0) { delete block.states!['minecraft:facing_direction']; block.states!.facing_direction = i; }
  } else if (typeof block.states!.facing_direction !== 'number' && typeof block.states!['minecraft:facing_direction'] === 'string'
    && INT_FACING_SHAPES.has(geo.shapeOf(block.name).replace(/<.*$/, ''))) {
    const i = FACING6.indexOf(block.states!['minecraft:facing_direction'] as Dir);
    if (i >= 0) { delete block.states!['minecraft:facing_direction']; block.states!.facing_direction = i; }
  }
  for (const v of geo.requirements(block.name).vars) {
    if (v in block.states!) continue;
    const d = stateDefault(v);
    if (d !== undefined) block.states![v] = d;
  }
  return block;
}

/**
 * Doors and two-block plants: in the game both halves carry every state, but hand-made and generated structures (the
 * bundled all-blocks demo among them) often give the upper half nothing but `upper_block_bit`. Its geometry needs the
 * lower half's direction, swing and hinge, so a missing state took its default and the upper half of a door turned away
 * from the lower one. The upper half takes the states it is missing from the cell below when that is the same block.
 */
const TWO_HIGH = /_door$|^(sunflower|lilac|tall_grass|large_fern|rose_bush|peony|double_plant|pitcher_plant|tall_dry_grass)$/;
export function upperHalfStates(ctx: Pick<BlockContext, 'name' | 'states' | 'neighbor'>): Record<string, unknown> {
  const st = ctx.states;
  if (!TWO_HIGH.test(ctx.name)) return st;
  const door = /_door$/.test(ctx.name);
  if (Number(st.upper_block_bit) !== 1) {
    // a door's hinge side lives in its UPPER half: the lower half's own door_hinge_bit is not kept up to date
    if (!door) return st;
    const above = ctx.neighbor(0, 1, 0);
    return above && above.name === ctx.name && Number(above.states.upper_block_bit) === 1 && 'door_hinge_bit' in above.states
      ? { ...st, door_hinge_bit: above.states.door_hinge_bit } : st;
  }
  const below = ctx.neighbor(0, -1, 0);
  if (!below || below.name !== ctx.name) return st;
  if (!door) return { ...below.states, ...st };
  // A game-written door carries every state on both halves, but only the LOWER half's facing and open/closed are kept up to
  // date (the upper half of an open door still says open_bit 0: its half was drawn shut, at a right angle to the open lower
  // half). The game draws both halves from the lower one's facing and swing and the upper one's hinge, and so does this.
  const fromLower: Record<string, unknown> = {};
  for (const k of DOOR_LOWER_STATES) if (k in below.states) fromLower[k] = below.states[k];
  return { ...below.states, ...st, ...fromLower };
}
const DOOR_LOWER_STATES = ['direction', 'minecraft:cardinal_direction', 'open_bit'];

/**
 * Shapes whose HoloPrint rotation table is written for the integer `facing_direction`. Newer games save some of these blocks with
 * the string `minecraft:facing_direction` instead (a hopper says `"down"`); the generic string table then tipped a downward hopper
 * onto its side (`down` → 90° about x). They get the integer the table expects (0 down, 1 up, 2 north, 3 south, 4 west, 5 east).
 */
const INT_FACING_SHAPES = new Set(['hopper', 'hanging_sign', 'button', 'lightning_rod', 'command_block', 'wall_sign', 'wall_sign_prefix', 'wall_sign_suffix',
  'glazed_terracotta', 'wall_banner', 'dispenser', 'item_frame', 'plant_stem', 'barrel', 'jigsaw_block', 'skull', 'player_head', 'dragon_head', 'piglin_head']);

const PISTON = /^(sticky_)?piston$/;

/**
 * Values for the block-entity fields a shape reads when the structure carries no (or an incomplete) block entity.
 *
 * HoloPrint's conditions (`entity.State == 0`, `entity.Type == 1` …) evaluate to TRUE for a field that is missing, so a
 * piston without a `PistonArm` entity used to be drawn as a retracted AND an extended AND a moving arm on top of each
 * other (structures made by tools, and hand-built demos, have no entity). The defaults make exactly one branch true:
 * a piston is extended when the cell in front of it holds its `*_piston_arm_collision`, retracted otherwise.
 */
export function entityDefaults(ctx: BlockContext, fields: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields.has('State') && PISTON.test(ctx.name)) {
    const dir = facingDirection(ctx.states, PISTON_FACING6) ?? 'up';
    const v = DIR_VEC[dir];
    const front = ctx.neighbor(v[0], v[1], v[2]);
    const extended = !!front && /piston_arm_collision$/.test(front.name);
    Object.assign(out, { State: extended ? 2 : 0, NewState: extended ? 2 : 0, Progress: extended ? 1 : 0, LastProgress: extended ? 1 : 0, Sticky: /^sticky/.test(ctx.name) ? 1 : 0 });
  }
  for (const f of ['Type', 'Base', 'hasBook', 'color', 'update_bit']) if (fields.has(f)) out[f] = 0;
  return out;
}

/**
 * A piston caught mid-stroke (`State` 1 / 3): HoloPrint only has a fixed half-way arm. The arm is built fully extended
 * and slid back by how far it still has to go (`Progress`: 0 = retracted, 1 = extended): the head plate and the thin
 * rod travel one block, the thick rod half a block. `dir` is the world direction the piston faces.
 */
function slideArm(quads: Quad[], dir: Dir, progress: number): void {
  const v = DIR_VEC[dir], axis = v[0] ? 0 : v[1] ? 1 : 2, sign = v[axis];
  const back = 1 - Math.max(0, Math.min(1, progress));
  for (const q of quads) {
    // position along the facing axis, 0 at the piston's back face … 32 at the tip of a fully extended arm
    const t = (a: number) => (sign > 0 ? q.pos[a][axis] : 16 - q.pos[a][axis]);
    const top = Math.max(t(0), t(1), t(2), t(3)), bottom = Math.min(t(0), t(1), t(2), t(3));
    if (top <= 12.001) continue; // the piston body itself (its open face is at 12)
    const centre = (top + bottom) / 2;
    const shift = (centre > 20 ? 16 : 8) * back; // face plate and thin rod: 16, thick rod: 8
    for (const p of q.pos) p[axis] -= sign * shift;
  }
}

/**
 * The brewing stand's three arms are planes that each show half of `brewing_stand.png`, a front view of the whole stand (the rod at
 * u 7…9, an arm with a bottle to its left, an empty arm to its right). HoloPrint's templates got the halves the wrong way round: the
 * empty arm (flipped on its south face) showed the dark band that hugs the rod at its outer end, running down to the base plates, and
 * the arm with a bottle (not flipped at all) was right from one side and mirrored from the other. Every face of an arm now samples
 * next to the rod (u nearest 8) at its inner end and the picture's edge at its outer end, seen from either side.
 */
function orientArms(quads: Quad[]): void {
  for (const q of quads) {
    if (!q.flat) continue;
    const d = q.pos.map((p) => Math.hypot(p[0] - 8, p[2] - 8));
    const near = d.indexOf(Math.min(...d)), far = d.indexOf(Math.max(...d));
    if (Math.abs(q.uv[near][0] - 8) <= Math.abs(q.uv[far][0] - 8)) continue;
    const us = q.uv.map((t) => t[0]);
    const lo = Math.min(...us), hi = Math.max(...us);
    for (const t of q.uv) t[0] = lo + hi - t[0];
  }
}

export interface HoloResult {
  model: BlockModel | null;
  /** The shape reads block entity data or neighbour-derived values: do not cache the model per palette entry. */
  dynamic: boolean;
}

/**
 * Build the model of one block from HoloPrint's data. `undefined` = leave the block to the registry.
 * `base` is the registry's own model of the block (material flags are copied from it).
 */
export function holoprintModel(ctx: BlockContext, base: BlockModel | null | undefined, geo = holoGeometry(), opts: HoloOptions = {}): BlockModel | null | undefined {
  if (base === null) return null; // the registry draws nothing here (air, barrier …) or the entity renderer does (beds, skulls …)
  const custom = blockGeometryModel(ctx); // blocks with their own models/blocks/*.geo.json (straw_bed)
  if (custom) return custom;
  const name = modernBlock(ctx.name, ctx.states)?.name ?? ctx.name;
  if (KEEP_BLOCKS.test(name) || opts.keep?.(name)) return undefined;
  const shape = splitSpecialTexture(geo.shapeOf(name)).shape;
  if (KEEP_SHAPES.has(shape) || !geo.hasShape(shape)) return undefined;
  const req = geo.requirements(name);
  const block = holoBlock(ctx.name, upperHalfStates(ctx), geo);
  let movingArm: { dir: Dir; progress: number } | undefined;
  if (req.entity.size) {
    const be = (plainNbt(ctx.blockEntity) as Record<string, unknown> | undefined) ?? {};
    const data: Record<string, unknown> = { ...entityDefaults(ctx, req.entity), ...be };
    if (PISTON.test(name) && (data.State === 1 || data.State === 3)) {
      const progress = Number(data.Progress);
      if (Number.isFinite(progress)) {
        // build the fully extended arm and slide it (below); State 2 selects HoloPrint's extended template
        movingArm = { dir: facingDirection(ctx.states, PISTON_FACING6) ?? 'up', progress };
        data.State = 2;
      }
    }
    block.block_entity_data = data;
  }
  let faces: HpFace[];
  try { faces = geo.faces(block); } catch (err) { console.warn(`mcstructure-renderer: HoloPrint geometry for ${name} failed`, err); return undefined; }
  // HoloPrint draws a whole door from its lower half (the model spans both cells): the upper half has no faces of its own. It used
  // to fall back to the registry's hand-made door, a second door in the upper cell that turned its own way (the "L" of two halves at
  // a right angle). An upper half standing on its lower half draws nothing; a lone upper half (cut structures) keeps the fallback.
  if (!faces.length && /_door$/.test(name) && Number(ctx.states.upper_block_bit) === 1 && ctx.neighbor(0, -1, 0)?.name === ctx.name) return null;
  if (!faces.length) return base?.elements.length || base?.quads?.length ? undefined : null;
  const textures = texturesFor(ctx.resources);
  const quads: Quad[] = [];
  for (const f of faces) { const q = toQuad(f, textures); if (q) quads.push(q); }
  if (!quads.length) return undefined; // no texture known for this block: the registry's guess is better than nothing
  if (movingArm) slideArm(quads, movingArm.dir, movingArm.progress);
  if (shape === 'brewing_stand') orientArms(quads);
  // A model that reads block entity data, or the other half of a door / two-high plant (upperHalfStates), is not a function of the
  // palette entry alone. Doors were cached per palette entry: the half of an open door whose saved states equal those of a closed
  // door's half (the game keeps open_bit on the lower half only) got that closed door's model, at a right angle to its other half.
  const model: BlockModel = { elements: [], quads, static: req.entity.size === 0 && !TWO_HIGH.test(name) };
  // a piston's arm and head plate reach into the next cell: no face of it is culled against a neighbour
  if (PISTON.test(name)) model.noCull = true;
  if (base) {
    if (base.layer) model.layer = base.layer;
    if (base.alpha !== undefined) model.alpha = base.alpha;
    if (base.cullSame) { model.cullSame = true; if (base.cullKey) model.cullKey = base.cullKey; }
    if (base.emissive) model.emissive = true;
  }
  model.opaque = isFullCube(quads) && (base ? !!base.opaque : true) && model.layer !== 'translucent';
  return model;
}

const texturesFor = perStack((stack) => new HoloTextures(stack));

/** Primary handler for `BlockRegistry.primary`. */
export function holoprintHandler(opts: HoloOptions = {}) {
  const geo = holoGeometry();
  return (ctx: BlockContext, base: () => BlockModel | null | undefined): BlockModel | null | undefined => holoprintModel(ctx, base(), geo, opts);
}

/** Which HoloPrint shape (and special texture) a block name maps to: for tooling and coverage reports. */
export function holoprintShapeOf(ref: BlockRef | string): { shape: string; texture?: string; kept: boolean } {
  const name = typeof ref === 'string' ? ref.replace(/^minecraft:/, '') : ref.name;
  const s = splitSpecialTexture(holoGeometry().shapeOf(name));
  return { ...s, kept: KEEP_BLOCKS.test(name) || KEEP_SHAPES.has(s.shape) };
}

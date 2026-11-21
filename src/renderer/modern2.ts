import {
  BlockContext, BlockRegistry, cardinal, facingDirection, firstTexture, num, st, truthy,
} from './blockutil';
import { BlockModel, Dir, Element, FaceSpec, HORIZONTAL, V3, box, cubeModel, faces, orientTo, yawOf } from './models';
import { crossModel, stateNum } from './kit';
import { baseCube, specToModel } from './blockutil';

/**
 * Shapes for blocks added after the 1.14 era that the first renderer generation had no model for
 * (sculk family, amethyst, dripstone, dripleaves, vines, petals, candle cakes, chiseled bookshelf, decorated pot,
 * shelves, hanging signs, lightning rods, trial blocks …).
 *
 * Bedrock draws all of these from code, not from a JSON model, so the outlines below are written from the vanilla
 * shapes (1/16 block units). Textures are looked up by several candidate names — the files differ between the
 * vanilla packs and texture packs — and the first one that exists in the resource stack wins.
 */

const tx = (c: BlockContext, ...keys: string[]): string => firstTexture(c.resources, ...keys);
const ALL: Dir[] = ['down', 'up', 'north', 'south', 'west', 'east'];

/** The six faces of a box, all showing `tex` (optionally per face). */
const six = (tex: string | Partial<Record<Dir, string>>, extra: Partial<FaceSpec> = {}): Partial<Record<Dir, FaceSpec>> => faces(tex as never, extra);

/** `minecraft:block_face` / `facing_direction` → direction an attached block points to. */
function blockFace(c: BlockContext, d: Dir = 'up'): Dir {
  const v = st(c.states, 'minecraft:block_face') ?? st(c.states, 'block_face');
  if (typeof v === 'string' && (ALL as string[]).includes(v)) return v as Dir;
  return facingDirection(c.states) ?? d;
}

/** Model rotation that turns a model drawn pointing UP so that it points along `to`. */
function pointing(model: BlockModel, to: Dir): BlockModel {
  const { x, y } = orientTo('up', to);
  return { ...model, rotX: x, rotY: y };
}

// ------------------------------------------------------------ small plants ---

const plant = (...keys: string[]) => (c: BlockContext): BlockModel => crossModel(tx(c, ...keys));

/** A crop / plant whose texture changes with `growth` (0..7). */
const staged = (prefix: string, max: number, stateKey = 'growth') => (c: BlockContext): BlockModel => {
  const g = Math.max(0, Math.min(max, stateNum(c, stateKey)));
  return crossModel(tx(c, `${prefix}${g}`, `${prefix}_${g}`, `${prefix}_stage${g}`, `${prefix}_stage_${g}`, prefix));
};

function twoTall(...keys: string[]) {
  return (c: BlockContext): BlockModel => {
    const upper = truthy(st(c.states, 'upper_block_bit'));
    const k = keys.map((n) => upper ? [`${n}_top`, `${n}_upper`] : [`${n}_bottom`, `${n}_lower`, n]).flat();
    return crossModel(tx(c, ...k, ...keys));
  };
}

/** Vines that hang / grow along y: two crossed planes like a plant but double sided and unshaded. */
const vineColumn = (...keys: string[]) => (c: BlockContext): BlockModel => crossModel(tx(c, ...keys));

// ----------------------------------------------------- multi-face attachments ---

const FACE_BITS: [number, Dir][] = [[1, 'down'], [2, 'up'], [4, 'north'], [8, 'south'], [16, 'west'], [32, 'east']];

/** glow_lichen, sculk_vein, resin_clump: flat planes on the faces named by `multi_face_direction_bits`. */
function multiFace(...keys: string[]) {
  return (c: BlockContext): BlockModel => {
    const bits = num(st(c.states, 'multi_face_direction_bits'), 0);
    const tex = tx(c, ...keys);
    const sheet = (d: Dir): Element => {
      const f: FaceSpec = { tex, uv: [0, 0, 16, 16], cull: false };
      const E = 0.1;
      switch (d) {
        case 'down': return box([0, E, 0], [16, E, 16], { up: f, down: f }, { shade: false });
        case 'up': return box([0, 16 - E, 0], [16, 16 - E, 16], { up: f, down: f }, { shade: false });
        case 'north': return box([0, 0, E], [16, 16, E], { north: f, south: f }, { shade: false });
        case 'south': return box([0, 0, 16 - E], [16, 16, 16 - E], { north: f, south: f }, { shade: false });
        case 'west': return box([E, 0, 0], [E, 16, 16], { west: f, east: f }, { shade: false });
        default: return box([16 - E, 0, 0], [16 - E, 16, 16], { west: f, east: f }, { shade: false });
      }
    };
    const els = FACE_BITS.filter(([b]) => bits & b).map(([, d]) => sheet(d));
    return { elements: els.length ? els : [sheet('down')] };
  };
}

// ---------------------------------------------------------- amethyst / drip ---

function amethyst(h: number, w: number, ...keys: string[]) {
  return (c: BlockContext): BlockModel => {
    const tex = tx(c, ...keys);
    const x0 = 8 - w / 2, x1 = 8 + w / 2;
    const f = (): FaceSpec => ({ tex, uv: [0, 16 - h, 16, 16], cull: false });
    const model: BlockModel = {
      elements: [
        box([x0, 0, 8], [x1, h, 8], { north: f(), south: f() }, { shade: false }),
        box([8, 0, x0], [8, h, x1], { west: f(), east: f() }, { shade: false }),
      ],
      static: false,
    };
    return pointing(model, blockFace(c, 'up'));
  };
}

function pointedDripstone(c: BlockContext): BlockModel {
  const hanging = truthy(st(c.states, 'hanging'));
  const thick = String(st(c.states, 'dripstone_thickness') ?? 'tip');
  const t = tx(c, `pointed_dripstone_${thick}${hanging ? '_down' : '_up'}`, `pointed_dripstone_${thick}`, 'pointed_dripstone', 'dripstone_block');
  // vanilla: the cone narrows towards the tip (tip 6px wide … base 12px, merge = two tips)
  const w = ({ tip: 6, tip_merge: 6, frustum: 8, middle: 10, base: 12 } as Record<string, number>)[thick] ?? 6;
  const a = (16 - w) / 2;
  return { elements: [box([a, 0, a], [a + w, 16, a + w], six(t, { cull: false }))], static: true };
}

function dripleafBig(c: BlockContext): BlockModel {
  const head = truthy(st(c.states, 'big_dripleaf_head'));
  const tilt = String(st(c.states, 'big_dripleaf_tilt') ?? 'none');
  const top = tx(c, 'big_dripleaf_top', 'big_dripleaf_tip');
  const stem = tx(c, 'big_dripleaf_stem', 'big_dripleaf_side');
  const side = tx(c, 'big_dripleaf_side', 'big_dripleaf_stem');
  const dir = cardinal(c.states) ?? 'north';
  if (!head) return { elements: [box([5, 0, 9], [11, 16, 15], six(stem, { cull: false }))], rotY: yawOf(dir), static: true };
  const y = tilt === 'full_tilt' ? 15 : tilt === 'partial_tilt' ? 13 : tilt === 'unstable' ? 14 : 11;
  const leaf = box([0, y, 0], [16, y + 1, 16], { up: { tex: top, cull: false }, down: { tex: top, cull: false }, north: { tex: side }, south: { tex: side }, west: { tex: side }, east: { tex: side } });
  const stemBox = box([5, 0, 9], [11, y, 15], six(stem, { cull: false }));
  return { elements: [stemBox, leaf], rotY: yawOf(dir), static: true };
}

function dripleafSmall(c: BlockContext): BlockModel {
  const upper = truthy(st(c.states, 'upper_block_bit'));
  const dir = cardinal(c.states) ?? 'north';
  const stem = tx(c, 'small_dripleaf_stem_top', 'small_dripleaf_stem', 'big_dripleaf_stem');
  if (!upper) return { elements: [box([6, 0, 6], [10, 16, 10], six(stem, { cull: false }))], static: true };
  const top = tx(c, 'small_dripleaf_top', 'small_dripleaf_side');
  const side = tx(c, 'small_dripleaf_side', 'small_dripleaf_top');
  return {
    elements: [box([6, 0, 6], [10, 8, 10], six(stem, { cull: false })), box([2, 8, 2], [14, 9, 14], { up: { tex: top, cull: false }, down: { tex: top, cull: false }, north: { tex: side }, south: { tex: side }, west: { tex: side }, east: { tex: side } })],
    rotY: yawOf(dir), static: true,
  };
}

// -------------------------------------------------------------------- sculk ---

function sculkSensor(c: BlockContext): BlockModel {
  const active = String(st(c.states, 'sculk_sensor_phase') ?? '0') !== '0';
  const base = c.name.startsWith('calibrated') ? 'calibrated_sculk_sensor' : 'sculk_sensor';
  const top = tx(c, `${base}_top`, `${base}_top_${active ? 'active' : 'inactive'}`, 'sculk_sensor_top');
  const side = tx(c, `${base}_side`, 'sculk_sensor_side');
  const bottom = tx(c, `${base}_bottom`, 'sculk_sensor_bottom');
  const tendril = tx(c, 'sculk_sensor_tendril_inactive', 'sculk_sensor_tendril_active', side);
  const els: Element[] = [box([0, 0, 0], [16, 8, 16], six({ up: top, down: bottom, north: side, south: side, west: side, east: side }, { cull: false }))];
  if (c.name.startsWith('calibrated')) els.push(box([6, 8, 6], [10, 9, 10], six(tendril, { cull: false })));
  return { elements: els, emissive: false, static: true };
}

function sculkShrieker(c: BlockContext): BlockModel {
  const top = tx(c, 'sculk_shrieker_top', 'sculk_shrieker_can_summon_top');
  const side = tx(c, 'sculk_shrieker_side', 'sculk_shrieker_bone_side');
  const bottom = tx(c, 'sculk_shrieker_bottom');
  return { elements: [box([0, 0, 0], [16, 8, 16], six({ up: top, down: bottom, north: side, south: side, west: side, east: side }, { cull: false }))], static: true };
}

// ------------------------------------------------------------------ candles ---

function candleCake(c: BlockContext): BlockModel {
  const colour = c.name.replace(/_?candle_cake$/, '');
  const lit = truthy(st(c.states, 'lit'));
  const cakeSide = tx(c, 'cake_side'), cakeTop = tx(c, 'cake_top'), cakeBottom = tx(c, 'cake_bottom');
  const candle = tx(c, ...(colour ? [`${colour}_candle${lit ? '_lit' : ''}`, `${colour}_candle`, `candle_${colour}`] : [`candle${lit ? '_lit' : ''}`, 'candle']));
  const f = (): FaceSpec => ({ tex: candle, cull: false });
  return {
    elements: [
      box([1, 0, 1], [15, 8, 15], six({ up: cakeTop, down: cakeBottom, north: cakeSide, south: cakeSide, west: cakeSide, east: cakeSide })),
      box([7, 8, 7], [9, 14, 9], { north: f(), south: f(), west: f(), east: f(), up: f(), down: f() }),
    ],
    static: true, emissive: false,
  };
}

// --------------------------------------------------- chiseled bookshelf / pot ---

function chiseledBookshelf(c: BlockContext): BlockModel {
  const dir = cardinal(c.states) ?? 'north';
  const bits = num(st(c.states, 'books_stored'), 0);
  const top = tx(c, 'chiseled_bookshelf_top');
  const side = tx(c, 'chiseled_bookshelf_side');
  const front = tx(c, bits ? 'chiseled_bookshelf_occupied' : 'chiseled_bookshelf_empty', 'chiseled_bookshelf_front', 'chiseled_bookshelf_empty');
  const m = cubeModel({ up: top, down: top, north: front, south: side, west: side, east: side }, { static: true });
  return { ...m, rotY: yawOf(dir), static: true };
}

function decoratedPot(c: BlockContext): BlockModel {
  const dir = cardinal(c.states) ?? 'north';
  const base = tx(c, 'decorated_pot_base', 'decorated_pot_side', 'decorated_pot_pattern_base', 'terracotta', 'hardened_clay');
  const side = tx(c, 'decorated_pot_side', 'decorated_pot_pattern_side', base);
  return {
    elements: [
      box([5, 0, 5], [11, 1, 11], six(base)),
      box([1, 0, 1], [15, 14, 15], six({ up: base, down: base, north: side, south: side, west: side, east: side })),
      box([4, 14, 4], [12, 16, 12], six(base)),
      box([5, 16, 5], [11, 20, 11], six(base)),
      box([4, 20, 4], [12, 24, 12], six(base)),
    ],
    rotY: yawOf(dir), static: true,
  };
}

// -------------------------------------------------------- lightning rod etc ---

function lightningRod(c: BlockContext): BlockModel {
  const tex = tx(c, c.name.replace(/^waxed_/, ''), 'lightning_rod', 'copper_block');
  const f = blockFace(c, 'up');
  const m: BlockModel = { elements: [box([7, 0, 7], [9, 12, 9], six(tex, { cull: false })), box([6, 12, 6], [10, 16, 10], six(tex, { cull: false }))], static: true };
  return pointing(m, f);
}

function copperLantern(c: BlockContext): BlockModel {
  const hanging = truthy(st(c.states, 'hanging'));
  const tex = tx(c, c.name.replace(/^waxed_/, ''), 'copper_lantern', 'lantern');
  const y = hanging ? 1 : 0;
  return {
    elements: [
      box([5, y, 5], [11, y + 7, 11], six(tex, { cull: false })),
      box([6, y + 7, 6], [10, y + 9, 10], six(tex, { cull: false })),
    ],
    emissive: true, static: true,
  };
}

// ----------------------------------------------------- carpets & layer blocks ---

function carpetOf(...keys: string[]) {
  return (c: BlockContext): BlockModel => ({ elements: [box([0, 0, 0], [16, 1, 16], faces(tx(c, ...keys), { tint: null }))], static: true });
}

/** leaf_litter, wildflowers, pink_petals: `growth` 0..7 (1–4 petals) lying on the ground. */
function petals(...keys: string[]) {
  return (c: BlockContext): BlockModel => {
    const tex = tx(c, ...keys);
    const count = Math.max(1, Math.min(4, (stateNum(c, 'growth') & 7) + 1));
    const dir = cardinal(c.states) ?? 'north';
    const quarters: [number, number][] = [[0, 0], [8, 0], [8, 8], [0, 8]];
    const els: Element[] = [];
    for (let i = 0; i < count; i++) {
      const [x, z] = quarters[i];
      els.push(box([x, 0.2, z], [x + 8, 0.2, z + 8], { up: { tex, uv: [x, z, x + 8, z + 8], cull: false }, down: { tex, uv: [x, z, x + 8, z + 8], cull: false } }, { shade: false }));
    }
    return { elements: els, rotY: yawOf(dir), static: true };
  };
}

// ---------------------------------------------------------- cubes w/ states ---

function stateCube(name: string, pick: (c: BlockContext) => Partial<Record<Dir, string[]>> | string[], opts: Partial<BlockModel> = {}) {
  return (c: BlockContext): BlockModel => {
    const spec = pick(c);
    const faceTex: Partial<Record<Dir, string>> = {};
    if (Array.isArray(spec)) { const t = tx(c, ...spec); for (const d of ALL) faceTex[d] = t; }
    else for (const d of ALL) { const keys = spec[d]; if (keys) faceTex[d] = tx(c, ...keys); }
    void name;
    return cubeModel(faceTex as never, { static: true, ...opts });
  };
}

function trialSpawner(c: BlockContext): BlockModel {
  const ominous = truthy(st(c.states, 'ominous'));
  const state = String(st(c.states, 'trial_spawner_state') ?? 'inactive');
  const active = state !== 'inactive';
  const p = `trial_spawner${ominous ? '_ominous' : ''}`;
  const top = tx(c, `${p}_top_${active ? 'active' : 'inactive'}`, `${p}_top`, 'trial_spawner_top_inactive');
  const side = tx(c, `${p}_side_${active ? 'active' : 'inactive'}`, `${p}_side`, 'trial_spawner_side_inactive');
  const bottom = tx(c, `${p}_bottom`, 'trial_spawner_bottom');
  return cubeModel({ up: top, down: bottom, north: side, south: side, west: side, east: side }, { static: true, layer: 'translucent', alpha: 1 });
}

function vault(c: BlockContext): BlockModel {
  const ominous = truthy(st(c.states, 'ominous'));
  const dir = cardinal(c.states) ?? 'north';
  const state = String(st(c.states, 'vault_state') ?? 'inactive');
  const p = `vault${ominous ? '_ominous' : ''}`;
  const front = tx(c, `${p}_front_${state}`, `${p}_front_on`, `${p}_front_off`, `${p}_front`);
  const top = tx(c, `${p}_top_${state}`, `${p}_top`, 'vault_top');
  const side = tx(c, `${p}_side_${state}`, `${p}_side_off`, `${p}_side`, 'vault_side_off');
  const bottom = tx(c, `${p}_bottom`, 'vault_bottom');
  const m = cubeModel({ up: top, down: bottom, north: front, south: side, west: side, east: side }, { static: true });
  return { ...m, rotY: yawOf(dir), static: true };
}

function creakingHeart(c: BlockContext): BlockModel {
  const axis = String(st(c.states, 'pillar_axis') ?? 'y');
  const state = String(st(c.states, 'creaking_heart_state') ?? 'uprooted');
  const suffix = state === 'awake' ? '_awake' : state === 'dormant' ? '' : '';
  const side = tx(c, `creaking_heart${suffix}`, 'creaking_heart', 'creaking_heart_side');
  const top = tx(c, `creaking_heart_top${suffix}`, 'creaking_heart_top', side);
  const m = cubeModel({ up: top, down: top, north: side, south: side, west: side, east: side }, { static: true });
  if (axis === 'x') return { ...m, rotX: 90, rotY: 90 };
  if (axis === 'z') return { ...m, rotX: 90 };
  return m;
}

function snifferEgg(c: BlockContext): BlockModel {
  const crack = Math.max(0, Math.min(2, stateNum(c, 'cracked_state')));
  const stage = ['not_cracked', 'cracked', 'very_cracked'][crack];
  const top = tx(c, `sniffer_egg_${stage}_top`, 'sniffer_egg_top');
  const side = tx(c, `sniffer_egg_${stage}_east`, `sniffer_egg_${stage}_side`, 'sniffer_egg_side');
  const bottom = tx(c, 'sniffer_egg_bottom', top);
  return { elements: [box([1, 0, 2], [15, 16, 14], six({ up: top, down: bottom, north: side, south: side, west: side, east: side }))], static: true };
}

function driedGhast(c: BlockContext): BlockModel {
  const dir = cardinal(c.states) ?? 'south';
  const h = Math.max(0, Math.min(4, stateNum(c, 'hydration_level')));
  const part = (p: string) => tx(c, h > 0 ? `dried_ghast_state_${h}_${p}` : `dried_ghast_${p}`, `dried_ghast_${p}`);
  // blocks.json: north = back, south = front, west = right, east = left; the unrotated model faces south
  const m: BlockModel = {
    elements: [box([3, 0, 3], [13, 10, 13], six({ up: part('top'), down: part('bottom'), north: part('back'), south: part('front'), west: part('right'), east: part('left') }, { cull: false }))],
    static: true,
  };
  return { ...m, rotY: (yawOf(dir) + 180) % 360 };
}

function hangingSign(c: BlockContext): BlockModel {
  const wall = /_wall_hanging_sign$/.test(c.name);
  const w = c.name.replace(/_?(wall_)?hanging_sign$/, '');
  const board = tx(c, `${w}_planks`, w ? `planks_${w}` : 'planks#0', `${w}_log`, 'oak_planks');
  const chain = tx(c, 'chain1', 'chain', 'iron_chain');
  if (wall) {
    const f = cardinal(c.states) ?? facingDirection(c.states) ?? 'north';
    const dir = (HORIZONTAL as string[]).includes(String(f)) ? (f as Dir) : 'north';
    return {
      elements: [
        box([0, 14, 6.5], [16, 16, 9.5], six(board, { cull: false })),            // the beam it hangs from
        box([1, 6, 7.5], [15, 14, 8.5], six(board, { cull: false })),             // the board
        box([3, 10, 7.5], [3.2, 16, 8.5], { east: { tex: chain }, west: { tex: chain } }),
        box([12.8, 10, 7.5], [13, 16, 8.5], { east: { tex: chain }, west: { tex: chain } }),
      ],
      rotY: (yawOf(dir) + 90) % 360, static: true,
    };
  }
  const rot = stateNum(c, 'ground_sign_direction') & 15;
  const r = { origin: [8, 8, 8] as V3, axis: 'y' as const, angle: -rot * 22.5 };
  return {
    elements: [
      box([1, 0, 7.5], [15, 10, 8.5], six(board, { cull: false }), { rotation: r }),
      box([7, 10, 7], [9, 16, 9], six(chain, { cull: false }), { rotation: r }),
    ],
    static: true,
  };
}

function shelf(c: BlockContext): BlockModel {
  const dir = cardinal(c.states) ?? 'north';
  const w = c.name.replace(/_shelf$/, '');
  const planks = tx(c, `${w}_planks`, `${w}_shelf`, 'oak_planks', 'planks#0');
  const front = tx(c, `${w}_shelf`, planks);
  const top = tx(c, `${w}_shelf_top`, planks);
  return {
    elements: [
      box([0, 0, 0], [16, 16, 4], six({ north: front, south: planks, up: top, down: top, west: planks, east: planks })),
      box([0, 0, 4], [16, 2, 16], six(planks)),
      box([0, 14, 4], [16, 16, 16], six(planks)),
    ],
    rotY: (yawOf(dir) + 180) % 360, static: true,
  };
}

function azalea(c: BlockContext): BlockModel {
  const flowering = c.name.startsWith('flowering');
  const top = tx(c, flowering ? 'flowering_azalea_top' : 'azalea_top', 'azalea_top');
  const side = tx(c, flowering ? 'flowering_azalea_side' : 'azalea_side', 'azalea_side');
  const plant = tx(c, 'azalea_plant', 'azalea_side');
  return {
    elements: [
      box([0, 8, 0], [16, 16, 16], six({ up: top, down: top, north: side, south: side, west: side, east: side })),
      box([6, 0, 6], [10, 8, 10], six(plant, { cull: false })),
    ],
    static: true,
  };
}

function sporeBlossom(c: BlockContext): BlockModel {
  const tex = tx(c, 'spore_blossom', 'spore_blossom_base');
  const base = tx(c, 'spore_blossom_base', tex);
  return { elements: [box([2, 15, 2], [14, 16, 14], six({ up: base, down: tex, north: base, south: base, west: base, east: base }, { cull: false }))], static: true };
}

function propagule(c: BlockContext): BlockModel {
  const hanging = truthy(st(c.states, 'hanging'));
  const stage = Math.max(0, Math.min(4, stateNum(c, 'propagule_stage')));
  return crossModel(tx(c, hanging ? `mangrove_propagule_hanging_${stage}` : 'mangrove_propagule', 'mangrove_propagule_hanging', 'mangrove_propagule'), null, hanging ? 16 : 16);
}

function bushLike(...keys: string[]) {
  return (c: BlockContext): BlockModel => {
    const t = tx(c, ...keys);
    return { elements: [box([2, 0, 2], [14, 13, 14], six(t, { cull: false }), { shade: false })], static: true };
  };
}

function cactusFlower(c: BlockContext): BlockModel {
  const t = tx(c, 'cactus_flower', 'cactus_flower_top');
  return crossModel(t, null, 8);
}

function eyeblossom(open: boolean) {
  return (c: BlockContext): BlockModel => crossModel(tx(c, open ? 'open_eyeblossom' : 'closed_eyeblossom', 'eyeblossom'), null, 16, open ? { emissive: true } : {});
}

function lodestone(c: BlockContext): BlockModel {
  return cubeModel({ up: tx(c, 'lodestone_top'), down: tx(c, 'lodestone_top'), north: tx(c, 'lodestone_side'), south: tx(c, 'lodestone_side'), west: tx(c, 'lodestone_side'), east: tx(c, 'lodestone_side') }, { static: true });
}

function smallCube(size: number, ...keys: string[]) {
  return (c: BlockContext): BlockModel => {
    const t = tx(c, ...keys);
    const a = (16 - size) / 2;
    return { elements: [box([a, 0, a], [a + size, size, a + size], six(t))], static: true };
  };
}

function copperGolemStatue(c: BlockContext): BlockModel {
  const dir = cardinal(c.states) ?? 'north';
  const t = tx(c, c.name.replace(/^waxed_/, '').replace(/_statue$/, '') + '_block', c.name.replace(/^waxed_/, ''), 'copper_block');
  return {
    elements: [box([3, 0, 3], [13, 5, 13], six(t)), box([4, 5, 5], [12, 12, 11], six(t)), box([3, 12, 3], [13, 20, 13], six(t))],
    rotY: yawOf(dir), static: true,
  };
}


// ------------------------------------------------------------ copper chests ---

function frogSpawn(c: BlockContext): BlockModel {
  const t = tx(c, 'frogspawn', 'frog_spawn');
  return { elements: [box([0, 0.2, 0], [16, 0.2, 16], { up: { tex: t, uv: [0, 0, 16, 16], cull: false }, down: { tex: t, uv: [0, 0, 16, 16], cull: false } }, { shade: false })], static: true };
}

// ------------------------------------------- legacy "stone_block_slab[2-4]" ids ---

const LEGACY_SLABS: Record<string, string[]> = {
  '': ['smooth_stone', 'sandstone', 'oak', 'cobblestone', 'brick', 'stone_brick', 'quartz', 'nether_brick'],
  '2': ['red_sandstone', 'purpur', 'prismarine', 'dark_prismarine', 'prismarine_brick', 'mossy_cobblestone', 'smooth_sandstone', 'red_nether_brick'],
  '3': ['end_stone_brick', 'smooth_red_sandstone', 'polished_andesite', 'andesite', 'diorite', 'polished_diorite', 'granite', 'polished_granite'],
  '4': ['mossy_stone_brick', 'smooth_quartz', 'stone', 'cut_sandstone', 'cut_red_sandstone'],
};
const SLAB_TYPE_KEY: Record<string, string> = { '': 'stone_slab_type', '2': 'stone_slab_type_2', '3': 'stone_slab_type_3', '4': 'stone_slab_type_4' };
const SLAB_TYPE_NAMES: Record<string, string[]> = {
  '': ['stone', 'sandstone', 'wood', 'cobblestone', 'brick', 'stone_brick', 'quartz', 'nether_brick'],
  '2': ['red_sandstone', 'purpur', 'prismarine_rough', 'prismarine_dark', 'prismarine_brick', 'mossy_cobblestone', 'smooth_sandstone', 'red_nether_brick'],
  '3': ['end_stone_brick', 'smooth_red_sandstone', 'polished_andesite', 'andesite', 'diorite', 'polished_diorite', 'granite', 'polished_granite'],
  '4': ['mossy_stone_brick', 'smooth_quartz', 'stone', 'cut_sandstone', 'cut_red_sandstone'],
};

function legacySlab(c: BlockContext): BlockModel | undefined {
  const m = c.name.match(/^(double_)?stone_block_slab([234])?$/);
  if (!m) return undefined;
  const n = m[2] ?? '';
  const raw = st(c.states, SLAB_TYPE_KEY[n]);
  const idx = typeof raw === 'string' ? Math.max(0, SLAB_TYPE_NAMES[n].indexOf(raw)) : Math.max(0, num(raw, 0));
  const base = LEGACY_SLABS[n][Math.min(idx, LEGACY_SLABS[n].length - 1)];
  const spec = baseCube(base, c.resources);
  if (!spec) return undefined;
  if (m[1]) return specToModel({ ...spec, opaque: true });
  const top = truthy(st(c.states, 'top_slot_bit')) || st(c.states, 'minecraft:vertical_half') === 'top';
  return { elements: [box([0, top ? 8 : 0, 0], [16, top ? 16 : 8, 16], faces(spec.faces as never))], static: true };
}

// ---------------------------------------------------------------- register ---

export function registerModern2(reg: BlockRegistry): void {
  // plants & small cross shapes
  reg.register('torchflower', plant('torchflower'));
  reg.register('torchflower_crop', staged('torchflower_crop_stage', 1));
  reg.register('pitcher_plant', twoTall('pitcher_plant'));
  reg.register('pitcher_crop', (c) => {
    const upper = truthy(st(c.states, 'upper_block_bit'));
    const g = Math.max(0, Math.min(4, stateNum(c, 'growth')));
    return crossModel(tx(c, `pitcher_crop_${upper ? 'top' : 'bottom'}_stage_${g}`, `pitcher_crop_${upper ? 'top' : 'bottom'}`, 'pitcher_crop'));
  });
  reg.register(['twisting_vines'], vineColumn('twisting_vines_base', 'twisting_vines', 'twisting_vines_plant'));
  reg.register(['twisting_vines_bottom'], vineColumn('twisting_vines_bottom', 'twisting_vines_base', 'twisting_vines'));
  reg.register(['weeping_vines'], vineColumn('weeping_vines_base', 'weeping_vines', 'weeping_vines_plant'));
  reg.register(['weeping_vines_bottom'], vineColumn('weeping_vines_bottom', 'weeping_vines_base', 'weeping_vines'));
  reg.register(['cave_vines', 'cave_vines_head_with_berries', 'cave_vines_body_with_berries'], (c) => {
    const berries = /berries/.test(c.name) || truthy(st(c.states, 'berries'));
    const head = /head/.test(c.name);
    const part = head ? 'head' : 'body';
    return crossModel(tx(c, berries ? `cave_vines_${part}_berries` : `cave_vines_${part}`, `cave_vines_${part}`, 'cave_vines_body', 'cave_vines_lit', 'cave_vines'));
  });
  reg.register(['crimson_fungus', 'warped_fungus', 'crimson_roots', 'warped_roots', 'nether_sprouts', 'hanging_roots', 'pale_hanging_moss'], (c) => crossModel(tx(c, c.name, c.name.replace(/^pale_/, ''))));
  reg.register('mangrove_propagule', propagule);
  reg.register(['sapling_cherry', 'cherry_sapling', 'pale_oak_sapling', 'bamboo_sapling_cherry'], (c) => crossModel(tx(c, c.name, c.name.replace(/^sapling_/, '') + '_sapling')));
  reg.register(['bush', 'firefly_bush'], (c) => bushLike(c.name, `${c.name}_top`)(c));
  reg.register(['short_dry_grass', 'tall_dry_grass'], (c) => crossModel(tx(c, c.name, 'short_dry_grass')));
  reg.register('cactus_flower', cactusFlower);
  reg.register('open_eyeblossom', eyeblossom(true));
  reg.register('closed_eyeblossom', eyeblossom(false));
  reg.register('azalea', azalea);
  reg.register('flowering_azalea', azalea);
  reg.register('spore_blossom', sporeBlossom);
  reg.register(['leaf_litter'], petals('leaf_litter', 'leaf_litter_top'));
  reg.register(['wildflowers'], petals('wildflowers', 'wildflowers_stem'));
  reg.register(['pink_petals'], petals('pink_petals', 'pink_petals_stem'));
  reg.register(['moss_carpet'], carpetOf('moss_block', 'moss_carpet'));
  reg.register(['pale_moss_carpet'], carpetOf('pale_moss_block', 'pale_moss_carpet'));
  reg.register(['glow_lichen'], multiFace('glow_lichen', 'lichen'));
  reg.register(['sculk_vein'], multiFace('sculk_vein'));
  reg.register(['resin_clump'], multiFace('resin_clump'));
  reg.register(['big_dripleaf'], dripleafBig);
  reg.register(['small_dripleaf_block', 'small_dripleaf'], dripleafSmall);

  // amethyst & dripstone
  reg.register('amethyst_cluster', amethyst(7, 12, 'amethyst_cluster'));
  reg.register('large_amethyst_bud', amethyst(5, 10, 'large_amethyst_bud'));
  reg.register('medium_amethyst_bud', amethyst(4, 8, 'medium_amethyst_bud'));
  reg.register('small_amethyst_bud', amethyst(3, 6, 'small_amethyst_bud'));
  reg.register('pointed_dripstone', pointedDripstone);

  // sculk family
  reg.register(['sculk_sensor', 'calibrated_sculk_sensor'], sculkSensor);
  reg.register('sculk_shrieker', sculkShrieker);
  reg.register('sculk_catalyst', stateCube('sculk_catalyst', () => ({
    up: ['sculk_catalyst_top', 'sculk_catalyst_top_bloom'], down: ['sculk_catalyst_bottom'],
    north: ['sculk_catalyst_side'], south: ['sculk_catalyst_side'], west: ['sculk_catalyst_side'], east: ['sculk_catalyst_side'],
  })));

  // candle cakes, bookshelf, pot, rods, lanterns
  reg.registerPattern(/(^|_)candle_cake$/, candleCake);
  reg.register('chiseled_bookshelf', chiseledBookshelf);
  reg.register('decorated_pot', decoratedPot);
  reg.registerPattern(/(^|_)lightning_rod$/, lightningRod);
  reg.registerPattern(/^(waxed_)?(exposed_|weathered_|oxidized_)?copper_lantern$/, copperLantern);
  reg.registerPattern(/_wall_hanging_sign$|_hanging_sign$/, hangingSign);
  reg.registerPattern(/_shelf$/, shelf);
  reg.registerPattern(/^(waxed_)?(exposed_|weathered_|oxidized_)?copper_golem_statue$/, copperGolemStatue);

  // cubes whose faces / textures depend on state
  reg.register('trial_spawner', trialSpawner);
  reg.register('vault', vault);
  reg.register('creaking_heart', creakingHeart);
  reg.register('sniffer_egg', snifferEgg);
  reg.register('dried_ghast', driedGhast);
  reg.register('lodestone', lodestone);
  reg.register('heavy_core', smallCube(8, 'heavy_core', 'heavy_core_side'));
  reg.register(['mob_spawner', 'spawner'], (c) => cubeModel(tx(c, 'mob_spawner', 'spawner'), { static: true, layer: 'translucent', alpha: 1 }));
  reg.register(['light_block', 'light'], () => null);
  reg.register(['camera', 'test_block', 'test_instance_block', 'client_request_placeholder_block', 'element_0', 'info_update', 'info_update2', 'reserved6'], () => null);
  reg.register('tinted_glass', (c) => cubeModel(tx(c, 'tinted_glass'), { static: true, layer: 'translucent', cullSame: true, alpha: 0.9, opaque: false }));
  reg.register('powder_snow', (c) => cubeModel(tx(c, 'powder_snow'), { static: true }));
  reg.register(['suspicious_sand', 'suspicious_gravel'], (c) => {
    const base = c.name.replace(/^suspicious_/, '');
    const n = Math.max(0, Math.min(3, stateNum(c, 'brushed_progress')));
    return cubeModel(tx(c, `${c.name}_${n}`, `${c.name}`, base), { static: true });
  });
  reg.register(['bee_nest', 'beehive'], (c) => {
    const dir = cardinal(c.states) ?? 'north';
    const honey = stateNum(c, 'honey_level') >= 5;
    const front = tx(c, `${c.name}_front${honey ? '_honey' : ''}`, `${c.name}_front`);
    const side = tx(c, `${c.name}_side`), top = tx(c, `${c.name}_top`), bottom = tx(c, `${c.name}_bottom`, top);
    return { ...cubeModel({ up: top, down: bottom, north: front, south: side, west: side, east: side }, { static: true }), rotY: yawOf(dir) };
  });
  reg.register('noteblock', (c) => cubeModel(tx(c, 'noteblock', 'note_block'), { static: true }));
  reg.register('frog_spawn', frogSpawn);
  reg.register('frogspawn', frogSpawn);
  reg.registerPattern(/^(double_)?stone_block_slab[234]?$/, legacySlab);
  reg.register(['azalea_leaves_flowered', 'azalea_leaves'], (c) => cubeModel(tx(c, c.name, 'azalea_leaves'), { static: true, opaque: false }));
  reg.register('mangrove_roots', (c) => cubeModel({ up: tx(c, 'mangrove_roots_top'), down: tx(c, 'mangrove_roots_top'), north: tx(c, 'mangrove_roots_side'), south: tx(c, 'mangrove_roots_side'), west: tx(c, 'mangrove_roots_side'), east: tx(c, 'mangrove_roots_side') }, { static: true, opaque: false }));
}

// ------------------------------------------------------------- last resort ---

const PLANTISH = /(sapling|propagule|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|valley|poppy|fungus|roots|sprouts|shrub|flower|mushroom|grass|fern)$/;
const NOT_CUBE = /(stairs|slab|wall|fence|door|trapdoor|button|plate|sign|bars|chest|carpet|pane|torch|lantern|chain|campfire|vine|candle|cluster|_bud$|rod$|pot$|frame|banner|head|skull|bed$|egg|bulb|anchor|shelf|petals|litter)/;

/**
 * Used for ids no handler knows: a plant-like name whose texture exists becomes a cross, any other block whose
 * texture (`name`, or `name_side` + `name_top`) exists becomes a cube. Returns `undefined` when nothing matches,
 * so truly unknown blocks still show the placeholder.
 */
export function genericFallback(c: BlockContext): BlockModel | undefined {
  const n = c.name.replace(/^waxed_/, '');
  const has = (k: string) => c.resources.hasTexture(k);
  if (PLANTISH.test(n) && has(n)) return crossModel(n);
  if (NOT_CUBE.test(n)) return undefined;
  const side = [`${n}_side`, n].find(has);
  if (!side) return undefined;
  const top = [`${n}_top`].find(has) ?? side;
  const bottom = [`${n}_bottom`].find(has) ?? top;
  return cubeModel({ up: top, down: bottom, north: side, south: side, west: side, east: side }, { static: true });
}

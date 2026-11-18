import {
  BlockContext, BlockRef, BlockRegistry, COLORS, CubeSpec, WOODS, baseCube, cardinal, cubeSpec, facingDirection,
  isDir, num, specToModel, st, truthy,
} from './blockutil';
import {
  BlockModel, DIR_VEC, Dir, Element, FaceSpec, HORIZONTAL, V3, box, cubeModel, faces, orientTo, yawOf,
} from './models';

const CCW: Record<string, Dir> = { east: 'north', north: 'west', west: 'south', south: 'east' };
const axisOf = (d: Dir) => (d === 'east' || d === 'west' ? 'x' : d === 'north' || d === 'south' ? 'z' : 'y');
const OPP: Record<string, Dir> = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };

/** Texture faces of a base block, or the missing texture. */
function specOrMissing(base: string, c: BlockContext): CubeSpec {
  return baseCube(base, c.resources) ?? {
    faces: { up: 'missing', down: 'missing', north: 'missing', south: 'missing', west: 'missing', east: 'missing' },
  };
}

// ------------------------------------------------------------------ slabs ---

function slab(c: BlockContext): BlockModel {
  // `exposed_double_cut_copper_slab` → `exposed_cut_copper`; legacy `wooden_slab` / `double_wooden_slab` take the wood from `wood_type`
  let base = c.name.replace(/_double_slab$|_slab$/, '').replace(/^double_/, '').replace(/_double_/, '_').replace(/^waxed_/, '');
  if (base === 'wooden') {
    const wood = st(c.states, 'wood_type');
    base = `${typeof wood === 'string' ? wood.replace(/^dark_oak$/, 'dark_oak') : ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'][num(wood)] ?? 'oak'}_planks`;
  }
  const spec = specOrMissing(base, c);
  if (/double/.test(c.name)) return specToModel({ ...spec, opaque: true });
  const top = st(c.states, 'vertical_half') === 'top' || truthy(st(c.states, 'top_slot_bit'));
  const [y0, y1] = top ? [8, 16] : [0, 8];
  return {
    elements: [box([0, y0, 0], [16, y1, 16], faces(spec.faces))],
    static: true,
    layer: spec.layer, alpha: spec.alpha,
  };
}

// ----------------------------------------------------------------- stairs ---

const WEIRDO: Dir[] = ['east', 'west', 'south', 'north'];
const stairFacing = (r: BlockRef): Dir => WEIRDO[num(st(r.states, 'weirdo_direction'))] ?? 'east';
const isStairs = (r: BlockRef | null): r is BlockRef => !!r && r.name.endsWith('_stairs');
const stairUpside = (r: BlockRef) => truthy(st(r.states, 'upside_down_bit'));

function stairShape(c: BlockContext): 'straight' | 'outer_left' | 'outer_right' | 'inner_left' | 'inner_right' {
  const facing = stairFacing(c), up = stairUpside(c);
  const canTake = (face: Dir): boolean => {
    const v = DIR_VEC[face];
    const o = c.neighbor(v[0], v[1], v[2]);
    return !isStairs(o) || stairFacing(o) !== facing || stairUpside(o) !== up;
  };
  const f = DIR_VEC[facing];
  const front = c.neighbor(f[0], 0, f[2]);
  if (isStairs(front) && stairUpside(front) === up) {
    const d1 = stairFacing(front);
    if (axisOf(d1) !== axisOf(facing) && canTake(OPP[d1])) return d1 === CCW[facing] ? 'outer_left' : 'outer_right';
  }
  const back = c.neighbor(-f[0], 0, -f[2]);
  if (isStairs(back) && stairUpside(back) === up) {
    const d2 = stairFacing(back);
    if (axisOf(d2) !== axisOf(facing) && canTake(d2)) return d2 === CCW[facing] ? 'inner_left' : 'inner_right';
  }
  return 'straight';
}

function stairs(c: BlockContext): BlockModel {
  let base = c.name.replace(/_stairs$/, '');
  if (base === 'stone') base = 'cobblestone'; // Bedrock's "stone_stairs" are cobblestone stairs
  if (base === 'normal_stone') base = 'stone';
  const spec = specOrMissing(base, c);
  const facing = stairFacing(c), up = stairUpside(c);
  const shape = stairShape(c);
  const [b0, b1] = up ? [8, 16] : [0, 8];       // the full-width slab
  const [s0, s1] = up ? [0, 8] : [8, 16];       // the raised step
  const f = DIR_VEC[facing];
  const left: [number, number] = [f[2], -f[0]];
  const quarter = (qf: 1 | -1, ql: 1 | -1): [V3, V3] => {
    const sx = qf * f[0] + ql * left[0], sz = qf * f[2] + ql * left[1];
    const x0 = sx > 0 ? 8 : 0, z0 = sz > 0 ? 8 : 0;
    return [[x0, s0, z0], [x0 + 8, s1, z0 + 8]];
  };
  const backHalf = (): [V3, V3] => {
    switch (facing) {
      case 'east': return [[8, s0, 0], [16, s1, 16]];
      case 'west': return [[0, s0, 0], [8, s1, 16]];
      case 'south': return [[0, s0, 8], [16, s1, 16]];
      default: return [[0, s0, 0], [16, s1, 8]];
    }
  };
  const boxes: [V3, V3][] = [[[0, b0, 0], [16, b1, 16]]];
  if (shape === 'straight') boxes.push(backHalf());
  else if (shape === 'outer_left') boxes.push(quarter(1, 1));
  else if (shape === 'outer_right') boxes.push(quarter(1, -1));
  else if (shape === 'inner_left') boxes.push(backHalf(), quarter(-1, 1));
  else boxes.push(backHalf(), quarter(-1, -1));
  return { elements: boxes.map(([a, b]) => box(a, b, faces(spec.faces))), layer: spec.layer };
}

// ------------------------------------------------------- fences / walls ---

function connectsSolid(c: BlockContext, dx: number, dz: number): boolean {
  return c.isOpaque(dx, 0, dz);
}

function fence(c: BlockContext): BlockModel {
  let base = c.name.replace(/_fence$/, '');
  if (base === 'fence') base = WOODS[num(st(c.states, 'wood_type'))] ?? 'oak';
  const spec = specOrMissing(base, c);
  const f = faces(spec.faces.north);
  const els: Element[] = [box([6, 0, 6], [10, 16, 10], f)];
  const arm = (from: V3, to: V3) => box(from, to, faces(spec.faces.north));
  const isFence = (n: BlockRef | null) => !!n && (/_fence$/.test(n.name) || /_fence_gate$/.test(n.name) || n.name === 'fence');
  const dirs: [Dir, number, number][] = [['north', 0, -1], ['south', 0, 1], ['west', -1, 0], ['east', 1, 0]];
  for (const [d, dx, dz] of dirs) {
    if (!(isFence(c.neighbor(dx, 0, dz)) || connectsSolid(c, dx, dz))) continue;
    const ranges: Record<string, [V3, V3][]> = {
      north: [[[7, 6, 0], [9, 9, 6]], [[7, 12, 0], [9, 15, 6]]],
      south: [[[7, 6, 10], [9, 9, 16]], [[7, 12, 10], [9, 15, 16]]],
      west: [[[0, 6, 7], [6, 9, 9]], [[0, 12, 7], [6, 15, 9]]],
      east: [[[10, 6, 7], [16, 9, 9]], [[10, 12, 7], [16, 15, 9]]],
    };
    for (const [a, b] of ranges[d]) els.push(arm(a, b));
  }
  return { elements: els };
}

function wall(c: BlockContext): BlockModel {
  const base = c.name.replace(/_wall$/, '');
  const spec = specOrMissing(base, c);
  const tex = spec.faces.north;
  const els: Element[] = [];
  const dirs: [Dir, number, number][] = [['north', 0, -1], ['south', 0, 1], ['west', -1, 0], ['east', 1, 0]];
  const conn: Record<string, number> = {};
  for (const [d, dx, dz] of dirs) {
    const s = st(c.states, `wall_connection_type_${d}`);
    if (s === 'tall') conn[d] = 16;
    else if (s === 'short') conn[d] = 14;
    else if (s === undefined) {
      const n = c.neighbor(dx, 0, dz);
      conn[d] = n && (/_wall$/.test(n.name) || /_fence_gate$/.test(n.name) || c.isOpaque(dx, 0, dz)) ? 14 : 0;
    } else conn[d] = 0;
  }
  const n = HORIZONTAL.filter((d) => conn[d] > 0);
  const straight = n.length === 2 && OPP[n[0]] === n[1];
  const postBit = st(c.states, 'wall_post_bit');
  const post = postBit === undefined ? !straight : truthy(postBit);
  if (post || n.length === 0) els.push(box([4, 0, 4], [12, 16, 12], faces(tex)));
  const ranges: Record<string, (h: number) => [V3, V3]> = {
    north: (h) => [[5, 0, 0], [11, h, 8]], south: (h) => [[5, 0, 8], [11, h, 16]],
    west: (h) => [[0, 0, 5], [8, h, 11]], east: (h) => [[8, 0, 5], [16, h, 11]],
  };
  for (const d of n) { const [a, b] = ranges[d](conn[d]); els.push(box(a, b, faces(tex))); }
  return { elements: els };
}

// ------------------------------------------------------------ panes / bars ---

function pane(c: BlockContext): BlockModel {
  const bars = /(^|_)(iron|copper)_bars$/.test(c.name);
  const iron = c.name === 'iron_bars';
  let side: string, edge: string, layer: 'translucent' | undefined;
  const m = c.name.match(/^(.+)_stained_glass_pane$/);
  if (iron) { side = 'iron_bars'; edge = 'iron_bars_edge'; }
  else if (bars) { side = c.name.replace(/^waxed_/, ''); edge = side; }
  else if (m && COLORS.includes(m[1])) {
    const i = COLORS.indexOf(m[1]);
    side = `stained_glass#${i}`; edge = `stained_glass_pane_top#${i}`; layer = 'translucent';
  } else { side = 'glass'; edge = 'glass_pane_top'; }
  const f = (): Partial<Record<Dir, FaceSpec>> => ({
    north: { tex: side, cull: false }, south: { tex: side, cull: false }, west: { tex: side, cull: false }, east: { tex: side, cull: false },
    up: { tex: edge, cull: false }, down: { tex: edge, cull: false },
  });
  const isPaneLike = (n: BlockRef | null) => !!n && (/_pane$/.test(n.name) || /_bars$/.test(n.name) || /_wall$/.test(n.name) || /glass$/.test(n.name));
  const dirs: [Dir, number, number][] = [['north', 0, -1], ['south', 0, 1], ['west', -1, 0], ['east', 1, 0]];
  const els: Element[] = [];
  let any = false;
  const arms: Element[] = [];
  const ranges: Record<string, [V3, V3]> = {
    north: [[7, 0, 0], [9, 16, 8]], south: [[7, 0, 8], [9, 16, 16]],
    west: [[0, 0, 7], [8, 16, 9]], east: [[8, 0, 7], [16, 16, 9]],
  };
  for (const [d, dx, dz] of dirs) {
    if (isPaneLike(c.neighbor(dx, 0, dz)) || c.isOpaque(dx, 0, dz)) { any = true; arms.push(box(ranges[d][0], ranges[d][1], f())); }
  }
  if (!any) {
    // isolated: Java shows a full "+" of four arms
    for (const d of HORIZONTAL) arms.push(box(ranges[d][0], ranges[d][1], f()));
  } else els.push(box([7, 0, 7], [9, 16, 9], f()));
  return { elements: [...els, ...arms], layer, cullKey: undefined };
}

// ------------------------------------------------------------ flat things ---

function carpet(c: BlockContext): BlockModel {
  const m = c.name.match(/^(.+)_carpet$/);
  const i = m ? COLORS.indexOf(m[1]) : -1;
  const tex = i >= 0 ? `wool#${i}` : 'missing';
  return { elements: [box([0, 0, 0], [16, 1, 16], faces(tex))], static: true };
}

function snowLayer(c: BlockContext): BlockModel {
  const h = (num(st(c.states, 'height')) + 1) * 2;
  return { elements: [box([0, 0, 0], [16, h, 16], faces('snow'))], static: true };
}

const RAIL_TEX: Record<string, [string, string]> = {
  rail: ['rail_normal', 'rail_normal_turned'],
  golden_rail: ['rail_golden', 'rail_golden'],
  detector_rail: ['rail_detector', 'rail_detector'],
  activator_rail: ['rail_activator', 'rail_activator'],
};

function rail(c: BlockContext): BlockModel {
  const shape = num(st(c.states, 'rail_direction'));
  const powered = truthy(st(c.states, 'rail_data_bit'));
  const [straight, curved] = RAIL_TEX[c.name];
  const powerSuffix = c.name !== 'rail' && powered ? '_powered' : '';
  const stexture = c.name === 'rail' ? straight : `${straight}${powerSuffix}`;
  const Y = 0.5;
  const flat = (tex: string): Element => box([0, Y, 0], [16, Y, 16], { up: { tex, uv: [0, 0, 16, 16], cull: false } });
  const slope = (tex: string, angle: number): Element =>
    box([0, 8.5, 0], [16, 8.5, 16], { up: { tex, uv: [0, 0, 16, 16], cull: false } },
      { rotation: { origin: [8, 8.5, 8], axis: 'z', angle, rescale: true } });
  switch (shape) {
    case 1: return { elements: [flat(stexture)], rotY: 90 };
    case 2: return { elements: [slope(stexture, 45)] };                    // ascending east
    case 3: return { elements: [slope(stexture, -45)] };                   // ascending west
    case 4: return { elements: [slope(stexture, 45)], rotY: 270 };         // ascending north
    case 5: return { elements: [slope(stexture, 45)], rotY: 90 };          // ascending south
    case 6: return { elements: [flat(curved)], rotY: 0 };                  // south+east
    case 7: return { elements: [flat(curved)], rotY: 90 };                 // south+west
    case 8: return { elements: [flat(curved)], rotY: 180 };                // north+west
    case 9: return { elements: [flat(curved)], rotY: 270 };                // north+east
    default: return { elements: [flat(stexture)] };
  }
}

function ladder(c: BlockContext): BlockModel {
  const f = facingDirection(c.states) ?? 'north';
  const s: FaceSpec = { tex: 'ladder', uv: [0, 0, 16, 16], cull: false };
  return {
    elements: [box([0, 0, 15.2], [16, 16, 15.2], { north: s, south: s })],
    rotY: yawOf(f),
  };
}

// --------------------------------------------------------------- plants ---

function cross(tex: string, tint: FaceSpec['tint'] = null): BlockModel {
  const f = (): FaceSpec => ({ tex, uv: [0, 0, 16, 16], cull: false, tint });
  const plane = (angle: number): Element => box([0.8, 0, 8], [15.2, 16, 8], { north: f(), south: f() },
    { rotation: { origin: [8, 8, 8], axis: 'y', angle, rescale: true }, shade: false });
  return { elements: [plane(45), plane(-45)], static: true };
}

const FLOWERS = ['poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley'];

// ------------------------------------------------------------------ water ---

const WATER_MODELS = new Map<number, BlockModel>();   // one shared (immutable) model per surface height

function water(c: BlockContext): BlockModel {
  const depth = num(st(c.states, 'liquid_depth'));
  const above = c.neighbor(0, 1, 0);
  const full = depth >= 8 || (!!above && (above.name === 'water' || above.name === 'flowing_water'));
  const h = full ? 16 : (8 - depth) / 9 * 16;
  let model = WATER_MODELS.get(h);
  if (!model) {
    const t: FaceSpec = { tex: 'still_water_grey', tint: 'water', uv: [0, 0, 16, 16] };
    model = {
      elements: [box([0, 0, 0], [16, h, 16], {
        down: { ...t }, up: { ...t, cull: false }, north: { ...t }, south: { ...t }, west: { ...t }, east: { ...t },
      })],
      layer: 'translucent', cullSame: true, cullKey: 'water', alpha: 0.72,
    };
    WATER_MODELS.set(h, model);
  }
  return model;
}

// ------------------------------------------------- oriented full cubes ---

function furnaceLike(prefix: string, lit: boolean) {
  return (c: BlockContext): BlockModel => {
    const f = cardinal(c.states) ?? 'north';
    const l = lit || c.name.startsWith('lit_');
    const side = `${prefix}_side#0`, top = `${prefix}_top#0`;
    const m = cubeModel({ north: `${prefix}_front_${l ? 'on' : 'off'}`, south: side, east: side, west: side, up: top, down: top });
    return { ...m, rotY: yawOf(f), emissive: false, static: true };
  };
}

function dispenser(kind: 'dispenser' | 'dropper') {
  return (c: BlockContext): BlockModel => {
    const f = facingDirection(c.states) ?? 'north';
    const vertical = f === 'up' || f === 'down';
    const front = `${kind}_front_${vertical ? 'vertical' : 'horizontal'}`;
    const side = `${kind}_side`, top = `${kind}_top`;
    const t: Partial<Record<Dir, string>> = vertical
      ? { up: f === 'up' ? front : top, down: f === 'down' ? front : top, north: side, south: side, east: side, west: side }
      : { north: front, south: side, east: side, west: side, up: top, down: top };
    const m = cubeModel(t);
    return vertical ? { ...m, static: true } : { ...m, rotY: yawOf(f), static: true };
  };
}

function pumpkinFace(lit: boolean) {
  return (c: BlockContext): BlockModel => {
    const f = cardinal(c.states) ?? 'north';
    const m = cubeModel({
      north: `pumpkin_face#${lit ? 1 : 0}`, south: 'pumpkin_side#0', east: 'pumpkin_side#0', west: 'pumpkin_side#0',
      up: 'pumpkin_top#0', down: 'pumpkin_top#0',
    }, { emissive: lit });
    return { ...m, rotY: yawOf(f), static: true };
  };
}

// --------------------------------------------------------------- register ---

export function registerShapes(reg: BlockRegistry): void {
  reg.register(['air', 'cave_air', 'void_air', 'structure_void', 'barrier', 'light_block', 'allow', 'deny', 'border_block', 'invisible_bedrock'], () => null);

  // drawn by the entity pass (geometry + texture come from the resource pack)
  reg.register('bed', () => null);
  reg.registerPattern(/^(?!straw)(.+)_bed$/, () => null);               // flattened bed ids are drawn by the entity pass
  reg.registerPattern(/^light_block(_\d+)?$/, () => null);
  reg.register(['unknown', 'info_update', 'info_update2'], () => null);
  reg.registerPattern(/shulker_box$/, () => null);
  reg.registerPattern(/(^skull$|_skull$|_head$)/, () => null);

  reg.registerPattern(/_slab$/, slab);
  reg.registerPattern(/_stairs$/, stairs);
  reg.registerPattern(/_fence$/, fence);
  reg.register('fence', fence);
  reg.registerPattern(/_wall$/, wall);
  reg.registerPattern(/(^glass_pane$|_stained_glass_pane$|(^|_)(iron|copper)_bars$)/, pane);
  reg.registerPattern(/_carpet$/, carpet);
  reg.register('snow_layer', snowLayer);
  reg.register(['rail', 'golden_rail', 'detector_rail', 'activator_rail'], rail);
  reg.register('ladder', ladder);
  reg.register(['water', 'flowing_water'], water);

  reg.register('furnace', furnaceLike('furnace', false)); reg.register('lit_furnace', furnaceLike('furnace', true));
  reg.register('blast_furnace', furnaceLike('blast_furnace', false)); reg.register('lit_blast_furnace', furnaceLike('blast_furnace', true));
  reg.register('smoker', furnaceLike('smoker', false)); reg.register('lit_smoker', furnaceLike('smoker', true));
  reg.register('dispenser', dispenser('dispenser')); reg.register('dropper', dispenser('dropper'));
  reg.register('carved_pumpkin', pumpkinFace(false)); reg.register('lit_pumpkin', pumpkinFace(true));

  // cross-shaped plants
  reg.register('dandelion', () => cross('yellow_flower')); reg.register('yellow_flower', () => cross('yellow_flower'));
  FLOWERS.forEach((f, i) => reg.register(f, () => cross(`red_flower#${i}`)));
  reg.register('red_flower', (c) => cross(`red_flower#${Math.max(0, FLOWERS.indexOf(String(st(c.states, 'flower_type') ?? 'poppy')))}`));
  reg.register(['short_grass', 'tallgrass'], () => cross('tallgrass#1', 'grass'));
  reg.register('fern', () => cross('tallgrass#2', 'grass'));
  reg.register('deadbush', () => cross('deadbush')); reg.register('dead_bush', () => cross('deadbush'));
  reg.register(['reeds', 'sugar_cane'], () => cross('reeds', 'grass'));
  reg.register(['web', 'cobweb'], () => cross('web'));
  reg.register('brown_mushroom', () => cross('mushroom_brown')); reg.register('red_mushroom', () => cross('mushroom_red'));
  WOODS.forEach((w, i) => reg.register(`${w}_sapling`, () => cross(`sapling#${i}`)));

  // blocks whose texture comes from the generic table but need pillar/axis handling
  reg.registerPattern(/^quartz_block$/, (c) => {
    const kind = String(st(c.states, 'chisel_type') ?? 'default');
    const idx = ({ default: 0, chiseled: 1, lines: 2, smooth: 3 } as Record<string, number>)[kind] ?? 0;
    const spec = cubeSpec(['quartz_block', 'chiseled_quartz_block', 'quartz_pillar', 'smooth_quartz'][idx], c.resources);
    return spec ? specToModel(spec, c.states) : undefined;
  });

  // fallback: any block that has a cube texture entry
  reg.fallback = (c) => {
    const spec = cubeSpec(c.name, c.resources);
    return spec ? specToModel(spec, c.states) : undefined;
  };
}

export { isDir };

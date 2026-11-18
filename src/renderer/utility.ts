import { BlockContext, BlockRegistry, WOODS, baseCube, facingDirection, firstTexture, num, st, truthy } from './blockutil';
import { BlockModel, DIRS, DIR_VEC, Dir, Element, FaceSpec, HORIZONTAL, OPPOSITE, V3, box, cubeModel, faces, orientTo, yawOf } from './models';
import { crossModel, full, horizontalFacing, stateNum } from './kit';

/**
 * Doors, gates, signs, banners and the "workstation / decoration" blocks. Shapes follow the vanilla outlines
 * (1/16 block units); every texture comes from the resource pack.
 */

const AXIS_X = (d: Dir) => d === 'east' || d === 'west';

// ------------------------------------------------------------------ doors ---

const DOOR_AABB: Record<string, [V3, V3]> = {
  east: [[0, 0, 0], [3, 16, 16]], south: [[0, 0, 0], [16, 16, 3]], west: [[13, 0, 0], [16, 16, 16]], north: [[0, 0, 13], [16, 16, 16]],
};
const DOOR_OPEN: Record<string, [string, string]> = { east: ['south', 'north'], south: ['west', 'east'], west: ['north', 'south'], north: ['east', 'west'] };
/** Bedrock legacy `direction` (east, south, west, north) — only used when `minecraft:cardinal_direction` is absent. */
const DOOR_LEGACY: Dir[] = ['east', 'south', 'west', 'north'];

const DOOR_TEX: Record<string, number> = { wooden_door: 0, oak_door: 0, spruce_door: 1, birch_door: 2, jungle_door: 3, acacia_door: 4, dark_oak_door: 5, iron_door: 6 };

function door(c: BlockContext): BlockModel {
  const upper = truthy(st(c.states, 'upper_block_bit'));
  const other = c.neighbor(0, upper ? -1 : 1, 0);
  const sameDoor = other && other.name === c.name ? other : null;
  // facing + open live on the lower half, the hinge on the upper half
  const lower = upper ? (sameDoor ?? c) : c;
  const top = upper ? c : (sameDoor ?? c);
  const cardinalV = st(lower.states, 'minecraft:cardinal_direction') ?? st(lower.states, 'cardinal_direction');
  const facing: Dir = typeof cardinalV === 'string' && (HORIZONTAL as string[]).includes(cardinalV)
    ? (cardinalV as Dir) : DOOR_LEGACY[num(st(lower.states, 'direction')) & 3];
  const open = truthy(st(lower.states, 'open_bit'));
  const hingeRight = truthy(st(top.states, 'door_hinge_bit'));
  const closed = DOOR_AABB[facing];
  const openKey = DOOR_OPEN[facing][hingeRight ? 0 : 1];
  const [from, to] = open ? DOOR_AABB[openKey] : closed;
  const nm = c.name.replace(/^waxed_/, '');
  // 1.14-era doors live in `door_lower#n` / `door_upper#n`; newer ones (cherry, copper, crimson …) have their own files
  const tex = DOOR_TEX[nm] !== undefined
    ? `door_${upper ? 'upper' : 'lower'}#${DOOR_TEX[nm]}`
    : firstTexture(c.resources, ...(upper ? [`${nm}_top`] : [`${nm}_bottom`, `${nm}_lower`]));

  // the hinge sits at the end of the closed panel that is covered by the open panel
  const op = DOOR_AABB[openKey];
  const ox = (Math.max(closed[0][0], op[0][0]) + Math.min(closed[1][0], op[1][0])) / 2;
  const oz = (Math.max(closed[0][2], op[0][2]) + Math.min(closed[1][2], op[1][2])) / 2;
  const hx = ox - (from[0] + to[0]) / 2, hz = oz - (from[2] + to[2]) / 2; // from the panel centre towards the hinge
  // texture "right" (where the handle is) in world terms, per big face
  const uDir: Record<string, [number, number]> = { north: [-1, 0], south: [1, 0], west: [0, 1], east: [0, -1] };
  const bigFaces: Dir[] = to[2] - from[2] < to[0] - from[0] ? ['north', 'south'] : ['west', 'east'];
  const f: Partial<Record<Dir, FaceSpec>> = {};
  for (const d of bigFaces) {
    const [ux, uz] = uDir[d];
    const flip = ux * -hx + uz * -hz < 0; // handle must lie on the side away from the hinge
    f[d] = { tex, uv: flip ? [16, 0, 0, 16] : [0, 0, 16, 16], cull: false };
  }
  for (const d of ['up', 'down'] as Dir[]) f[d] = { tex };
  for (const d of HORIZONTAL) if (!f[d]) f[d] = { tex };
  return { elements: [box(from, to, f)], static: false };
}

// ------------------------------------------------------------ fence gates ---

function fenceGate(c: BlockContext): BlockModel {
  const wood = c.name === 'fence_gate' ? 'oak' : c.name.replace(/_fence_gate$/, '');
  const base = baseCube(wood, c.resources)?.faces.north ?? `planks#${Math.max(0, WOODS.indexOf(wood))}`;
  const open = truthy(st(c.states, 'open_bit'));
  const dy = truthy(st(c.states, 'in_wall_bit')) ? -3 : 0;
  const w = (a: V3, b: V3): Element => box([a[0], a[1] + dy, a[2]], [b[0], b[1] + dy, b[2]], faces(base, { cull: false }));
  const els: Element[] = [w([0, 5, 7], [2, 16, 9]), w([14, 5, 7], [16, 16, 9])];
  if (!open) {
    els.push(w([6, 6, 7], [10, 15, 9]));
    for (const x of [2, 10]) { els.push(w([x, 6, 7], [x + 4, 9, 9])); els.push(w([x, 12, 7], [x + 4, 15, 9])); }
  } else {
    for (const x of [0, 14]) {
      els.push(w([x, 6, 1], [x + 2, 15, 3]));
      els.push(w([x, 6, 3], [x + 2, 9, 7])); els.push(w([x, 12, 3], [x + 2, 15, 7]));
    }
  }
  const f = horizontalFacing(c);
  return { elements: els, rotY: AXIS_X(f) ? 90 : 0, static: true };
}

// ------------------------------------------------------------------ signs ---

const SIGN_TEX: Record<string, string> = { '': 'sign', spruce: 'spruce_sign', birch: 'birch_sign', jungle: 'jungle_sign', acacia: 'acacia_sign', darkoak: 'darkoak_sign' };
const signWood = (name: string, stack: BlockContext['resources']) => {
  const w = name.replace(/_?(standing|wall)_sign$/, '').replace('darkoak', 'dark_oak');
  if (SIGN_TEX[w.replace('_', '')] && stack.hasTexture(SIGN_TEX[w.replace('_', '')])) return SIGN_TEX[w.replace('_', '')];
  return baseCube(w || 'oak', stack)?.faces.north ?? 'sign';       // planks of the wood (cherry, mangrove, bamboo …)
};

function standingSign(c: BlockContext): BlockModel {
  const tex = signWood(c.name, c.resources);
  const rot = stateNum(c, 'ground_sign_direction') & 15;          // 0 south, 4 west, 8 north, 12 east
  const r = { origin: [8, 8, 8] as V3, axis: 'y' as const, angle: -rot * 22.5 };
  const board = box([0, 8, 7.33], [16, 16, 8.67], faces(tex, { cull: false }), { rotation: r });
  const post = box([7.33, 0, 7.33], [8.67, 8, 8.67], faces(tex, { cull: false }), { rotation: r });
  return { elements: [post, board], static: true };
}

function wallSign(c: BlockContext): BlockModel {
  const tex = signWood(c.name, c.resources);
  const f = facingDirection(c.states) ?? 'north';   // the way the sign faces; the wall is behind it
  // default: faces north, wall on the south side
  const board = box([0, 4.5, 14.67], [16, 12.5, 16], faces(tex, { cull: false }));
  return { elements: [board], rotY: yawOf(f === 'up' || f === 'down' ? 'north' : f), static: true };
}

// ---------------------------------------------------------------- banners ---

function banner(wall: boolean) {
  return (c: BlockContext): BlockModel => {
    const baseV = c.blockEntity ? (c.blockEntity as Record<string, unknown>).Base : undefined;
    const base = typeof baseV === 'number' ? baseV : typeof baseV === 'bigint' ? Number(baseV) : 15;
    const wool = `wool#${Math.max(0, Math.min(15, 15 - base))}`; // banner dye numbering is the reverse of wool's
    // the cloth is taller than a block: map the whole texture onto it instead of the default (cell-relative) UVs
    const cloth = (y0: number, y1: number, z0: number, z1: number): Element => box([2, y0, z0], [14, y1, z1], faces(wool, { cull: false, uv: [0, 0, 16, 16] }));
    if (wall) {
      const f = facingDirection(c.states) ?? 'north';
      return { elements: [cloth(0, 28, 14, 15)], rotY: yawOf(f === 'up' || f === 'down' ? 'north' : f), static: false };
    }
    const rot = stateNum(c, 'ground_sign_direction') & 15;
    const r = { origin: [8, 8, 8] as V3, axis: 'y' as const, angle: -rot * 22.5 };
    return {
      elements: [
        box([7.5, 0, 7.5], [8.5, 32, 8.5], faces('planks#0', { cull: false, uv: [7, 0, 9, 16] }), { rotation: r }),
        box([2, 4, 8.5], [14, 28, 9.5], faces(wool, { cull: false, uv: [0, 0, 16, 16] }), { rotation: r }),
      ],
      static: false,
    };
  };
}

// ---------------------------------------------------------- redstone-ish ---

function daylightDetector(c: BlockContext): BlockModel {
  const inv = c.name.endsWith('inverted');
  const side = 'daylight_detector_side#0';
  return {
    elements: [box([0, 0, 0], [16, 6, 16], {
      up: { tex: `daylight_detector_top#${inv ? 1 : 0}`, uv: [0, 0, 16, 16] }, down: { tex: side, uv: [0, 0, 16, 16] },
      north: { tex: side }, south: { tex: side }, west: { tex: side }, east: { tex: side },
    })],
    static: true,
  };
}

function tripwireHook(c: BlockContext): BlockModel {
  const f = horizontalFacing(c);                       // the way the string leaves the hook
  const plank = firstTexture(c.resources, 'trip_wire_base');
  const ring = firstTexture(c.resources, 'trip_wire_source');
  const attached = truthy(st(c.states, 'attached_bit'));
  const els: Element[] = [
    box([6, 0, 14], [10, 9, 16], faces(plank)),
    box([7.5, attached ? 3 : 4.5, 8], [8.5, attached ? 4 : 5.5, 14], faces(ring)),
  ];
  return { elements: els, rotY: yawOf(f), static: true };
}

function tripwire(c: BlockContext): BlockModel {
  const tex = 'trip_wire';
  return { elements: [box([0, 1, 7.5], [16, 1, 8.5], { up: full(tex, { uv: [0, 6, 16, 10] }), down: full(tex, { uv: [0, 6, 16, 10] }) }, { shade: false })], static: true };
}

const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * `FaceSpec.rot` value that turns the "up" edge of a face's texture towards the world direction `target`; `face`
 * is the face's outward normal. (The mesher applies `rot` counter-clockwise as seen from outside the face.) In the default UV orientation the
 * top of a side face's texture is up, the top of an `up` face's texture is north and that of a `down` face is south.
 */
function rotToward(face: Dir, target: Dir): 0 | 90 | 180 | 270 {
  const texUp: Record<Dir, Dir> = { north: 'up', south: 'up', east: 'up', west: 'up', up: 'north', down: 'south' };
  const u = DIR_VEC[texUp[face]], t = DIR_VEC[target], n = DIR_VEC[face];
  const ccw = Math.round((Math.atan2(dot3(cross3(u, t), n), dot3(u, t)) * 180) / Math.PI);
  return (((ccw % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

/** Command blocks: front texture on the facing side, back on the opposite side, arrows on the sides point at the front. */
function commandBlock(kind: string) {
  return (c: BlockContext): BlockModel => {
    const f = facingDirection(c.states) ?? 'up';
    const p = kind ? `command_block_${kind}` : 'command_block';
    const cond = truthy(st(c.states, 'conditional_bit'));
    const side = `${p}_${cond ? 'conditional_side' : 'side'}`;
    const fs: Partial<Record<Dir, FaceSpec>> = {};
    for (const d of DIRS) {
      if (d === f) fs[d] = { tex: `${p}_front` };
      else if (d === OPPOSITE[f]) fs[d] = { tex: `${p}_back` };
      else fs[d] = { tex: side, rot: rotToward(d, f) };
    }
    return { elements: [box([0, 0, 0], [16, 16, 16], fs)], opaque: true, static: true };
  };
}

function structureBlock(c: BlockContext): BlockModel {
  const kinds: Record<string, number> = { invalid: 0, data: 1, save: 2, load: 3, corner: 4, export: 5 };
  const t = st(c.states, 'structure_block_type');
  const i = typeof t === 'string' ? (kinds[t] ?? 0) : num(t);
  return cubeModel(`structure_block#${Math.max(0, Math.min(5, i))}`, { static: true });
}

function jigsaw(c: BlockContext): BlockModel {
  const f = facingDirection(c.states) ?? 'up';
  const t: Record<Dir, string> = { up: 'jigsaw_side', down: 'jigsaw_side', north: 'jigsaw_side', south: 'jigsaw_side', west: 'jigsaw_side', east: 'jigsaw_side' };
  t[f] = 'jigsaw_front'; t[OPPOSITE[f]] = 'jigsaw_back';
  return cubeModel(t, { static: true });
}

// ------------------------------------------------------------- containers ---

function barrel(c: BlockContext): BlockModel {
  const f = facingDirection(c.states) ?? 'up';
  const open = truthy(st(c.states, 'open_bit'));
  const m = cubeModel({ up: `barrel_top#${open ? 1 : 0}`, down: 'barrel_bottom#0', north: 'barrel_side#0', south: 'barrel_side#0', west: 'barrel_side#0', east: 'barrel_side#0' }, { static: true });
  const { x, y } = orientTo('up', f);
  return { ...m, rotX: x, rotY: y };
}

function composter(c: BlockContext): BlockModel {
  const lvl = Math.max(0, Math.min(8, stateNum(c, 'composter_fill_level')));
  const side = 'composter_side', top = 'composter_top#0', bottom = 'composter_bottom';
  const wall = (a: V3, b: V3, rim: [number, number, number, number], inward: Dir): Element => {
    const f: Partial<Record<Dir, FaceSpec>> = { ...faces(side), up: { tex: top, uv: rim }, down: { tex: bottom } };
    f[inward] = { tex: side, cull: false };
    return box(a, b, f);
  };
  const els: Element[] = [
    box([0, 0, 0], [16, 2, 16], { ...faces(bottom, {}), up: { tex: bottom, uv: [0, 0, 16, 16], cull: false } }),
    wall([0, 2, 0], [16, 16, 2], [0, 0, 16, 2], 'south'), wall([0, 2, 14], [16, 16, 16], [0, 14, 16, 16], 'north'),
    wall([0, 2, 2], [2, 16, 14], [0, 2, 2, 14], 'east'), wall([14, 2, 2], [16, 16, 14], [14, 2, 16, 14], 'west'),
  ];
  if (lvl > 0) {
    const y = lvl >= 8 ? 15 : 1 + lvl * 2;
    els.push(box([2, y, 2], [14, y, 14], { up: { tex: `composter_top#${lvl >= 8 ? 2 : 1}`, uv: [2, 2, 14, 14], cull: false } }));
  }
  return { elements: els, static: true };
}

// ----------------------------------------------------- workstation cubes ---

/** Full cube with a front face; `t` lists the faces for the default orientation (front = north). */
function oriented6(c: BlockContext, t: Partial<Record<Dir, string>>): BlockModel {
  const m = cubeModel(t as Record<Dir, string>, { static: true });
  return { ...m, rotY: yawOf(horizontalFacing(c)) };
}

function loom(c: BlockContext): BlockModel {
  return oriented6(c, { up: 'loom_top', down: 'loom_bottom', north: 'loom_front', south: 'loom_side', east: 'loom_side', west: 'loom_side' });
}
function cartography(): BlockModel {
  return cubeModel({ up: 'cartography_table_top', down: 'cartography_table_bottom', north: 'cartography_table_side3', east: 'cartography_table_side3', south: 'cartography_table_side1', west: 'cartography_table_side2' }, { static: true });
}
function fletching(): BlockModel {
  return cubeModel({ up: 'fletching_table_top', down: 'planks#2', north: 'fletching_table_side1', south: 'fletching_table_side1', east: 'fletching_table_side2', west: 'fletching_table_side2' }, { static: true });
}
function smithing(): BlockModel {
  return cubeModel({ up: 'smithing_table_top', down: 'smithing_table_bottom', north: 'smithing_table_front', south: 'smithing_table_front', east: 'smithing_table_side', west: 'smithing_table_side' }, { static: true });
}

function stonecutter(c: BlockContext): BlockModel {
  const f = horizontalFacing(c);
  const side = 'stonecutter2_side';
  return {
    elements: [
      box([0, 0, 0], [16, 9, 16], { up: { tex: 'stonecutter2_top', uv: [0, 0, 16, 16] }, down: { tex: 'stonecutter2_bottom', uv: [0, 0, 16, 16] }, north: { tex: side }, south: { tex: side }, west: { tex: side }, east: { tex: side } }),
      box([1, 9, 7], [15, 16, 9], { ...faces('stonecutter2_saw', { cull: false }, ['north', 'south']), up: { tex: 'stonecutter2_saw', uv: [0, 0, 14, 2], cull: false } }),
    ],
    rotY: AXIS_X(f) ? 90 : 0, static: true,
  };
}

/** The pre-1.14 stonecutter: a full cube with the saw on top. */
function stonecutterV1(): BlockModel {
  return cubeModel({ up: 'stonecutter_top', down: 'stonecutter_bottom', north: 'stonecutter_side', south: 'stonecutter_side', west: 'stonecutter_other_side', east: 'stonecutter_other_side' }, { static: true });
}

function enchantingTable(): BlockModel {
  return {
    elements: [box([0, 0, 0], [16, 12, 16], {
      up: { tex: 'enchanting_table_top', uv: [0, 0, 16, 16] }, down: { tex: 'enchanting_table_bottom', uv: [0, 0, 16, 16] },
      north: { tex: 'enchanting_table_side' }, south: { tex: 'enchanting_table_side' }, west: { tex: 'enchanting_table_side' }, east: { tex: 'enchanting_table_side' },
    })],
    static: true,
  };
}

// ------------------------------------------------------------------ anvil ---

function anvil(c: BlockContext): BlockModel {
  const damage = ({ undamaged: 0, slightly_damaged: 1, very_damaged: 2, broken: 3 } as Record<string, number>)[String(st(c.states, 'damage') ?? 'undamaged')] ?? 0;
  const s = 'anvil_base#0';
  const all = (): Partial<Record<Dir, FaceSpec>> => faces(s);
  const f = horizontalFacing(c);
  return {
    elements: [
      box([2, 0, 2], [14, 4, 14], all()), box([4, 4, 3], [12, 5, 13], all()), box([6, 5, 4], [10, 10, 12], all()),
      box([3, 10, 0], [13, 16, 16], { ...all(), up: { tex: `anvil_top_damaged_x#${damage}`, uv: [0, 0, 16, 16] } }),
    ],
    rotY: AXIS_X(f) ? 0 : 90, static: true,
  };
}

// -------------------------------------------------------------- grindstone ---

function grindstone(c: BlockContext): BlockModel {
  const attach = String(st(c.states, 'attachment') ?? 'standing');
  const f = horizontalFacing(c);
  const leg = firstTexture(c.resources, 'grindstone_leg');
  const els: Element[] = [
    box([2, 0, 6], [4, 7, 10], faces(leg)), box([12, 0, 6], [14, 7, 10], faces(leg)),
    box([4, 4, 2], [12, 16, 14], {
      west: { tex: 'grindstone_side', uv: [0, 0, 16, 16] }, east: { tex: 'grindstone_side', uv: [0, 0, 16, 16] },
      up: { tex: 'grindstone_round', uv: [0, 0, 8, 16] }, down: { tex: 'grindstone_round', uv: [0, 0, 8, 16] },
      north: { tex: 'grindstone_round', uv: [0, 0, 8, 16] }, south: { tex: 'grindstone_round', uv: [0, 0, 8, 16] },
    }),
    box([3, 8, 7], [4, 12, 9], faces('grindstone_pivot')), box([12, 8, 7], [13, 12, 9], faces('grindstone_pivot')),
  ];
  const m: BlockModel = { elements: els, rotY: AXIS_X(f) ? 0 : 90, static: true };
  if (attach === 'hanging') m.rotX = 180;
  return m;
}

// ----------------------------------------------------------------- campfire ---

function campfire(c: BlockContext): BlockModel {
  const lit = !truthy(st(c.states, 'extinguished'));
  const log = c.name === 'soul_campfire' ? 'soul_campfire_log_lit' : lit ? 'campfire_log_lit' : 'campfire_log';
  const l = (a: V3, b: V3): Element => box(a, b, faces(log));
  const els: Element[] = [l([0, 0, 1], [16, 4, 5]), l([0, 0, 11], [16, 4, 15]), l([1, 4, 0], [5, 8, 16]), l([11, 4, 0], [15, 8, 16])];
  const m = crossModel(c.name === 'soul_campfire' ? firstTexture(c.resources, 'soul_campfire', 'soul_fire_0') : 'campfire_fire', null, 12);
  const out: BlockModel = { elements: els, static: true };
  if (lit) { out.elements.push(...m.elements); }
  return { ...out, rotY: AXIS_X(horizontalFacing(c)) ? 90 : 0 };
}

// ------------------------------------------------------------ lantern etc. ---

function lantern(c: BlockContext): BlockModel {
  const t = c.name === 'soul_lantern' ? 'soul_lantern' : 'lantern';
  const hanging = truthy(st(c.states, 'hanging'));
  const y = hanging ? 1 : 0;
  const side = (): FaceSpec => ({ tex: t, uv: [0, 2, 6, 9] });
  return {
    elements: [
      box([5, y, 5], [11, y + 7, 11], { north: side(), south: side(), west: side(), east: side(), up: { tex: t, uv: [0, 0, 6, 6] }, down: { tex: t, uv: [0, 9, 6, 15] } }),
      box([6, y + 7, 6], [10, y + 9, 10], { ...faces(t, { uv: [0, 0, 4, 2] }, ['north', 'south', 'west', 'east']), up: { tex: t, uv: [0, 0, 4, 4] } }),
      ...(hanging ? [box([7.5, y + 9, 7.5], [8.5, 16, 8.5], faces(t, { uv: [11, 0, 12, 7] }))] : []),
    ],
    static: true,
  };
}

function endRod(c: BlockContext): BlockModel {
  const f = facingDirection(c.states) ?? 'up';
  const side: FaceSpec = { tex: 'end_rod', uv: [0, 0, 2, 15] };
  const m: BlockModel = {
    elements: [
      box([7, 1, 7], [9, 16, 9], { north: side, south: side, west: side, east: side, up: { tex: 'end_rod', uv: [2, 0, 4, 2] } }),
      box([6, 0, 6], [10, 1, 10], { ...faces('end_rod', { uv: [2, 2, 6, 3] }, ['north', 'south', 'west', 'east']), down: { tex: 'end_rod', uv: [2, 2, 6, 6] }, up: { tex: 'end_rod', uv: [2, 2, 6, 6] } }),
    ],
    static: true,
  };
  const { x, y } = orientTo('up', f);
  return { ...m, rotX: x, rotY: y };
}

function beacon(): BlockModel {
  return {
    elements: [
      box([2, 0, 2], [14, 3, 14], faces('beacon_base')),
      box([3, 3, 3], [13, 13, 13], faces('beacon_core')),
      box([0, 0, 0], [16, 16, 16], faces('beacon_shell')),
    ],
    static: true,
  };
}

function conduit(): BlockModel {
  return { elements: [box([5, 5, 5], [11, 11, 11], faces('conduit', { uv: [0, 0, 16, 16] }))], static: true };
}

function dragonEgg(): BlockModel {
  const slices: [number, number, number][] = [[6, 15, 16], [5, 14, 15], [4, 13, 14], [3, 11, 13], [2, 8, 11], [2, 3, 8], [3, 1, 3], [5, 0, 1]];
  const els = slices.map(([m, y0, y1]) => box([m, y0, m], [16 - m, y1, 16 - m], faces('dragon_egg')));
  return { elements: els, static: true };
}

function endPortalFrame(c: BlockContext): BlockModel {
  const eye = truthy(st(c.states, 'end_portal_eye_bit'));
  const f = horizontalFacing(c);
  const els: Element[] = [box([0, 0, 0], [16, 13, 16], { up: { tex: 'endframe_top', uv: [0, 0, 16, 16] }, down: { tex: 'endframe_bottom', uv: [0, 0, 16, 16] }, north: { tex: 'endframe_side' }, south: { tex: 'endframe_side' }, west: { tex: 'endframe_side' }, east: { tex: 'endframe_side' } })];
  if (eye) els.push(box([4, 13, 4], [12, 16, 12], { ...faces('endframe_eye', { uv: [0, 0, 8, 3] }, ['north', 'south', 'west', 'east']), up: { tex: 'endframe_eye', uv: [4, 4, 12, 12] } }));
  return { elements: els, rotY: yawOf(f), static: true };
}

function endPortal(): BlockModel {
  return { elements: [box([0, 12, 0], [16, 12, 16], { up: full('end_portal'), down: full('end_portal') })], static: true };
}

function netherPortal(c: BlockContext): BlockModel {
  const axis = String(st(c.states, 'portal_axis') ?? 'x');
  const el = axis === 'z'
    ? box([6, 0, 0], [10, 16, 16], { west: full('portal'), east: full('portal') })
    : box([0, 0, 6], [16, 16, 10], { north: full('portal'), south: full('portal') });
  return { elements: [el], layer: 'translucent', alpha: 0.8, static: true };
}

function cake(c: BlockContext): BlockModel {
  const bites = Math.max(0, Math.min(6, stateNum(c, 'bite_counter')));
  const x0 = 1 + bites * 2;
  return {
    elements: [box([x0, 0, 1], [15, 8, 15], {
      up: { tex: 'cake_top#0', uv: [x0, 1, 15, 15] }, down: { tex: 'cake_bottom#0', uv: [x0, 1, 15, 15] },
      north: { tex: 'cake_side#0', uv: [x0, 8, 15, 16] }, south: { tex: 'cake_side#0', uv: [x0, 8, 15, 16] },
      east: { tex: 'cake_side#0', uv: [1, 8, 15, 16] }, west: { tex: bites > 0 ? 'cake_west#1' : 'cake_west#0', uv: [1, 8, 15, 16] },
    })],
    static: true,
  };
}

function brewingStand(c: BlockContext): BlockModel {
  const base = firstTexture(c.resources, 'brewing_stand_base'), rod = firstTexture(c.resources, 'brewing_stand');
  return {
    elements: [
      box([9, 0, 5], [15, 2, 11], faces(base, { uv: [0, 0, 6, 6] })), box([1, 0, 9], [7, 2, 15], faces(base, { uv: [0, 0, 6, 6] })), box([1, 0, 1], [7, 2, 7], faces(base, { uv: [0, 0, 6, 6] })),
      box([7, 0, 7], [9, 14, 9], faces(rod, { uv: [7, 0, 9, 14] })),
    ],
    static: true,
  };
}

function flowerPot(c: BlockContext): BlockModel {
  const t = firstTexture(c.resources, 'flower_pot');
  const w = (a: V3, b: V3): Element => box(a, b, faces(t, { uv: [5, 10, 11, 16] }));
  return {
    elements: [
      w([5, 0, 5], [11, 2, 11]), w([5, 2, 5], [11, 6, 6]), w([5, 2, 10], [11, 6, 11]), w([5, 2, 6], [6, 6, 10]), w([10, 2, 6], [11, 6, 10]),
      box([6, 4, 6], [10, 4, 10], { up: { tex: 'dirt#0', uv: [6, 6, 10, 10] } }),
    ],
    static: true,
  };
}

function itemFrame(c: BlockContext): BlockModel {
  const f = facingDirection(c.states) ?? 'north';   // the way the frame faces; the wall is behind it
  const bg = 'itemframe_background';
  const m: BlockModel = {
    elements: [box([2, 2, 15], [14, 14, 16], { ...faces('planks#0', { cull: false }), north: { tex: bg, uv: [0, 0, 16, 16], cull: false } })],
    static: true,
  };
  const { x, y } = orientTo('north', f);
  return { ...m, rotX: x, rotY: y };
}

function frostedIce(c: BlockContext): BlockModel {
  const age = Math.max(0, Math.min(3, stateNum(c, 'age')));
  return cubeModel(`frosted_ice#${age}`, { layer: 'translucent', cullSame: true, alpha: 0.85, static: true });
}

function glazedTerracotta(c: BlockContext): BlockModel | undefined {
  const m = c.name.match(/^(.+)_glazed_terracotta$/);
  if (!m) return undefined;
  const key = `${m[1] === 'light_gray' ? 'silver' : m[1]}_glazed_terracotta`;
  const f = facingDirection(c.states) ?? 'north';
  return { ...cubeModel(key, { static: true }), rotY: yawOf(f === 'up' || f === 'down' ? 'north' : f) };
}

function driedKelp(): BlockModel {
  return cubeModel({ up: 'dried_kelp_block_top', down: 'dried_kelp_block_top', north: 'dried_kelp_block_side_a', south: 'dried_kelp_block_side_a', west: 'dried_kelp_block_side_b', east: 'dried_kelp_block_side_b' }, { static: true });
}

function strippedWood(c: BlockContext): BlockModel | undefined {
  const m = c.name.match(/^stripped_(.+)_wood$/);
  if (!m || !WOODS.includes(m[1])) return undefined;
  const mm = cubeModel(`wood#${WOODS.indexOf(m[1]) * 2 + 1}`, { static: true });
  const axis = st(c.states, 'pillar_axis');
  if (axis === 'x') { mm.rotX = 90; mm.rotY = 90; } else if (axis === 'z') mm.rotX = 90;
  return mm;
}

/** Infested stone: Bedrock `monster_egg` (+ `monster_egg_stone_type`) or the flattened `infested_*` ids. */
function infested(c: BlockContext): BlockModel {
  const t = c.name === 'monster_egg' ? String(st(c.states, 'monster_egg_stone_type') ?? 'stone') : c.name.replace(/^infested_/, '');
  const idx = ({
    cobblestone: 0, stone_brick: 1, stone_bricks: 1, mossy_stone_brick: 2, mossy_stone_bricks: 2,
    cracked_stone_brick: 3, cracked_stone_bricks: 3, chiseled_stone_brick: 4, chiseled_stone_bricks: 4, stone: 5,
  } as Record<string, number>)[t] ?? 5;
  return cubeModel(`monster_egg#${idx}`, { static: true });
}

function bubbleColumn(): BlockModel | null { return null; }

// --------------------------------------------------------------- register ---

export function registerUtility(reg: BlockRegistry): void {
  reg.registerPattern(/(^|_)door$/, door);
  reg.registerPattern(/(^|_)fence_gate$/, fenceGate);
  reg.registerPattern(/(^|_)standing_sign$/, standingSign);
  reg.registerPattern(/(^|_)wall_sign$/, wallSign);
  reg.register('standing_banner', banner(false));
  reg.register('wall_banner', banner(true));
  reg.register(['daylight_detector', 'daylight_detector_inverted'], daylightDetector);
  reg.register('tripwire_hook', tripwireHook);
  reg.register('tripwire', tripwire);
  reg.register('command_block', commandBlock(''));
  reg.register('chain_command_block', commandBlock('chain'));
  reg.register('repeating_command_block', commandBlock('repeating'));
  reg.register('structure_block', structureBlock);
  reg.register('jigsaw', jigsaw);
  reg.register('barrel', barrel);
  reg.register('composter', composter);
  reg.register('loom', loom);
  reg.register('cartography_table', cartography);
  reg.register('fletching_table', fletching);
  reg.register('smithing_table', smithing);
  reg.register('stonecutter_block', stonecutter);
  reg.register('stonecutter', stonecutterV1);
  reg.register('enchanting_table', enchantingTable);
  reg.register('anvil', anvil);
  reg.register('grindstone', grindstone);
  reg.register(['campfire', 'soul_campfire'], campfire);
  reg.register(['lantern', 'soul_lantern'], lantern);
  reg.register('end_rod', endRod);
  reg.register('beacon', beacon);
  reg.register('conduit', conduit);
  reg.register('dragon_egg', dragonEgg);
  reg.register('end_portal_frame', endPortalFrame);
  reg.register('end_portal', endPortal);
  reg.register('portal', netherPortal);
  reg.register('cake', cake);
  reg.register('brewing_stand', brewingStand);
  reg.register('flower_pot', flowerPot);
  reg.register(['item_frame', 'frame', 'glow_frame'], itemFrame);
  reg.register('frosted_ice', frostedIce);
  reg.registerPattern(/_glazed_terracotta$/, glazedTerracotta);
  reg.register('dried_kelp_block', driedKelp);
  reg.registerPattern(/^stripped_.+_wood$/, strippedWood);
  reg.register('bubble_column', bubbleColumn);
  reg.registerPattern(/^(monster_egg|infested_.+)$/, infested);
  reg.register(['glowingobsidian', 'glowing_obsidian'], () => cubeModel('glowing_obsidian', { static: true }));
  reg.register(['netherreactor', 'nether_reactor'], () => cubeModel('reactor_core#0', { static: true }));
  reg.register('allow', () => cubeModel('build_allow', { static: true }));
  reg.register('deny', () => cubeModel('build_deny', { static: true }));
}


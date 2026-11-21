import {
  BlockContext, BlockRegistry, cardinal, col6, cubeSpec, facingDirection, firstTexture, num, specToModel, st, truthy,
} from './blockutil';
import { BlockModel, Dir, Element, FaceSpec, OPPOSITE, V3, box, faces, yawOf } from './models';

/**
 * Blocks that Bedrock draws with hard-coded shapes (no JSON model in any pack): trapdoors, hoppers, targets, bells,
 * cauldrons, scaffolding, lecterns and chests. The shapes follow the vanilla geometry (1/16 block units); textures
 * come from the resource pack.
 */

// --------------------------------------------------------------- helpers ---

/**
 * A box textured with the entity-model "box UV" layout: `[u, v]` is the texture offset, `size` the (square) texture
 * edge in pixels. In the block's default orientation the texture's `north` rectangle (the face with a chest's latch)
 * is drawn on the **south** side, so rotate the model with `rotY = yawOf(facing) + 180`.
 */
function entityBox(tex: string, size: number, u: number, v: number, from: V3, to: V3, grow = 0, sizeV = size): Element {
  const w = to[0] - from[0], h = to[1] - from[1], d = to[2] - from[2];
  const k = 16 / size, kv = 16 / sizeV;
  const rect = (x: number, y: number, rw: number, rh: number): FaceSpec =>
    ({ tex, uv: [x * k, y * kv, (x + rw) * k, (y + rh) * kv], cull: false });
  return box(
    [from[0] - grow, from[1] - grow, from[2] - grow], [to[0] + grow, to[1] + grow, to[2] + grow],
    {
      south: rect(u + d, v + d, w, h),
      north: rect(u + 2 * d + w, v + d, w, h),
      east: rect(u + d + w, v + d, d, h),
      west: rect(u, v + d, d, h),
      up: rect(u + d, v, w, d),
      down: rect(u + d + w, v, w, d),
    },
  );
}

// ------------------------------------------------------------- trapdoors ---

/**
 * Bedrock `direction` → the way the trapdoor *faces* (Java's `facing`: away from the block it is hinged on).
 * An open trapdoor lies on the opposite edge of its cell. Verified on a real structure: the one open trapdoor
 * (`direction` 0) has a cobblestone wall on its west and that wall reports a full-height connection towards it.
 */
const TRAPDOOR_FACING: Dir[] = ['east', 'west', 'south', 'north'];

function trapdoor(c: BlockContext): BlockModel {
  const name = c.name.replace(/^waxed_/, '');
  const tex = firstTexture(c.resources, ...(name === 'oak_trapdoor' ? ['trapdoor', 'oak_trapdoor'] : [name]));
  const facing = TRAPDOOR_FACING[num(st(c.states, 'direction')) & 3];
  const open = truthy(st(c.states, 'open_bit'));
  const upside = truthy(st(c.states, 'upside_down_bit'));
  // default model: facing north, hinged on the south edge when open
  const [from, to]: [V3, V3] = open ? [[0, 0, 13], [16, 16, 16]] : upside ? [[0, 13, 0], [16, 16, 16]] : [[0, 0, 0], [16, 3, 16]];
  return { elements: [box(from, to, faces(tex))], rotY: open ? yawOf(facing) : 0, static: true };
}

// ---------------------------------------------------------------- hopper ---

function hopper(c: BlockContext): BlockModel {
  const facing = facingDirection(c.states) ?? 'down';
  const outside = firstTexture(c.resources, 'hopper_outside');
  const top = firstTexture(c.resources, 'hopper_top');
  const inside = firstTexture(c.resources, 'hopper_inside');
  const out = (only: Dir[]) => faces(outside, {}, only);
  const ALL: Dir[] = ['down', 'up', 'north', 'south', 'west', 'east'];
  const rim = (from: V3, to: V3, topUv: [number, number, number, number], only: Dir[]): Element =>
    box(from, to, { ...out(only), up: { tex: top, uv: topUv } });

  const els: Element[] = [
    // floor of the bowl: its top is the dark "inside" texture seen between the rims
    box([0, 10, 0], [16, 11, 16], { ...out(['down', 'north', 'south', 'west', 'east']), up: { tex: inside, uv: [0, 0, 16, 16], cull: false } }),
    // four rim walls
    rim([0, 11, 0], [16, 16, 2], [0, 0, 16, 2], ['north', 'south', 'west', 'east']),
    rim([0, 11, 14], [16, 16, 16], [0, 14, 16, 16], ['north', 'south', 'west', 'east']),
    rim([0, 11, 2], [2, 16, 14], [0, 2, 2, 14], ['west', 'east']),
    rim([14, 11, 2], [16, 16, 14], [14, 2, 16, 14], ['west', 'east']),
    // funnel
    box([4, 4, 4], [12, 10, 12], out(ALL.filter((d) => d !== 'up'))),
  ];
  if (facing === 'down' || facing === 'up') els.push(box([6, 0, 6], [10, 4, 10], out(ALL)));
  else els.push(box([6, 4, 0], [10, 8, 4], out(ALL))); // side spout (vanilla shape: 6,4,0 → 10,8,4 for north), turned below
  return { elements: els, rotY: facing === 'down' || facing === 'up' ? 0 : yawOf(facing), static: true };
}

// ---------------------------------------------------------------- target ---

function target(c: BlockContext): BlockModel {
  // `blocks.json` / an exact terrain key win; otherwise the vanilla keys `target_top` / `target_side`
  const spec = cubeSpec('target', c.resources)
    ?? { faces: col6(firstTexture(c.resources, 'target_side'), firstTexture(c.resources, 'target_top')), opaque: true };
  return specToModel(spec, c.states);
}

// ------------------------------------------------------------------ bell ---

/**
 * Bedrock bell `direction` 0..3 = south, west, north, east: the way the bell faces, i.e. *away* from the wall it hangs
 * on (`attachment: side`). Only one bell was available to check this: it sits next to a solid block on the side this
 * table implies. Floor/ceiling bells swing across the axis of `direction`.
 */
const BELL_FACING: Dir[] = ['south', 'west', 'north', 'east'];
const BELL_TEX = '@textures/entity/bell/bell';

function bell(c: BlockContext): BlockModel {
  const attach = String(st(c.states, 'attachment') ?? 'standing');
  const facing = BELL_FACING[num(st(c.states, 'direction')) & 3];
  const wood = firstTexture(c.resources, 'planks#5', 'planks#0');
  const stone = firstTexture(c.resources, 'bell_stone');
  const bellTex = c.resources.hasTexture(BELL_TEX) ? BELL_TEX : firstTexture(c.resources, 'bell_side');
  const real = bellTex === BELL_TEX;

  // golden body: dome 6×7×6 + flared rim 8×2×8 (entity texture 32×32, offsets (0,0) and (0,13))
  const body: Element[] = real
    ? [entityBox(BELL_TEX, 32, 0, 0, [5, 6, 5], [11, 13, 11]), entityBox(BELL_TEX, 32, 0, 13, [4, 4, 4], [12, 6, 12])]
    : [box([5, 6, 5], [11, 13, 11], faces(bellTex)), box([4, 4, 4], [12, 6, 12], faces(bellTex))];
  const w = (from: V3, to: V3): Element => box(from, to, faces(wood));
  const hook = w([7, 13, 7], [9, 14, 9]);

  let frame: Element[];
  let rotY = 0;
  switch (attach) {
    case 'hanging': // from the ceiling
      frame = [w([7, 13, 7], [9, 16, 9])];
      rotY = facing === 'north' || facing === 'south' ? 0 : 90;
      break;
    case 'side': { // on a wall: arm from the wall (default: wall on the east side) to the bell
      frame = [w([7, 14, 7], [16, 16, 9]), hook];
      const wall = OPPOSITE[facing];
      rotY = ({ east: 0, south: 90, west: 180, north: 270 } as Record<string, number>)[wall] ?? 0;
      break;
    }
    case 'multiple': // between two walls
      frame = [w([0, 14, 7], [16, 16, 9]), hook];
      rotY = facing === 'north' || facing === 'south' ? 90 : 0;
      break;
    default: // standing on the floor: two posts with stone feet and a top beam
      frame = [
        w([0, 14, 7], [16, 16, 9]), hook,
        w([0, 3, 7], [2, 14, 9]), w([14, 3, 7], [16, 14, 9]),
        box([0, 0, 6], [2, 3, 10], faces(stone)), box([14, 0, 6], [16, 3, 10], faces(stone)),
      ];
      rotY = facing === 'north' || facing === 'south' ? 0 : 90;
  }
  return { elements: [...frame, ...body], rotY, static: true };
}

// -------------------------------------------------------------- cauldron ---

function cauldron(c: BlockContext): BlockModel {
  const side = firstTexture(c.resources, 'cauldron_side');
  const top = firstTexture(c.resources, 'cauldron_top');
  const inner = firstTexture(c.resources, 'cauldron_inner');
  const bottom = firstTexture(c.resources, 'cauldron_bottom');
  const wall = (from: V3, to: V3, inward: Dir, topUv: [number, number, number, number]): Element => {
    const f: Partial<Record<Dir, FaceSpec>> = { ...faces(side), up: { tex: top, uv: topUv }, down: { tex: bottom } };
    f[inward] = { tex: inner, cull: false };
    return box(from, to, f);
  };
  const els: Element[] = [
    wall([0, 3, 0], [16, 16, 2], 'south', [0, 0, 16, 2]),
    wall([0, 3, 14], [16, 16, 16], 'north', [0, 14, 16, 16]),
    wall([0, 3, 2], [2, 16, 14], 'east', [0, 2, 2, 14]),
    wall([14, 3, 2], [16, 16, 14], 'west', [14, 2, 16, 14]),
    box([2, 3, 2], [14, 4, 14], { up: { tex: inner, uv: [2, 2, 14, 14], cull: false } }),
  ];
  for (const [x, z] of [[0, 0], [12, 0], [0, 12], [12, 12]]) els.push(box([x, 0, z], [x + 4, 3, z + 4], faces(side)));

  const level = num(st(c.states, 'fill_level'));
  const liquid = String(st(c.states, 'cauldron_liquid') ?? 'water');
  if (level > 0) {
    const y = liquid === 'lava' ? 15 : 6 + Math.min(6, level) * 1.5; // 1…6 sixths → 7.5 … 15
    const t: FaceSpec = liquid === 'lava'
      ? { tex: firstTexture(c.resources, 'still_lava'), uv: [2, 2, 14, 14], cull: false }
      : liquid === 'powder_snow'
        ? { tex: firstTexture(c.resources, 'snow'), uv: [2, 2, 14, 14], cull: false }
        : { tex: firstTexture(c.resources, 'still_water_grey', 'cauldron_water'), uv: [2, 2, 14, 14], cull: false, tint: 'water' }; // same texture as water blocks: packs differ a lot in cauldron_water's alpha
    els.push(box([2, y, 2], [14, y, 14], { up: t }, liquid === 'water' || (liquid !== 'lava' && liquid !== 'powder_snow') ? { layer: 'translucent', alpha: 0.85 } : {}));
  }
  return { elements: els, static: true };
}

// ------------------------------------------------------------ scaffolding ---

function scaffolding(c: BlockContext): BlockModel {
  const top = firstTexture(c.resources, 'scaffolding_top');
  const side = firstTexture(c.resources, 'scaffolding_side');
  const bottom = firstTexture(c.resources, 'scaffolding_bottom');
  const plate = (from: V3, to: V3, flat: string): Element =>
    box(from, to, { ...faces(side), up: { tex: flat, uv: [0, 0, 16, 16] }, down: { tex: flat, uv: [0, 0, 16, 16] } });
  const els: Element[] = [plate([0, 14, 0], [16, 16, 16], top)];
  // an unsupported ("unstable") scaffold also has a bottom plate and shorter legs
  const below = c.neighbor(0, -1, 0);
  const unstable = num(st(c.states, 'stability')) > 0 && !(below && below.name === 'scaffolding');
  const legTop = unstable ? 2 : 0;
  for (const [x, z] of [[0, 0], [14, 0], [0, 14], [14, 14]]) els.push(box([x, legTop, z], [x + 2, 14, z + 2], faces(side)));
  if (unstable) els.push(plate([0, 0, 0], [16, 2, 16], bottom));
  return { elements: els };
}

// --------------------------------------------------------------- lectern ---

function lectern(c: BlockContext): BlockModel {
  const facing = cardinal(c.states) ?? 'north';
  const base = firstTexture(c.resources, 'lectern_base');
  const front = firstTexture(c.resources, 'lectern_front');
  const sides = firstTexture(c.resources, 'lectern_sides');
  const top = firstTexture(c.resources, 'lectern_top');
  const bottom = firstTexture(c.resources, 'lectern_bottom', 'planks#0');
  const els: Element[] = [
    box([0, 0, 0], [16, 2, 16], { ...faces(base), up: { tex: base, uv: [0, 0, 16, 16] }, down: { tex: bottom } }),
    // post; its north side (the front) shows the shelf
    box([4, 2, 4], [12, 15, 12], { ...faces(sides), north: { tex: front, uv: [4, 1, 12, 14] } }),
    // book rest: tilted towards the front (north in the default model)
    box([0, 12.5, 0], [16, 14.5, 16], { ...faces(sides), up: { tex: top, uv: [0, 0, 16, 16] }, down: { tex: sides } },
      { rotation: { origin: [8, 14.5, 8], axis: 'x', angle: -22.5 } }),
  ];
  return { elements: els, rotY: yawOf(facing), static: true };
}

// ------------------------------------------------------------------ chest ---

const CHEST_FACING6: Dir[] = ['down', 'up', 'north', 'south', 'west', 'east'];
/** A chest's front: `minecraft:cardinal_direction` (newer games) or the integer `facing_direction` (2 north … 5 east). */
function chestFacing(states: Record<string, unknown>): Dir {
  const c = cardinal(states as never);
  if (c) return c;
  const f = states.facing_direction ?? states['minecraft:facing_direction'];
  const d = typeof f === 'number' ? CHEST_FACING6[f] : typeof f === 'string' ? (f as Dir) : undefined;
  return d && d !== 'up' && d !== 'down' ? d : 'south';
}
/** The model's +x (where a large chest's second half is) for a chest facing `d`: the model is turned by (yaw + 180)° about y. */
const CHEST_RIGHT: Record<string, [number, number]> = { south: [1, 0], north: [-1, 0], east: [0, -1], west: [0, 1] };

/**
 * Which half of a large chest this cell is. `lead` draws the whole 30 px chest over both cells (toward the model's +x), `rest`
 * draws nothing, `null` is a single chest. The pair is the block entity's `pairx` / `pairz` (world coordinates, compared with its
 * own `x` / `z`); a chest without them (structures written by tools) pairs with a neighbour of the same kind and facing beside it,
 * two by two along a row. Large chests were never drawn: every half was a small chest of its own.
 */
function chestHalf(c: BlockContext, facing: Dir): 'lead' | 'rest' | null {
  if (c.name.startsWith('ender')) return null;
  const [rx, rz] = CHEST_RIGHT[facing];
  const same = (dx: number, dz: number) => {
    const n = c.neighbor(dx, 0, dz);
    return !!n && n.name === c.name && chestFacing(n.states as Record<string, unknown>) === facing;
  };
  const be = c.blockEntity ?? {};
  const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : undefined);
  const px = n(be.pairx), pz = n(be.pairz), x = n(be.x), z = n(be.z);
  if (px !== undefined && pz !== undefined && x !== undefined && z !== undefined) {
    const dx = px - x, dz = pz - z;
    if (dx === rx && dz === rz && same(rx, rz)) return 'lead';
    if (dx === -rx && dz === -rz && same(-rx, -rz)) return 'rest';
  }
  // no (usable) pair data: count the same chests in a row on the -x side; pairs are (0, 1), (2, 3) …
  let k = 0;
  while (k < 64 && same(-rx * (k + 1), -rz * (k + 1))) k++;
  if (k % 2 === 1) return 'rest';
  return same(rx, rz) ? 'lead' : null;
}

/** Copper chests (waxed or not, any oxidation): the chest model with the copper textures of their oxidation stage. */
const COPPER_CHEST = /^(?:waxed_)?(?:(exposed|weathered|oxidized)_)?copper_chest$/;

function chest(c: BlockContext): BlockModel {
  const facing = chestFacing(c.states as Record<string, unknown>);
  const copper = COPPER_CHEST.exec(c.name);
  const kind = copper ? 'copper' : c.name.startsWith('ender') ? 'ender' : c.name.startsWith('trapped') ? 'trapped' : 'normal';
  // Bedrock names the unoxidised copper chest `copper_default` (Java packs: `copper`); the others `copper_<stage>`
  const copperTex = copper && (copper[1] ? `copper_${copper[1]}` : ['copper_default', 'copper'].find((n) => c.resources.hasTexture(`@textures/entity/chest/${n}`)) ?? 'copper_default');
  const tex = `@textures/entity/chest/${copperTex || kind}`;
  // a chest's model depends on its neighbours and block entity (which half of a large chest it is): never cached per palette entry
  const half = chestHalf(c, facing);
  if (half === 'rest') return { elements: [], static: false };
  const doubleTex = `@textures/entity/chest/${copperTex ? `${copperTex}_double` : kind === 'trapped' ? 'trapped_double' : 'double_normal'}`;
  if (half === 'lead' && c.resources.hasTexture(doubleTex)) {
    // the large chest (128×64 texture, the classic model): body 30×10×14, lid 30×5×14, latch in the middle of the front
    return {
      elements: [
        entityBox(doubleTex, 128, 0, 19, [1, 0, 1], [31, 10, 15], 0, 64),
        entityBox(doubleTex, 128, 0, 0, [1, 9, 1], [31, 14, 15], 0.01, 64),
        entityBox(doubleTex, 128, 0, 0, [15, 7, 15], [17, 11, 16], 0, 64),
      ],
      rotY: (yawOf(facing) + 180) % 360, static: false,
    };
  }
  if (!c.resources.hasTexture(tex)) {
    // no entity texture in the pack: use the block-style textures that the inventory icon uses
    const p = copper ? `${copper[1] ? copper[1] + '_' : ''}copper_chest` : kind === 'ender' ? 'ender_chest' : 'chest';
    const front = kind === 'trapped' ? 'trapped_chest_inventory_front' : `${p}_inventory_front`;
    const t = (key: string) => firstTexture(c.resources, key);
    return {
      elements: [box([1, 0, 1], [15, 14, 15], faces({
        down: t(`${p}_inventory_top`), up: t(`${p}_inventory_top`), north: t(`${p}_inventory_side`),
        south: t(front), west: t(`${p}_inventory_side`), east: t(`${p}_inventory_side`),
      }))],
      rotY: (yawOf(facing) + 180) % 360, static: half === null && kind === 'ender',
    };
  }
  return {
    elements: [
      entityBox(tex, 64, 0, 19, [1, 0, 1], [15, 10, 15]),          // body
      entityBox(tex, 64, 0, 0, [1, 9, 1], [15, 14, 15], 0.01),     // lid (0.01 grow avoids z-fighting with the body)
      entityBox(tex, 64, 0, 0, [7, 7, 15], [9, 11, 16]),           // latch
    ],
    rotY: (yawOf(facing) + 180) % 360, static: half === null && kind === 'ender',
  };
}

// --------------------------------------------------------------- register ---

export function registerSpecial(reg: BlockRegistry): void {
  reg.registerPattern(/(^|_)trapdoor$/, trapdoor);
  reg.register('hopper', hopper);
  reg.register('target', target);
  reg.register('bell', bell);
  reg.register('cauldron', cauldron);
  reg.register('scaffolding', scaffolding);
  reg.register('lectern', lectern);
  reg.registerPattern(/^(trapped_|ender_)?chest$/, chest);
  reg.registerPattern(COPPER_CHEST, chest);
}


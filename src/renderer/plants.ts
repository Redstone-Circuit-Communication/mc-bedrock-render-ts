import { BlockContext, BlockRegistry, facingDirection, num, st, truthy } from './blockutil';
import { BlockModel, Dir, Element, FaceSpec, V3, box, cubeModel, faces, yawOf } from './models';
import { crossModel, full, hashModel, isBlock, planeX, planeZ, stateNum } from './kit';

/**
 * Plants and other thin / partial blocks. Every texture comes from the resource pack; a texture the pack does not
 * contain is reported in `mesh.stats.missingTextures` and drawn as the missing-texture checkerboard.
 */

// ------------------------------------------------------------------ crops ---

/** Bedrock `growth` 0..7 → the 4 visual stages of carrots, potatoes and beetroot. */
const cropStage = (g: number) => (g < 2 ? 0 : g < 4 ? 1 : g < 7 ? 2 : 3);

function stem(kind: 'melon' | 'pumpkin') {
  return (c: BlockContext): BlockModel => {
    const g = Math.max(0, Math.min(7, stateNum(c, 'growth')));
    const f = facingDirection(c.states);
    const attached = !!f && f !== 'down' && f !== 'up';
    const key = `${kind}_stem`;
    if (attached) {
      // bent stem lying towards the fruit: one plane along the direction of the fruit
      const tex = `${key}#1`, tint = 0xe0c71c;
      const plane = (f === 'north' || f === 'south') ? planeX(0, 16, 0, 16, 8, tex, { tint }) : planeZ(0, 16, 0, 16, 8, tex, { tint });
      return { elements: [planeX(0, 16, 0, 16, 8, tex, { tint: 0xe0c71c }), planeZ(0, 16, 0, 16, 8, tex, { tint: 0xe0c71c }), plane], static: true };
    }
    const h = (g + 1) * 2;
    const tint = ((g * 32) << 16) | ((255 - g * 8) << 8) | (g * 4);
    return { elements: [planeX(0, 16, 0, h, 8, `${key}#0`, { tint }), planeZ(0, 16, 0, h, 8, `${key}#0`, { tint })], static: true };
  };
}

function cocoa(c: BlockContext): BlockModel {
  const age = Math.max(0, Math.min(2, stateNum(c, 'age')));
  const tex = `cocoa#${age}`;
  const w = 4 + age * 2, h = 5 + age * 2;              // pod width / height
  const x0 = 8 - w / 2, y0 = 12 - h;
  // base orientation: the log (support) is on the south side, the pod hangs against it
  const pod = box([x0, y0, 15 - w], [x0 + w, y0 + h, 15], faces(tex));
  const leaf = box([8, 12, 15 - 4], [8, 16, 16], { west: full(tex, { uv: [0, 0, 4, 4] }), east: full(tex, { uv: [0, 0, 4, 4] }) });
  // Bedrock `direction` 0..3 = south, west, north, east: the side the supporting jungle log is on
  const log: Dir = (['south', 'west', 'north', 'east'] as Dir[])[num(st(c.states, 'direction')) & 3];
  return { elements: [pod, leaf], rotY: (yawOf(log) + 180) % 360, static: true };
}

// ----------------------------------------------------------- double plants ---

const DOUBLE_IDX: Record<string, number> = {
  sunflower: 0, lilac: 1, syringa: 1, tall_grass: 2, grass: 2, large_fern: 3, fern: 3, rose_bush: 4, rose: 4, peony: 5, paeonia: 5,
};

function doublePlant(c: BlockContext): BlockModel {
  const type = c.name === 'double_plant' ? String(st(c.states, 'double_plant_type') ?? 'sunflower') : c.name;
  const idx = DOUBLE_IDX[type] ?? 0;
  const upper = truthy(st(c.states, 'upper_block_bit'));
  const tint = idx === 2 || idx === 3 ? 'grass' : null;
  return crossModel(`double_plant_${upper ? 'top' : 'bottom'}#${idx}`, tint);
}

// ------------------------------------------------------------ water plants ---

function kelp(c: BlockContext): BlockModel {
  const above = c.neighbor(0, 1, 0);
  const body = isBlock(above, 'kelp');
  const variant = ['kelp_a', 'kelp_b', 'kelp_c', 'kelp_d'][(c.x * 7 + c.z * 13 + c.y) & 3];
  return crossModel(body ? variant : 'kelp_top', null, 16, { static: false });
}

function seagrass(c: BlockContext): BlockModel {
  const t = String(st(c.states, 'sea_grass_type') ?? 'default');
  if (t === 'double_bot') return crossModel('seagrass_tall_bot_a');
  if (t === 'double_top') return crossModel('seagrass_tall_top_a');
  return crossModel('seagrass_short');
}

// ------------------------------------------------------------------ corals ---

const CORAL_KINDS = ['tube', 'brain', 'bubble', 'fire', 'horn'];
const CORAL_COLORS = ['blue', 'pink', 'purple', 'red', 'yellow'];

function coralInfo(name: string, states: BlockContext['states']): { idx: number; dead: boolean; part: 'plant' | 'block' | 'fan' | 'wall_fan' | 'hang' } | undefined {
  let m = name.match(/^(dead_)?(tube|brain|bubble|fire|horn)_coral(_block|_fan|_wall_fan)?$/);
  if (m) {
    const part = m[3] === '_block' ? 'block' : m[3] === '_fan' ? 'fan' : m[3] === '_wall_fan' ? 'wall_fan' : 'plant';
    return { idx: CORAL_KINDS.indexOf(m[2]), dead: !!m[1], part };
  }
  m = name.match(/^coral(_block|_fan|_fan_dead|_fan_hang\d?)?$/);
  if (m) {
    const idx = Math.max(0, CORAL_COLORS.indexOf(String(st(states, 'coral_color') ?? 'blue')));
    const dead = truthy(st(states, 'dead_bit')) || m[1] === '_fan_dead';
    const part = m[1] === '_block' ? 'block' : m[1]?.startsWith('_fan_hang') ? 'hang' : m[1] ? 'fan' : 'plant';
    return { idx, dead, part };
  }
  return undefined;
}

function coral(c: BlockContext): BlockModel | undefined {
  const info = coralInfo(c.name, c.states);
  if (!info) return undefined;
  const { idx, dead, part } = info;
  if (part === 'block') return cubeModel(`coral_block#${idx + (dead ? 5 : 0)}`, { static: true });
  if (part === 'plant') return crossModel(`coral#${idx + (dead ? 5 : 0)}`);
  const fanTex = `${dead ? 'coral_fan_dead' : 'coral_fan'}#${idx}`;
  if (part === 'fan') {
    // standing fan: one upright plane across the block, a little lower than the block
    return { elements: [planeX(0, 16, 0, 13, 8, fanTex)], static: true };
  }
  // wall fan: plane leaning against the wall; default wall on the south side
  const f = facingDirection(c.states, ['down', 'up', 'north', 'south', 'west', 'east']) ?? 'north';
  const tilt: Element = box([0, 3, 12], [16, 16, 12], { north: full(fanTex), south: full(fanTex) }, { rotation: { origin: [8, 3, 12], axis: 'x', angle: 22.5 }, shade: false });
  return { elements: [tilt], rotY: yawOf(f === 'up' || f === 'down' ? 'north' : f), static: true };
}

// ---------------------------------------------------------------- bamboo ---

function bamboo(c: BlockContext): BlockModel {
  const tex = 'bamboo_stem';
  const thick = String(st(c.states, 'bamboo_stalk_thickness') ?? 'thin') === 'thick';
  const w = thick ? 3 : 2, a = 8 - w / 2, b = 8 + w / 2;
  const side: FaceSpec = { tex, uv: [0, 0, w, 16] };
  const els: Element[] = [
    box([a, 0, a], [b, 16, b], { north: side, south: side, west: side, east: side, up: { tex, uv: [0, 0, w, w] }, down: { tex, uv: [0, 0, w, w] } }),
  ];
  const leaves = String(st(c.states, 'bamboo_leaf_size') ?? 'no_leaves');
  if (leaves !== 'no_leaves') els.push(...crossModel(leaves === 'large_leaves' ? 'bamboo_leaf' : 'bamboo_small_leaf').elements);
  return { elements: els, static: true };
}

// ----------------------------------------------------------- mushroom blocks ---

function mushroomBlock(c: BlockContext): BlockModel {
  const bits = Math.max(0, Math.min(15, stateNum(c, 'huge_mushroom_bits')));
  if (c.name === 'mushroom_stem') {
    const side = bits === 15 ? 'mushroom_block#3' : bits === 10 ? 'mushroom_block#3' : 'mushroom_block#2';
    const cap = bits === 15 ? 'mushroom_block#3' : 'mushroom_block#2';
    return cubeModel({ up: cap, down: cap, north: side, south: side, west: side, east: side }, { static: true });
  }
  const k = c.name.startsWith('red') ? 'red' : 'brown';
  return cubeModel({
    up: `mushroom_${k}_top#${bits}`, down: `mushroom_${k}_bottom#${bits}`, north: `mushroom_${k}_north#${bits}`,
    south: `mushroom_${k}_south#${bits}`, west: `mushroom_${k}_west#${bits}`, east: `mushroom_${k}_east#${bits}`,
  }, { static: true });
}

// ------------------------------------------------------------ vines, pads ---

function vine(c: BlockContext): BlockModel {
  const bits = stateNum(c, 'vine_direction_bits');
  const f = (): FaceSpec => full('vine', { tint: 'foliage' });
  const els: Element[] = [];
  if (bits & 1) els.push(planeX(0, 16, 0, 16, 15.2, 'vine', { tint: 'foliage' }));   // south
  if (bits & 2) els.push(planeZ(0, 16, 0, 16, 0.8, 'vine', { tint: 'foliage' }));    // west
  if (bits & 4) els.push(planeX(0, 16, 0, 16, 0.8, 'vine', { tint: 'foliage' }));    // north
  if (bits & 8) els.push(planeZ(0, 16, 0, 16, 15.2, 'vine', { tint: 'foliage' }));   // east
  const above = c.neighbor(0, 1, 0);
  if (bits === 0 || (above && c.isOpaque(0, 1, 0))) els.push(box([0, 15.2, 0], [16, 15.2, 16], { up: f(), down: f() }));
  return { elements: els, static: false };
}

function waterlily(): BlockModel {
  return { elements: [box([0, 0.25, 0], [16, 0.25, 16], { up: full('waterlily', { tint: 0x208030 }), down: full('waterlily', { tint: 0x208030 }) })], static: true };
}

// ----------------------------------------------------------------- chorus ---

function chorusPlant(c: BlockContext): BlockModel {
  const t = 'chorus_plant';
  const els: Element[] = [box([4, 4, 4], [12, 12, 12], faces(t, { cull: false }))];
  const isPart = (n: { name: string } | null) => isBlock(n, 'chorus_plant', 'chorus_flower');
  const arm = (dx: number, dy: number, dz: number, a: V3, b: V3) => { if (isPart(c.neighbor(dx, dy, dz))) els.push(box(a, b, faces(t, { cull: false }))); };
  arm(0, 1, 0, [4, 12, 4], [12, 16, 12]);
  arm(0, -1, 0, [4, 0, 4], [12, 4, 12]);
  arm(0, 0, -1, [4, 4, 0], [12, 12, 4]);
  arm(0, 0, 1, [4, 4, 12], [12, 12, 16]);
  arm(-1, 0, 0, [0, 4, 4], [4, 12, 12]);
  arm(1, 0, 0, [12, 4, 4], [16, 12, 12]);
  const below = c.neighbor(0, -1, 0);
  if (below && !isPart(below) && c.isOpaque(0, -1, 0)) els.push(box([4, 0, 4], [12, 4, 12], faces(t, { cull: false })));
  return { elements: els };
}

function chorusFlower(c: BlockContext): BlockModel {
  const t = stateNum(c, 'age') >= 5 ? 'chorus_flower#1' : 'chorus_flower#0';
  return {
    elements: [
      box([2, 0, 2], [14, 16, 14], faces({ north: t, south: t, west: t, east: t }, { cull: false }, ['north', 'south', 'west', 'east'])),
      box([2, 0, 2], [14, 16, 14], faces(t, { cull: false }, ['up', 'down'])),
      box([0, 2, 2], [16, 14, 14], faces(t, { cull: false }, ['west', 'east'])),
      box([2, 2, 0], [14, 14, 16], faces(t, { cull: false }, ['north', 'south'])),
    ],
    static: true,
  };
}

// ---------------------------------------------------------- sea creatures ---

function seaPickle(c: BlockContext): BlockModel {
  const n = Math.max(0, Math.min(3, stateNum(c, 'cluster_count'))) + 1;
  const dead = truthy(st(c.states, 'dead_bit'));
  const tex = 'sea_pickle';
  const spots: [number, number, number][] = [[6, 6, 6], [10, 4, 9], [3, 5, 4], [9, 5, 2]]; // x, height, z of each pickle
  const els: Element[] = [];
  for (let i = 0; i < n; i++) {
    const [x, h, z] = spots[i];
    const side: FaceSpec = { tex, uv: [0, 0, 4, h], tint: dead ? 0x9a8a5a : null };
    els.push(box([x - 2, 0, z - 2], [x + 2, h, z + 2], { north: side, south: side, west: side, east: side, up: { tex, uv: [0, 0, 4, 4] }, down: { tex, uv: [0, 0, 4, 4] } }));
  }
  return { elements: els, static: true, emissive: false };
}

function turtleEgg(c: BlockContext): BlockModel {
  const count = ({ one_egg: 1, two_egg: 2, three_egg: 3, four_egg: 4 } as Record<string, number>)[String(st(c.states, 'turtle_egg_count') ?? 'one_egg')] ?? 1;
  const crack = ({ no_cracks: 0, cracked: 1, max_cracked: 2 } as Record<string, number>)[String(st(c.states, 'cracked_state') ?? 'no_cracks')] ?? 0;
  const tex = `turtle_egg#${crack}`;
  const spots: [number, number][] = [[3, 4], [9, 3], [3, 11], [9, 10]];
  const els: Element[] = [];
  for (let i = 0; i < count; i++) {
    const [x, z] = spots[i];
    els.push(box([x, 0, z], [x + 4, 7, z + 4], faces(tex)));
  }
  return { elements: els, static: true };
}

// ------------------------------------------------------------------- misc ---

function fire(): BlockModel {
  const m = crossModel('fire_0', null, 16, { emissive: true });
  return m;
}

function cactus(): BlockModel {
  const side: FaceSpec = { tex: 'cactus_side', uv: [0, 0, 16, 16] };
  return {
    elements: [
      box([1, 0, 1], [15, 16, 15], { up: { tex: 'cactus_top', uv: [0, 0, 16, 16], cull: false }, down: { tex: 'cactus_bottom', uv: [0, 0, 16, 16] }, north: { ...side, cull: false }, south: { ...side, cull: false }, west: { ...side, cull: false }, east: { ...side, cull: false } }),
      // the spines reach the cell edge
      box([0, 0, 1], [16, 15, 15], { ...faces('cactus_side', { uv: [0, 0, 16, 16] }, ['west', 'east']) }),
      box([1, 0, 0], [15, 15, 16], { ...faces('cactus_side', { uv: [0, 0, 16, 16] }, ['north', 'south']) }),
    ],
    static: true,
  };
}

function farmland(c: BlockContext): BlockModel {
  const wet = stateNum(c, 'moisturized_amount') > 0;
  return {
    elements: [box([0, 0, 0], [16, 15, 16], { up: { tex: `farmland#${wet ? 0 : 1}`, uv: [0, 0, 16, 16] }, down: { tex: 'dirt#0' }, north: { tex: 'farmland_side' }, south: { tex: 'farmland_side' }, west: { tex: 'farmland_side' }, east: { tex: 'farmland_side' } })],
    static: true,
  };
}

function dirtPath(): BlockModel {
  return {
    elements: [box([0, 0, 0], [16, 15, 16], { up: { tex: 'grass_path_top', uv: [0, 0, 16, 16] }, down: { tex: 'dirt#0' }, north: { tex: 'grass_path_side' }, south: { tex: 'grass_path_side' }, west: { tex: 'grass_path_side' }, east: { tex: 'grass_path_side' } })],
    static: true,
  };
}

// --------------------------------------------------------------- register ---

export function registerPlants(reg: BlockRegistry): void {
  reg.register('wheat', (c) => hashModel(`wheat#${Math.max(0, Math.min(7, stateNum(c, 'growth')))}`));
  for (const k of ['carrots', 'potatoes', 'beetroot']) reg.register(k, (c) => hashModel(`${k}#${cropStage(stateNum(c, 'growth'))}`));
  reg.register('nether_wart', (c) => hashModel(`nether_wart#${Math.max(0, Math.min(3, stateNum(c, 'age')))}`));
  reg.register('melon_stem', stem('melon'));
  reg.register('pumpkin_stem', stem('pumpkin'));
  reg.register('sweet_berry_bush', (c) => crossModel(`sweet_berry_bush_${Math.min(3, Math.floor(stateNum(c, 'growth') / 2))}`));
  reg.register('cocoa', cocoa);

  reg.register(['tall_grass', 'large_fern', 'sunflower', 'lilac', 'rose_bush', 'peony', 'double_plant'], doublePlant);
  reg.register('kelp', kelp);
  reg.register('seagrass', seagrass);
  reg.registerPattern(/^(dead_)?(tube|brain|bubble|fire|horn)_coral(_block|_fan|_wall_fan)?$|^coral(_block|_fan|_fan_dead|_fan_hang\d?)?$/, coral);
  reg.register('bamboo', bamboo);
  reg.register('bamboo_sapling', () => crossModel('bamboo_sapling'));
  reg.register(['brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem'], mushroomBlock);
  reg.register('vine', vine);
  reg.register('waterlily', waterlily);
  reg.register('chorus_plant', chorusPlant);
  reg.register('chorus_flower', chorusFlower);
  reg.register('sea_pickle', seaPickle);
  reg.register('turtle_egg', turtleEgg);
  reg.register('fire', fire);
  reg.register('cactus', cactus);
  reg.register('farmland', farmland);
  reg.register(['grass_path', 'dirt_path'], dirtPath);
  reg.register('wither_rose', () => crossModel('wither_rose'));
  reg.register('sapling', (c) => {
    const i = Math.max(0, ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'].indexOf(String(st(c.states, 'sapling_type') ?? 'oak')));
    return crossModel(`sapling#${i}`);
  });
}


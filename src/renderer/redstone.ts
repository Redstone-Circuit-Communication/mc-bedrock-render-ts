import {
  BlockContext, BlockRef, BlockRegistry, PISTON_FACING6, baseCube, cardinal, facingDirection, isDir, num, st, truthy,
} from './blockutil';
import {
  BlockModel, Dir, DIR_VEC, Element, FaceSpec, HORIZONTAL, OPPOSITE, V3, box, cubeModel, faces, orientTo, yawOf,
} from './models';
import { StateValue } from './structure';

const axisOf = (d: Dir) => (d === 'east' || d === 'west' ? 'x' : d === 'north' || d === 'south' ? 'z' : 'y');
const SIDES: Dir[] = ['north', 'south', 'east', 'west'];

/**
 * The side a repeater / comparator takes its INPUT from.
 *
 * Bedrock's `cardinal_direction` (legacy `direction` int 0..3 = south, west, north, east) is the side that faces the
 * player who placed it — Java's `facing` — so the output leaves through the opposite side. Verified on a real
 * structure: every comparator that is lit or unlit by a container / lit copper bulb has that block on the
 * `cardinal_direction` side, and a powered repeater has its powered wire there.
 */
function inputSide(states: Record<string, StateValue>): Dir {
  const c = cardinal(states);
  if (c) return c;
  const legacy = st(states, 'direction');
  return (typeof legacy === 'number' ? (['south', 'west', 'north', 'east'] as Dir[])[legacy & 3] : undefined) ?? 'south';
}

// --------------------------------------------------------------- observer ---

function observer(c: BlockContext): BlockModel {
  const f = facingDirection(c.states) ?? 'north';
  const powered = truthy(st(c.states, 'powered_bit'));
  const m = cubeModel({
    north: 'observer_north', south: powered ? 'observer_south#1' : 'observer_south',
    east: 'observer_east', west: 'observer_west', up: 'observer_top', down: 'observer_bottom',
  }, { static: true });
  const { x, y } = orientTo('north', f); // the face ("eyes") looks along facing_direction
  return { ...m, rotX: x, rotY: y };
}

// ----------------------------------------------------------------- piston ---

function pistonModel(c: BlockContext, sticky: boolean, table: Dir[]): BlockModel {
  const dir = facingDirection(c.states, table) ?? 'up';
  const be = c.blockEntity;
  let p = 0;
  if (be && typeof be.Progress === 'number') p = Math.max(0, Math.min(1, be.Progress));
  else if (be && typeof be.State === 'number') p = be.State === 2 ? 1 : 0;
  else {
    const v = DIR_VEC[dir];
    const front = c.neighbor(v[0], v[1], v[2]);
    if (front && /piston_arm_collision$/.test(front.name)) p = 1;
  }
  const top = sticky ? 'piston_top_sticky' : 'piston_top_normal';
  const { x, y } = orientTo('up', dir);

  if (p <= 0) {
    const m = cubeModel({ up: top, down: 'piston_bottom', north: 'piston_side', south: 'piston_side', west: 'piston_side', east: 'piston_side' });
    return { ...m, rotX: x, rotY: y };
  }
  const L = 16 * p;
  const side = (uv: [number, number, number, number], cull: FaceSpec['cull'] = undefined): Partial<Record<Dir, FaceSpec>> => {
    const f: FaceSpec = { tex: 'piston_side', uv, ...(cull === undefined ? {} : { cull }) };
    return { north: f, south: f, west: f, east: f };
  };
  const rodFace = (): FaceSpec => ({ tex: 'piston_top_normal', uv: [6, 0, 10, L], cull: false });
  const elements: Element[] = [
    // base body (12/16 deep) — front face shows the hollow interior
    box([0, 0, 0], [16, 12, 16], {
      down: { tex: 'piston_bottom' },
      up: { tex: 'piston_inner', uv: [0, 0, 16, 16], cull: false },
      ...side([0, 4, 16, 16]),
    }),
    // rod
    box([6, 12, 6], [10, 12 + L, 10], { north: rodFace(), south: rodFace(), west: rodFace(), east: rodFace() }),
    // head plate (the arm itself is rendered by the PistonArm block entity in-game)
    box([0, 12 + L, 0], [16, 16 + L, 16], {
      up: { tex: top, uv: [0, 0, 16, 16], cull: false },
      down: { tex: 'piston_side', uv: [0, 0, 16, 4], cull: false },
      ...side([0, 0, 16, 4], false),
    }),
  ];
  return { elements, rotX: x, rotY: y, opaque: false };
}

// ------------------------------------------------------------------- wire ---

const SOURCES = new Set([
  'redstone_block', 'lever', 'redstone_torch', 'unlit_redstone_torch', 'daylight_detector', 'daylight_detector_inverted',
  'target', 'tripwire_hook', 'detector_rail', 'lightning_rod', 'sculk_sensor', 'trapped_chest', 'lectern',
]);

function wireConnects(nb: BlockRef, dir: Dir): boolean {
  const n = nb.name;
  if (n === 'redstone_wire') return true;
  if (/^(powered_|unpowered_)?(repeater|comparator)$/.test(n)) {
    return axisOf(inputSide(nb.states)) === axisOf(dir);
  }
  if (n === 'observer') return facingDirection(nb.states) === dir;
  return SOURCES.has(n) || /_button$/.test(n) || /_pressure_plate$/.test(n);
}

/** Java-style wire colour for a signal strength. */
export function wireColor(power: number): number {
  const r = power / 15;
  const R = r * 0.6 + (r > 0 ? 0.4 : 0.3);
  const G = Math.max(0, Math.min(1, r * r * 0.7 - 0.5));
  const B = Math.max(0, Math.min(1, r * r * 0.6 - 0.7));
  return (Math.round(R * 255) << 16) | (Math.round(G * 255) << 8) | Math.round(B * 255);
}

function wire(c: BlockContext): BlockModel {
  const tint = wireColor(num(st(c.states, 'redstone_signal')));
  const Y = 0.25;
  type Conn = 'none' | 'side' | 'up';
  const conn: Record<string, Conn> = {};
  const aboveOpaque = c.isOpaque(0, 1, 0);
  for (const d of SIDES) {
    const [dx, , dz] = DIR_VEC[d];
    const nb = c.neighbor(dx, 0, dz);
    let k: Conn = 'none';
    if (nb && wireConnects(nb, d)) k = 'side';
    if (!aboveOpaque && c.isOpaque(dx, 0, dz)) {
      const nu = c.neighbor(dx, 1, dz);
      if (nu && nu.name === 'redstone_wire') k = 'up';
    }
    if (k === 'none' && !c.isOpaque(dx, 0, dz)) {
      const nd = c.neighbor(dx, -1, dz);
      if (nd && nd.name === 'redstone_wire') k = 'side';
    }
    conn[d] = k;
  }
  const on = (d: Dir) => conn[d] !== 'none';
  const ns = on('north') || on('south');
  const ew = on('east') || on('west');
  const flat = (from: V3, to: V3, tex: string, uv: [number, number, number, number], rot: 0 | 90 = 0): Element =>
    box([from[0], Y, from[2]], [to[0], Y, to[2]], { up: { tex, uv, rot, tint, cull: false } });

  const elements: Element[] = [];
  const count = SIDES.filter(on).length;
  if (count === 0) {
    elements.push(flat([0, 0, 0], [16, 0, 16], 'redstone_dust_cross', [0, 0, 16, 16]));
  } else if (!(ns && ew)) {
    if (ew) elements.push(flat([0, 0, 5], [16, 0, 11], 'redstone_dust_line', [0, 5, 16, 11]));
    else elements.push(flat([5, 0, 0], [11, 0, 16], 'redstone_dust_line', [0, 5, 16, 11], 90));
  } else {
    elements.push(flat([5, 0, 5], [11, 0, 11], 'redstone_dust_cross', [5, 5, 11, 11]));
    if (on('east')) elements.push(flat([11, 0, 5], [16, 0, 11], 'redstone_dust_line', [11, 5, 16, 11]));
    if (on('west')) elements.push(flat([0, 0, 5], [5, 0, 11], 'redstone_dust_line', [0, 5, 5, 11]));
    if (on('north')) elements.push(flat([5, 0, 0], [11, 0, 5], 'redstone_dust_line', [0, 5, 5, 11], 90));
    if (on('south')) elements.push(flat([5, 0, 11], [11, 0, 16], 'redstone_dust_line', [11, 5, 16, 11], 90));
  }
  // climbing a neighbouring wall
  const wall = (d: Dir): Element | null => {
    const f: FaceSpec = { tex: 'redstone_dust_line', uv: [0, 5, 16, 11], rot: 90, tint, cull: false };
    switch (d) {
      case 'east': return box([15.75, 0, 5], [15.75, 16, 11], { west: f });
      case 'west': return box([0.25, 0, 5], [0.25, 16, 11], { east: f });
      case 'north': return box([5, 0, 0.25], [11, 16, 0.25], { south: f });
      case 'south': return box([5, 0, 15.75], [11, 16, 15.75], { north: f });
      default: return null;
    }
  };
  for (const d of SIDES) if (conn[d] === 'up') { const e = wall(d); if (e) elements.push(e); }
  return { elements };
}

// ------------------------------------------------------ repeater/comparator ---

const torchSide = (tex: string, h: number): Partial<Record<Dir, FaceSpec>> => {
  const s: FaceSpec = { tex, uv: [7, 6, 9, 6 + h], cull: false };
  return { north: s, south: s, east: s, west: s, up: { tex, uv: [7, 6, 9, 8], cull: false } };
};

function repeater(c: BlockContext): BlockModel {
  const powered = c.name.startsWith('powered');
  // The model below is drawn with its (fixed) output torch on the north edge, so turn the output away from the input side.
  const out = OPPOSITE[inputSide(c.states)];
  const delay = Math.max(0, Math.min(3, num(st(c.states, 'repeater_delay'))));
  const p = powered ? 1 : 0;
  const floor: FaceSpec = { tex: 'repeater_floor' };
  const moving = 7 + 2 * delay; // z centre; the output torch is fixed 3px from the front edge
  const elements: Element[] = [
    box([0, 0, 0], [16, 2, 16], {
      down: floor, north: floor, south: floor, east: floor, west: floor,
      up: { tex: `repeater_up#${p}`, uv: [0, 0, 16, 16] },
    }),
    box([7, 2, 2], [9, 7, 4], torchSide(`repeater_torch#${p}`, 5)),
    box([7, 2, moving - 1], [9, 7, moving + 1], torchSide(`repeater_torch#${p}`, 5)),
  ];
  return { elements, rotY: yawOf(out), emissive: false };
}

function comparator(c: BlockContext): BlockModel {
  const lit = c.name.startsWith('powered') || truthy(st(c.states, 'output_lit_bit'));
  const sub = truthy(st(c.states, 'output_subtract_bit'));
  const out = OPPOSITE[inputSide(c.states)]; // model: single (mode) torch at the output end, north
  const p = lit ? 1 : 0;
  const floor: FaceSpec = { tex: 'comparator_stone_slab' };
  const elements: Element[] = [
    box([0, 0, 0], [16, 2, 16], {
      down: floor, north: floor, south: floor, east: floor, west: floor,
      up: { tex: `comparator_up#${p}`, uv: [0, 0, 16, 16] },
    }),
    box([7, 2, 2], [9, sub ? 7 : 5, 4], torchSide(`comparator_torch#${sub ? 1 : 0}`, sub ? 5 : 3)),
    box([3, 2, 10], [5, 7, 12], torchSide(`comparator_torch#${p}`, 5)),
    box([11, 2, 10], [13, 7, 12], torchSide(`comparator_torch#${p}`, 5)),
  ];
  return { elements, rotY: yawOf(out) };
}

// ------------------------------------------------------------------ lever ---

function lever(c: BlockContext): BlockModel {
  const dirKey = String(st(c.states, 'lever_direction') ?? 'up_north_south');
  const on = truthy(st(c.states, 'open_bit'));
  const angle = on ? 45 : -45;
  const cob = (): FaceSpec => ({ tex: 'cobblestone' });
  const handle = (): FaceSpec => ({ tex: 'lever', uv: [7, 6, 9, 16], cull: false });
  const elements: Element[] = [
    box([5, 0, 4], [11, 3, 12], { down: cob(), up: cob(), north: cob(), south: cob(), west: cob(), east: cob() }),
    box([7, 1, 7], [9, 11, 9], {
      north: handle(), south: handle(), west: handle(), east: handle(),
      up: { tex: 'lever', uv: [7, 6, 9, 8], cull: false },
    }, { rotation: { origin: [8, 1, 8], axis: 'x', angle } }),
  ];
  // Default model: mounted on the floor, handle swinging along z.
  let rx = 0, ry = 0;
  if (isDir(dirKey)) {
    const o = orientTo('up', dirKey); // wall lever: "north" = faces north, mounted on the south block
    rx = o.x; ry = o.y;
  } else {
    const ceiling = dirKey.startsWith('down');
    const eastWest = dirKey.endsWith('east_west');
    rx = ceiling ? 180 : 0;
    ry = eastWest ? 90 : 0;
  }
  return { elements, rotX: rx, rotY: ry };
}

// ----------------------------------------------------------------- torches ---

function torch(tex: string, support: Dir | 'top', emissive: boolean): BlockModel {
  const side = (): FaceSpec => ({ tex, uv: [7, 6, 9, 16], cull: false });
  const f = {
    north: side(), south: side(), east: side(), west: side(),
    up: { tex, uv: [7, 6, 9, 8], cull: false } as FaceSpec,
    down: { tex, uv: [7, 14, 9, 16], cull: false } as FaceSpec,
  };
  if (support === 'top' || support === 'up' || support === 'down') {
    return { elements: [box([7, 0, 7], [9, 10, 9], f)], emissive };
  }
  // default: wall to the west, torch leans east
  const el = box([-1, 3.5, 7], [1, 13.5, 9], f, { rotation: { origin: [0, 3.5, 8], axis: 'z', angle: -22.5 } });
  const ry = ({ west: 0, north: 90, east: 180, south: 270 } as Record<string, number>)[support] ?? 0;
  return { elements: [el], rotY: ry, emissive };
}

export function torchHandler(tex: string, emissive: boolean) {
  return (c: BlockContext): BlockModel => {
    const v = st(c.states, 'torch_facing_direction');
    // Bedrock names the side the supporting block is on ("west" → wall at the west).
    const sup: Dir | 'top' = isDir(v) ? v : 'top';
    return torch(tex, sup, emissive);
  };
}

// ---------------------------------------------------- buttons / plates ---

function plateTexture(name: string, ctxRes: BlockContext): string {
  if (name.startsWith('light_weighted')) return 'gold_block';
  if (name.startsWith('heavy_weighted')) return 'iron_block';
  const base = name.replace(/_pressure_plate$|_button$/, '').replace(/^wooden$/, 'oak');
  const spec = baseCube(base, ctxRes.resources);
  return spec?.faces.north ?? 'missing';
}

// --------------------------------------------------------------- register ---

export interface RedstoneOptions {
  /** `facing_direction` integer → direction table used for pistons. */
  pistonFacing?: Dir[];
}

export function registerRedstone(reg: BlockRegistry, opts: RedstoneOptions = {}): void {
  const pf = opts.pistonFacing ?? PISTON_FACING6;
  reg.register('observer', observer);
  reg.register('piston', (c) => pistonModel(c, false, pf));
  reg.register('sticky_piston', (c) => pistonModel(c, true, pf));
  reg.register(['piston_arm_collision', 'sticky_piston_arm_collision', 'moving_block', 'movingblock'], () => null);
  reg.register('redstone_wire', wire);
  reg.register(['powered_repeater', 'unpowered_repeater'], repeater);
  reg.register(['powered_comparator', 'unpowered_comparator'], comparator);
  reg.register('lever', lever);
  reg.register('redstone_torch', torchHandler('redstone_torch_on', true));
  reg.register('unlit_redstone_torch', torchHandler('redstone_torch_off', false));
  reg.register('torch', torchHandler('torch_on', true));

  reg.registerPattern(/_pressure_plate$/, (c) => {
    const pressed = num(st(c.states, 'redstone_signal')) > 0;
    const tex = plateTexture(c.name, c);
    return { elements: [box([1, 0, 1], [15, pressed ? 0.5 : 1, 15], faces(tex, { cull: false }, ['up', 'down', 'north', 'south', 'east', 'west']))] };
  });
  reg.registerPattern(/_button$/, (c) => {
    const pressed = truthy(st(c.states, 'button_pressed_bit'));
    const f = facingDirection(c.states) ?? 'up';
    const tex = plateTexture(c.name, c);
    const { x, y } = orientTo('up', f);
    return { elements: [box([5, 0, 6], [11, pressed ? 1 : 2, 10], faces(tex, { cull: false }))], rotX: x, rotY: y };
  });
}

export { HORIZONTAL };

import { BlockContext, BlockRegistry, firstTexture, st, truthy } from './blockutil';
import { BlockModel, Dir, Element, box, cubeModel, faces, orientTo, rotateDir } from './models';
import { crossModel, stateNum } from './kit';
import { torchHandler } from './redstone';

/**
 * Blocks added after 1.14 that need more than "the same texture on every face". Textures are found by file name, so
 * they work with packs that only replace image files (Faithful …) as well as with packs that ship `terrain_texture.json`.
 */

/** Copper bulb: one texture per (lit, powered) combination; oxidation and wax are part of the name. */
function copperBulb(c: BlockContext): BlockModel {
  const n = c.name.replace(/^waxed_/, '');
  const lit = truthy(st(c.states, 'lit'));
  const powered = truthy(st(c.states, 'powered_bit'));
  return cubeModel(`${n}${lit ? '_lit' : ''}${powered ? '_powered' : ''}`, { static: true });
}

function respawnAnchor(c: BlockContext): BlockModel {
  const charge = Math.max(0, Math.min(4, stateNum(c, 'respawn_anchor_charge')));
  const side = `respawn_anchor_side${charge}`;
  return cubeModel({
    up: charge > 0 ? 'respawn_anchor_top' : 'respawn_anchor_top_off', down: 'respawn_anchor_bottom',
    north: side, south: side, west: side, east: side,
  }, { static: true });
}

/** Chains (iron and copper): two crossed 3 px wide planes, each with its own texture; `pillar_axis` turns them. */
function chain(c: BlockContext): BlockModel {
  const n = c.name.replace(/^waxed_/, '').replace(/^iron_/, '');
  const t1 = firstTexture(c.resources, `${n}1`), t2 = firstTexture(c.resources, `${n}2`);
  const plane = (from: [number, number, number], to: [number, number, number], d: Dir, d2: Dir, tex: string): Element =>
    box(from, to, { [d]: { tex, uv: [0, 0, 3, 16], cull: false }, [d2]: { tex, uv: [0, 0, 3, 16], cull: false } },
      { rotation: { origin: [8, 8, 8], axis: 'y', angle: 45 }, shade: false });
  const axis = String(st(c.states, 'pillar_axis') ?? 'y');
  const { x, y } = orientTo('up', axis === 'x' ? 'east' : axis === 'z' ? 'south' : 'up');
  return {
    elements: [plane([6.5, 0, 8], [9.5, 16, 8], 'north', 'south', t1), plane([8, 0, 6.5], [8, 16, 9.5], 'east', 'west', t2)],
    rotX: x, rotY: y, static: true,
  };
}

/** Candles (1–4, lit or not). Positions are approximate; the textures come from `textures/blocks/candles/`. */
const CANDLE_SPOTS: [number, number, number][][] = [
  [[7, 7, 6]],
  [[5, 6, 6], [9, 8, 5]],
  [[6, 6, 6], [9, 7, 5], [7, 9, 4]],
  [[5, 5, 6], [9, 6, 5], [6, 9, 4], [10, 10, 6]],
];
function candle(c: BlockContext): BlockModel {
  const n = c.name;                                       // candle, white_candle …
  const lit = truthy(st(c.states, 'lit'));
  const tex = firstTexture(c.resources, lit ? `${n}_lit` : n, n);
  const count = Math.max(1, Math.min(4, stateNum(c, 'candles') + 1));
  const els: Element[] = CANDLE_SPOTS[count - 1].map(([x, z, h]) => {
    const side = { tex, uv: [0, 8 - Math.min(h, 6) + 6, 2, 14] as [number, number, number, number] };
    return box([x, 0, z], [x + 2, h, z + 2], { north: side, south: side, west: side, east: side, up: { tex, uv: [0, 5, 2, 7] } });
  });
  return { elements: els, emissive: false, static: true };
}

/** Crafter: textures are named for the default orientation (front north, top up); `orientation` is "front_top". */
function crafter(c: BlockContext): BlockModel {
  const [front, top] = String(st(c.states, 'orientation') ?? 'north_up').split('_') as [Dir, Dir];
  const crafting = truthy(st(c.states, 'crafting')), triggered = truthy(st(c.states, 'triggered_bit'));
  const t = (face: string) => firstTexture(c.resources, ...(crafting ? [`crafter_${face}_crafting`] : []), ...(triggered ? [`crafter_${face}_triggered`] : []), `crafter_${face}`);
  let rx = 0, ry = 0;
  search: for (const x of [0, 90, 180, 270]) for (const y of [0, 90, 180, 270]) {
    if (rotateDir('north', x, y) === front && rotateDir('up', x, y) === top) { rx = x; ry = y; break search; }
  }
  return { ...cubeModel({ up: t('top'), down: 'crafter_bottom', north: t('north'), south: t('south'), east: t('east'), west: t('west') }, { static: true }), rotX: rx, rotY: ry };
}

/** Plants that are a plain cross of their own texture file (name = texture). */
const CROSS_PLANTS = [
  'crimson_fungus', 'warped_fungus', 'crimson_roots', 'warped_roots', 'nether_sprouts', 'torchflower', 'bush', 'short_dry_grass', 'firefly_bush',
  'cherry_sapling', 'pale_oak_sapling', 'mangrove_propagule', 'hanging_roots',
];

export function registerModern(reg: BlockRegistry): void {
  for (const id of CROSS_PLANTS) reg.register(id, (c) => crossModel(firstTexture(c.resources, id)));
  reg.registerPattern(/^(waxed_)?((exposed|weathered|oxidized)_)?copper_chain$|^(iron_)?chain$/, chain);
  reg.registerPattern(/(^|_)candle$/, candle);
  reg.register('crafter', crafter);
  reg.registerPattern(/^(waxed_)?((exposed|weathered|oxidized)_)?copper_bulb$/, copperBulb);
  reg.register('respawn_anchor', respawnAnchor);
  reg.register('honey_block', () => cubeModel({ up: 'honey_top', down: 'honey_bottom', north: 'honey_side', south: 'honey_side', west: 'honey_side', east: 'honey_side' },
    { layer: 'translucent', cullSame: true, alpha: 0.85, static: true }));
  reg.register('honeycomb_block', () => cubeModel('honeycomb', { static: true }));
  reg.register('soul_torch', torchHandler('soul_torch', true));
  reg.register('copper_torch', torchHandler('copper_torch', true));
  reg.register('soul_fire', () => crossModel('soul_fire_0', null, 16, { emissive: true }));
}

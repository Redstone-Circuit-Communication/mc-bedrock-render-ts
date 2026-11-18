import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EntityLibrary, buildEntityBatches, planEntity } from '../src/renderer/entity';
import { ResourcePack, ResourceStack } from '../src/renderer/resources';
import { buildMcStructure, parseMcStructure } from '../src/renderer/structure';
import { createDefaultRegistry } from '../src/renderer/blocks';

/**
 * 1.4.3: entity materials (alpha as glow / dye mask), render-controller texture slots, the experience orb, format 1.8 controllers
 * with the root bones' position rest, doors drawn from their lower half, hoppers saved with a string facing, large chests and
 * the brewing stand's arms.
 */
const stack = new ResourceStack([await ResourcePack.fromBytes(new Uint8Array(readFileSync('example/public/packs/bedrock_resources.zip')))]);
const lib = new EntityLibrary(stack);
const plan = (id: string, extra: object = {}) => planEntity(lib, { identifier: id, pos: [0, 0, 0], yaw: 0, ...extra } as never) as any[];
const empty = parseMcStructure(buildMcStructure({ size: [2, 1, 2], blockAt: () => null }));

test('spider eyes and sheep skin: alpha is a glow / dye mask, every pixel with alpha > 0 is drawn', async () => {
  for (const [id, queries] of [['minecraft:spider', {}], ['minecraft:sheep', { color: 14 }]] as const) {
    const r = await buildEntityBatches(empty, stack, [{ identifier: id, pos: [1, 0, 1], queries } as never]);
    const img = r.batches[0].image;
    let partial = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0 && img.data[i] < 255) partial++;
    assert.equal(partial, 0, `${id}: no pixel is left for the alpha test to throw away (spider eyes: alpha 3)`);
  }
  assert.equal(plan('minecraft:sheep', { queries: { color: 14 } })[0].tint[0] > 0.6, true, 'a red sheep dyes its wool red');
  assert.equal(plan('minecraft:spider')[0].alphaMode, 'mask');
});

test('render controller texture slots: potions and the experience bottle are one sprite, without the glint slot', () => {
  for (const id of ['minecraft:splash_potion', 'minecraft:lingering_potion', 'minecraft:xp_bottle']) {
    const d = plan(id);
    assert.equal(d.length, 1, `${id}: one draw (the glint used to be drawn as a sprite of its own)`);
    assert.ok(!/enchanted/.test(d[0].texturePath) && !d[0].layers, id);
    assert.ok(d[0].billboard, id);
  }
  const llama = plan('minecraft:llama', { queries: { variant: 0 } });
  assert.equal(llama.length, 1, 'llama: base and decor are layers of one draw');
});

test('experience orb: a camera-facing sprite, tinted by its overlay_color and unlit', () => {
  const [d] = plan('minecraft:xp_orb');
  assert.ok(d.billboard && d.emissive);
  assert.deepEqual(d.overlay.map((v: number) => +v.toFixed(2)), [0.5, 1, 0.01, 0.5]);
});

test('format 1.8 controllers and the root position rest: the wolf stands level, the enderman wears its head', () => {
  const wolf = plan('minecraft:wolf')[0].poses;
  assert.equal(wolf.get('body').rot[0], 90, 'setup turns the body level');
  assert.deepEqual(wolf.get('upperbody').pos, [0, 0, -5], 'the mane moves to z = -3 (Java ModelWolf)');
  assert.deepEqual(wolf.get('leg0').pos, [0, 0, 0], 'legs stay where the geometry has them (root rest = pivot - 24)');
  const ender = plan('minecraft:enderman')[0].poses;
  assert.equal(ender.get('head').pos[1], 14, 'head up onto the body');
  assert.equal(ender.get('body').pos[1], -3);
  assert.equal(ender.get('rightleg').pos[1], 7, 'feet on the ground: legs 0…30');
});

// ------------------------------------------------------------------- blocks ---
type B = { name: string; states?: Record<string, string | number> };
function cells(blocks: Record<string, B>, be: Record<string, any> = {}) {
  const reg = createDefaultRegistry();
  const at = (x: number, y: number, z: number) => blocks[`${x},${y},${z}`];
  return (x: number, y: number, z: number) => reg.resolve({
    name: at(x, y, z).name, states: at(x, y, z).states ?? {}, x, y, z, resources: stack, blockEntity: be[`${x},${y},${z}`],
    neighbor: (dx: number, dy: number, dz: number) => at(x + dx, y + dy, z + dz) ?? null, isOpaque: () => false,
  } as never) as any;
}
const extent = (m: any) => {
  const lo = [99, 99, 99], hi = [-99, -99, -99];
  for (const q of m?.quads ?? []) for (const p of q.pos) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  for (const e of m?.elements ?? []) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], e.from[a]); hi[a] = Math.max(hi[a], e.to[a]); }
  return [lo, hi];
};

test('doors: the lower half draws the whole door, the upper half nothing; an open door is open in both halves', () => {
  const door = (open: number, upperOpen: number) => cells({
    '0,0,0': { name: 'wooden_door', states: { upper_block_bit: 0, 'minecraft:cardinal_direction': 'north', open_bit: open, door_hinge_bit: 0 } },
    '0,1,0': { name: 'wooden_door', states: { upper_block_bit: 1, 'minecraft:cardinal_direction': 'north', open_bit: upperOpen, door_hinge_bit: 0 } },
  });
  const asGameWrites = door(1, 0), consistent = door(1, 1), closed = door(0, 0);
  assert.equal(asGameWrites(0, 1, 0), null, 'the upper half no longer adds the hand-made door turned its own way');
  assert.deepEqual(extent(asGameWrites(0, 0, 0)), extent(consistent(0, 0, 0)));
  assert.equal(extent(asGameWrites(0, 0, 0))[1][1], 32, 'one model, both cells');
  assert.notDeepEqual(extent(asGameWrites(0, 0, 0)), extent(closed(0, 0, 0)));
  assert.equal(asGameWrites(0, 0, 0).static, false, 'never cached per palette entry: it depends on the other half');
});

test('hopper saved with the string facing ("down" / "east") stands upright like the integer one', () => {
  const r = cells({ '0,0,0': { name: 'hopper', states: { 'minecraft:facing_direction': 'down' } }, '2,0,0': { name: 'hopper', states: { facing_direction: 0 } },
    '4,0,0': { name: 'hopper', states: { 'minecraft:facing_direction': 'east' } }, '6,0,0': { name: 'hopper', states: { facing_direction: 5 } } });
  assert.deepEqual(extent(r(0, 0, 0)), extent(r(2, 0, 0)));
  assert.deepEqual(extent(r(4, 0, 0)), extent(r(6, 0, 0)));
  assert.equal(extent(r(0, 0, 0))[1][1], 16, 'the bowl is on top (a hopper on its side was 16 wide in y only by accident)');
  assert.ok(extent(r(0, 0, 0))[0][1] === 0 && extent(r(0, 0, 0))[1][0] === 16);
});

test('large chests: one 30 px chest per pair (pair data or two by two along a row), the other half draws nothing', () => {
  const I = (v: number) => v;
  const blocks: Record<string, B> = {}, be: Record<string, any> = {};
  for (const x of [0, 1]) { blocks[`${x},0,0`] = { name: 'chest', states: { 'minecraft:cardinal_direction': 'south' } }; be[`${x},0,0`] = { x: I(100 + x), y: 0, z: I(50), pairx: I(101 - x), pairz: I(50) }; }
  for (const z of [2, 3, 4]) blocks[`0,0,${z}`] = { name: 'chest', states: { facing_direction: 4 } };   // facing west, a row of three, no pair data
  const r = cells(blocks, be);
  assert.equal(r(0, 0, 0).elements.length, 3); assert.equal(Math.round(extent(r(0, 0, 0))[1][0]), 31, 'the lead spans both cells');
  assert.equal(r(1, 0, 0).elements.length, 0);
  const row = [2, 3, 4].map((z) => r(0, 0, z).elements.length);
  assert.deepEqual(row.slice().sort(), [0, 3, 3], 'a pair and a single chest');
  assert.ok([2, 3, 4].some((z) => Math.round(extent(r(0, 0, z))[1][0]) === 31), 'the pair is a large chest');
});

test('brewing stand: the rod side of each arm picture is against the rod', () => {
  const m = cells({ '0,0,0': { name: 'brewing_stand', states: { brewing_stand_slot_a_bit: 0, brewing_stand_slot_b_bit: 1, brewing_stand_slot_c_bit: 0 } } })(0, 0, 0);
  const planes = m.quads.filter((q: any) => q.flat);
  assert.ok(planes.length >= 3);
  for (const q of planes) {
    const d = q.pos.map((p: number[]) => Math.hypot(p[0] - 8, p[2] - 8));
    const near = d.indexOf(Math.min(...d)), far = d.indexOf(Math.max(...d));
    // the picture has the rod at u 7…9: the inner end of an arm plane samples next to it, the outer end the picture's edge
    assert.ok(Math.abs(q.uv[near][0] - 8) < Math.abs(q.uv[far][0] - 8), `inner u ${q.uv[near][0]}, outer u ${q.uv[far][0]}`);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { holoBlock, modernBlock, upperHalfStates } from '../src/renderer/holoprint/model';
import { buildStructureMesh } from '../src/renderer/mesher';
import { buildMcStructure, parseMcStructure } from '../src/renderer/structure';
import { ResourceStack } from '../src/renderer/resources';
import { officialPacks } from '../scripts/lib/official-pack';

/**
 * Old Bedrock ids (`yellow_flower`, `red_flower` + `flower_type`, `double_plant` + `double_plant_type`, `tallgrass`,
 * `sapling`, the coral family) matched no HoloPrint shape and were drawn as cubes with the sprite on all six faces.
 * Upper halves without states turned away from their lower half; a brewing stand without slot states lost its arms;
 * `sulfur_spike` and `shelf_mushroom` had no shape at all.
 */
test('old ids map to today\'s ids, keeping the states that are not the type', () => {
  assert.deepEqual(modernBlock('yellow_flower', {}), { name: 'dandelion', states: {} });
  assert.deepEqual(modernBlock('red_flower', { flower_type: 'houstonia' }), { name: 'azure_bluet', states: {} });
  assert.deepEqual(modernBlock('red_flower', {})?.name, 'poppy');
  assert.deepEqual(modernBlock('double_plant', { double_plant_type: 'rose', upper_block_bit: 1 }), { name: 'rose_bush', states: { upper_block_bit: 1 } });
  assert.equal(modernBlock('double_plant', { double_plant_type: 'syringa' })?.name, 'lilac');
  assert.equal(modernBlock('tallgrass', { tall_grass_type: 'fern' })?.name, 'fern');
  assert.equal(modernBlock('tallgrass', {})?.name, 'short_grass');
  assert.equal(modernBlock('sapling', { sapling_type: 'roofed_oak' })?.name, 'dark_oak_sapling');
  assert.equal(modernBlock('coral', { coral_color: 'red' })?.name, 'fire_coral');
  assert.equal(modernBlock('coral_block', { coral_color: 'yellow', dead_bit: 1 })?.name, 'dead_horn_coral_block');
  assert.deepEqual(modernBlock('coral_fan_hang2', { coral_hang_type_bit: 1, coral_direction: 3 }), { name: 'fire_coral_wall_fan', states: { coral_direction: 3 } });
  assert.equal(modernBlock('tripWire', {})?.name, 'trip_wire');
  assert.equal(modernBlock('stone', { stone_type: 'granite' }), undefined, 'texture-only legacy ids stay (blocks.json knows them)');
});

test('an upper half without states takes the missing ones from the lower half of the same block', () => {
  const lower = { name: 'oak_door', states: { upper_block_bit: 0, 'minecraft:cardinal_direction': 'east', open_bit: 1, door_hinge_bit: 1 } };
  const ctx = (states: Record<string, unknown>, below = lower) => ({ name: 'oak_door', states: states as never, neighbor: (_x: number, y: number) => (y === -1 ? (below as never) : null) });
  assert.deepEqual(upperHalfStates(ctx({ upper_block_bit: 1 })), { ...lower.states, upper_block_bit: 1 });
  // the game keeps a door's facing and swing on its lower half only: an open door's upper half still says open_bit 0
  assert.deepEqual(upperHalfStates(ctx({ upper_block_bit: 1, open_bit: 0, 'minecraft:cardinal_direction': 'north', door_hinge_bit: 0 })),
    { ...lower.states, upper_block_bit: 1, door_hinge_bit: 0 }, 'facing and swing from the lower half, hinge from its own');
  // … and its hinge on the upper half
  const upper = { name: 'oak_door', states: { upper_block_bit: 1, door_hinge_bit: 1 } };
  const lowerCtx = { name: 'oak_door', states: { upper_block_bit: 0, door_hinge_bit: 0, open_bit: 1 } as never, neighbor: (_x: number, y: number) => (y === 1 ? (upper as never) : null) };
  assert.equal(upperHalfStates(lowerCtx).door_hinge_bit, 1, 'a lower half takes the hinge from its upper half');
  const plant = { name: 'sunflower', states: { upper_block_bit: 0, double_plant_type: 'sunflower' } };
  assert.equal(upperHalfStates({ name: 'sunflower', states: { upper_block_bit: 1, double_plant_type: 'rose' } as never, neighbor: (_x: number, y: number) => (y === -1 ? (plant as never) : null) }).double_plant_type, 'rose', 'a plant keeps its own states');
  assert.deepEqual(upperHalfStates(ctx({ upper_block_bit: 1 }, { name: 'stone', states: {} } as never)), { upper_block_bit: 1 }, 'only from the same block');
  assert.deepEqual(upperHalfStates(ctx({ upper_block_bit: 0 })), { upper_block_bit: 0 }, 'lower halves unchanged');
});

test('states read through interpolation get defaults: the brewing stand keeps its three arms', () => {
  const b = holoBlock('brewing_stand', {});
  for (const k of ['brewing_stand_slot_a_bit', 'brewing_stand_slot_b_bit', 'brewing_stand_slot_c_bit']) assert.equal(b.states?.[k], 0, k);
  assert.equal(holoBlock('pointed_dripstone', {}).states?.dripstone_thickness, 'tip');
});

test('meshing: old sprite ids are crosses (two planes), not cubes; new blocks have shapes; nothing unknown', async () => {
  const stack = new ResourceStack(await officialPacks());
  const faces = async (name: string, states: Record<string, unknown> = {}) => {
    const s = parseMcStructure(buildMcStructure({ size: [1, 1, 1], blockAt: () => ({ name, states }) as never }));
    const m = await buildStructureMesh(s, stack, { backend: 'ts', entities: false });
    assert.deepEqual(m.stats.unknownBlocks, [], name);
    return m.stats.faces;
  };
  for (const [n, st] of [['minecraft:yellow_flower', {}], ['minecraft:red_flower', { flower_type: 'oxeye' }], ['minecraft:tallgrass', {}], ['minecraft:coral', { coral_color: 'red' }], ['minecraft:sapling', {}], ['minecraft:sulfur_spike', {}]] as const) {
    assert.equal(await faces(n, st), 2, `${n} is a cross`);
  }
  assert.equal(await faces('minecraft:brewing_stand'), 27, 'rod, three base plates, three arms');
  assert.ok((await faces('minecraft:shelf_mushroom')) > 0);
});

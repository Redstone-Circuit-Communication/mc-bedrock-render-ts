import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceStack } from '../src/renderer/resources';
import { createDefaultRegistry } from '../src/renderer/blocks';
import { stateDefault } from '../src/renderer/holoprint/model';
import { buildMcStructure, parseMcStructure } from '../src/renderer/structure';
import { T } from '../src/renderer/nbt';
import { buildStructureMesh } from '../src/renderer/mesher';
import { entityLibraryFor, planEntity } from '../src/renderer/entity';
import { emitGeometry, IDENT } from '../src/renderer/geometry';
import { LayerBuilder } from '../src/renderer/layer';
import type { BlockModel } from '../src/renderer/models';
import { officialPacks } from '../scripts/lib/official-pack';

const stack = new ResourceStack();
for (const pack of await officialPacks()) stack.push(pack);
const reg = createDefaultRegistry();
const model = (name: string, states: Record<string, string | number> = {}, blockEntity?: Record<string, unknown>) =>
  reg.resolve({ name, states, x: 0, y: 0, z: 0, neighbor: () => null, isOpaque: () => false, blockEntity: blockEntity as never, resources: stack }) as BlockModel;
const count = (m: BlockModel) => m.quads?.length ?? m.elements.length;

// ----------------------------------------------------------- missing states ---
// A structure the game writes has every state of every block; hand-made ones and the generated examples have `{}`. HoloPrint's
// conditions are true for a state that is missing, so every branch was drawn at once.
test('blocks whose structure stores no states draw exactly their default state, not all of them stacked', () => {
  const same = (name: string, explicit: Record<string, number | string>) => assert.equal(count(model(name, {})), count(model(name, explicit)), `${name}: {} = the default permutation`);
  same('unpowered_repeater', { repeater_delay: 0 });
  same('powered_repeater', { repeater_delay: 0 });
  same('unpowered_comparator', { output_subtract_bit: 0 });
  same('dropper', { facing_direction: 0 });
  same('dispenser', { facing_direction: 0 });
  same('trapdoor', { open_bit: 0, upside_down_bit: 0 });
  same('iron_trapdoor', { open_bit: 0, upside_down_bit: 0 });
  same('wooden_door', { upper_block_bit: 0, open_bit: 0, door_hinge_bit: 0 });
  same('copper_door', { upper_block_bit: 0, open_bit: 0, door_hinge_bit: 0 });
  assert.equal(count(model('trapdoor')), 6, 'a single board, not all open / closed / upside-down positions');
  assert.equal(count(model('dropper')), 6, 'one cube front, not the front of every facing');
});
test('stateDefault knows only real block states, never the variables the adapter computes', () => {
  assert.equal(stateDefault('repeater_delay'), 0);
  assert.equal(stateDefault('open_bit'), 0);
  assert.equal(stateDefault('attachment'), 'standing');
  assert.equal(stateDefault('wall_connection_type_east'), 'none');
  assert.equal(stateDefault('Nbias'), undefined);
  assert.equal(stateDefault('isJunction'), undefined);
});
test('golden dandelion is a cross like the dandelion, not a cube textured with the sprite', () => {
  assert.equal(count(model('golden_dandelion')), 2);
  assert.equal(count(model('dandelion')), 2);
});

// ------------------------------------------------------------ piston faces ---
test('a piston is never face-culled, and a face that leaves its cell is not culled by this cell\'s neighbour', async () => {
  assert.equal(model('piston', { facing_direction: 1 }, { State: 2, Progress: 1 }).noCull, true);
  // an extended sticky piston facing up at (1,1,1): its arm and head plate are in the cell above, (1,2,1)
  const piston = { name: 'minecraft:sticky_piston', states: { facing_direction: 1 } };
  const arm = { name: 'minecraft:sticky_piston_arm_collision', states: { facing_direction: 1 } };
  const be = { id: T.string('PistonArm'), State: T.byte(2), NewState: T.byte(2), Progress: T.float(1), LastProgress: T.float(1), Sticky: T.byte(1), AttachedBlocks: T.list('int', []), BreakBlocks: T.list('int', []) };
  const faces = async (withStones: boolean, backend: 'ts' | 'wasm') => {
    const stone = { name: 'minecraft:stone' };
    const at = (x: number, y: number, z: number) => (x === 1 && y === 1 && z === 1 ? piston : x === 1 && y === 2 && z === 1 ? arm
      : withStones && y === 1 && ((Math.abs(x - 1) === 1 && z === 1) || (Math.abs(z - 1) === 1 && x === 1)) ? stone : null);
    const bytes = buildMcStructure({ size: [3, 4, 3], blockAt: at, blockEntityAt: (x, y, z) => (x === 1 && y === 1 && z === 1 ? (be as never) : undefined) });
    const mesh = await buildStructureMesh(parseMcStructure(bytes), stack, { entities: false, backend });
    // quads strictly inside the arm cell (y 2..3): the rod and the head plate
    let n = 0; const l = mesh.solid;
    for (let q = 0; q < l.indices.length / 6; q++) {
      const ys = [0, 1, 2, 3].map((k) => l.positions[l.indices[q * 6 + (k === 3 ? 5 : k)] * 3 + 1]);
      if (ys.every((y) => y > 2.001)) n++;
    }
    return n;
  };
  for (const backend of ['ts', 'wasm'] as const) {
    const open = await faces(false, backend), walled = await faces(true, backend);
    assert.ok(open >= 10, `${backend}: the arm has faces (${open})`);
    assert.equal(walled, open, `${backend}: stones beside the PISTON cell hide nothing of the arm in the cell above`);
  }
});

// ------------------------------------------------------------------ sprites ---
test('fireballs and thrown items are camera-facing sprites: one quad whose four corners are the centre', () => {
  const lib = entityLibraryFor(stack);
  for (const [id, half] of [['minecraft:fireball', 1], ['minecraft:small_fireball', 0.25], ['minecraft:snowball', 0.25]] as const) {
    const [d] = planEntity(lib, { identifier: id, pos: [10, 1, 10] });
    assert.equal(d.billboard, true, id);
    const sink = new LayerBuilder();
    emitGeometry(d.geometry, { poses: d.poses, isVisible: d.isVisible, world: d.world, color: d.color, alpha: d.alpha, emissive: d.emissive, billboard: d.billboard, texW: 16, texH: 16 }, sink);
    const l = sink.finish();
    assert.equal(l.indices.length / 6, 1, `${id}: both sides collapse into one sprite (the fireball has only one face to begin with)`);
    assert.ok(l.billboards, id);
    assert.deepEqual([...l.positions.slice(0, 3)], [...l.positions.slice(9, 12)], `${id}: all four corners at the centre`);
    assert.ok(Math.abs(l.billboards![2] - half) < 1e-6 && Math.abs(l.billboards![3] - half) < 1e-6, `${id}: half size ${half}, got ${l.billboards![2]}`);
  }
  // an ordinary mob draws no sprite layer
  const [cow] = planEntity(lib, { identifier: 'minecraft:cow', pos: [0, 0, 0] });
  assert.notEqual(cow.billboard, true);
});
test('the slime\'s outer shell is translucent so its core shows (slime_outer, sulfur_cube_outer)', () => {
  const lib = entityLibraryFor(stack);
  const layers = planEntity(lib, { identifier: 'minecraft:slime', pos: [0, 0, 0] }).map((d) => d.layer);
  assert.deepEqual(layers.sort(), ['solid', 'translucent']);
  assert.ok(planEntity(lib, { identifier: 'minecraft:sulfur_cube', pos: [0, 0, 0] }).some((d) => d.layer === 'translucent'));
});

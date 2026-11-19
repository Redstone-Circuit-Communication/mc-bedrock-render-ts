import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceStack } from '../src/renderer/resources';
import { createDefaultRegistry } from '../src/renderer/blocks';
import type { BlockModel } from '../src/renderer/models';
import { officialPacks } from '../scripts/lib/official-pack';

const stack = new ResourceStack();
for (const pack of await officialPacks()) stack.push(pack);
const reg = createDefaultRegistry();
type Nb = (dx: number, dy: number, dz: number) => { name: string; states: Record<string, never> } | null;
const model = (name: string, states: Record<string, string | number> = {}, blockEntity?: Record<string, unknown>, neighbor: Nb = () => null) =>
  reg.resolve({ name, states, x: 0, y: 0, z: 0, neighbor, isOpaque: () => false, blockEntity: blockEntity as never, resources: stack }) as BlockModel;
const pts = (m: BlockModel) => m.quads!.flatMap((q) => q.pos);
const centre = (ps: number[][], axis: number) => ps.reduce((s, p) => s + p[axis], 0) / ps.length;

// ---------------------------------------------------------------- torches ---
// Bedrock's torch_facing_direction names the side the SUPPORTING block is on (measured on real structures: every wall torch has
// a solid block on that side). HoloPrint's torch template puts the base on the opposite side, so the data carries a 180° turn.
test('wall torch: the base touches the named side and the tip leans away from it', () => {
  const side: Record<string, [number, number]> = { west: [0, 0], east: [0, 16], north: [2, 0], south: [2, 16] }; // [axis, base coordinate]
  for (const name of ['redstone_torch', 'unlit_redstone_torch', 'torch', 'soul_torch']) {
    for (const [dir, [axis, plane]] of Object.entries(side)) {
      const ps = pts(model(name, { torch_facing_direction: dir }));
      const lo = Math.min(...ps.map((p) => p[1]));
      const base = ps.filter((p) => Math.abs(p[1] - lo) < 0.5), tip = ps.filter((p) => Math.abs(p[1] - Math.max(...ps.map((q) => q[1]))) < 0.5);
      assert.ok(Math.abs(centre(base, axis) - plane) < 0.5, `${name} ${dir}: base at ${centre(base, axis)}, wanted ${plane}`);
      assert.ok(Math.abs(centre(tip, axis) - 8) < Math.abs(centre(base, axis) - 8), `${name} ${dir}: tip is nearer the cell centre than the base`);
    }
  }
});

// ------------------------------------------------------- repeater / comparator ---
// cardinal_direction is the side they read their INPUT from (the same as Java's `facing`): the OUTPUT leaves through the opposite
// side. Evidence in the structures of the issue: a comparator's OutputSignal equals the fill level of the container on its
// cardinal side (4 of 4), and the hopper on the output side of a powered repeater is locked. The torch that stays put and the
// arrow of the top texture are at the OUTPUT end; a comparator's two rear torches are at the INPUT end (vanilla Java models).
test('repeater: the fixed torch is at the output end, opposite of cardinal_direction', () => {
  const output: Record<string, [number, number]> = { north: [2, 16], south: [2, 0], east: [0, 0], west: [0, 16] }; // axis, plane the output end is near
  for (const [card, [axis, plane]] of Object.entries(output)) {
    const m = model('unpowered_repeater', { 'minecraft:cardinal_direction': card, repeater_delay: 0 });
    const tops = m.quads!.filter((q) => q.normal[1] > 0.9 && q.pos[0][1] > 3).map((q) => centre(q.pos, axis));
    const nearest = tops.reduce((a, b) => (Math.abs(b - plane) < Math.abs(a - plane) ? b : a));
    assert.ok(Math.abs(nearest - plane) < 5, `${card}: fixed torch ${nearest} should be near ${plane}`);
    assert.equal(tops.length, 2);
  }
});
test('comparator: the two rear torches are at the input end, on the cardinal_direction side', () => {
  const input: Record<string, [number, number]> = { north: [2, 0], south: [2, 16], east: [0, 16], west: [0, 0] };
  for (const [card, [axis, plane]] of Object.entries(input)) {
    const m = model('unpowered_comparator', { 'minecraft:cardinal_direction': card, output_lit_bit: 0, output_subtract_bit: 0 });
    const tops = m.quads!.filter((q) => q.normal[1] > 0.9 && q.pos[0][1] > 3).map((q) => centre(q.pos, axis)).sort((a, b) => Math.abs(a - plane) - Math.abs(b - plane));
    assert.equal(tops.length, 3);
    assert.ok(Math.abs(tops[0] - plane) < 6 && Math.abs(tops[1] - plane) < 6, `${card}: two torches near ${plane}, got ${tops}`);
    assert.ok(Math.abs(tops[2] - plane) > 8, `${card}: the single torch is at the far end`);
  }
});

// ----------------------------------------------------------------- pistons ---
const entity = (State: number, Progress: number, Sticky = 0) => ({ id: 'PistonArm', State, NewState: State, Progress, LastProgress: Progress, Sticky, AttachedBlocks: [], BreakBlocks: [] });
const ARM: Record<number, [number, number]> = { 0: [1, -16], 1: [1, 32], 2: [2, 32], 3: [2, -16], 4: [0, 32], 5: [0, -16] }; // facing_direction → axis, far end of an extended arm
test('piston: an extended arm reaches one block out the way facing_direction points (0 down, 1 up, 2 south, 3 north, 4 east, 5 west)', () => {
  for (const [fd, [axis, far]] of Object.entries(ARM)) {
    const ps = pts(model('piston', { facing_direction: Number(fd) }, entity(2, 1)));
    const ext = far > 0 ? Math.max(...ps.map((p) => p[axis])) : Math.min(...ps.map((p) => p[axis]));
    assert.equal(ext, far, `facing_direction ${fd}`);
  }
});
test('piston without a PistonArm entity draws exactly one arm: extended when its arm-collision block is in front', () => {
  // hand-made structures and tools carry no block entity; a missing field used to make every `entity.State == …` branch true
  // and stack the retracted, extended and moving arms (46 faces)
  const arm: Nb = (dx, dy, dz) => (dy === 1 && !dx && !dz ? { name: 'piston_arm_collision', states: { facing_direction: 1 } as never } : null);
  assert.equal(model('piston', { facing_direction: 1 }).quads!.length, 18);
  assert.equal(model('piston', { facing_direction: 1 }, undefined, arm).quads!.length, 21);
  assert.equal(model('sticky_piston', { facing_direction: 1 }, {}, arm).quads!.length, 21, 'an empty entity compound counts as no data');
});
test('piston: string-valued minecraft:facing_direction (hand-made files) points the same way as the integer', () => {
  const asInt: Record<string, number> = { down: 0, up: 1, south: 2, north: 3, east: 4, west: 5 };
  for (const [dir, fd] of Object.entries(asInt)) {
    const a = pts(model('piston', { 'minecraft:facing_direction': dir }, entity(2, 1))), b = pts(model('piston', { facing_direction: fd }, entity(2, 1)));
    assert.deepEqual([0, 1, 2].map((i) => [Math.min(...a.map((p) => p[i])), Math.max(...a.map((p) => p[i]))]), [0, 1, 2].map((i) => [Math.min(...b.map((p) => p[i])), Math.max(...b.map((p) => p[i]))]), dir);
  }
});
test('piston mid-stroke: the arm follows Progress continuously and matches the half-way template at 0.5', () => {
  const tip = (p: number) => Math.max(...pts(model('sticky_piston', { facing_direction: 1 }, entity(1, p, 1))).map((q) => q[1]));
  assert.deepEqual([0, 0.25, 0.5, 0.75, 1].map(tip), [16, 20, 24, 28, 32]);
  // retracting uses the same pose as extending at equal progress
  assert.equal(Math.max(...pts(model('piston', { facing_direction: 1 }, entity(3, 0.5))).map((q) => q[1])), 24);
});

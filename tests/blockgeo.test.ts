import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceStack } from '../src/renderer/resources';
import { createDefaultRegistry } from '../src/renderer/blocks';
import type { BlockModel } from '../src/renderer/models';
import { officialPacks } from '../scripts/lib/official-pack';

const stack = new ResourceStack();
for (const pack of await officialPacks()) stack.push(pack);
const reg = createDefaultRegistry();
const model = (name: string, states: Record<string, string | number> = {}) =>
  reg.resolve({ name, states, x: 0, y: 0, z: 0, neighbor: () => null, isOpaque: () => false, resources: stack }) as BlockModel;
const quads = (m: BlockModel) => m.quads ?? [];
const tops = (m: BlockModel) => Math.max(...quads(m).flatMap((q) => q.pos.map((p) => p[1])));

test('straw_bed is drawn from the pack\'s models/blocks geometry, not as a cube textured with its sprite', () => {
  const foot = model('straw_bed', {}), head = model('straw_bed', { head_piece_bit: 1 });
  assert.equal(foot.elements.length, 0, 'no fallback cube');
  assert.ok(quads(foot).length > 8 && quads(head).length > 8);
  assert.notEqual(quads(foot).length, quads(head).length, 'the head half has its own geometry (the pillow)');
  assert.ok(tops(foot) < 6 && tops(head) < 6, `a bed is low (foot ${tops(foot)}, head ${tops(head)} of 16)`);
  for (const q of quads(foot)) for (const p of q.pos) for (const c of p) assert.ok(c > -12 && c < 28, 'inside (or just around) the cell');
});
test('the bed turns with minecraft:cardinal_direction', () => {
  const key = (d: string) => JSON.stringify(quads(model('straw_bed', { 'minecraft:cardinal_direction': d })).map((q) => q.pos[0].map((c) => Math.round(c))));
  assert.notEqual(key('north'), key('south'));
  assert.notEqual(key('north'), key('east'));
});

// The old coral ids matched no shape pattern and fell back to a cube with the sprite on all six faces.
test('legacy coral ids are the modern corals', () => {
  const same = (legacy: string, st: Record<string, string | number>, modern: string) => {
    const a = model(legacy, st), b = model(modern);
    assert.equal(quads(a).length, quads(b).length, `${legacy} ${JSON.stringify(st)} = ${modern}`);
    assert.deepEqual([...new Set(quads(a).map((q) => q.tex))], [...new Set(quads(b).map((q) => q.tex))]);
  };
  same('coral', { coral_color: 'blue', dead_bit: 0 }, 'tube_coral');
  same('coral', { coral_color: 'red', dead_bit: 1 }, 'dead_fire_coral');
  same('coral_fan', { coral_color: 'purple' }, 'bubble_coral_fan');
  same('coral_fan_dead', { coral_color: 'yellow' }, 'dead_horn_coral_fan');
  same('coral_fan_hang', { coral_hang_type_bit: 1 }, 'brain_coral_wall_fan');
  same('coral_fan_hang2', { coral_hang_type_bit: 0 }, 'bubble_coral_wall_fan');
  assert.notEqual(quads(model('coral', {})).length, 6, 'not a cube any more');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMcStructure, parseMcStructure } from '../src/renderer/structure';

/** The NBT tag type written in front of a named tag (type byte, then the name's length, then the name). */
function tagTypeOf(bytes: Uint8Array, name: string): number {
  const key = new TextEncoder().encode(name);
  for (let i = 3; i + key.length <= bytes.length; i++)
    if (key.every((b, k) => bytes[i + k] === b) && bytes[i - 2] === (key.length & 255) && bytes[i - 1] === key.length >> 8) return bytes[i - 3];
  return -1;
}

test('written states keep the game\'s tag types: booleans are bytes, whole numbers ints, words strings', () => {
  const bytes = buildMcStructure({
    size: [1, 1, 1],
    blockAt: () => ({ name: 'minecraft:dispenser', states: { triggered_bit: true, facing_direction: 3, 'minecraft:cardinal_direction': 'north' } }),
  });
  assert.equal(tagTypeOf(bytes, 'triggered_bit'), 1, 'byte');
  assert.equal(tagTypeOf(bytes, 'facing_direction'), 3, 'int');
  assert.equal(tagTypeOf(bytes, 'minecraft:cardinal_direction'), 8, 'string');
  const states = parseMcStructure(bytes).palette.find((p) => p.name === 'minecraft:dispenser')?.states;
  assert.deepEqual(states, { triggered_bit: 1, facing_direction: 3, 'minecraft:cardinal_direction': 'north' });
});

test('formatVersion 2 writes the layout the game writes now and reads back the same as format 1', async () => {
  const { readTypedNbt, fields } = await import('./helpers/typed-nbt');
  const { readFileSync } = await import('node:fs');
  const opts = {
    size: [2, 2, 2] as [number, number, number],
    blockAt: (x: number, y: number, z: number) => (y === 0 ? { name: 'minecraft:piston', states: { facing_direction: x + z } } : null),
    blockEntityAt: (x: number, y: number, z: number) => (x === 0 && y === 0 && z === 0 ? { id: { t: 'string', v: 'PistonArm' } as const } : null),
  };
  const v1 = parseMcStructure(buildMcStructure(opts)), v2 = parseMcStructure(buildMcStructure({ ...opts, formatVersion: 2 }));
  assert.equal(v2.formatVersion, 2);
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++)
    assert.deepEqual(v2.blockAt(x, y, z), v1.blockAt(x, y, z));
  assert.deepEqual([...v2.blockEntities.keys()], [...v1.blockEntities.keys()]);
  // the same layout as a structure the game saved (1.26.51): a list of IntArrays, one layer when there is no liquid
  const layout = (bytes: Uint8Array) => {
    const indices = fields(fields(readTypedNbt(bytes)).structure).block_indices as any;
    return { of: indices.of, layers: indices.v.length };
  };
  assert.deepEqual(layout(buildMcStructure({ ...opts, formatVersion: 2 })), layout(new Uint8Array(readFileSync('tests/fixtures/game-saved-entities.mcstructure'))));
});

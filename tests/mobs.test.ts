import assert from 'node:assert/strict';
import test from 'node:test';
import { EntityLibrary, planEntity } from '../src/renderer/entity';
import { ResourceStack } from '../src/renderer/resources';
import { officialPacks } from '../scripts/lib/official-pack';

/**
 * Guardian: the spikes are written as absolute positions (`24 - 8 * … - this`); Molang's `this` is the rest value (a child
 * bone's pivot relative to its parent), so they sit on the body's edges instead of floating 24 px above it.
 * Ender dragon: the neck and tail are drawn by repeating the `neck` bone (neck1…5, tail1…12), every part hangs off `root`,
 * the limb tips are relative to their limb, and the right-hand limbs are mirrors of the left ones.
 */
const stack = new ResourceStack(await officialPacks());
const lib = new EntityLibrary(stack);
const plan = (id: string) => planEntity(lib, { identifier: id, pos: [0, 0, 0], yaw: 0 } as never) as any[];

test('guardian spikes rest on the body (y 2…14), not above it', () => {
  const poses = plan('minecraft:guardian')[0].poses as Map<string, { pos: number[] }>;
  for (const b of ['spikepart0', 'spikepart8']) {
    const y = 24 + poses.get(b)!.pos[1]; // pivot y 24 + offset
    assert.ok(y > -2 && y < 18, `${b} centre at y=${y.toFixed(1)}`);
  }
});

test('ender dragon: neck and tail segments exist and hang off root; right wing is the mirror of the left', () => {
  const geo = lib.geometries.get('geometry.dragon')!;
  const bone = (n: string) => geo.bones.find((b) => b.name.toLowerCase() === n)!;
  for (const n of ['neck1', 'neck5', 'tail1', 'tail12']) assert.equal(bone(n).parent, 'root', n);
  assert.ok(bone('neck').neverRender, 'the neck bone is only the template');
  assert.equal(bone('wingtip').parent, 'wing');
  assert.deepEqual(bone('wing1').pivot, [-bone('wing').pivot[0], bone('wing').pivot[1], bone('wing').pivot[2]]);
  assert.ok(bone('wing1').cubes.every((c) => c.origin[0] >= 12 - 1e-6), 'right wing points to +x');
  const poses = plan('minecraft:ender_dragon')[0].poses as Map<string, { rot: number[] }>;
  // drawn as mirrors, symmetric wings need opposite z rotations (a mirror turns θ into -θ) at both shoulder and tip
  for (const [r, l] of [['wing1', 'wing'], ['wingtip1', 'wingtip']]) assert.ok(Math.abs(poses.get(r)!.rot[2] + poses.get(l)!.rot[2]) < 1e-6, `${r} mirrors ${l}`);
});

test('sulfur cube: the opaque core shows by default; only a cube that swallowed a block is see-through, with the block inside', async () => {
  const { buildMcStructure, parseMcStructure } = await import('../src/renderer/structure');
  const { buildStructureMesh } = await import('../src/renderer/mesher');
  const { T } = await import('../src/renderer/nbt');
  const cube = (extra: Record<string, unknown>) => ({ identifier: T.string('minecraft:sulfur_cube'), Pos: T.list('float', [T.float(1.5), T.float(1), T.float(1.5)]), ...extra });
  const mesh = async (e: Record<string, unknown>) => buildStructureMesh(parseMcStructure(buildMcStructure({ size: [3, 1, 3], blockAt: () => null, entities: [e as never] })), stack, { backend: 'ts', entities: true });
  const plain = await mesh(cube({}));
  const swallowed = await mesh(cube({
    properties: T.compound({ 'minecraft:sulfur_cube_archetype': T.string('copper') }),
    Mainhand: T.list('compound', [T.compound({ Name: T.string('minecraft:copper_block'), Count: T.byte(1) })]),
  }));
  const textures = (m: Awaited<ReturnType<typeof mesh>>) => m.entityBatches.length;
  // default: core (inner texture) + shell; swallowed: shell + the copper block, no core
  const draws = (inst: Record<string, unknown>) => plan('minecraft:sulfur_cube').filter((d) => d.isVisible({ ...inst }));
  assert.equal(draws({}).length >= 1, true);
  assert.ok(plain.stats.entities === 1 && swallowed.stats.entities === 1);
  assert.ok(textures(swallowed) >= textures(plain), 'the swallowed block adds its own texture batch');
  const core = plan('minecraft:sulfur_cube').find((d) => /sulfur_cube_inner$/.test(d.texturePath));
  assert.ok(core, 'the core is drawn by default');
});

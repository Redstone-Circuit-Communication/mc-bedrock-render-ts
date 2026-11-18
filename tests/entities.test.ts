import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityLibrary, planEntity } from '../src/renderer/entity';
import { boatGeometry } from '../src/renderer/entity-builtin';
import { buildStructureMesh } from '../src/renderer/mesher';
import { buildMcStructure, parseMcStructure } from '../src/renderer/structure';
import { T, Tagged } from '../src/renderer/nbt';
import { hasPack, loadBasePack } from './helpers/pack';

const ent = (id: string, x: number, y: number, z: number, extra: Record<string, Tagged> = {}) => ({
  identifier: T.string(id), Pos: T.list('float', [T.float(x), T.float(y), T.float(z)]), Rotation: T.list('float', [T.float(0), T.float(0)]), ...extra,
});

test('every client entity of the base pack is drawn and its textures resolve (items / misc textures included)', { skip: !hasPack }, async () => {
  const stack = await loadBasePack();
  const lib = new EntityLibrary(stack);
  assert.ok(lib.defs.size >= 98);
  const entities = [...lib.defs.keys()].map((id, i) => ent(id, (i % 10) * 3 + 1.5, 1, Math.floor(i / 10) * 3 + 1.5));
  const s = parseMcStructure(buildMcStructure({ size: [32, 4, 32], blockAt: (x, y) => (y === 0 ? { name: 'minecraft:stone' } : null), entities }));
  const mesh = await buildStructureMesh(s, stack, {});
  // the evoker fang is scaled to nothing until its spawn animation plays: defined, but it draws no faces at rest
  assert.equal(mesh.stats.entities, lib.defs.size - 1);
  assert.deepEqual(mesh.stats.undrawnEntities, ['minecraft:evocation_fang']);
  assert.deepEqual(mesh.stats.unknownEntities, []);
  assert.deepEqual(mesh.stats.missingEntityTextures, []);
  // the evoker fang is scaled to nothing until its spawn animation plays, so it legitimately draws no faces at rest
  assert.deepEqual(mesh.entityRecords.filter((r) => !r.bounds).map((r) => r.id), ['minecraft:evocation_fang']);
  assert.ok(planEntity(lib, { identifier: 'minecraft:boat', pos: [0, 0, 0], textureKey: 'oak' }).length > 0, 'the boat has geometry now');
});

test('hard-coded entities: boat, painting, dropped item, falling block, TNT', { skip: !hasPack }, async () => {
  const stack = await loadBasePack();
  const entities = [
    ent('minecraft:boat', 3, 1, 3, { Variant: T.int(2) }),
    ent('minecraft:painting', 6, 3, 3, { Motive: T.string('Pointer'), Direction: T.byte(0) }),
    ent('minecraft:item', 9, 1, 3, { Item: T.compound({ Name: T.string('minecraft:apple'), Count: T.byte(1), Damage: T.short(0) }) }),
    ent('minecraft:falling_block', 12, 1, 3, { FallingBlock: T.compound({ name: T.string('minecraft:sand'), states: T.compound({}) }) }),
    ent('minecraft:tnt', 15, 1, 3),
  ];
  const s = parseMcStructure(buildMcStructure({ size: [20, 6, 8], blockAt: () => null, entities }));
  const mesh = await buildStructureMesh(s, stack, {});
  assert.equal(mesh.entityRecords.length, 5);
  assert.deepEqual(mesh.entityRecords.map((r) => r.status), ['model', 'builtin', 'builtin', 'builtin', 'builtin']);
  assert.deepEqual(mesh.stats.missingEntityTextures, []);
  const paint = mesh.entityRecords[1].bounds!;
  assert.ok(Math.abs(paint.max[1] - paint.min[1] - 4) < 0.01, 'a Pointer painting is 4 blocks tall');
});

test('boat geometry: 28×16 bottom, 6-high walls, 9 px tall hull, two paddles', () => {
  const g = boatGeometry();
  const hull = g.bones.filter((b) => !/paddle/.test(b.name)).flatMap((b) => b.cubes);
  assert.equal(hull.length, 5);
  const top = Math.max(...hull.map((c) => c.origin[1] + c.size[1]));
  assert.equal(top, 9);
  // paddles (Java BoatModel: an 18 px shaft and a 6×7 blade each, at the resting angle) were missing
  for (const n of ['left_paddle', 'right_paddle']) {
    const b = g.bones.find((x) => x.name === n)!;
    assert.deepEqual(b.cubes.map((c) => c.size), [[2, 2, 18], [1, 6, 7]], n);
    assert.ok(b.cubes.every((c) => c.rotation && c.pivot), `${n} is tilted about its oarlock`);
  }
});

test('chest boat: the chest stands toward the stern, front and lock toward the rider, lid UV from row 59', async () => {
  const { applyM, aroundPivot, rotM } = await import('../src/renderer/geometry');
  const g = boatGeometry(true);
  const box = (n: string) => {
    const c = g.bones.find((b) => b.name === n)!.cubes[0];
    const m = aroundPivot(rotM(...(c.rotation as [number, number, number])), c.pivot!);
    const pts = [0, 1].flatMap((i) => [0, 1].flatMap((j) => [0, 1].map((k) => applyM(m, [c.origin[0] + i * c.size[0], c.origin[1] + j * c.size[1], c.origin[2] + k * c.size[2]]))));
    return [0, 1, 2].map((a) => [Math.min(...pts.map((p) => p[a])), Math.max(...pts.map((p) => p[a]))].map((v) => Math.round(v * 1000) / 1000));
  };
  assert.deepEqual(box('chest_bottom'), [[-14, -2], [3, 11], [-6, 6]]);
  assert.deepEqual(box('chest_lid'), [[-14, -2], [11, 15], [-6, 6]]);
  assert.deepEqual(box('chest_lock'), [[-2, -1], [8, 12], [-1, 1]], 'the lock sticks out of the chest side that faces the bow');
  const lid = g.bones.find((b) => b.name === 'chest_lid')!.cubes[0].uv as Record<string, { uv: number[] }>;
  assert.equal(lid.up.uv[1], 59);
});

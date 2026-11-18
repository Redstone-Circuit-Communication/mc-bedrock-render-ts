import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { GeometryLibrary, IDENT, emitGeometry, inheritBindPose, mergeBone, type Geometry } from '../src/renderer/geometry';
import { LayerBuilder } from '../src/renderer/layer';
import { ResourceStack } from '../src/renderer/resources';

const stack = new ResourceStack();
await stack.addBytes(new Uint8Array(readFileSync(new URL('../example/public/packs/bedrock_resources.zip', import.meta.url))));
const lib = new GeometryLibrary(stack);
const geo = (id: string): Geometry => { const g = lib.get(id); assert.ok(g, id); return g!; };
const bone = (id: string, name: string) => { const b = geo(id).bones.find((x) => x.name === name.toLowerCase()); assert.ok(b, `${id}.${name}`); return b!; };

/** Axis-aligned bounds of everything a geometry draws at rest, in model units (1 = 1/16 block, y up). */
function bounds(id: string): { min: number[]; max: number[] } {
  const sink = new LayerBuilder();
  emitGeometry(geo(id), { poses: new Map(), isVisible: () => true, world: IDENT, color: [1, 1, 1], alpha: 1, emissive: false, texW: 64, texH: 64 }, sink);
  const p = sink.finish().positions;
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[i + a]); max[a] = Math.max(max[a], p[i + a]); }
  return { min, max };
}

// -------------------------------------------------- bind_pose_rotation kept ---
// A file can define a geometry twice, as `geometry.x` and as a `minecraft:geometry` block of the same identifier. The new block
// has the same cubes but lost the bind pose that lays an upright-modelled body down; it must inherit it.
test('a minecraft:geometry block inherits the bind_pose_rotation of its legacy twin (polar bear, cat, ocelot, fox, parrot …)', () => {
  assert.deepEqual(bone('geometry.polarbear', 'body').bindPose, [90, 0, 0]);
  assert.deepEqual(bone('geometry.cat', 'body').bindPose, [90, 0, 0]);
  assert.deepEqual(bone('geometry.ocelot.v1.8', 'body').bindPose, [90, 0, 0]);
  assert.deepEqual(bone('geometry.fox', 'body').bindPose, [90, 0, 0]);
  assert.ok(Math.abs(bone('geometry.parrot', 'body').bindPose[0] - 28.287) < 1e-6);
  // …and the new block's own additions stay (the polar bear's ears are a third and fourth head cube)
  assert.equal(bone('geometry.polarbear', 'head').cubes.length, 4);
});
test('a polar bear lies down: it is longer than it is tall', () => {
  const b = bounds('geometry.polarbear');
  assert.ok(b.max[2] - b.min[2] > b.max[1] - b.min[1], 'z (length) exceeds y (height)');
});
test('inheritBindPose leaves a bone alone that is posed some other way', () => {
  const legacy = [{ name: 'body', bind_pose_rotation: [90, 0, 0] }];
  assert.deepEqual(inheritBindPose([{ name: 'body', rotation: [10, 0, 0], cubes: [] }], legacy), [{ name: 'body', rotation: [10, 0, 0], cubes: [] }]);
  assert.deepEqual(inheritBindPose([{ name: 'body', cubes: [{ rotation: [90, 0, 0] }] }], legacy), [{ name: 'body', cubes: [{ rotation: [90, 0, 0] }] }]);
  assert.deepEqual(inheritBindPose([{ name: 'body', cubes: [] }], legacy)[0].bind_pose_rotation, [90, 0, 0]);
  assert.deepEqual(inheritBindPose([{ name: 'body', cubes: [] }], undefined), [{ name: 'body', cubes: [] }]);
});

// ------------------------------------------------ cube rotation pivot ---
// A rotated cube without `pivot` turns about its own centre (minecart.v1.8 reproduces its v1.0 twin's explicit pivots that way).
test('rotated cube without a pivot: the pig lies on its legs, the chicken stays at body height', () => {
  const pig = bounds('geometry.pig.v3');
  assert.ok(pig.min[1] >= -0.01, `pig bottom ${pig.min[1]}: nothing below the ground`);
  const chicken = bounds('geometry.chicken.v1.12');
  assert.ok(chicken.min[1] >= -0.01 && chicken.max[1] <= 16, `chicken y ${chicken.min[1]}..${chicken.max[1]}`);
});
test('minecart.v1.8 has the same footprint as its v1.0 twin (four walls around a 20 × 16 floor)', () => {
  const a = bounds('geometry.minecart.v1.8'), b = bounds('geometry.minecart');
  for (const axis of [0, 2]) {
    assert.ok(Math.abs((a.max[axis] - a.min[axis]) - (b.max[axis] - b.min[axis])) < 0.01, `axis ${axis} extent`);
    assert.ok(Math.abs((a.max[axis] + a.min[axis]) - (b.max[axis] + b.min[axis])) < 0.01, `axis ${axis} centre`);
  }
});

// ------------------------------------------------------- bone merging ---
test('inherited bones merge their cubes unless reset: the sheep keeps its skin head and legs under the wool', () => {
  assert.equal(bone('geometry.sheep.v1.8', 'head').cubes.length, 2, 'skin head + wool cap');
  assert.equal(bone('geometry.sheep.v1.8', 'leg0').cubes.length, 2, 'skin leg + wool sleeve');
  assert.equal(bone('geometry.villager.witch.v1.8', 'nose').cubes.length, 2, 'villager nose + the witch\'s wart');
});
test('reset: true discards the inherited cubes (the enderman\'s thin body and long legs replace the humanoid ones)', () => {
  // a merge would leave two cubes per bone: the humanoid's and the enderman's
  assert.equal(bone('geometry.enderman', 'body').cubes.length, 1);
  assert.equal(bone('geometry.enderman', 'leftleg').cubes.length, 1);
  assert.equal(bone('geometry.zombie.villager', 'body').cubes.length, 2, 'the zombie villager\'s own body + jacket, no humanoid body');
});
test('a child cube at the parent cube\'s place overrides it; the bone\'s own fields stay the child\'s (player arm: uv, no mirror)', () => {
  const parent = { name: 'leftarm', mirror: true, cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [40, 16] }] };
  const child = { name: 'leftArm', cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [32, 48] }, { origin: [4, 12, -2], size: [4, 6, 4], uv: [0, 0] }] };
  const m = mergeBone(parent, child);
  assert.equal(m.cubes.length, 2);
  assert.deepEqual(m.cubes[0].uv, [32, 48]);
  assert.equal(m.mirror, undefined);
  assert.equal(mergeBone(parent, { ...child, reset: true }).cubes.length, 2, 'reset returns the child as is');
  assert.equal(bone('geometry.humanoid.custom', 'leftArm').cubes.length, 1, 'the player has one left arm cube');
});

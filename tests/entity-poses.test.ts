import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceStack } from '../src/renderer/resources';
import { entityLibraryFor, legacyControllers, planEntity } from '../src/renderer/entity';
import { emitGeometry, IDENT } from '../src/renderer/geometry';
import { LayerBuilder } from '../src/renderer/layer';
import { StructureViewer } from '../src/renderer/viewer';
import { officialPacks } from '../scripts/lib/official-pack';

const stack = new ResourceStack();
for (const pack of await officialPacks()) stack.push(pack);
const lib = entityLibraryFor(stack);
/** Vertical extent in blocks of an entity at rest, standing at y = 0. */
function extent(id: string): { min: number; max: number } {
  let min = 1e9, max = -1e9;
  for (const d of planEntity(lib, { identifier: id, pos: [0, 0, 0] })) {
    const sink = new LayerBuilder();
    emitGeometry(d.geometry, { poses: d.poses, isVisible: d.isVisible, world: d.world, color: d.color, alpha: d.alpha, emissive: d.emissive, billboard: d.billboard, texW: d.geometry.texW ?? 64, texH: d.geometry.texH ?? 64 }, sink);
    const p = sink.finish().positions;
    for (let i = 1; i < p.length; i += 3) { min = Math.min(min, p[i]); max = Math.max(max, p[i]); }
  }
  return { min, max };
}

// A format 1.8 client entity has no `scripts.animate`; the game plays its own animation controller.
test('the controller a format 1.8 entity plays by itself is found by its name or by the owner of its animations', () => {
  const ids = (e: string) => legacyControllers(lib, lib.getDef(e)!);
  assert.deepEqual(ids('minecraft:spider'), ['controller.animation.spider.move']);
  assert.deepEqual(ids('minecraft:cave_spider'), ['controller.animation.spider.move'], 'the cave spider declares animation.spider.*');
  assert.deepEqual(ids('minecraft:blaze'), ['controller.animation.blaze.move'], 'blaze.flame only has particles');
});
test('spider legs are bent down to the ground, not straight rods; the blaze\'s rods circle its head', () => {
  assert.ok(extent('minecraft:spider').min < 0.1, `spider legs reach the ground, min y ${extent('minecraft:spider').min}`);
  assert.ok(extent('minecraft:cave_spider').min < 0.1);
  assert.ok(extent('minecraft:blaze').min < 0.5, `blaze rods hang below the head, min y ${extent('minecraft:blaze').min}`);
});
// Playing every format 1.8 controller was tried and sank the wolf by a block, the polar bear by 0.7, the parrot by 0.4 and stretched
// the enderman to 3.5: their controllers need query / variable values the renderer does not provide. They stay as they were.
test('entities whose controller is not verified keep standing on the ground and keep their height', () => {
  for (const id of ['minecraft:wolf', 'minecraft:polar_bear', 'minecraft:parrot', 'minecraft:bat', 'minecraft:villager']) {
    assert.ok(extent(id).min >= -0.05, `${id} below the ground: min y ${extent(id).min}`);
  }
  assert.ok(extent('minecraft:enderman').max < 3.0, `an enderman is 2.9 blocks tall, got ${extent('minecraft:enderman').max}`);
});

// -------------------------------------------------------------- interaction ---
// The orbit interaction takes the numbers of the Java renderer (three.js OrbitControls, CameraManager's presets).
test('orbit interaction parameters are the Java renderer\'s', () => {
  assert.deepEqual(StructureViewer.ORBIT, { rotateSpeed: 0.8, zoomSpeed: 1.2, dampingFactor: 0.08 });
  // one wheel notch (deltaY 100) zooms by 0.95 ^ 1.2 = 6.0 %
  assert.ok(Math.abs(Math.pow(0.95, StructureViewer.ORBIT.zoomSpeed) - 0.9403) < 1e-4);
  // damping: the sum of what is applied each frame (8 % of the rest) is the whole drag
  let pending = 1, applied = 0;
  for (let i = 0; i < 400; i++) { const step = pending * StructureViewer.ORBIT.dampingFactor; applied += step; pending -= step; }
  assert.ok(Math.abs(applied - 1) < 1e-9);
});

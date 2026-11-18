import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { createDefaultRegistry } from '../src/renderer/blocks';
import { EntityLibrary, planEntity } from '../src/renderer/entity';
import { buildStructureMesh } from '../src/renderer/mesher';
import { ResourcePack, ResourceStack } from '../src/renderer/resources';
import { buildMcStructure, parseMcStructure } from '../src/renderer/structure';

// Everything here runs on the example resource pack that ships in the repo (all packs of the game, merged and trimmed).
async function examplePack(): Promise<ResourceStack> {
  const stack = new ResourceStack();
  await stack.addBytes(new Uint8Array(readFileSync(new URL('../example/public/packs/bedrock_resources.zip', import.meta.url))));
  return stack;
}
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

test('grass block sides: the texture alpha is a tint mask (dirt under alpha 0, grey fringe at alpha 255), baked into the atlas', async () => {
  const stack = await examplePack();
  const bytes = buildMcStructure({ size: [1, 1, 1], blockAt: () => ({ name: 'minecraft:grass_block' }) });
  const mesh = await buildStructureMesh(parseMcStructure(bytes), stack, { entities: false, backend: 'legacy' });
  const ref = [...mesh.atlas.rects.keys()].find((k) => /(^|\/)grass_side\|mask:grass$/.test(k));
  const rect = ref ? mesh.atlas.rects.get(ref) : undefined;
  assert.ok(rect, 'the sides use the masked-tint texture');
  const px = (xf: number, yf: number) => {
    const x = Math.floor((rect[0] + (rect[2] - rect[0]) * xf) * mesh.atlas.width), y = Math.floor((rect[1] + (rect[3] - rect[1]) * yf) * mesh.atlas.height);
    const o = (y * mesh.atlas.width + x) * 4;
    return [...mesh.atlas.data.slice(o, o + 4)];
  };
  const fringe = px(0.5, 0.02), dirt = px(0.5, 0.9);
  assert.ok(fringe[1] > fringe[0] && fringe[1] > fringe[2], `fringe is green: ${fringe}`);
  assert.ok(dirt[0] > dirt[1] && dirt[1] > dirt[2], `dirt stays brown: ${dirt}`);
  assert.equal(fringe[3], 255); assert.equal(dirt[3], 255);
});

test('leaf colours: spruce and birch are fixed, oak / jungle / mangrove take the biome foliage, cherry / azalea are untinted', async () => {
  const stack = await examplePack(), reg = createDefaultRegistry();
  // HoloPrint geometry: the tint sits on the quad facing up
  const tint = (name: string) => (reg.resolve({ name, states: {}, x: 0, y: 0, z: 0, neighbor: () => null, isOpaque: () => false, resources: stack } as never) as { quads: { normal: number[]; tint?: unknown }[] }).quads.find((q) => q.normal[1] > 0.9)!.tint;
  assert.equal(tint('spruce_leaves'), 0x619961);
  assert.equal(tint('birch_leaves'), 0x80a755);
  for (const n of ['oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves']) assert.equal(tint(n), 'foliage', n);
  for (const n of ['cherry_leaves', 'azalea_leaves']) assert.equal(tint(n), undefined, n);
});

test('definition files are merged by identifier across packs, not replaced by file', async () => {
  const older = ResourcePack.fromFiles({ 'render_controllers/golem.render_controllers.json': enc({ render_controllers: { 'controller.render.base': { geometry: 'Geometry.default' } } }) });
  const newer = ResourcePack.fromFiles({ 'render_controllers/golem.render_controllers.json': enc({ render_controllers: { 'controller.render.cracks': { geometry: 'Geometry.default' } } }) });
  const lib = new EntityLibrary(new ResourceStack([older, newer]));
  assert.ok(lib.renderControllers.has('controller.render.base'), 'the older pack keeps its controller');
  assert.ok(lib.renderControllers.has('controller.render.cracks'));
});

test('entities saved in a structure: temperate climate variant, full health (iron golem base + no cracks)', async () => {
  const lib = new EntityLibrary(await examplePack());
  const tex = (id: string) => planEntity(lib, { identifier: `minecraft:${id}`, pos: [0, 0, 0] }).map((d) => d.texturePath.replace('textures/entity/', ''));
  assert.deepEqual(tex('chicken'), ['chicken/chicken']);
  assert.ok(tex('cow')[0].startsWith('cow/') && !/cold|warm/.test(tex('cow')[0]));
  assert.ok(!/cold|warm/.test(tex('pig').join()));
  assert.deepEqual(tex('iron_golem'), ['iron_golem', 'iron_golem/cracked_none']);
});

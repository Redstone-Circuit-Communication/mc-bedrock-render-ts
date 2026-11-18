import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { ResourceStack } from '../src/renderer/resources';
import { buildMcStructure, parseMcStructure } from '../src/renderer/structure';
import { buildStructureMesh } from '../src/renderer/mesher';

const pack = readFileSync(new URL('../example/public/packs/bedrock_resources.zip', import.meta.url));
async function faces(blocks: Record<string, { name: string; states?: Record<string, string | number> }>, size: [number, number, number], backend: 'ts' | 'wasm' = 'ts') {
  const stack = new ResourceStack();
  await stack.addBytes(new Uint8Array(pack));
  const bytes = buildMcStructure({ size, blockAt: (x, y, z) => blocks[`${x},${y},${z}`] });
  const mesh = await buildStructureMesh(parseMcStructure(bytes), stack, { entities: false, backend });
  return { solid: mesh.solid.indices.length / 6, translucent: mesh.translucent.indices.length / 6, mesh };
}
const STONE = { name: 'minecraft:stone' };

test('occlusion: two stone cubes hide the faces between them (10 of 12)', async () => {
  assert.equal((await faces({ '0,0,0': STONE, '1,0,0': STONE }, [2, 1, 1])).solid, 10);
});

test('occlusion: a block behind a see-through texture keeps its face (copper grate has holes, stone does not)', async () => {
  // before: the grate was counted as an opaque cube, so the stone's face towards it was culled and the holes showed the void
  const grate = await faces({ '0,0,0': STONE, '1,0,0': { name: 'minecraft:copper_grate' } }, [2, 1, 1]);
  assert.equal(grate.solid, 11, 'stone 6 faces (the one towards the grate stays) + grate 5 (its face towards the stone is hidden by the opaque stone)');
  const cubes = await faces({ '0,0,0': STONE, '1,0,0': STONE }, [2, 1, 1]);
  assert.ok(grate.solid > cubes.solid);
});

test('occlusion: a slab hides only the neighbour face against its flat side', async () => {
  const slab = { name: 'minecraft:stone_block_slab', states: { 'minecraft:vertical_half': 'bottom', stone_slab_type: 'smooth_stone' } };
  // stone below a bottom slab: the stone's top face is covered by the slab's full bottom face; the slab's bottom face by the stone
  const under = await faces({ '0,0,0': STONE, '0,1,0': slab }, [1, 2, 1]);
  assert.equal(under.solid, 10, 'stone 5 + slab 5');
  // stone beside a bottom slab: the slab's side face is only half a face, so the stone's face towards it stays visible
  const beside = await faces({ '0,0,0': STONE, '1,0,0': slab }, [2, 1, 1]);
  assert.equal(beside.solid, 11, 'stone 6 (side face not covered) + slab 5 (its stone-side face is hidden by the stone)');
});

test('translucent layer: glass faces carry outward normals so the viewer can drop the far side', async () => {
  const { mesh } = await faces({ '0,0,0': { name: 'minecraft:white_stained_glass' } }, [1, 1, 1], 'ts');
  const l = mesh.translucent;
  assert.ok(l.normals, 'normals present');
  assert.equal(l.normals!.length, l.positions.length);
  // every vertex of a glass cube's six faces has a unit-length normal, and the six directions are all present
  const dirs = new Set<string>();
  for (let v = 0; v < l.positions.length / 3; v++) {
    const n = [l.normals![v * 3], l.normals![v * 3 + 1], l.normals![v * 3 + 2]];
    assert.ok(Math.abs(Math.hypot(...n) - 1) < 0.02, `unit normal, got ${n}`);
    dirs.add(n.map((c) => Math.round(c)).join(','));
  }
  assert.equal(dirs.size, 6);
  // wasm and the TypeScript core agree
  const w = (await faces({ '0,0,0': { name: 'minecraft:white_stained_glass' } }, [1, 1, 1], 'wasm')).mesh.translucent;
  assert.deepEqual(Array.from(w.normals ?? []).map((n) => Math.round(n)), Array.from(l.normals!).map((n) => Math.round(n)));
});

test('solid layer has normals: the viewer draws blocks FrontSide like the Java package (a closed cube\'s faces point out)', async () => {
  const n = (await faces({ '0,0,0': STONE }, [1, 1, 1])).mesh.solid.normals!;
  assert.ok(n && n.length > 0);
  for (let i = 0; i < n.length; i += 3) assert.equal(Math.round(Math.hypot(n[i], n[i + 1], n[i + 2])), 1, 'no zero (two-sided) normal on a full cube');
});

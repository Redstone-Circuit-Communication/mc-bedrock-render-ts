import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { parseMcStructure } from '../src/renderer/structure';
import { buildStructureMesh } from '../src/renderer/mesher';
import { MeshBuilder } from '../src/mesh/core/index';
import { benchStructure } from './helpers/bench-structure';
import { hasPack, loadBasePack } from './helpers/pack';

const golden = JSON.parse(readFileSync(new URL('./fixtures/mesh-golden.json', import.meta.url), 'utf8'));
const h = (a: ArrayBufferView) => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 32);

test('the optimised legacy mesher is byte-identical to the first-generation mesher (golden hashes)', { skip: !hasPack }, async () => {
  const mesh = await buildStructureMesh(parseMcStructure(benchStructure()), await loadBasePack(), { entities: false, backend: 'legacy' });
  assert.equal(mesh.solid.indices.length / 6, golden.quads.solid);
  assert.equal(mesh.translucent.indices.length / 6, golden.quads.translucent);
  for (const layer of ['solid', 'translucent'] as const)
    for (const k of ['positions', 'uvs', 'colors', 'indices'] as const)
      assert.equal(h(mesh[layer][k]), golden[layer][k], `${layer}.${k}`);
});

test('shared mesh core (same code as the Java package): a 4×3×4 solid cube keeps only its 80 boundary quads', () => {
  const N = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  const quad = (n: number[]) => { const a = n.findIndex((v) => v !== 0), s = n[a], u = (a + 1) % 3, v = (a + 2) % 3; const P: number[] = []; for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = [0, 0, 0]; p[a] = s * 0.5; p[u] = i * 0.5; p[v] = j * 0.5; P.push(...p); } return P; };
  const geometry = {
    positions: new Float32Array(N.flatMap(quad)), normals: new Float32Array(N.flatMap((n) => [...n, ...n, ...n, ...n])),
    uvs: new Float32Array(N.flatMap(() => [0, 0, 1, 0, 1, 1, 0, 1])), indices: new Uint32Array(N.flatMap((_, f) => [0, 1, 2, 0, 2, 3].map((i) => f * 4 + i))), materialIndex: 0,
  };
  const blocks: number[] = []; for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 4; z++) blocks.push(x, y, z, 0);
  const r = new MeshBuilder([{ index: 0, occlusionFlags: 63, category: 'solid', geometries: [geometry] }]).build({ blocks: new Int32Array(blocks) });
  assert.equal(r.stats.triangles, 160);
  assert.equal(r.stats.vertices, 320);
});

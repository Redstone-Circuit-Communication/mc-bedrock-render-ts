import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { ResourceStack } from '../src/renderer/resources';
import { parseMcStructure } from '../src/renderer/structure';
import { buildStructureMesh, type MeshLayerData } from '../src/renderer/mesher';
import { benchStructure } from './helpers/bench-structure';

// Everything below runs on the in-repo example pack and sample structures, so it needs nothing from outside the repo.
const url = (p: string) => new URL(`../example/public/${p}`, import.meta.url);
const load = (p: string) => new Uint8Array(readFileSync(url(p)));

/** One string per quad: vertices (1/256 block), uv (1/1000) and colour (1/1000). */
function quads(l: MeshLayerData): string[] {
  const out: string[] = [];
  for (let q = 0; q < l.indices.length / 6; q++) {
    const vs: string[] = [];
    for (let k = 0; k < 4; k++) {
      const i = l.indices[q * 6 + (k === 3 ? 5 : k)];
      vs.push([0, 1, 2].map((a) => Math.round(l.positions[i * 3 + a] * 256) / 256).join(',') + '|' + [0, 1].map((a) => Math.round(l.uvs[i * 2 + a] * 1e3) / 1e3).join(',') + '|' + [0, 1, 2, 3].map((a) => Math.round(l.colors[i * 4 + a] * 1e3) / 1e3).join(','));
    }
    out.push(vs.join(';'));
  }
  return out;
}
/** Multiset difference of two quad lists: what only `a` has and what only `b` has. */
function diff(a: string[], b: string[]) {
  const m = new Map<string, number>();
  for (const k of a) m.set(k, (m.get(k) ?? 0) + 1);
  const onlyB: string[] = [];
  for (const k of b) { const n = m.get(k) ?? 0; if (n) m.set(k, n - 1); else onlyB.push(k); }
  const onlyA: string[] = [];
  for (const [k, n] of m) for (let i = 0; i < n; i++) onlyA.push(k);
  return { onlyA, onlyB };
}
/** `true` when the quad lies in a plane between two blocks (all four vertices share an integer coordinate). */
function onCellBoundary(quad: string): boolean {
  const v = quad.split(';').map((p) => p.split('|')[0].split(',').map(Number));
  return [0, 1, 2].some((a) => v.every((p) => p[a] === v[0][a]) && Math.abs(v[0][a] - Math.round(v[0][a])) < 1 / 256);
}

async function meshes(bytes: Uint8Array) {
  const stack = new ResourceStack();
  await stack.addBytes(load('packs/bedrock_resources.zip'));
  // 'wasm' is still accepted (one options object serves both renderers) and since 1.6.0 gives the TS core
  const out = {} as Record<'legacy' | 'ts' | 'wasm', Awaited<ReturnType<typeof buildStructureMesh>>>;
  for (const backend of ['legacy', 'ts', 'wasm'] as const) out[backend] = await buildStructureMesh(parseMcStructure(bytes), stack, { entities: false, backend });
  return out;
}

const SAMPLES: [string, () => Uint8Array][] = [
  ['all-blocks', () => load('schematics/all-blocks.mcstructure')],
  ['inspection-demo', () => load('schematics/inspection-demo.mcstructure')],
  ['redstone-demo', () => load('schematics/redstone-demo.mcstructure')],
  ['terrain', () => benchStructure()],
];

for (const [name, bytes] of SAMPLES) {
  test(`mesh backends on ${name}: a 'wasm' request is served by the shared TS core, which only drops faces the single-pass mesher draws hidden`, async () => {
    const m = await meshes(bytes());
    assert.equal(m.wasm.stats.meshBackend, 'ts', 'no wasm builder ships in this package any more (NOTICE.md)');
    assert.equal(m.ts.stats.meshBackend, 'ts');
    assert.equal(m.legacy.stats.meshBackend, 'legacy');
    for (const layer of ['solid', 'translucent'] as const) {
      const ts = quads(m.ts[layer]), wasm = quads(m.wasm[layer]), legacy = quads(m.legacy[layer]);
      const same = diff(ts, wasm);
      assert.deepEqual([same.onlyA.length, same.onlyB.length], [0, 0], `${layer}: asking for wasm gives exactly the TS core's quads`);
      const d = diff(legacy, ts);
      // quads only the single-pass mesher emits are faces between two blocks that are hidden anyway (pane / bars ends against
      // solid blocks, water inside water); the palette mesher adds only the floor face under translucent blocks that the
      // single pass wrongly culls (honey, frosted ice) — also a face in a plane between two blocks.
      // Since the occlusion flags follow the texture alpha (tests/occlusion.test.ts), the palette mesher also keeps the faces
      // next to blocks whose texture has transparent pixels (copper grates, old leaves, sprite textures: the single pass counts
      // them as opaque cubes and culls what lies behind their holes): about twenty on all-blocks
      assert.ok(d.onlyA.every(onCellBoundary), `${layer}: every legacy-only quad is a boundary face`);
      assert.ok(d.onlyB.every(onCellBoundary) && d.onlyB.length <= 24, `${layer}: palette-only quads ${d.onlyB.length}`);
    }
    assert.equal(m.wasm.stats.unknownBlocks.join(), m.legacy.stats.unknownBlocks.join());
  });
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { HoloGeometry } from '../src/renderer/holoprint/geo';
import { parseMcStructure } from '../src/renderer/structure';

/**
 * The TypeScript port of HoloPrint's geometry maker (src/renderer/holoprint/geo.ts) against the original code: tests/holoprint/
 * NeoBlockGeoMaker.reference.js is the `core/NeoBlockGeoMaker.js` of neoHoloprintDB 0.2.4, run as it is, with ONE change (marked
 * in the file): `conditionallyGroup` returns its two groups the way upstream HoloPrint's does. In the shipped file they are the
 * other way round, which makes the geometry optimiser merge and cull the *rotated* cubes instead of the straight ones (a
 * cross-shaped plant loses one of its two planes). See docs/HOLOPRINT.md.
 *
 * Every block state of the example structures goes through both; the vertex positions, texture corners and texture references
 * of every face have to match.
 */
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const D = (n: string) => JSON.parse(read(`src/renderer/holoprint/data/${n}.json`));
const data = { blockShapes: D('blockShapes'), blockShapeGeos: D('blockShapeGeos'), blockStateDefinitions: D('blockStateDefinitions'), blockEigenvariants: D('blockEigenvariants') };

const quiet = { log() {}, debug() {}, warn() {}, error() {} };
const sandbox: Record<string, unknown> = { window: {}, console: quiet, structuredClone };
sandbox.globalThis = sandbox;
vm.runInNewContext(read('tests/holoprint/NeoBlockGeoMaker.reference.js'), sandbox);
const Reference = (sandbox.window as Record<string, new (...a: unknown[]) => any>).neoHoloprintDB_NeoBlockGeoMaker;
const reference = new Reference({ SCALE: 1, IGNORED_BLOCKS: [] }, data.blockShapes, data.blockShapeGeos, data.blockStateDefinitions, data.blockEigenvariants, quiet);
const port = new HoloGeometry(data as never);
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

for (const file of ['all-blocks', 'redstone-demo', 'inspection-demo', 'entities-demo']) {
  test(`HoloPrint port = original, every block state of ${file}.mcstructure`, () => {
    const structure = parseMcStructure(readFileSync(new URL(`../example/public/schematics/${file}.mcstructure`, import.meta.url)));
    const bad: string[] = [];
    for (const entry of structure.palette) {
      const block = { name: entry.name.replace(/^minecraft:/, ''), states: JSON.parse(JSON.stringify(entry.states)) };
      const a = reference.makePolyMeshTemplates([structuredClone(block)])[0];
      const b = port.faces(structuredClone(block));
      const geo = (faces: { vertices: { pos: number[]; corner: number }[] }[]) => faces.map((f) => JSON.stringify(f.vertices.map((v) => [v.pos.map(r4), v.corner]))).sort().join('|');
      const refs = [...reference.textureRefs];
      const texA = a.map((f: { textureRefI: number }) => JSON.stringify(refs[f.textureRefI])).sort().join('|');
      const texB = b.map((f) => JSON.stringify(f.tex)).sort().join('|');
      if (a.length !== b.length || geo(a) !== geo(b) || texA !== texB) bad.push(`${block.name} ${JSON.stringify(block.states)}: ${a.length} faces vs ${b.length}`);
    }
    assert.deepEqual(bad.slice(0, 10), [], `${bad.length} of ${structure.palette.length} block states differ`);
    assert.ok(structure.palette.length > 0);
  });
}

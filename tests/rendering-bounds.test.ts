import assert from 'node:assert/strict';
import test from 'node:test';
import { restrictStructure } from '../src/renderer/bounds';
import { McStructureRenderer } from '../src/renderer/renderer';
import { buildMcStructure, parseMcStructure } from '../src/renderer/structure';
import { fakeCanvas, installFakeDom } from './helpers/fake-dom';

/**
 * Rendering bounds (slicing), the Java renderer's semantics: `min <= block < max` per axis, blocks outside are not meshed —
 * so the faces the cut uncovers are drawn (a solid cube cut in half is a closed box, not a hollow shell).
 */
installFakeDom();
const cube = (n = 3) => buildMcStructure({ size: [n, n, n], blockAt: () => ({ name: 'minecraft:stone' }) });
const options = { meshBackend: 'ts', entities: false } as const;
const QUAD = 6; // indices per quad

async function setup(n = 3) {
  const { canvas, log } = fakeCanvas();
  const r = new McStructureRenderer(canvas, options);
  const s = await r.schematicManager.loadSchematic('a', cube(n));
  const quads = () => { log.drawElements.length = 0; r.viewer.render(); return log.drawElements.reduce((a, b) => a + b, 0) / QUAD; };
  return { r, s, quads };
}

test('a solid cube shows its 6 outer sides; cutting it keeps a closed box (the cut face is drawn)', async () => {
  const { r, s, quads } = await setup(3);
  assert.equal(quads(), 54);
  r.setRenderingBounds('a', [0, 0, 0], [3, 2, 3]); // y = 2 and above hidden
  await s.rebuildMesh();
  // two layers high: top and bottom 9 + 9, four sides 6 each
  assert.equal(quads(), 9 + 9 + 4 * 6);
  s.bounds.maxY = 1;
  await s.rebuildMesh();
  assert.equal(quads(), 9 + 9 + 4 * 3);
  r.dispose();
});

test('max is exclusive and min inclusive; the three axes are independent', async () => {
  const { r, s, quads } = await setup(4);
  r.setRenderingBounds('a', [1, 1, 1], [3, 3, 3]); // a 2×2×2 block
  await s.rebuildMesh();
  assert.equal(quads(), 24);
  r.setRenderingBoundsAxis('a', 'x', 0, 1); // now 1×2×2
  await s.rebuildMesh();
  // a 1×2×2 slab: its two big faces are 2×2 (4 quads each), the other four sides are 1×2 (2 quads each)
  assert.equal(quads(), 2 * 4 + 4 * 2);
  assert.deepEqual(r.getRenderingBounds('a'), { min: [0, 1, 1], max: [1, 3, 3] });
  const objects = r.getRenderingBounds('a', false)!;
  assert.equal((objects.min as { x: number }).x, 0);
  r.dispose();
});

test('reset: back to the full size, bounds off; `reset(false)` keeps them on', async () => {
  const { r, s, quads } = await setup(3);
  r.setRenderingBounds('a', [0, 0, 0], [1, 1, 1]);
  await s.rebuildMesh();
  assert.equal(quads(), 6);
  assert.equal(s.bounds.enabled, true);
  r.resetRenderingBounds('a');
  await s.rebuildMesh();
  assert.equal(quads(), 54);
  assert.equal(s.bounds.enabled, false);
  assert.deepEqual(r.getRenderingBounds('a'), { min: [0, 0, 0], max: [3, 3, 3] });
  r.resetRenderingBounds('a', false);
  assert.equal(s.bounds.enabled, true);
  r.dispose();
});

test('the reactive `bounds` object: setting a value turns nothing on until `enabled`; enabled shows the helper box', async () => {
  const { r, s, quads } = await setup(3);
  s.bounds.maxY = 1;
  assert.equal(s.bounds.enabled, false);
  await s.rebuildMesh();
  assert.equal(quads(), 54, 'bounds are off: everything is drawn');
  assert.equal(s.helperOverlays().length, 0);
  s.bounds.enabled = true;
  assert.equal(s.helperOverlays().length, 1, 'turning them on shows the wireframe');
  assert.equal(s.helperOverlays()[0].positions.length, 12 * 2 * 3);
  await s.rebuildMesh();
  assert.equal(quads(), 3 * 3 + 3 * 3 + 4 * 3);
  assert.equal(s.bounds.showHelper(false), 'Helper hidden');
  assert.equal(s.helperOverlays().length, 0);
  assert.equal(s.bounds.reset(), 'Reset to full dimensions');
  r.dispose();
});

test('many quick changes cost one rebuild: only the newest bounds end up on screen', async () => {
  const { r, s, quads } = await setup(3);
  const first = s.rebuildMesh();
  r.setRenderingBounds('a', [0, 0, 0], [3, 1, 3]);
  const second = s.rebuildMesh();
  await Promise.all([first, second]);
  assert.equal(quads(), 9 + 9 + 4 * 3, 'the newest request won, whichever finished last');
  r.dispose();
});

test('restrictStructure: blocks, block entities and entities outside are dropped; size and origin stay', () => {
  const bytes = buildMcStructure({
    size: [4, 4, 4],
    blockAt: (x, y, z) => ({ name: x === 0 && y === 0 && z === 0 ? 'minecraft:chest' : 'minecraft:stone' }),
    blockEntityAt: (x, y, z) => (x === 0 && y === 0 && z === 0 ? { id: { t: 'string', v: 'Chest' } } : null),
    entities: [{ identifier: { t: 'string', v: 'minecraft:pig' }, Pos: { t: 'list', of: 'float', v: [{ t: 'float', v: 0.5 }, { t: 'float', v: 0 }, { t: 'float', v: 0.5 }] } }],
  });
  const full = parseMcStructure(bytes);
  assert.equal(full.entities.length, 1);
  const inside = restrictStructure(full, [0, 0, 0], [2, 2, 2]);
  assert.deepEqual(inside.size, full.size);
  assert.equal(inside.blockEntities.size, 1);
  assert.equal(inside.entities.length, 1);
  const outside = restrictStructure(full, [1, 1, 1], [4, 4, 4]);
  assert.equal(outside.blockEntities.size, 0);
  assert.equal(outside.entities.length, 0);
  assert.equal(outside.paletteIndexAt(0, 0, 0), -1);
  assert.ok(outside.paletteIndexAt(1, 1, 1) >= 0);
  assert.ok(full.paletteIndexAt(0, 0, 0) >= 0, 'the original is untouched');
});

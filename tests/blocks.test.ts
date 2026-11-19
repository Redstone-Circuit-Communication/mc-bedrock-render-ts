import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultRegistry } from '../src/renderer/blocks';
import { DIRS } from '../src/renderer/models';
import { CANDIDATES } from '../scripts/candidate-blocks';
import { buildFixturePack } from './helpers/fixture';
import { hasPack, loadBasePack } from './helpers/pack';
import { officialPacks } from '../scripts/lib/official-pack';

function coverage(stack: Awaited<ReturnType<typeof loadBasePack>>) {
  const reg = createDefaultRegistry();
  const unresolved: string[] = [], badTexture: string[] = []; let ok = 0;
  for (const name of CANDIDATES) {
    const m = reg.resolve({ name, states: {}, x: 0, y: 0, z: 0, neighbor: () => null, isOpaque: () => false, resources: stack } as never);
    if (m === undefined) { unresolved.push(name); continue; }
    if (m === null) continue;
    let bad = false;
    for (const el of m.elements) for (const d of DIRS) { const f = el.faces[d]; if (f && (f.tex === 'missing' || !stack.hasTexture(f.tex))) bad = true; }
    for (const q of m.quads ?? []) if (q.tex === 'missing' || !stack.hasTexture(q.tex)) bad = true;
    if (bad) badTexture.push(name); else ok++;
  }
  return { ok, unresolved, badTexture };
}

test('every candidate block has a handler (newer packs stood in for by a synthetic texture fixture)', { skip: !hasPack }, async () => {
  const stack = await loadBasePack();
  stack.push(buildFixturePack(stack, CANDIDATES).pack);
  const c = coverage(stack);
  assert.deepEqual(c.unresolved, []);
  assert.deepEqual(c.badTexture, []);
  assert.ok(c.ok > 1100);
});

test('with only the supplied base pack, every block of its own era draws with real textures', { skip: !hasPack }, async () => {
  const stack = await loadBasePack();
  const c = coverage(stack);
  assert.ok(c.ok >= 650, `ok = ${c.ok}`);
  // everything that is missing here is a block whose texture is not in the base pack (1.14-era textures only)
  for (const n of ['stone', 'oak_planks', 'oak_stairs', 'redstone_wire', 'hopper', 'observer', 'piston', 'dispenser', 'chest', 'lectern', 'barrel'])
    assert.ok(!c.unresolved.includes(n) && !c.badTexture.includes(n), `${n} must render from the base pack`);
});

test('every block id of the real packs (blocks.json) resolves with real textures — the example pack', async () => {
  const { readFileSync } = await import('fs');
  const { ResourceStack } = await import('../src/renderer/resources');
  const stack = new ResourceStack();
  for (const pack of await officialPacks()) stack.push(pack);
  const reg = createDefaultRegistry();
  const unresolved: string[] = [], missing: string[] = [];
  for (const id of stack.blocksJson.keys()) {
    const m = reg.resolve({ name: id, states: {}, x: 0, y: 0, z: 0, neighbor: () => null, isOpaque: () => false, resources: stack } as never);
    if (m === undefined) { unresolved.push(id); continue; }
    if (m === null) continue;
    for (const el of m.elements) for (const d of DIRS) { const f = el.faces[d]; if (f && (f.tex === 'missing' || !stack.hasTexture(f.tex))) missing.push(`${id}→${f.tex}`); }
  }
  // `shelf_mushroom` lists only its sound in blocks.json; it is drawn from the pack's models/blocks/shelf_mushroom_*.geo.json
  assert.deepEqual(unresolved, []);
  assert.deepEqual([...new Set(missing)], []);
});

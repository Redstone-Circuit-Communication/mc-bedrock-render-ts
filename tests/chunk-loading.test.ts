import assert from 'node:assert/strict';
import test from 'node:test';
import { BlueprintLoader, isAbortError } from '../src/blueprint-loader';
import { SDK_API, SDK_EDITION } from '../src/sdk';
import { buildStructureMesh } from '../src/renderer/mesher';
import { McStructureRenderer } from '../src/renderer/renderer';
import { ResourceStack } from '../src/renderer/resources';
import { buildMcStructure, parseMcStructure } from '../src/renderer/structure';
import { fakeCanvas, installFakeDom } from './helpers/fake-dom';

/**
 * Progressive loading (`chunkLoading`): one 16³ chunk at a time, bottom layer first, at least `minIntervalMs` per chunk;
 * the structure joins the scene before its first chunk; a newer load cancels one that is still streaming.
 */
installFakeDom();

// 40 × 20 × 20: chunks along x 0/16/32, y 0/16, z 0/16; the x = 16…31 slab is air, so its chunks are skipped
const bytes = buildMcStructure({
  size: [40, 20, 20],
  blockAt: (x, y, z) => (x >= 16 && x < 32 ? null : (x + y + z) % 3 ? { name: 'minecraft:stone' } : { name: 'minecraft:glass' }),
});
const small = buildMcStructure({ size: [3, 3, 3], blockAt: (x) => ({ name: x ? 'minecraft:stone' : 'minecraft:dirt' }) });
const buffer = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const opts = { backend: 'ts', entities: false } as const;
const filledChunks = 2 /* x */ * 2 /* y */ * 2 /* z */;

test('the mesher streams every non-empty chunk once, bottom layer first, and the whole mesh still comes back', async () => {
  const structure = parseMcStructure(bytes);
  const whole = await buildStructureMesh(structure, new ResourceStack(), opts);
  const seen: { origin: number[]; done: number; total: number; faces: number }[] = [];
  let atlasFirst = false;
  const streamed = await buildStructureMesh(structure, new ResourceStack(), opts, {
    onAtlas: (atlas, size) => { atlasFirst = seen.length === 0 && atlas.width > 0; assert.deepEqual(size, [40, 20, 20]); },
    onChunk: (c, done, total) => { seen.push({ origin: c.origin, done, total, faces: (c.solid.indices.length + c.translucent.indices.length) / 6 }); },
  });
  assert.ok(atlasFirst, 'the atlas comes before the first chunk');
  assert.equal(seen.length, filledChunks);
  assert.deepEqual(seen.map((s) => s.done), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(seen.every((s) => s.total === filledChunks));
  assert.ok(seen.every((s) => s.origin[0] !== 16), 'the empty slab is skipped');
  const ys = seen.map((s) => s.origin[1]);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b), 'bottom layer first');
  assert.equal(seen.reduce((n, s) => n + s.faces, 0), streamed.stats.faces, 'the chunks add up to the whole mesh');
  assert.equal(streamed.stats.faces, whole.stats.faces, 'streaming does not change the geometry');
});

test('every chunk takes at least minChunkMs (the rest is a pause), and an aborted signal stops between two chunks', async () => {
  const structure = parseMcStructure(bytes);
  const stamps: number[] = [];
  const t0 = performance.now();
  await buildStructureMesh(structure, new ResourceStack(), opts, { minChunkMs: 40, onChunk: () => { stamps.push(performance.now()); } });
  const spent = performance.now() - t0;
  // every chunk gets a slot of at least minChunkMs from the moment it starts meshing, so chunk k cannot show before k whole slots have
  // passed. (The gap between two *appearances* can be shorter: a chunk that meshes slowly uses up more of its own slot than the next one.)
  for (let i = 0; i < stamps.length; i++) assert.ok(stamps[i] - t0 >= i * 40 - 2, `chunk ${i + 1} showed ${Math.round(stamps[i] - t0)} ms after the start`);
  assert.ok(spent >= filledChunks * 38, `whole load took ${Math.round(spent)} ms`);

  const stop = new AbortController();
  let chunks = 0;
  await assert.rejects(
    buildStructureMesh(structure, new ResourceStack(), opts, { minChunkMs: 30, signal: stop.signal, onChunk: (_c, done) => { chunks = done; if (done === 2) stop.abort(); } }),
    (e: unknown) => isAbortError(e),
  );
  assert.equal(chunks, 2, 'no chunk after the abort');
});

async function renderer(minIntervalMs: number) {
  const { canvas } = fakeCanvas();
  const r = new McStructureRenderer(canvas, { meshBackend: 'ts', entities: false, chunkLoading: { minIntervalMs } });
  return r;
}

test('renderer chunkLoading: onStart before the first chunk, one GPU set per chunk sharing the atlas, progress callback and event', async () => {
  const r = await renderer(0);
  const order: string[] = [];
  const events: number[] = [];
  const callbacks: number[] = [];
  r.options.callbacks = { onChunkProgress: (_id, done) => callbacks.push(done) };
  r.eventEmitter.on('schematicChunkProgress', (e: { id: string; done: number; total: number }) => { order.push(`chunk ${e.done}`); events.push(e.total); });
  const loaded = await r.schematicManager.loadSchematic('door', buffer(bytes), { focused: false }, {
    onStart: (s) => { order.push('start'); assert.equal(s.id, 'door'); assert.ok(r.schematicManager.getSchematic('door'), 'in the scene before its chunks'); },
  });
  assert.equal(order[0], 'start');
  assert.equal(order.length, filledChunks + 1);
  assert.deepEqual(callbacks, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(events.every((t) => t === filledChunks));
  const handle = (loaded as unknown as { handle: { sets: { shared?: boolean }[]; blockSets: number } }).handle;
  assert.equal(handle.blockSets, 1 + filledChunks, 'the atlas set plus one set per chunk');
  assert.ok(handle.sets.slice(1, handle.blockSets).every((s) => s.shared), 'chunks share the atlas texture');
  assert.ok(loaded.mesh.stats.faces > 0, 'the final mesh replaces the placeholder');
  r.dispose();
});

test('renderer chunkLoading: removing the structure while it streams stops it with an AbortError and leaves nothing behind', async () => {
  const r = await renderer(20);
  r.eventEmitter.on('schematicChunkProgress', (e: { done: number }) => { if (e.done === 2) void r.schematicManager.removeSchematic('door'); });
  await assert.rejects(r.schematicManager.loadSchematic('door', buffer(bytes), { focused: false }), (e: unknown) => isAbortError(e));
  assert.equal(r.schematicManager.getAllSchematics().length, 0);
  assert.equal(r.viewer.meshCount, 0, 'GPU object freed');
  r.dispose();
});

test('BlueprintLoader with chunkLoading: hooks report start and chunks; a newer load cancels the one still streaming', async () => {
  const r = await renderer(15);
  const loader = new BlueprintLoader(r);
  const chunks: number[] = [];
  let started = 0;
  const first = loader.load(buffer(bytes), 'big.mcstructure', { onStart: () => started++, onChunk: (done) => chunks.push(done) });
  // let the first one get going, then replace it
  await new Promise((resolve) => setTimeout(resolve, 60));
  const second = loader.load(buffer(small), 'small.mcstructure', { onStart: () => started++ });
  await assert.rejects(first, (e: unknown) => isAbortError(e));
  const result = await second;
  assert.ok(chunks.length > 0 && chunks.length < filledChunks, `the first load streamed ${chunks.length} chunks before it was cancelled`);
  assert.equal(started, 2);
  assert.deepEqual(r.schematicManager.getAllSchematics().map((s) => s.id), [result.id], 'only the newer structure is left');
  assert.deepEqual(result.dimensions, [3, 3, 3]);

  // an aborted signal cancels a queued load before it starts
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(loader.load(buffer(small), 'small.mcstructure', { signal: stop.signal }), (e: unknown) => isAbortError(e));
  assert.deepEqual(r.schematicManager.getAllSchematics().map((s) => s.id), [result.id], 'a cancelled load does not touch the scene');
  await loader.dispose();
  r.dispose();
});

test('BlueprintLoader without chunkLoading: unchanged, and onStart still fires once the structure is shown', async () => {
  const { canvas } = fakeCanvas();
  const r = new McStructureRenderer(canvas, { meshBackend: 'ts', entities: false });
  const loader = new BlueprintLoader(r);
  let visibleAtStart: boolean | undefined;
  const result = await loader.load(buffer(small), 'small.mcstructure', { onStart: (s) => { visibleAtStart = s.group.visible; } });
  assert.equal(visibleAtStart, true);
  assert.deepEqual(result.dimensions, [3, 3, 3]);
  await loader.dispose();
  r.dispose();
});

test('the SDK says which contract it implements', () => {
  assert.equal(SDK_API, 1);
  assert.equal(SDK_EDITION, 'bedrock');
});

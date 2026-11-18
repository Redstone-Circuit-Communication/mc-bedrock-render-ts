import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

// Since 1.6.0 the package ships no wasm builder (its source is schematic-renderer's, AGPL-3.0; see NOTICE.md). A 'wasm'
// request is served by the shared TS core without touching WebAssembly at all — so a Content-Security-Policy without
// `wasm-unsafe-eval` cannot break meshing. Node's own fetch/Response machinery (undici's llhttp) compiles wasm by itself,
// so the test does not block WebAssembly: it records every compile/instantiate that does not come from Node internals.
test('a wasm request meshes on the shared TS core without touching WebAssembly', async () => {
  const saved = { instantiate: WebAssembly.instantiate, compile: WebAssembly.compile };
  const ours: string[] = [];
  const watch = (name: 'instantiate' | 'compile') => function (this: unknown, ...args: unknown[]) {
    const stack = new Error().stack ?? '';
    if (!/node:internal|undici/.test(stack)) ours.push(name);
    return (saved[name] as (...a: unknown[]) => unknown).apply(this, args);
  };
  (WebAssembly as { instantiate: unknown }).instantiate = watch('instantiate');
  (WebAssembly as { compile: unknown }).compile = watch('compile');
  try {
    const { buildStructureMesh } = await import('../src/renderer/mesher');
    const { ResourceStack } = await import('../src/renderer/resources');
    const { parseMcStructure } = await import('../src/renderer/structure');
    const stack = new ResourceStack();
    await stack.addBytes(new Uint8Array(readFileSync(new URL('../example/public/packs/bedrock_resources.zip', import.meta.url))));
    const bytes = new Uint8Array(readFileSync(new URL('../example/public/schematics/redstone-demo.mcstructure', import.meta.url)));
    for (const backend of ['wasm', undefined] as const) {
      const m = await buildStructureMesh(parseMcStructure(bytes), stack, { entities: false, backend });
      assert.equal(m.stats.meshBackend, 'ts', `backend ${backend ?? '(default)'}`);
      assert.ok(m.stats.faces > 500);
    }
    assert.deepEqual(ours, [], 'the package itself never compiles or instantiates WebAssembly');
  } finally {
    (WebAssembly as { instantiate: unknown }).instantiate = saved.instantiate;
    (WebAssembly as { compile: unknown }).compile = saved.compile;
  }
});

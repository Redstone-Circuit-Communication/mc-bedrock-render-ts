/** Meshing benchmark: legacy single pass vs the palette mesher on the shared TS core (the wasm builder was removed in 1.6.0). */
import { readFileSync } from 'fs';
import { ResourceStack } from '../src/renderer/resources';
import { parseMcStructure } from '../src/renderer/structure';
import { buildStructureMesh } from '../src/renderer/mesher';
import { benchStructure } from './helpers/bench-structure';

const sizes: [number, number, number][] = process.argv.length > 2 ? [[Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4])]] : [[48, 64, 48], [64, 96, 64], [64, 384, 64]];
const packPath = process.env.BEDROCK_PACK ?? new URL('../example/public/packs/bedrock_resources.zip', import.meta.url).pathname;
(async () => {
  const stack = new ResourceStack();
  await stack.addBytes(new Uint8Array(readFileSync(packPath)));
  for (const size of sizes) {
    const bytes = benchStructure(size);
    const row: Record<string, unknown> = { size: size.join('×'), cells: size[0] * size[1] * size[2] };
    for (const backend of ['legacy', 'ts'] as const) {
      const times: number[] = []; let quads = 0;
      for (let i = 0; i < 4; i++) {
        const s = parseMcStructure(bytes);
        const t0 = performance.now();
        const m = await buildStructureMesh(s, stack, { entities: false, backend });
        if (i > 0) times.push(performance.now() - t0);   // first run warms up the JIT
        quads = m.stats.faces;
      }
      times.sort((a, b) => a - b);
      row[backend] = `${Math.round(times[1])} ms · ${quads} faces`;
    }
    console.log(JSON.stringify(row));
  }
})();

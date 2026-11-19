/** Block coverage: how many candidate ids resolve to a real model whose textures exist in the supplied pack(s). */
import { readFileSync } from 'fs';
import { ResourcePack, ResourceStack } from '../src/renderer/resources';
import { createDefaultRegistry } from '../src/renderer/blocks';
import { CANDIDATES } from '../scripts/candidate-blocks';
import { DIRS } from '../src/renderer/models';
import { buildFixturePack } from './helpers/fixture';
import { officialPacks } from '../scripts/lib/official-pack';

const args = process.argv.slice(2);
// a pack zip as argument or in BEDROCK_PACK; by default Mojang's official resources (downloaded once into .cache/)
const packPath = args.find((a) => !a.startsWith('--')) ?? process.env.BEDROCK_PACK;
const withFixture = args.includes('--fixture');
(async () => {
  const stack = new ResourceStack(packPath ? [await ResourcePack.fromBytes(new Uint8Array(readFileSync(packPath)))] : await officialPacks());
  if (withFixture) { const { pack, refs } = buildFixturePack(stack, CANDIDATES); stack.push(pack); console.log('fixture textures:', refs.length); }
  const reg = createDefaultRegistry();
  const unresolved: string[] = [], missingTex = new Map<string, string[]>(); let ok = 0, nullModels = 0;
  for (const name of CANDIDATES) {
    const ctx = { name, states: {}, x: 0, y: 0, z: 0, neighbor: () => null, isOpaque: () => false, resources: stack };
    let m: any;
    try { m = reg.resolve(ctx as any); } catch (e) { unresolved.push(name + ' (throws)'); continue; }
    if (m === undefined) { unresolved.push(name); continue; }
    if (m === null) { nullModels++; continue; }
    const bad: string[] = [];
    for (const el of m.elements) for (const d of DIRS) { const f = el.faces[d]; if (f && f.tex !== 'missing' && !stack.hasTexture(f.tex)) bad.push(f.tex); }
    if (bad.length || JSON.stringify(m).includes('"tex":"missing"')) missingTex.set(name, [...new Set(bad)].length ? [...new Set(bad)] : ['missing']);
    else ok++;
  }
  console.log(`candidates ${CANDIDATES.length} | ok ${ok} | null ${nullModels} | UNRESOLVED ${unresolved.length} | BAD TEXTURE ${missingTex.size}`);
  console.log('UNRESOLVED:', unresolved.join(' '));
  console.log('BAD TEXTURE:', [...missingTex].map(([k, v]) => `${k}→${v.slice(0, 2).join('|')}`).join('  '));
})();

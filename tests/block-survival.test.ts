/**
 * The sample structures as the game will keep them (scripts/lib/block-survival.ts): liquids cannot flow out, plants stand
 * on ground they live on, wall-mounted blocks have something to hang on, leaves do not decay, cacti have free sides.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMcStructure } from '../src/renderer/structure';

const GROUND: [RegExp, string][] = [
  [/^(wheat|carrots|potatoes|beetroot|melon_stem|pumpkin_stem|torchflower_crop|pitcher_crop)$/, 'farmland'],
  [/^(cactus|deadbush|short_dry_grass|tall_dry_grass|reeds)$/, 'sand'],
  [/^(brown|red)_mushroom$/, 'mycelium'],
  [/^(nether_wart|bubble_column)$/, 'soul_sand'],
  [/^chorus_(plant|flower)$/, 'end_stone'],
  [/(^|_)sapling$|^(dandelion|poppy|blue_orchid|allium|azure_bluet|(red|orange|white|pink)_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|short_grass|fern|bush|azalea|sweet_berry_bush|bamboo|pink_petals|wildflowers)$/, 'grass_block'],
];

test('every-block example: nothing flows, falls, decays or drops once the game loads it', () => {
  const s = parseMcStructure(new Uint8Array(readFileSync('example/public/schematics/all-blocks.mcstructure')));
  const [sx, sy, sz] = s.size;
  const name = (x: number, y: number, z: number, layer = 0) =>
    x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 'air' : (s.blockAt(x, y, z, layer)?.name ?? 'minecraft:air').replace('minecraft:', '');
  const bad: string[] = [];
  let liquids = 0;
  for (let x = 0; x < sx; x++) for (let y = 1; y < sy; y++) for (let z = 0; z < sz; z++) {
    const id = name(x, y, z), states = s.blockAt(x, y, z)?.states ?? {};
    if (id === 'air') continue;
    for (const [rx, ground] of GROUND) if (rx.test(id) && ![ground, id].includes(name(x, y - 1, z))) bad.push(`${id} on ${name(x, y - 1, z)}`);
    if (/^(flowing_)?(water|lava)$/.test(id) || name(x, y, z, 1) === 'water') {
      liquids++;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (name(x + dx, y, z + dz) === 'air') bad.push(`${id} at ${x},${y},${z} can flow`);
    }
    if (/leaves/.test(id) && 'persistent_bit' in states && !states.persistent_bit) bad.push(`${id} decays`);
    if (id === 'cactus') for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (name(x + dx, y, z + dz) !== 'air') bad.push('cactus touches a block');
    if (/(_wall_sign|_wall_banner)$|^(wall_sign|ladder)$/.test(id) && name(x, y, z + 1) === 'air') bad.push(`${id} has nothing behind it`);
  }
  assert.ok(liquids > 20, `liquid cells: ${liquids}`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} problems`);
});

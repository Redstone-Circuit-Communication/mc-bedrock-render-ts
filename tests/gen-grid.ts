/** Writes tests/e2e/out/<preset>.mcstructure (a labelled grid of blocks) and fixture.zip (the synthetic textures). */
import { readFileSync, writeFileSync } from 'fs';
import { ResourcePack, ResourceStack } from '../src/renderer/resources';
import { buildMcStructure } from '../src/renderer/structure';
import { buildFixturePack } from './helpers/fixture';
import { writeZip } from './helpers/zipwriter';
import { CANDIDATES } from '../scripts/candidate-blocks';

const OUT = process.env.E2E_OUT ?? new URL('./e2e/out', import.meta.url).pathname;
type Spec = { name: string; states?: Record<string, string | number> };
const PRESETS: Record<string, Spec[]> = {
  shapes: [
    'amethyst_cluster', 'large_amethyst_bud', 'medium_amethyst_bud', 'small_amethyst_bud', 'pointed_dripstone', 'sculk_sensor', 'calibrated_sculk_sensor', 'sculk_shrieker',
    'sculk_vein', 'glow_lichen', 'big_dripleaf', 'small_dripleaf_block', 'spore_blossom', 'azalea', 'flowering_azalea', 'hanging_roots', 'moss_carpet', 'pale_moss_carpet',
    'candle_cake', 'red_candle_cake', 'chiseled_bookshelf', 'decorated_pot', 'lightning_rod', 'copper_lantern', 'oak_hanging_sign', 'cherry_hanging_sign', 'oak_shelf',
    'pink_petals', 'leaf_litter', 'wildflowers', 'torchflower', 'pitcher_plant', 'twisting_vines', 'weeping_vines', 'cave_vines', 'mangrove_propagule', 'bush',
    'firefly_bush', 'cactus_flower', 'short_dry_grass', 'open_eyeblossom', 'trial_spawner', 'vault', 'creaking_heart', 'sniffer_egg', 'dried_ghast', 'heavy_core',
    'copper_chest', 'exposed_copper_chest', 'copper_golem_statue', 'frog_spawn', 'tinted_glass', 'powder_snow', 'suspicious_sand', 'beehive', 'mob_spawner', 'lodestone',
  ].map((name) => ({ name })),
};
PRESETS.shapes = PRESETS.shapes.map((s) => ({ ...s, states: { 'minecraft:cardinal_direction': 'south', growth: 3, books_stored: 21, honey_level: 5, big_dripleaf_head: 1, multi_face_direction_bits: 7, dripstone_thickness: 'tip', upper_block_bit: 0 } }));

(async () => {
  const preset = process.argv[2] ?? 'shapes';
  const cols = Number(process.argv[3] ?? 10);
  const base = new ResourceStack([await ResourcePack.fromBytes(new Uint8Array(readFileSync(process.env.BEDROCK_PACK ?? '/mnt/user-data/uploads/animation_controllers.zip')))]);
  const list: Spec[] = preset === 'all' ? CANDIDATES.map((name) => ({ name })) : PRESETS[preset];
  const { pack } = buildFixturePack(base, list.map((s) => s.name));
  writeFileSync(`${OUT}/fixture.zip`, writeZip(pack.files));
  const rows = Math.ceil(list.length / cols), sp = 2;
  const sx = cols * sp + 1, sz = rows * sp + 1;
  const at = new Map<string, Spec>();
  list.forEach((s, i) => at.set(`${(i % cols) * sp + 1},${Math.floor(i / cols) * sp + 1}`, s));
  const bytes = buildMcStructure({
    size: [sx, 4, sz],
    blockAt: (x, y, z) => {
      if (y === 0) return { name: 'minecraft:stone' };
      if (y === 1) { const s = at.get(`${x},${z}`); if (s) return { name: 'minecraft:' + s.name, states: s.states ?? {} }; }
      return null;
    },
  });
  writeFileSync(`${OUT}/${preset}.mcstructure`, bytes);
  console.log(preset, list.length, 'blocks →', `${cols}x${rows}`, 'grid');
})();

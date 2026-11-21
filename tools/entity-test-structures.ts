/**
 * Structures for checking entities in the game: every entity of the every-entity example, split by kind, each group in a
 * closed glass pen on a stone floor (undead do not burn by day, nothing wanders off; water mobs are in water). Written
 * with the same code as the sample structures (scripts/lib/scene.ts). Not part of the example.
 *
 *   tsx tools/entity-test-structures.ts [output folder]      (default: entity-test/)
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Scene } from '../scripts/lib/scene';

const out = process.argv[2] ?? 'entity-test';
mkdirSync(out, { recursive: true });

const GROUPS: [string, string[], { water?: boolean; spacing?: number; open?: boolean }?][] = [
  ['1-farm-animals', ['chicken', 'cow', 'pig', 'sheep', 'mooshroom', 'rabbit', 'goat', 'armadillo', 'frog', 'sniffer', 'camel', 'panda', 'polar_bear', 'fox', 'turtle']],
  ['2-pets-and-mounts', ['wolf', 'cat', 'ocelot', 'parrot', 'horse', 'donkey', 'mule', 'llama', 'trader_llama', 'skeleton_horse', 'zombie_horse', 'strider', 'camel_husk']],
  ['3-villagers-golems', ['villager_v2', 'villager', 'wandering_trader', 'iron_golem', 'snow_golem', 'copper_golem', 'allay', 'bee', 'bat', 'npc', 'armor_stand']],
  ['4-undead-and-spiders', ['zombie', 'husk', 'drowned', 'zombie_villager_v2', 'zombie_villager', 'zombie_pigman', 'skeleton', 'stray', 'bogged', 'parched', 'wither_skeleton', 'spider', 'cave_spider']],
  ['5-other-monsters', ['creeper', 'enderman', 'endermite', 'silverfish', 'witch', 'slime', 'magma_cube', 'sulfur_cube', 'blaze', 'breeze', 'creaking', 'phantom', 'shulker', 'vex']],
  ['6-illagers-nether', ['pillager', 'vindicator', 'evocation_illager', 'ravager', 'piglin', 'piglin_brute', 'hoglin', 'zoglin']],
  ['7-water', ['cod', 'salmon', 'tropicalfish', 'pufferfish', 'squid', 'glow_squid', 'dolphin', 'guardian', 'elder_guardian', 'axolotl', 'tadpole', 'nautilus', 'zombie_nautilus'], { water: true }],
  ['8-vehicles-and-objects', ['boat', 'chest_boat', 'minecart', 'chest_minecart', 'hopper_minecart', 'tnt_minecart', 'command_block_minecart', 'ender_crystal', 'xp_orb', 'cushion']],
  ['9-large-and-bosses', ['ghast', 'happy_ghast', 'warden', 'wither', 'ender_dragon'], { spacing: 12 }],
  ['10-projectiles', ['arrow', 'egg', 'snowball', 'splash_potion', 'xp_bottle', 'fireworks_rocket', 'wind_charge_projectile'], { open: true }],
];
const lines: string[] = [];
for (const [name, ids, o = {}] of GROUPS) {
  const sp = o.spacing ?? 4, cols = Math.min(ids.length, o.spacing ? 3 : 5);
  const w = cols * sp + 2, d = Math.ceil(ids.length / cols) * sp + 2, h = o.spacing ? 14 : 5;
  const s = new Scene([w, h, d]);
  s.floor = { name: 'minecraft:stone' };
  if (!o.open) for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) for (let y = 1; y < h; y++) {
    const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1, roof = y === h - 1;
    if (edge || roof) s.put(x, y, z, 'glass');
    else if (o.water) s.put(x, y, z, 'water', { liquid_depth: 0 });
  }
  ids.forEach((id, i) => s.entity(id, 1 + (i % cols) * sp + sp / 2, 1, 1 + Math.floor(i / cols) * sp + sp / 2, 0));
  writeFileSync(join(out, `${name}.mcstructure`), s.bytes());
  lines.push(`${name}.mcstructure (${ids.length}): ${ids.join(', ')}`);
}
writeFileSync(join(out, 'CONTENTS.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));

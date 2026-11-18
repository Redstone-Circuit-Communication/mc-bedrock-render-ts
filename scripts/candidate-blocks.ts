/**
 * Candidate Bedrock block identifiers used by the coverage test.
 *
 * Source: the 1283 Java block ids of the Java renderer's `all-blocks.csv`, translated with the (well known)
 * Java → Bedrock naming differences below, plus Bedrock-only ids. This is NOT an official block list; it exists so that
 * regressions ("block X shows the magenta placeholder") can be found without launching the game.
 */
import { readFileSync } from 'fs';

const javaIds: string[] = JSON.parse(readFileSync(new URL('./java-block-ids.json', import.meta.url), 'utf8'));

/** exact renames */
const RENAME: Record<string, string> = {
  bricks: 'brick_block', nether_bricks: 'nether_brick', red_nether_bricks: 'red_nether_brick', end_stone_bricks: 'end_bricks',
  end_stone_brick_stairs: 'end_brick_stairs', terracotta: 'hardened_clay', dirt_path: 'grass_path', lily_pad: 'waterlily',
  cobweb: 'web', sugar_cane: 'reeds', jack_o_lantern: 'lit_pumpkin', melon: 'melon_block', snow_block: 'snow', snow: 'snow_layer',
  nether_portal: 'portal', repeater: 'unpowered_repeater', comparator: 'unpowered_comparator', wall_torch: 'torch',
  soul_wall_torch: 'soul_torch', redstone_wall_torch: 'redstone_torch', piston_head: 'piston_arm_collision', moving_piston: 'moving_block',
  oak_sign: 'standing_sign', oak_wall_sign: 'wall_sign', oak_door: 'wooden_door', oak_trapdoor: 'trapdoor', oak_button: 'wooden_button',
  oak_pressure_plate: 'wooden_pressure_plate', oak_fence: 'fence', oak_fence_gate: 'fence_gate', stone_slab: 'stone_block_slab',
  tall_seagrass: 'seagrass', cave_vines_plant: 'cave_vines', kelp_plant: 'kelp', bubble_column: 'bubble_column',
  grass_block: 'grass_block', short_grass: 'short_grass', tall_grass: 'tall_grass', mycelium: 'mycelium', podzol: 'podzol',
  sticky_piston: 'sticky_piston', light_weighted_pressure_plate: 'light_weighted_pressure_plate',
  heavy_weighted_pressure_plate: 'heavy_weighted_pressure_plate', lever: 'lever', redstone_wire: 'redstone_wire',
  beetroots: 'beetroot', cocoa: 'cocoa', player_head: 'skull', player_wall_head: 'skull', skeleton_skull: 'skull',
  skeleton_wall_skull: 'skull', wither_skeleton_skull: 'skull', wither_skeleton_wall_skull: 'skull',
  zombie_head: 'skull', zombie_wall_head: 'skull', creeper_head: 'skull', creeper_wall_head: 'skull', dragon_head: 'skull',
  dragon_wall_head: 'skull', piglin_head: 'skull', piglin_wall_head: 'skull',
  stone_pressure_plate: 'stone_pressure_plate', stonecutter: 'stonecutter_block', cauldron: 'cauldron', water_cauldron: 'cauldron',
  lava_cauldron: 'cauldron', powder_snow_cauldron: 'cauldron', frogspawn: 'frog_spawn', end_gateway: 'end_gateway',
  big_dripleaf_stem: 'big_dripleaf', skeleton_wall_head: 'skull',
  powered_rail: 'golden_rail', note_block: 'noteblock', magma_block: 'magma', nether_quartz_ore: 'quartz_ore', spawner: 'mob_spawner',
  light: 'light_block', copper_wall_torch: 'copper_torch', flowering_azalea_leaves: 'azalea_leaves_flowered',
};
/** Java-only ids that do not exist in Bedrock at all (colour-specific beds, potted plants, damaged anvils, *_plant vines). */
const JAVA_ONLY = /(_bed$|^potted_|^chipped_anvil$|^damaged_anvil$|_vines_plant$)/;

const out = new Set<string>();
for (const id of javaIds) {
  if (JAVA_ONLY.test(id)) continue;
  let r = RENAME[id] ?? id;
  // Java `<wood>_sign` → Bedrock `<wood>_standing_sign`
  if (/^(spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|bamboo|crimson|warped|pale_oak|poplar)_sign$/.test(r)) r = r.replace(/_sign$/, '_standing_sign');
  // wall signs / banners / heads: Bedrock uses `<wood>_wall_sign`, `wall_banner`, `standing_banner`
  if (/_banner$/.test(r) && !/wall_banner/.test(r)) r = 'standing_banner';
  if (/_wall_banner$/.test(r)) r = 'wall_banner';
  r = r.replace(/^light_gray_glazed/, 'silver_glazed');
  out.add(r);
}
// Bedrock-only / legacy ids worth testing
for (const id of [
  'stonebrick', 'stone_stairs', 'normal_stone_stairs', 'stone_brick_stairs', 'mossy_stone_brick_stairs', 'double_stone_block_slab',
  'stone_block_slab2', 'stone_block_slab3', 'stone_block_slab4', 'double_stone_block_slab2', 'oak_double_slab', 'wooden_slab',
  'standing_sign', 'wall_sign', 'spruce_standing_sign', 'birch_standing_sign', 'jungle_standing_sign', 'acacia_standing_sign', 'darkoak_standing_sign',
  'lit_furnace', 'lit_blast_furnace', 'lit_smoker', 'lit_redstone_lamp', 'lit_redstone_ore', 'powered_repeater', 'powered_comparator',
  'unlit_redstone_torch', 'info_update', 'glowingobsidian', 'netherreactor', 'stained_glass', 'monster_egg', 'frame', 'glow_frame',
  'item_frame', 'grass_path', 'bed', 'skull', 'carved_pumpkin', 'bubble_column', 'flowing_water', 'flowing_lava', 'water', 'lava',
  'light_block', 'barrier', 'structure_void', 'command_block', 'chain_command_block', 'repeating_command_block', 'structure_block', 'jigsaw',
  'camera', 'allow', 'deny', 'border_block', 'invisible_bedrock', 'element_0', 'client_request_placeholder_block',
]) out.add(id);

export const CANDIDATES: string[] = [...out].sort();

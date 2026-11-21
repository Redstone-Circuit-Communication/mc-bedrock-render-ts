/**
 * What a block needs around it to stay as written once the game loads the structure. The renderer draws whatever a
 * structure holds; the game updates the blocks as it places them: a flower on stone drops as an item, leaves away from
 * logs decay, water and lava flow, a lit furnace without fuel goes out, a sign with nothing behind it falls. The
 * every-block example places each block with what it needs: the right ground under it, a ceiling, a wall, water around
 * it, or a power source for the states the renderer shows as powered. Supports are opaque blocks (stone), so the only
 * translucent blocks are the ones being shown.
 *
 * Where the side a block hangs on is not certain from game data (tripwire hooks, cocoa, coral wall fans, vines), the
 * support is on every side it could be.
 */
import { StateInput } from '../../src/renderer/structure';
import { T, Tagged } from '../../src/renderer/nbt';
import type { Scene } from './scene';

/** The ground a plant needs under it (replacing the floor cell). */
const GROUND: [RegExp, string, Record<string, StateInput>?][] = [
  [/^(wheat|carrots|potatoes|beetroot|melon_stem|pumpkin_stem|torchflower_crop|pitcher_crop)$/, 'farmland', { moisturized_amount: 7 }],
  [/^(cactus|deadbush|short_dry_grass|tall_dry_grass)$/, 'sand'],
  [/^(brown|red)_mushroom$/, 'mycelium'],
  [/^crimson_(fungus|roots)$/, 'crimson_nylium'],
  [/^(warped_(fungus|roots)|nether_sprouts)$/, 'warped_nylium'],
  [/^nether_wart$/, 'soul_sand'],
  [/^chorus_(plant|flower)$/, 'end_stone'],
  [/^small_dripleaf_block$/, 'moss_block'],
  [/^fire$/, 'netherrack'],
  [/^soul_fire$/, 'soul_soil'],
  [/^bubble_column$/, 'soul_sand'],
  [/^(lit_redstone_lamp|unlit_redstone_torch|redstone_wire)$/, 'redstone_block'],
  [/(^|_)sapling$|^(yellow_flower|red_flower|dandelion|golden_dandelion|poppy|blue_orchid|allium|azure_bluet|(red|orange|white|pink)_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|(open|closed)_eyeblossom|short_grass|tallgrass|tall_grass|fern|large_fern|sunflower|lilac|rose_bush|peony|double_plant|pitcher_plant|bush|firefly_bush|azalea|flowering_azalea|sweet_berry_bush|bamboo|pink_petals|wildflowers|big_dripleaf|mangrove_propagule)$/, 'grass_block'],
];
/** The ground the game needs under a plant, or null. */
export function groundFor(id: string): [string, Record<string, StateInput>] | null {
  const g = GROUND.find(([rx]) => rx.test(id));
  return g ? [g[1], g[2] ?? {}] : null;
}

/** States that keep a block where it is (attached to the floor, not decaying, the leaf of a big dripleaf …). */
export function statesFor(id: string): Record<string, StateInput> {
  if (/leaves/.test(id) && !/^leaves2?$/.test(id)) return { persistent_bit: true };
  if (/_button$/.test(id)) return { facing_direction: 1 }; // on the floor
  if (/torch$/.test(id)) return { torch_facing_direction: 'top' };
  if (/_(head|skull)$/.test(id)) return { facing_direction: 1 };
  if (/^(frame|glow_frame)$/.test(id)) return { facing_direction: 1 };
  if (/^(glow_lichen|sculk_vein|resin_clump)$/.test(id)) return { multi_face_direction_bits: 1 }; // on the floor
  if (id === 'vine') return { vine_direction_bits: 15 };
  if (id === 'big_dripleaf') return { big_dripleaf_head: true };
  if (id === 'farmland') return { moisturized_amount: 7 };
  if (id === 'powered_comparator') return { output_lit_bit: true };
  return {};
}

const LIVE_CORAL = /^(brain|bubble|fire|horn|tube)_coral(_fan|_wall_fan)?$/;
const LIVE_CORAL_BLOCK = /^(brain|bubble|fire|horn|tube)_coral_block$/;
const WALL_ON_SOUTH = /(_wall_sign|_wall_banner)$|^(wall_sign|wall_banner|ladder)$/;

export interface Placed { y: number; note: string }

/**
 * Places `id` at (x, ·, z) of the every-block grid with what it needs, when it needs more than its own cell; null when
 * the caller places it as usual. The grid leaves x ± 1 and z + 1, z + 2 free (spacing 2 and 3).
 */
export function placeForGame(s: Scene, id: string, x: number, z: number): Placed | null {
  const set = (dx: number, y: number, dz: number, name: string, states: Record<string, StateInput> = {}, nbt?: Record<string, Tagged>) => {
    const key = `${x + dx},${y},${z + dz}`, had = s.blocks.get(key);
    const full = 'minecraft:' + name;
    if (had && had.name !== full) throw new Error(`${id}: (${key}) already holds ${had.name}, wanted ${full}`);
    s.put(x + dx, y, z + dz, name, states, nbt);
  };
  const ring = (y: number, name = 'stone') => { set(-1, y, 0, name); set(1, y, 0, name); set(0, y, -1, name); set(0, y, 1, name); };
  const ground = groundFor(id);
  if (ground) set(0, 0, 0, ground[0], ground[1]);
  const st = statesFor(id);

  if (/^(flowing_)?(water|lava)$/.test(id) || id === 'frosted_ice') {
    set(0, 1, 0, id, /ice/.test(id) ? {} : { liquid_depth: 0 }); ring(1);
    return { y: 1, note: 'stone around it, so it does not flow (frosted ice melts into water)' };
  }
  if (/^(fire|soul_fire)$/.test(id)) {
    set(0, 1, 0, id); ring(1);
    return { y: 1, note: `on ${ground![0]}, stone around it` };
  }
  if (LIVE_CORAL.test(id) || /^(kelp|seagrass|sea_pickle)$/.test(id)) {
    set(0, 1, 0, id, st); s.water(x, 1, z); ring(1);
    return { y: 1, note: 'in water, stone around it' };
  }
  if (/^dead_\w+_coral_wall_fan$/.test(id)) {
    set(0, 1, 0, id, st); ring(1);
    return { y: 1, note: 'stone around it to hang on' };
  }
  if (LIVE_CORAL_BLOCK.test(id)) {
    set(0, 1, 0, id); set(0, 2, 0, 'water', { liquid_depth: 0 }); ring(2);
    return { y: 1, note: 'water on top, stone around the water' };
  }
  if (id === 'bubble_column') {
    set(0, 1, 0, id); ring(1);
    return { y: 1, note: 'on soul sand, stone around it' };
  }
  if (/^(waterlily|frog_spawn)$/.test(id)) {
    set(0, 1, 0, 'water', { liquid_depth: 0 }); ring(1); set(0, 2, 0, id);
    return { y: 2, note: 'on water, stone around the water' };
  }
  if (id === 'reeds') {
    set(0, 1, 0, 'sand'); set(0, 2, 0, id);
    set(0, 1, 1, 'water', { liquid_depth: 0 }); set(-1, 1, 1, 'stone'); set(1, 1, 1, 'stone'); set(0, 1, 2, 'stone');
    return { y: 2, note: 'on sand next to water' };
  }
  if (id === 'farmland') {
    set(0, 1, 0, id, st);
    set(0, 1, 1, 'water', { liquid_depth: 0 }); set(-1, 1, 1, 'stone'); set(1, 1, 1, 'stone'); set(0, 1, 2, 'stone');
    return { y: 1, note: 'water next to it, so it stays farmland' };
  }
  if (/^(hanging_roots|spore_blossom|cave_vines(_body_with_berries|_head_with_berries)?|weeping_vines|pale_hanging_moss)$/.test(id)) {
    set(0, 3, 0, id === 'pale_hanging_moss' ? 'pale_oak_leaves' : 'stone', id === 'pale_hanging_moss' ? { persistent_bit: true } : {});
    set(0, 2, 0, id);
    return { y: 2, note: 'hanging from the block above' };
  }
  if (/_hanging_sign$/.test(id)) {
    set(0, 2, 0, 'stone'); set(0, 1, 0, id, { hanging: true, attached_bit: false, facing_direction: 2 });
    return { y: 1, note: 'hanging from the block above' };
  }
  if (WALL_ON_SOUTH.test(id)) {
    // facing north (2): the block it hangs on is to the south
    set(0, 1, 1, 'stone'); set(0, 1, 0, id, { facing_direction: 2 });
    return { y: 1, note: 'facing north, on the block to the south' };
  }
  if (id === 'tripwire_hook') {
    set(0, 1, -1, 'stone'); set(0, 1, 1, 'stone'); set(0, 1, 0, id, { direction: 2, attached_bit: false, powered_bit: false });
    return { y: 1, note: 'a block on either side to hang on' };
  }
  if (id === 'cocoa') {
    set(0, 1, -1, 'jungle_log'); set(0, 1, 1, 'jungle_log'); set(0, 1, 0, id);
    return { y: 1, note: 'a jungle log on either side' };
  }
  if (id === 'vine') {
    set(0, 1, 0, id, st); ring(1);
    return { y: 1, note: 'stone around it to hang on' };
  }
  if (id === 'portal') {
    // a nether portal survives only in a whole frame: the smallest one, 2 wide (along z) and 3 high
    for (const dz of [0, 1]) { set(0, 0, dz, 'obsidian'); set(0, 4, dz, 'obsidian'); for (let y = 1; y <= 3; y++) set(0, y, dz, id, { portal_axis: 'z' }); }
    for (let y = 1; y <= 3; y++) { set(0, y, -1, 'obsidian'); set(0, y, 2, 'obsidian'); }
    return { y: 1, note: 'a whole portal (2 × 3) in an obsidian frame' };
  }
  if (/^lit_(furnace|blast_furnace|smoker)$/.test(id)) {
    set(0, 1, 0, id, {}, { BurnTime: T.short(32000), BurnDuration: T.short(32000) });
    return { y: 1, note: 'burning (about 25 minutes of fuel time)' };
  }
  if (/^powered_(repeater|comparator)$/.test(id)) {
    // a redstone block at both ends of its axis (it faces south), so its input is powered whichever end that is
    set(0, 1, -1, 'redstone_block'); set(0, 1, 1, 'redstone_block');
    set(0, 1, 0, id, st, id === 'powered_comparator' ? { OutputSignal: T.int(15) } : undefined);
    return { y: 1, note: 'powered by redstone blocks at both ends' };
  }
  if (ground && id === 'redstone_wire') { set(0, 1, 0, id, { redstone_signal: 15 }); return { y: 1, note: 'on a redstone block' }; }
  if (ground && ['lit_redstone_lamp', 'unlit_redstone_torch'].includes(id)) { set(0, 1, 0, id, st); return { y: 1, note: 'on a redstone block' }; }
  if (id === 'small_dripleaf_block') {
    set(0, 1, 0, id, { upper_block_bit: false }); set(0, 2, 0, id, { upper_block_bit: true });
    return { y: 1, note: 'on moss, upper half at y=2' };
  }
  return null;
}

/**
 * Bedrock counterpart of the Java package's `scripts/generate-coverage-schematics.mjs`: writes the sample structures of
 * the example app into `example/public/schematics/` — `all-blocks` / `all-entities` (every block id of the pack's
 * `blocks.json`, every client entity the game can load from a structure) with CSV indexes, plus `inspection-demo`,
 * `redstone-demo`, `entities-demo` and `five-entities`.
 *
 *   tsx scripts/generate-coverage-structures.ts [resource pack zip] [output dir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { EntityLibrary } from '../src/renderer/entity';
import { ResourceStack } from '../src/renderer/resources';
import type { StateInput } from '../src/renderer/structure';
import { T, Tagged } from '../src/renderer/nbt';
import { nameFor } from '../src/names';
import { entityName } from '../src/entities';
import { officialPacks } from './lib/official-pack';
import { item, items, loadBlockStates, Scene, unknownStates, unwritable } from './lib/scene';
import { groundFor, placeForGame, statesFor } from './lib/block-survival';

// optional: a pack zip to read the block and entity lists from; by default the official pack (downloaded once into .cache/)
const packPath = process.argv[2];
const outDir = process.argv[3] ?? 'example/public/schematics';
mkdirSync(outDir, { recursive: true });

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';

(async () => {
  const stack = new ResourceStack();
  if (packPath) await stack.addBytes(new Uint8Array(readFileSync(packPath)));
  else for (const pack of await officialPacks()) stack.push(pack);
  const lib = new EntityLibrary(stack);
  await loadBlockStates();

  // ---------------------------------------------------------------- all blocks
  {
    const ids = [...stack.blocksJson.keys()].filter((k) => !/^(air|light_block_\d+)$/.test(k)).sort();
    const cols = Math.ceil(Math.sqrt(ids.length * 1.4)), sp = 2;
    const rows: (string | number)[][] = [['index', 'name', 'id', 'x', 'y', 'z', 'state', 'note']];
    // height 5: a nether portal needs its whole obsidian frame (scripts/lib/block-survival.ts)
    const s = new Scene([cols * sp + 1, 5, Math.ceil(ids.length / cols) * (sp + 1) + 2]);
    ids.forEach((id, i) => {
      const x = (i % cols) * sp + 1, z = Math.floor(i / cols) * (sp + 1) + 1;
      let note = '', y = 1, states: Record<string, StateInput> = {};
      // each block with what it needs to stay as written in the game: ground, ceiling, wall, water, power
      const ground = groundFor(id);
      const placed = placeForGame(s, id, x, z);
      if (placed) ({ y, note } = placed);
      else if (/_door$/.test(id)) { s.put(x, 1, z, id, { upper_block_bit: 0, 'minecraft:cardinal_direction': 'north' }); s.put(x, 2, z, id, { upper_block_bit: 1 }); note = 'upper half at y=2'; }
      else if (/^(tall_grass|large_fern|sunflower|lilac|rose_bush|peony|double_plant|pitcher_plant)$/.test(id)) { s.put(x, 1, z, id, { upper_block_bit: 0 }); s.put(x, 2, z, id, { upper_block_bit: 1 }); note = 'upper half at y=2'; }
      else if (/_bed$/.test(id)) { s.put(x, 1, z, id, { head_piece_bit: 0, direction: 0 }); s.put(x, 1, z + 1, id, { head_piece_bit: 1, direction: 0 }); note = 'head at z+1 (drawn as an entity)'; }
      else {
        if (/_stairs$/.test(id)) states = { weirdo_direction: 0, upside_down_bit: 0 };
        states = { ...states, ...statesFor(id) };
        s.put(x, 1, z, id, states);
        if (Object.keys(states).length) note = 'default test state';
      }
      if (ground && !placed) { s.put(x, 0, z, ground[0], ground[1]); note = [note, `on ${ground[0]}`].filter(Boolean).join('; '); }
      const written = s.blocks.get(`${x},${y},${z}`)?.states ?? {};
      rows.push([i + 1, nameFor(id), 'minecraft:' + id, x, y, z, Object.entries(written).map(([k, v]) => `${k}=${v}`).join(','), note]);
    });
    writeFileSync(join(outDir, 'all-blocks.mcstructure'), s.bytes());
    writeFileSync(join(outDir, 'all-blocks.csv'), csv(rows));
    console.log('all-blocks:', ids.length, 'ids');
  }

  // -------------------------------------------------------------- all entities
  {
    // Every client definition the game can load from a structure (see `unwritable`); the rest are listed when generating.
    const left = [...lib.defs.keys()].sort().filter((id) => unwritable(id));
    console.log('left out of all-entities:', left.map((id) => `${id} (${unwritable(id)})`).join(', '));
    // Mobs far wider than the grid spacing get their own row past the grid, so they hide nothing.
    const LARGE = new Set(['minecraft:ender_dragon', 'minecraft:ghast', 'minecraft:happy_ghast']);
    const all = [...lib.defs.keys()].sort().filter((id) => !unwritable(id));
    const ids = all.filter((id) => !LARGE.has(id)), large = all.filter((id) => LARGE.has(id));
    const cols = 12, sp = 5, largeSp = 22;
    const gridDepth = Math.ceil(ids.length / cols) * sp;
    const rows: (string | number)[][] = [['index', 'name', 'id', 'x', 'y', 'z', 'status', 'note']];
    const s = new Scene([Math.max(cols * sp, (large.length + 1) * largeSp) + 2, 8, gridDepth + largeSp + 2]);
    // a stone floor at y = 0 and the entities standing on it: loaded in the game without a floor they fell into whatever
    // was below, and entities written at y = 0 were inside the floor
    const y = 1;
    ids.forEach((id, i) => {
      const x = (i % cols) * sp + 2.5, z = Math.floor(i / cols) * sp + 2.5;
      s.entity(id, x, y, z, 0);
      rows.push([i + 1, entityName({ id, nbt: {} }), id, x, y, z, '', '']);
    });
    large.forEach((id, i) => {
      const x = i * largeSp + largeSp / 2 + 1, z = gridDepth + largeSp / 2 + 1;
      s.entity(id, x, y, z, 0);
      rows.push([ids.length + i + 1, entityName({ id, nbt: {} }), id, x, y, z, '', 'large: own row past the grid']);
    });
    // a baby happy ghast (a ghastling) next to the large row, in the state its spawn event gives a baby
    {
      const id = 'minecraft:happy_ghast', x = large.length * largeSp + largeSp / 2 + 1, z = gridDepth + largeSp / 2 + 1;
      s.entity(id, x, y, z, 0, {}, { baby: true });
      rows.push([ids.length + large.length + 1, `${entityName({ id, nbt: {} })} (baby)`, id, x, y, z, '', 'baby']);
    }
    writeFileSync(join(outDir, 'all-entities.mcstructure'), s.bytes());
    writeFileSync(join(outDir, 'all-entities.csv'), csv(rows));
    console.log('all-entities:', ids.length, 'ids');
  }

  // ------------------------------------------------------------ inspection demo
  {
    const s = new Scene([22, 7, 16]);
    let x = 1;
    const dir = { 'minecraft:cardinal_direction': 'south' };
    s.put(x, 1, 2, 'chest', dir, items(item(0, 'diamond', 3), item(1, 'enchanted_golden_apple', 2), item(13, 'iron_pickaxe'), item(26, 'bread', 16)));
    s.put(3, 1, 2, 'trapped_chest', dir, items(item(4, 'redstone', 64)));
    s.put(5, 1, 2, 'chest', dir, { ...items(item(0, 'iron_ingot', 64), item(10, 'gold_ingot', 20)), pairx: T.int(6), pairz: T.int(2), pairlead: T.byte(1) });
    s.put(6, 1, 2, 'chest', dir, { ...items(item(0, 'emerald', 9), item(26, 'netherite_ingot', 1)), pairx: T.int(5), pairz: T.int(2), pairlead: T.byte(0) });
    s.put(8, 1, 2, 'ender_chest', dir);
    s.put(10, 1, 2, 'barrel', { 'minecraft:facing_direction': 'up' }, items(item(0, 'wheat', 64), item(1, 'carrot', 32), item(2, 'potato', 12)));
    s.put(12, 1, 2, 'blue_shulker_box', {}, items(item(0, 'ender_pearl', 16), item(5, 'diamond_sword')));
    // fuel without anything to smelt (and the reverse for the blast furnace): the game would light a furnace holding both
    s.put(14, 1, 2, 'furnace', dir, items(item(1, 'coal', 4), item(2, 'iron_ingot', 10)));
    s.put(16, 1, 2, 'blast_furnace', dir, items(item(0, 'raw_gold', 5)));
    s.put(18, 1, 2, 'smoker', dir, items(item(1, 'charcoal', 2), item(2, 'cooked_beef', 3)));
    s.put(2, 1, 6, 'hopper', { 'minecraft:facing_direction': 'down', toggle_bit: 0 }, items(item(0, 'cobblestone', 64), item(2, 'cobblestone', 10)));
    // not triggered: powered, the game would fire it on loading (an arrow, or the water)
    s.put(4, 1, 6, 'dispenser', { 'minecraft:facing_direction': 'south', triggered_bit: 0 }, items(item(0, 'arrow', 64), item(4, 'water_bucket')));
    s.put(6, 1, 6, 'dropper', { 'minecraft:facing_direction': 'up', triggered_bit: 0 }, items(item(8, 'stick', 8)));
    // bottles shown in the two slots that hold them; no ingredient, so nothing starts brewing
    s.put(8, 1, 6, 'brewing_stand', { brewing_stand_slot_a_bit: 1, brewing_stand_slot_b_bit: 1 }, items(item(1, 'potion'), item(2, 'potion'), item(4, 'blaze_powder', 3)));
    s.put(10, 1, 6, 'chiseled_bookshelf', { ...dir, books_stored: 21 }, items(item(0, 'book'), item(2, 'enchanted_book'), item(4, 'writable_book')));
    s.put(12, 1, 6, 'decorated_pot', dir, { item: T.compound({ Name: T.string('minecraft:emerald'), Count: T.byte(5), Damage: T.short(0) }) });
    s.put(14, 1, 6, 'copper_chest', dir, items(item(0, 'copper_ingot', 40)));
    // burning: without burn time the game puts a lit furnace out at once (this keeps it lit for about 25 minutes)
    s.put(16, 1, 6, 'lit_furnace', { 'minecraft:cardinal_direction': 'west' }, { ...items(item(0, 'cobblestone', 32), item(2, 'stone', 7)), BurnTime: T.short(32000), BurnDuration: T.short(32000) });
    s.put(2, 1, 10, 'unpowered_repeater', { 'minecraft:cardinal_direction': 'north', repeater_delay: 2 });
    // powered things have power in the game too: a redstone block at both ends of the comparator, under the wire and
    // under the lit lamp; an observer's pulse is over by the time anyone looks, so it is written unpowered
    s.put(3, 1, 10, 'redstone_block'); s.put(5, 1, 10, 'redstone_block');
    s.put(4, 1, 10, 'powered_comparator', { 'minecraft:cardinal_direction': 'east', output_lit_bit: 1, output_subtract_bit: 0 }, { OutputSignal: T.int(15) });
    s.put(6, 1, 10, 'observer', { 'minecraft:facing_direction': 'south', powered_bit: 0 });
    // on the floor, as the redstone example's lever (which stays in the game)
    s.put(8, 1, 10, 'lever', { lever_direction: 'down_north_south', open_bit: 1 });
    s.put(10, 0, 10, 'redstone_block'); s.put(10, 1, 10, 'redstone_wire', { redstone_signal: 15 });
    s.put(12, 1, 10, 'redstone_lamp', {}); s.put(14, 0, 10, 'redstone_block'); s.put(14, 1, 10, 'lit_redstone_lamp', {});
    s.entity('cow', 17.5, 1, 11.5, 90); s.entity('armor_stand', 19.5, 1, 11.5, 180);
    writeFileSync(join(outDir, 'inspection-demo.mcstructure'), s.bytes());
  }

  // -------------------------------------------------------------- redstone demo
  {
    const s = new Scene([20, 5, 14]);
    const up = { 'minecraft:facing_direction': 'up' };
    const fd = (d: string) => ({ 'minecraft:facing_direction': d });
    // the wire stops one block short of the repeater, so the repeater stays unpowered in the game as drawn
    for (let i = 0; i < 7; i++) s.put(2 + i, 1, 2, 'redstone_wire', { redstone_signal: 15 - i });
    s.put(1, 1, 2, 'redstone_block'); s.put(10, 1, 2, 'unpowered_repeater', { 'minecraft:cardinal_direction': 'west', repeater_delay: 1 });
    s.put(2, 1, 5, 'sticky_piston', up); s.put(2, 2, 5, 'sticky_piston_arm_collision', up); s.put(2, 3, 5, 'slime');
    s.put(4, 1, 5, 'piston', fd('east')); s.put(5, 1, 5, 'piston_arm_collision', fd('east')); s.put(7, 1, 5, 'observer', { ...fd('west'), powered_bit: 0 });
    // a redstone block under each extended piston keeps it extended in the game, as the renderer shows it (unpowered, the
    // game retracts it as soon as it is loaded); the way a game-saved upward piston is powered
    s.put(2, 0, 5, 'redstone_block'); s.put(4, 0, 5, 'redstone_block');
    // powered in the game as drawn: redstone blocks at both ends of the comparator, between the hopper and the dropper,
    // and under the powered rail; a pressed button, a stepped-on plate and an observer's pulse are over within a second
    // in the game, so they are written at rest
    s.put(9, 1, 4, 'redstone_block'); s.put(9, 1, 6, 'redstone_block');
    s.put(9, 1, 5, 'powered_comparator', { 'minecraft:cardinal_direction': 'south', output_lit_bit: 1, output_subtract_bit: 1 }, { OutputSignal: T.int(15) });
    s.put(11, 1, 5, 'lever', { lever_direction: 'down_east_west', open_bit: 0 }); s.put(13, 1, 5, 'stone_button', { ...fd('up'), button_pressed_bit: 0 });
    s.put(15, 1, 5, 'stone_pressure_plate', { redstone_signal: 0 }); s.put(17, 1, 5, 'redstone_torch', { torch_facing_direction: 'top' });
    s.put(3, 1, 9, 'redstone_block');
    s.put(2, 1, 9, 'hopper', { ...fd('down'), toggle_bit: 1 }); s.put(4, 1, 9, 'dropper', { ...fd('south'), triggered_bit: 1 }); s.put(6, 1, 9, 'dispenser', { ...fd('up'), triggered_bit: 0 });
    s.put(8, 0, 9, 'redstone_block'); s.put(8, 1, 9, 'golden_rail', { rail_direction: 0, rail_data_bit: 1 }); s.put(9, 1, 9, 'rail', { rail_direction: 1 }); s.put(10, 1, 9, 'detector_rail', { rail_direction: 0, rail_data_bit: 0 });
    s.put(12, 1, 9, 'daylight_detector', { redstone_signal: 8 }); s.put(14, 1, 9, 'target', {});
    // a hook hangs on a block (one on either side, whichever it uses); not attached, as there is no tripwire
    s.put(16, 1, 8, 'stone'); s.put(16, 1, 10, 'stone');
    s.put(16, 1, 9, 'tripwire_hook', { 'minecraft:cardinal_direction': 'north', attached_bit: 0, powered_bit: 0 });
    writeFileSync(join(outDir, 'redstone-demo.mcstructure'), s.bytes());
  }

  // -------------------------------------------------------------- entity demos
  {
    const s = new Scene([30, 8, 22]);
    s.floor = { name: 'minecraft:grass_block' };
    const mobs = ['cow', 'pig', 'sheep', 'chicken', 'horse', 'wolf', 'cat', 'villager_v2', 'iron_golem', 'zombie', 'skeleton', 'creeper', 'enderman', 'spider', 'allay', 'frog', 'axolotl', 'panda', 'camel', 'armadillo'];
    mobs.filter((m) => lib.getDef('minecraft:' + m)).forEach((m, i) => s.entity(m, 2.5 + (i % 10) * 2.8, 1, 3.5 + Math.floor(i / 10) * 3, (i * 40) % 360));
    ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'darkoak', 'mangrove', 'cherry'].forEach((_, i) => s.entity('boat', 3 + i * 3.4, 1, 11, i * 20, { Variant: T.int(i) }));
    s.entity('minecart', 3, 1, 15); s.entity('chest_minecart', 6, 1, 15); s.entity('hopper_minecart', 9, 1, 15); s.entity('tnt_minecart', 12, 1, 15); s.entity('armor_stand', 15, 1, 15, 45);
    // paintings hang on a wall (in the game one without a wall drops as an item): facing south, on the south face of a
    // stone wall at z = 19, centred on whole or half blocks by their size as the game places them
    for (let x = 1; x <= 26; x++) for (let y = 2; y <= 6; y++) s.put(x, y, 19, 'stone');
    ([['Kebab', 1, 1], ['Pool', 2, 1], ['Wanderer', 1, 2], ['Match', 2, 2], ['Fighters', 4, 2], ['Pointer', 4, 4]] as const).forEach(([m, w, h], i) =>
      s.entity('painting', 3 + i * 4 + (w % 2) / 2, 4 + (h % 2) / 2, 20 + 1 / 32, 0, { Motive: T.string(m), Direction: T.byte(0) }));
    writeFileSync(join(outDir, 'entities-demo.mcstructure'), s.bytes());
  }
  {
    const s = new Scene([16, 6, 10]);
    s.floor = { name: 'minecraft:grass_block' };
    s.entity('allay', 3, 2, 3, 20); s.entity('armor_stand', 6, 1, 3, 180); s.entity('minecart', 9, 1, 3); s.entity('boat', 12, 1, 3, 90, { Variant: T.int(0) }); s.entity('chest_boat', 12, 1, 7, 0, { Variant: T.int(1) });
    writeFileSync(join(outDir, 'five-entities.mcstructure'), s.bytes());
  }
  console.log('wrote structures to', outDir);
  if (unknownStates.size) console.warn('states these blocks do not have (left out):', [...unknownStates].sort().join('; '));
})();

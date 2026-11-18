/**
 * Bedrock counterpart of the Java package's `scripts/generate-coverage-schematics.mjs`: writes the sample structures of
 * the example app into `example/public/schematics/` — `all-blocks` / `all-entities` (every block id of the pack's
 * `blocks.json`, every client entity) with CSV indexes, plus `inspection-demo`, `redstone-demo`, `entities-demo` and
 * `five-entities`.
 *
 *   tsx scripts/generate-coverage-structures.ts [resource pack zip] [output dir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { EntityLibrary } from '../src/renderer/entity';
import { ResourceStack } from '../src/renderer/resources';
import { buildMcStructure, StateValue } from '../src/renderer/structure';
import { T, Tagged } from '../src/renderer/nbt';
import { nameFor } from '../src/names';
import { entityName } from '../src/entities';

const packPath = process.argv[2] ?? 'example/public/packs/bedrock_resources.zip';
const outDir = process.argv[3] ?? 'example/public/schematics';
mkdirSync(outDir, { recursive: true });

type B = { name: string; states?: Record<string, StateValue> };
class Scene {
  blocks = new Map<string, B>();
  be = new Map<string, Record<string, Tagged>>();
  entities: Record<string, Tagged>[] = [];
  floor: B | null = { name: 'minecraft:stone' };
  constructor(public size: [number, number, number]) {}
  put(x: number, y: number, z: number, name: string, states: Record<string, StateValue> = {}, nbt?: Record<string, Tagged>) {
    this.blocks.set(`${x},${y},${z}`, { name: name.includes(':') ? name : 'minecraft:' + name, states });
    if (nbt) this.be.set(`${x},${y},${z}`, nbt);
  }
  entity(id: string, x: number, y: number, z: number, yaw = 0, extra: Record<string, Tagged> = {}) {
    this.entities.push({ identifier: T.string(id.includes(':') ? id : 'minecraft:' + id), Pos: T.list('float', [T.float(x), T.float(y), T.float(z)]), Rotation: T.list('float', [T.float(yaw), T.float(0)]), UniqueID: T.long(BigInt(this.entities.length + 1)), ...extra });
  }
  bytes(): Uint8Array {
    return buildMcStructure({
      size: this.size, entities: this.entities,
      blockAt: (x, y, z) => (y === 0 ? this.floor : this.blocks.get(`${x},${y},${z}`) ?? null),
      blockEntityAt: (x, y, z) => this.be.get(`${x},${y},${z}`) ?? null,
    });
  }
}
const item = (slot: number, name: string, count = 1) => T.compound({ Slot: T.byte(slot), Name: T.string('minecraft:' + name), Count: T.byte(count), Damage: T.short(0) });
const items = (...it: Tagged[]) => ({ Items: T.list('compound', it) });
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';

(async () => {
  const stack = new ResourceStack();
  await stack.addBytes(new Uint8Array(readFileSync(packPath)));
  const lib = new EntityLibrary(stack);

  // ---------------------------------------------------------------- all blocks
  {
    const ids = [...stack.blocksJson.keys()].filter((k) => !/^(air|light_block_\d+)$/.test(k)).sort();
    const cols = Math.ceil(Math.sqrt(ids.length * 1.4)), sp = 2;
    const rows: (string | number)[][] = [['index', 'name', 'id', 'x', 'y', 'z', 'state', 'note']];
    let zExtra = 0;
    const s = new Scene([cols * sp + 1, 4, Math.ceil(ids.length / cols) * (sp + 1) + 2]);
    ids.forEach((id, i) => {
      const x = (i % cols) * sp + 1, z = Math.floor(i / cols) * (sp + 1) + 1;
      let note = '', states: Record<string, StateValue> = {};
      if (/_door$/.test(id)) { s.put(x, 1, z, id, { upper_block_bit: 0, 'minecraft:cardinal_direction': 'north' }); s.put(x, 2, z, id, { upper_block_bit: 1 }); note = 'upper half at y=2'; }
      else if (/^(tall_grass|large_fern|sunflower|lilac|rose_bush|peony|double_plant|pitcher_plant|tall_dry_grass)$/.test(id)) { s.put(x, 1, z, id, { upper_block_bit: 0 }); s.put(x, 2, z, id, { upper_block_bit: 1 }); note = 'upper half at y=2'; }
      else if (/_bed$/.test(id)) { s.put(x, 1, z, id, { head_piece_bit: 0, direction: 0 }); s.put(x, 1, z + 1, id, { head_piece_bit: 1, direction: 0 }); note = 'head at z+1 (drawn as an entity)'; }
      else {
        if (/^(flowing_)?(water|lava)$/.test(id)) states = { liquid_depth: 0 };
        else if (/_stairs$/.test(id)) states = { weirdo_direction: 0, upside_down_bit: 0 };
        else if (id === 'redstone_wire') states = { redstone_signal: 15 };
        s.put(x, 1, z, id, states);
        if (Object.keys(states).length) note = 'default test state';
      }
      rows.push([i + 1, nameFor(id), 'minecraft:' + id, x, 1, z, Object.entries(states).map(([k, v]) => `${k}=${v}`).join(','), note]);
    });
    void zExtra;
    writeFileSync(join(outDir, 'all-blocks.mcstructure'), s.bytes());
    writeFileSync(join(outDir, 'all-blocks.csv'), csv(rows));
    console.log('all-blocks:', ids.length, 'ids');
  }

  // -------------------------------------------------------------- all entities
  {
    const ids = [...lib.defs.keys()].sort();
    const cols = 12, sp = 5;
    const rows: (string | number)[][] = [['index', 'name', 'id', 'x', 'y', 'z', 'status', 'note']];
    const s = new Scene([cols * sp + 2, 8, Math.ceil(ids.length / cols) * sp + 2]);
    s.floor = { name: 'minecraft:grass_block' };
    ids.forEach((id, i) => {
      const x = (i % cols) * sp + 2.5, z = Math.floor(i / cols) * sp + 2.5;
      s.entity(id, x, 1, z, 0);
      rows.push([i + 1, entityName({ id, nbt: {} }), id, x, 1, z, '', '']);
    });
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
    s.put(12, 1, 2, 'blue_shulker_box', { 'minecraft:facing_direction': 'up' }, items(item(0, 'ender_pearl', 16), item(5, 'diamond_sword')));
    s.put(14, 1, 2, 'furnace', dir, items(item(0, 'iron_ore', 8), item(1, 'coal', 4), item(2, 'iron_ingot', 2)));
    s.put(16, 1, 2, 'blast_furnace', dir, items(item(0, 'raw_gold', 5)));
    s.put(18, 1, 2, 'smoker', dir, items(item(0, 'beef', 3), item(1, 'charcoal', 2)));
    s.put(2, 1, 6, 'hopper', { 'minecraft:facing_direction': 'down', toggle_bit: 0 }, items(item(0, 'cobblestone', 64), item(2, 'cobblestone', 10)));
    s.put(4, 1, 6, 'dispenser', { 'minecraft:facing_direction': 'south', triggered_bit: 1 }, items(item(0, 'arrow', 64), item(4, 'water_bucket')));
    s.put(6, 1, 6, 'dropper', { 'minecraft:facing_direction': 'up', triggered_bit: 0 }, items(item(8, 'stick', 8)));
    s.put(8, 1, 6, 'brewing_stand', {}, items(item(0, 'nether_wart'), item(1, 'potion'), item(2, 'potion'), item(4, 'blaze_powder', 3)));
    s.put(10, 1, 6, 'chiseled_bookshelf', { ...dir, books_stored: 21 }, items(item(0, 'book'), item(2, 'enchanted_book'), item(4, 'writable_book')));
    s.put(12, 1, 6, 'decorated_pot', dir, { item: T.compound({ Name: T.string('minecraft:emerald'), Count: T.byte(5), Damage: T.short(0) }) });
    s.put(14, 1, 6, 'copper_chest', dir, items(item(0, 'copper_ingot', 40)));
    s.put(16, 1, 6, 'lit_furnace', { 'minecraft:cardinal_direction': 'west' }, items(item(0, 'cobblestone', 32), item(2, 'stone', 7)));
    s.put(2, 1, 10, 'unpowered_repeater', { 'minecraft:cardinal_direction': 'north', repeater_delay: 2 });
    s.put(4, 1, 10, 'powered_comparator', { 'minecraft:cardinal_direction': 'east', output_lit_bit: 1, output_subtract_bit: 0 }, { OutputSignal: T.int(7) });
    s.put(6, 1, 10, 'observer', { 'minecraft:facing_direction': 'south', powered_bit: 1 });
    s.put(8, 1, 10, 'lever', { lever_direction: 'up_north_south', open_bit: 1 });
    s.put(10, 1, 10, 'redstone_wire', { redstone_signal: 9 });
    s.put(12, 1, 10, 'redstone_lamp', {}); s.put(14, 1, 10, 'lit_redstone_lamp', {});
    s.entity('cow', 17.5, 1, 11.5, 90); s.entity('armor_stand', 19.5, 1, 11.5, 180);
    writeFileSync(join(outDir, 'inspection-demo.mcstructure'), s.bytes());
  }

  // -------------------------------------------------------------- redstone demo
  {
    const s = new Scene([20, 5, 14]);
    const up = { 'minecraft:facing_direction': 'up' };
    const fd = (d: string) => ({ 'minecraft:facing_direction': d });
    for (let i = 0; i < 8; i++) s.put(2 + i, 1, 2, 'redstone_wire', { redstone_signal: 15 - i });
    s.put(1, 1, 2, 'redstone_block'); s.put(10, 1, 2, 'unpowered_repeater', { 'minecraft:cardinal_direction': 'west', repeater_delay: 1 });
    s.put(2, 1, 5, 'sticky_piston', up); s.put(2, 2, 5, 'sticky_piston_arm_collision', up); s.put(2, 3, 5, 'slime');
    s.put(4, 1, 5, 'piston', fd('east')); s.put(5, 1, 5, 'piston_arm_collision', fd('east')); s.put(7, 1, 5, 'observer', { ...fd('west'), powered_bit: 1 });
    s.put(9, 1, 5, 'powered_comparator', { 'minecraft:cardinal_direction': 'south', output_lit_bit: 1, output_subtract_bit: 1 }, { OutputSignal: T.int(12) });
    s.put(11, 1, 5, 'lever', { lever_direction: 'down_east_west', open_bit: 0 }); s.put(13, 1, 5, 'stone_button', { ...fd('up'), button_pressed_bit: 1 });
    s.put(15, 1, 5, 'stone_pressure_plate', { redstone_signal: 15 }); s.put(17, 1, 5, 'redstone_torch', { torch_facing_direction: 'top' });
    s.put(2, 1, 9, 'hopper', { ...fd('down'), toggle_bit: 1 }); s.put(4, 1, 9, 'dropper', { ...fd('south'), triggered_bit: 1 }); s.put(6, 1, 9, 'dispenser', { ...fd('up'), triggered_bit: 0 });
    s.put(8, 1, 9, 'golden_rail', { rail_direction: 0, rail_data_bit: 1 }); s.put(9, 1, 9, 'rail', { rail_direction: 1 }); s.put(10, 1, 9, 'detector_rail', { rail_direction: 0, rail_data_bit: 0 });
    s.put(12, 1, 9, 'daylight_detector', { redstone_signal: 8 }); s.put(14, 1, 9, 'target', {}); s.put(16, 1, 9, 'tripwire_hook', { 'minecraft:cardinal_direction': 'north', attached_bit: 1, powered_bit: 0 });
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
    ['Kebab', 'Pool', 'Wanderer', 'Match', 'Fighters', 'Pointer'].forEach((m, i) => s.entity('painting', 3 + i * 4, 4, 20.9, 0, { Motive: T.string(m), Direction: T.byte(0) }));
    writeFileSync(join(outDir, 'entities-demo.mcstructure'), s.bytes());
  }
  {
    const s = new Scene([16, 6, 10]);
    s.floor = { name: 'minecraft:grass_block' };
    s.entity('allay', 3, 2, 3, 20); s.entity('armor_stand', 6, 1, 3, 180); s.entity('minecart', 9, 1, 3); s.entity('boat', 12, 1, 3, 90, { Variant: T.int(0) }); s.entity('chest_boat', 12, 1, 7, 0, { Variant: T.int(1) });
    writeFileSync(join(outDir, 'five-entities.mcstructure'), s.bytes());
  }
  console.log('wrote structures to', outDir);
})();

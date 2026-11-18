import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMcStructure, parseMcStructure } from '../src/renderer/structure';
import { T, Tagged } from '../src/renderer/nbt';
import { blockString, StructureWrapper, LoadedStructure } from '../src/renderer/manager';
import { countStructureMaterials } from '../src/materials';
import { containerDefinition, readBlockInventory, readContainer } from '../src/inventory';
import { readRedstone } from '../src/redstone';
import { nameFor } from '../src/names';
import { materialsToCsv, filterMaterials } from '../src/material-export';
import { FrameStats } from '../src/frame-stats';
import { normalizeRenderSettings, RENDER_PRESETS } from '../src/settings';
import { entityName } from '../src/entities';
import { itemNameVariants } from '../src/item-assets';

const item = (slot: number, name: string, count: number) => T.compound({ Slot: T.byte(slot), Name: T.string('minecraft:' + name), Count: T.byte(count), Damage: T.short(0) });
function sample() {
  const be = new Map<string, Record<string, Tagged>>([
    ['1,1,1', { Items: T.list('compound', [item(0, 'diamond', 3), item(30, 'apple', 1)]) }],
    ['3,1,1', { Items: T.list('compound', [item(0, 'iron_ingot', 64)]), pairx: T.int(4), pairz: T.int(1), pairlead: T.byte(1) }],
    ['4,1,1', { Items: T.list('compound', [item(26, 'gold_ingot', 5)]), pairx: T.int(3), pairz: T.int(1), pairlead: T.byte(0) }],
  ]);
  const blocks: Record<string, { name: string; states?: Record<string, string | number> }> = {
    '1,1,1': { name: 'minecraft:chest' }, '3,1,1': { name: 'minecraft:chest' }, '4,1,1': { name: 'minecraft:chest' },
    '6,1,1': { name: 'minecraft:unpowered_repeater', states: { repeater_delay: 3, 'minecraft:cardinal_direction': 'east' } },
  };
  const bytes = buildMcStructure({ size: [8, 3, 3], blockAt: (x, y, z) => (y === 0 ? { name: 'minecraft:stone' } : blocks[`${x},${y},${z}`] ?? null), blockEntityAt: (x, y, z) => be.get(`${x},${y},${z}`) ?? null });
  const structure = parseMcStructure(bytes);
  return { structure, schematic: new LoadedStructure('t', structure, {} as never, { visible: true, dispose() {} } as never) };
}

test('materials: air is skipped, counts are stacks + remainder, sorted by count', () => {
  const { materials, regionCount } = countStructureMaterials(sample().structure);
  assert.equal(regionCount, 1);
  assert.deepEqual(materials[0], { id: 'minecraft:stone', count: 24, stacks: 0, remainder: 24 });
  assert.ok(materials.every((m) => !/air/.test(m.id)));
  assert.equal(materials.find((m) => m.id === 'minecraft:chest')!.count, 3);
});

test('inventory: single chest, Bedrock item compounds, double chest merge', () => {
  const { schematic } = sample();
  const single = readBlockInventory(schematic, [1, 1, 1]).inventory!;
  assert.equal(single.size, 27);
  assert.equal(single.slots[0]!.id, 'minecraft:diamond');
  assert.ok(single.warnings.length > 0, 'slot 30 does not exist in a 27-slot chest');
  const dbl = readBlockInventory(schematic, [4, 1, 1]).inventory!;
  assert.equal(dbl.size, 54);
  assert.equal(dbl.name, '大型箱子');
  assert.equal(dbl.slots[0]!.id, 'minecraft:iron_ingot');   // the pairlead half lists first
  assert.equal(dbl.slots[53]!.id, 'minecraft:gold_ingot');  // slot 26 of the other half → 27 + 26
  assert.equal(containerDefinition('minecraft:lit_furnace')!.name, '熔炉');
  assert.equal(containerDefinition('minecraft:white_shulker_box')!.size, 27);
  assert.equal(readContainer('minecraft:stone', {}), null);
});

test('redstone readers use Bedrock states and report what a snapshot really holds', () => {
  const r = readRedstone('minecraft:unpowered_repeater[cardinal_direction=east,repeater_delay=3]')!;
  assert.equal(r.status, '未激活');
  assert.match(r.details.map((d) => d.value).join('|'), /4 红石刻.*\|.*东.*\|.*西/);
  assert.equal(readRedstone('minecraft:redstone_wire[redstone_signal=9]')!.strength, 9);
  assert.equal(readRedstone('minecraft:powered_comparator[output_lit_bit=1]', { OutputSignal: 7 })!.strength, 7);
  assert.equal(readRedstone('minecraft:lever[open_bit=1]')!.active, true);
  assert.equal(readRedstone('minecraft:stone'), null);
});

test('block strings, SNBT and wrapper access', () => {
  const { structure } = sample();
  assert.equal(blockString({ name: 'minecraft:stairs', states: { weirdo_direction: 1, 'minecraft:vertical_half': 'top' } }), 'minecraft:stairs[vertical_half=top,weirdo_direction=1]');
  const w = new StructureWrapper(structure);
  assert.equal(w.get_block(1, 1, 1), 'minecraft:chest');
  assert.equal(w.get_block(99, 0, 0), undefined);
  assert.match(w.getBlockEntitySnbt(1, 1, 1)!, /Items:\[\{/);
});

test('names, CSV export, frame stats and settings behave like the Java package', () => {
  assert.equal(nameFor('minecraft:unpowered_repeater'), '红石中继器');
  assert.equal(nameFor('minecraft:cherry_stairs'), '樱花楼梯');
  assert.equal(nameFor('minecraft:white_wool'), '白色羊毛');
  assert.equal(entityName({ id: 'minecraft:armor_stand', nbt: {} }), '盔甲架');
  const csv = materialsToCsv(filterMaterials([{ id: 'minecraft:stone', count: 70, stacks: 1, remainder: 6 }], 'stone'));
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"石头","minecraft:stone","70","1","6"/);
  const f = new FrameStats(); for (let i = 0; i < 30; i++) f.record(1000 + i * 16.666); assert.ok(Math.abs(f.snapshot(1000 + 29 * 16.666).fps - 60) < 2);
  assert.deepEqual(normalizeRenderSettings({ maxPixelRatio: 9, targetFPS: -4, ssao: 'x' as never }), { ...RENDER_PRESETS.balanced, maxPixelRatio: 2, targetFPS: 0 });
});

test('item icon names: legacy Bedrock icon files are found through name variants', () => {
  assert.ok(itemNameVariants('enchanted_golden_apple').includes('apple_golden'));
  assert.ok(itemNameVariants('cooked_beef').includes('beef_cooked'));
  assert.ok(itemNameVariants('beef').includes('beef_raw'));
});

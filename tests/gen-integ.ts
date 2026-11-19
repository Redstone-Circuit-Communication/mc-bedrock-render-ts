/** Writes tests/e2e/out/integ.mcstructure (containers, redstone parts, new-era blocks, entities) and fixture.zip. */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { ResourcePack, ResourceStack } from '../src/renderer/resources';
import { buildMcStructure, StateValue } from '../src/renderer/structure';
import { T, Tagged } from '../src/renderer/nbt';
import { buildFixturePack } from './helpers/fixture';
import { officialPacks } from '../scripts/lib/official-pack';
import { writeZip } from './helpers/zipwriter';

const OUT = process.env.E2E_OUT ?? new URL('./e2e/out', import.meta.url).pathname;
type B = { name: string; states?: Record<string, StateValue> };
const blocks = new Map<string, B>();
const be = new Map<string, Record<string, Tagged>>();
const put = (x: number, y: number, z: number, name: string, states: Record<string, StateValue> = {}, nbt?: Record<string, Tagged>) => {
  blocks.set(`${x},${y},${z}`, { name: 'minecraft:' + name, states });
  if (nbt) be.set(`${x},${y},${z}`, nbt);
};
const item = (slot: number, name: string, count: number) => T.compound({ Slot: T.byte(slot), Name: T.string('minecraft:' + name), Count: T.byte(count), Damage: T.short(0) });

put(2, 1, 2, 'chest', { 'minecraft:cardinal_direction': 'south' }, { Items: T.list('compound', [item(0, 'diamond', 3), item(1, 'apple', 12)]), id: T.string('Chest') });
put(5, 1, 2, 'chest', { 'minecraft:cardinal_direction': 'south' }, { Items: T.list('compound', [item(0, 'iron_ingot', 64)]), pairx: T.int(6), pairz: T.int(2), pairlead: T.byte(1) });
put(6, 1, 2, 'chest', { 'minecraft:cardinal_direction': 'south' }, { Items: T.list('compound', [item(26, 'gold_ingot', 5)]), pairx: T.int(5), pairz: T.int(2), pairlead: T.byte(0) });
put(8, 1, 2, 'lit_furnace', { 'minecraft:cardinal_direction': 'south' }, { Items: T.list('compound', [item(0, 'iron_ore', 8), item(1, 'coal', 4), item(2, 'iron_ingot', 2)]) });
put(2, 1, 6, 'unpowered_repeater', { 'minecraft:cardinal_direction': 'north', repeater_delay: 2 });
put(4, 1, 6, 'powered_comparator', { 'minecraft:cardinal_direction': 'east', output_subtract_bit: 0, output_lit_bit: 1 }, { OutputSignal: T.int(7) });
put(6, 1, 6, 'observer', { 'minecraft:facing_direction': 'south', powered_bit: 1 });
put(8, 1, 6, 'lever', { lever_direction: 'up_north_south', open_bit: 1 });
put(10, 1, 6, 'redstone_wire', { redstone_signal: 9 });
put(12, 1, 6, 'piston', { 'minecraft:facing_direction': 'up' });
// stairs / slab / fence of a wood the base pack does not know + a few newer shapes
put(2, 1, 10, 'cherry_stairs', { weirdo_direction: 1, upside_down_bit: 0 });
put(3, 1, 10, 'cherry_slab', { 'minecraft:vertical_half': 'bottom' });
put(4, 1, 10, 'cherry_fence', {});
put(6, 1, 10, 'amethyst_cluster', { 'minecraft:block_face': 'up' });
put(8, 1, 10, 'sculk_sensor', { sculk_sensor_phase: 0 });
put(10, 1, 10, 'chiseled_bookshelf', { 'minecraft:cardinal_direction': 'south', books_stored: 5 });
put(12, 1, 10, 'copper_chest', { 'minecraft:cardinal_direction': 'south' });
// a wall of stone with a few plain blocks
for (let x = 0; x < 16; x++) put(x, 1, 14, x % 2 ? 'cobblestone' : 'stone_bricks');

const ent = (id: string, x: number, y: number, z: number, yaw = 0, extra: Record<string, Tagged> = {}) => ({
  identifier: T.string(id), Pos: T.list('float', [T.float(x), T.float(y), T.float(z)]), Rotation: T.list('float', [T.float(yaw), T.float(0)]), ...extra,
});
const entities = [
  ent('minecraft:cow', 3.5, 1, 12.5, 90), ent('minecraft:armor_stand', 5.5, 1, 12.5, 180), ent('minecraft:boat', 8.5, 1.1, 12.5, 0, { Variant: T.int(1) }),
  ent('minecraft:painting', 12, 3, 14.9, 0, { Motive: T.string('Wanderer'), Direction: T.byte(0) }),
  ent('minecraft:item', 14.5, 1, 12.5, 40, { Item: T.compound({ Name: T.string('minecraft:diamond'), Count: T.byte(1), Damage: T.short(0) }) }),
];
(async () => {
  mkdirSync(OUT, { recursive: true });
  // BEDROCK_PACK=<zip> uses another pack; by default Mojang's official resources (downloaded once into .cache/)
  const base = new ResourceStack((process.env.BEDROCK_PACK ? [await ResourcePack.fromBytes(new Uint8Array(readFileSync(process.env.BEDROCK_PACK)))] : await officialPacks()));
  const names = [...blocks.values()].map((b) => b.name.replace('minecraft:', ''));
  const { pack } = buildFixturePack(base, names);
  writeFileSync(`${OUT}/fixture.zip`, writeZip(pack.files));
  const bytes = buildMcStructure({
    size: [16, 6, 16],
    blockAt: (x, y, z) => (y === 0 ? { name: 'minecraft:stone' } : blocks.get(`${x},${y},${z}`) ?? null),
    blockEntityAt: (x, y, z) => be.get(`${x},${y},${z}`) ?? null,
    entities,
  });
  writeFileSync(`${OUT}/integ.mcstructure`, bytes);
  console.log('blocks', blocks.size, 'entities', entities.length, 'bytes', bytes.length);
})();

/** A structure with the hard-coded entities (boats, paintings, dropped items, falling blocks, TNT). */
import { writeFileSync } from 'fs';
import { buildMcStructure } from '../src/renderer/structure';
import { T, Tagged } from '../src/renderer/nbt';

const ent = (id: string, x: number, y: number, z: number, yaw = 0, extra: Record<string, Tagged> = {}): Record<string, Tagged> => ({
  identifier: T.string(id),
  Pos: T.list('float', [T.float(x), T.float(y), T.float(z)]),
  Rotation: T.list('float', [T.float(yaw), T.float(0)]),
  ...extra,
});
const list: Record<string, Tagged>[] = [];
// boats: six variants, the first two turned
['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'].forEach((_, i) => list.push(ent('minecraft:boat', 3 + i * 4, 1, 3, i === 1 ? 90 : i === 2 ? 180 : 0, { Variant: T.int(i) })));
// paintings in the four directions + a few motives
const motives = ['Kebab', 'Pool', 'Wanderer', 'Match', 'Fighters', 'Skeleton', 'Pointer', 'Pigscene', 'BurningSkull', 'Earth', 'Wither', 'Creebet'];
motives.forEach((m, i) => list.push(ent('minecraft:painting', 3 + (i % 6) * 4, 3 + Math.floor(i / 6) * 4, 9, 0, { Motive: T.string(m), Direction: T.byte(i % 4) })));
// dropped items
['minecraft:apple', 'minecraft:diamond', 'minecraft:stick', 'minecraft:stone', 'minecraft:sand', 'minecraft:planks'].forEach((n, i) =>
  list.push(ent('minecraft:item', 3 + i * 4, 1, 17, i * 30, { Item: T.compound({ Name: T.string(n), Count: T.byte(1), Damage: T.short(0) }) })));
// falling blocks + tnt
['minecraft:sand', 'minecraft:gravel', 'minecraft:anvil'].forEach((n, i) =>
  list.push(ent('minecraft:falling_block', 3 + i * 4, 1, 21, 0, { FallingBlock: T.compound({ name: T.string(n), states: T.compound({}) }) })));
list.push(ent('minecraft:tnt', 15, 1, 21));
const bytes = buildMcStructure({ size: [28, 12, 26], blockAt: (x, y) => (y === 0 ? { name: 'minecraft:stone' } : null), entities: list });
writeFileSync((process.env.E2E_OUT ?? new URL('./e2e/out', import.meta.url).pathname) + '/builtin.mcstructure', bytes);
console.log('entities:', list.length);

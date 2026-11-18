import type { BlockInventory, ContainerDefinition, ContainerInventory, InventoryItem, InventorySchematic, NbtData, Position } from './types.js';

/** Bedrock port of the Java renderer's inventory helpers: same output types, Bedrock block-entity NBT. */

// name, size, columns, labels. Slot order follows the Java renderer so both editions share one panel layout.
const DEFINITIONS: Record<string, [string, number, number, string[]?]> = {
  chest: ['箱子', 27, 9], trapped_chest: ['陷阱箱', 27, 9], barrel: ['木桶', 27, 9], shulker_box: ['潜影盒', 27, 9],
  hopper: ['漏斗', 5, 5], dispenser: ['发射器', 9, 3], dropper: ['投掷器', 9, 3], crafter: ['合成器', 9, 3],
  furnace: ['熔炉', 3, 3, ['输入', '燃料', '输出']], blast_furnace: ['高炉', 3, 3, ['输入', '燃料', '输出']],
  smoker: ['烟熏炉', 3, 3, ['输入', '燃料', '输出']],
  brewing_stand: ['酿造台', 5, 5, ['药水', '药水', '药水', '原料', '燃料']],
  chiseled_bookshelf: ['雕纹书架', 6, 3], decorated_pot: ['饰纹陶罐', 1, 1], ender_chest: ['末影箱', 0, 9],
};
const TAG = /^(Compound|List|String|Byte|Short|Int|Long|Float|Double|ByteArray|IntArray|LongArray)$/;

export function unwrapNbt(value: unknown): NbtData {
  if (Array.isArray(value)) return value.map(unwrapNbt);
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return value;
  const record = value as NbtData;
  const entries = Object.entries(record);
  if (entries.length === 1 && TAG.test(entries[0][0])) return unwrapNbt(entries[0][1]);
  return Object.fromEntries(entries.map(([k, v]) => [k, unwrapNbt(v)]));
}

/** `minecraft:chest[minecraft:cardinal_direction=north]` → `{ id, properties }`. */
export function blockState(input = '') {
  const [id, states = ''] = input.split('[');
  return {
    id,
    properties: Object.fromEntries(states.replace(/]$/, '').split(',').filter(Boolean).map((v) => v.split('='))) as Record<string, string>,
  };
}

/** Normalised container name for a Bedrock block id (lit variants, coloured shulker boxes, copper chests). */
function containerKey(id: string): string {
  let name = id.replace(/^minecraft:/, '');
  if (/(^|_)shulker_box$/.test(name)) name = 'shulker_box';
  if (/^(waxed_)?(exposed_|weathered_|oxidized_)?copper_chest$/.test(name)) name = 'chest';
  name = name.replace(/^lit_/, '');
  return name;
}

export function containerDefinition(id: string): ContainerDefinition | null {
  const name = containerKey(blockState(id).id);
  const d = DEFINITIONS[name];
  return d ? { name: d[0], size: d[1], columns: d[2], labels: d[3], unavailable: name === 'ender_chest' } : null;
}

export function textComponent(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') { try { return textComponent(JSON.parse(value)); } catch { return value; } }
  if (Array.isArray(value)) return value.map(textComponent).join('');
  if (typeof value === 'object') return String((value as NbtData).text ?? (value as NbtData).translate ?? '') + textComponent((value as NbtData).extra ?? []);
  return String(value);
}

/** Bedrock item compound (`Name`, `Count`, `Damage`, `Slot`, `tag`) → the Java renderer's `InventoryItem`. */
export function normalizeItem(raw: unknown, fallbackSlot?: number): InventoryItem | null {
  const item = unwrapNbt(raw);
  const stack = item?.item ?? item;
  const id = stack?.Name ?? stack?.id;
  if (!stack || typeof id !== 'string' || id === '' || /^(minecraft:)?air$/.test(id)) return null;
  const count = Number(stack.Count ?? stack.count ?? 1);
  const slot = Number(item.Slot ?? item.slot ?? fallbackSlot);
  if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(slot) || slot < 0) return null;
  const tag = stack.tag ?? {};
  const lore = tag.display?.Lore;
  return {
    id: id.includes(':') ? id : `minecraft:${id}`, count, slot, raw: item,
    customName: textComponent(tag.display?.Name),
    lore: Array.isArray(lore) ? lore.map(textComponent) : [],
    enchanted: Boolean(tag.ench?.length || tag.StoredEnchantments?.length || tag.Enchantments?.length),
  };
}

/** Slot order of Bedrock brewing stands (0 ingredient, 1-3 bottles, 4 fuel) → the Java order the panel uses. */
const BREWING_FROM_BEDROCK = [3, 0, 1, 2, 4];

export function readContainer(id: string, raw: unknown): ContainerInventory | null {
  const definition = containerDefinition(id);
  if (!definition) return null;
  const nbt = unwrapNbt(raw ?? {});
  const content = nbt.Items ?? nbt.items;
  const entries = Array.isArray(content) ? content : nbt.item ? [{ Slot: 0, ...nbt.item }] : [];
  const slots: (InventoryItem | null)[] = Array(definition.size).fill(null);
  const warnings: string[] = [];
  const brewing = containerKey(blockState(id).id) === 'brewing_stand';
  for (const e of entries) {
    const item = normalizeItem(e, definition.size === 1 ? 0 : undefined);
    if (!item) { warnings.push('无效或超出范围的槽位已保留在原始 NBT 中。'); continue; }
    if (brewing && item.slot < 5) item.slot = BREWING_FROM_BEDROCK[item.slot];
    if (item.slot >= slots.length) { warnings.push('无效或超出范围的槽位已保留在原始 NBT 中。'); continue; }
    if (slots[item.slot]) warnings.push(`槽位 ${item.slot} 重复，显示最后一条记录。`);
    slots[item.slot] = item;
  }
  let state: ContainerInventory['state'] = 'loaded';
  if (definition.unavailable) state = 'player';
  else if (nbt.LootTable || nbt.loot_table) state = 'loot';
  else if (!Array.isArray(content) && !nbt.item) state = 'missing';
  return {
    ...definition,
    name: textComponent(nbt.CustomName ?? nbt.custom_name) || definition.name,
    slots, nbt, state, warnings: [...new Set(warnings)],
    occupied: slots.filter(Boolean).length,
    total: slots.reduce((n, item) => n + (item?.count ?? 0), 0),
  };
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : undefined);

/**
 * Other half of a double chest. Bedrock stores it in the block entity (`pairx`, `pairz`); the value is a world
 * coordinate, so it is tried both as is and shifted by the structure origin, and the candidate that holds the same
 * chest block wins. Without NBT the neighbour is derived from `minecraft:cardinal_direction` like the Java renderer.
 */
export function pairedChestPosition(
  state: string, position: Position, nbt?: NbtData, origin: Position = [0, 0, 0], isSame?: (p: Position) => boolean,
): Position | null {
  const { id } = blockState(state);
  if (!/:(chest|trapped_chest|(?:waxed_)?(?:exposed_|weathered_|oxidized_)?copper_chest)$/.test(id)) return null;
  const px = num(nbt?.pairx), pz = num(nbt?.pairz);
  if (px !== undefined && pz !== undefined) {
    const candidates: Position[] = [[px - origin[0], position[1], pz - origin[2]], [px, position[1], pz]];
    for (const c of candidates) if ((c[0] !== position[0] || c[2] !== position[2]) && (!isSame || isSame(c))) return c;
  }
  return null;
}

export function readBlockInventory(schematic: InventorySchematic, position: Position, origin: Position = [0, 0, 0]): BlockInventory {
  const wrapper = schematic.schematicWrapper;
  const state = wrapper.get_block_string(...position) ?? wrapper.get_block(...position) ?? 'minecraft:air';
  const map = schematic.getBlockEntitiesMap();
  const nbt = map.get(position.join(','))?.nbt;
  const snbt = wrapper.getBlockEntitySnbt?.(...position);
  let inventory = readContainer(state, nbt);
  const sameChest = (p: Position) => blockState(wrapper.get_block_string(...p) ?? '').id === blockState(state).id;
  const pairPosition = pairedChestPosition(state, position, unwrapNbt(nbt ?? {}), origin, sameChest);
  if (inventory && pairPosition) {
    const pair = readContainer(wrapper.get_block_string(...pairPosition) ?? '', map.get(pairPosition.join(','))?.nbt);
    if (pair) {
      // pairlead marks the half that lists first (Bedrock's double chest shows the lead half in slots 0–26)
      const lead = Number(unwrapNbt(nbt ?? {}).pairlead ?? 0) === 1;
      const halves: ContainerInventory[] = lead ? [inventory, pair] : [pair, inventory];
      const slots = halves.flatMap((half, i) => half.slots.map((item) => (item ? { ...item, slot: item.slot + i * 27 } : null)));
      inventory = {
        ...inventory,
        name: inventory.name === containerDefinition(state)?.name ? '大型箱子' : inventory.name,
        size: 54, slots, occupied: slots.filter(Boolean).length, total: slots.reduce((n, item) => n + (item?.count ?? 0), 0),
        state: halves.some((h) => h.state !== 'loaded') ? 'partial' : 'loaded',
        nbt: { lead: halves[0].nbt, other: halves[1].nbt }, warnings: halves.flatMap((h) => h.warnings), pairPosition,
      };
    }
  }
  return { state, position, nbt: unwrapNbt(nbt ?? {}), snbt, inventory };
}

export const nbtJson = (value: unknown) => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? `${v}L` : v), 2);

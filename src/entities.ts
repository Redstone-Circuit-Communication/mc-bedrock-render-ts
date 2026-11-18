import type { EntityObject, EntitySummary } from './types.js';
import { textComponent } from './inventory.js';

const NAMES: Record<string, string> = {
  allay: '悦灵', zombie: '僵尸', skeleton: '骷髅', creeper: '苦力怕', pig: '猪', cow: '牛', armor_stand: '盔甲架',
  minecart: '矿车', chest_minecart: '运输矿车', hopper_minecart: '漏斗矿车', tnt_minecart: 'TNT矿车', command_block_minecart: '命令方块矿车',
  boat: '船', chest_boat: '运输船', painting: '画', item: '掉落物', falling_block: '下落的方块', tnt: '已点燃的TNT',
  sheep: '羊', chicken: '鸡', horse: '马', donkey: '驴', mule: '骡', wolf: '狼', cat: '猫', villager: '村民', villager_v2: '村民',
  zombie_villager: '僵尸村民', zombie_villager_v2: '僵尸村民', iron_golem: '铁傀儡', snow_golem: '雪傀儡', enderman: '末影人',
  ender_crystal: '末地水晶', xp_orb: '经验球', arrow: '箭', fireball: '火球', snowball: '雪球', egg: '鸡蛋', ender_pearl: '末影珍珠',
};

/** Display name of an entity record: custom name, else the Chinese name for its id, else the id. */
export function entityName(record: EntitySummary): string {
  return textComponent(record.nbt?.CustomName) || NAMES[record.id.replace(/^minecraft:/, '')] || record.id;
}

/** Walks up from a picked object to the entity it belongs to. */
export function entityFromObject(object: EntityObject | null): EntitySummary | null {
  for (let node = object; node; node = node.parent) if (node.userData?.kind === 'entity') return node.userData.entity ?? null;
  return null;
}

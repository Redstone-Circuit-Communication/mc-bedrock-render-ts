import type { RedstoneInfo } from './types.js';
import { blockState, unwrapNbt } from './inventory.js';

/**
 * Bedrock port of the Java renderer's `readRedstone`: reads what a structure snapshot actually saved (block states
 * and block-entity NBT). No propagation, ticking or guessed input levels.
 */

const DIRECTIONS: Record<string, string> = {
  north: '北 · −Z', south: '南 · +Z', east: '东 · +X', west: '西 · −X', up: '上 · +Y', down: '下 · −Y',
};
const OPPOSITE: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
const FACING6 = ['down', 'up', 'north', 'south', 'west', 'east'];
const LEGACY_DIRECTION = ['south', 'west', 'north', 'east'];
const yesNo = (v: boolean | null) => (v === null ? '未知' : v ? '是' : '否');

type Props = Record<string, string>;
const prop = (p: Props, key: string): string | undefined => p[key] ?? p[`minecraft:${key}`];
const flag = (v: string | undefined): boolean | null => (v === undefined ? null : v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : null);
function int(v: string | undefined, min = 0, max = 15): number | null {
  if (v === undefined || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}
function facing6(p: Props): string | undefined {
  const v = prop(p, 'facing_direction');
  if (v === undefined) return undefined;
  return /^\d+$/.test(v) ? FACING6[Number(v)] : v;
}
function cardinal(p: Props): string | undefined {
  const c = prop(p, 'cardinal_direction');
  if (c) return c;
  const d = prop(p, 'direction');
  return d !== undefined && /^\d+$/.test(d) ? LEGACY_DIRECTION[Number(d) & 3] : undefined;
}

export function readRedstone(state: string, rawNbt: unknown = {}): RedstoneInfo | null {
  const { id, properties: p } = blockState(state);
  if (!id.startsWith('minecraft:')) return null;
  const name = id.slice(10);
  const nbt = unwrapNbt(rawNbt) ?? {};
  const info: RedstoneInfo = { active: null, status: '状态未知', strength: null, signalLabel: '输出强度', source: '蓝图未保存可用的信号强度', details: [], note: '' };
  const detail = (label: string, value: string) => info.details.push({ label, value });
  const direction = (label: string, value: string | undefined) => detail(label, (value && DIRECTIONS[value]) || '未知');
  const active = (v: boolean | null, on = '已激活', off = '未激活') => { info.active = v; info.status = v === null ? '状态未知' : v ? on : off; };
  const binary = (property: string, on?: string, off?: string) => {
    active(flag(prop(p, property)), on, off);
    info.strength = info.active === null ? null : info.active ? 15 : 0;
    if (info.strength !== null) info.source = `方块状态 ${property} · 原版固定输出 0 / 15`;
  };
  const analog = (property = 'redstone_signal') => {
    info.strength = int(prop(p, property));
    active(info.strength === null ? null : info.strength > 0);
    if (info.strength !== null) info.source = `方块状态 ${property}`;
  };
  const consumer = (v: boolean | null, on?: string, off?: string) => {
    active(v, on, off);
    info.signalLabel = '输入强度';
    info.source = '方块状态不保存输入信号的数值';
    info.note = '工作状态不能用来推算输入强度，也不代表该方块输出红石信号。';
  };

  if (name === 'redstone_wire') { analog(); info.signalLabel = '信号强度'; }
  else if (name === 'powered_repeater' || name === 'unpowered_repeater') {
    active(name === 'powered_repeater'); info.strength = info.active ? 15 : 0; info.source = '方块 ID（powered / unpowered）';
    const delay = int(prop(p, 'repeater_delay'), 0, 3);
    detail('延迟', delay === null ? '未知' : `${delay + 1} 红石刻 · ${(delay + 1) * 2} 游戏刻 · ${((delay + 1) / 10).toFixed(1)} 秒`);
    const input = cardinal(p);
    direction('输入方向', input); direction('输出方向', input ? OPPOSITE[input] : undefined);
  } else if (name === 'powered_comparator' || name === 'unpowered_comparator') {
    active(name === 'powered_comparator' || flag(prop(p, 'output_lit_bit')) === true);
    const out = typeof nbt.OutputSignal === 'number' ? nbt.OutputSignal : null;
    info.strength = out !== null && out >= 0 && out <= 15 ? out : null;
    detail('模式', flag(prop(p, 'output_subtract_bit')) ? '减法' : '比较');
    const input = cardinal(p);
    direction('输入方向', input); direction('输出方向', input ? OPPOSITE[input] : undefined);
    if (info.strength !== null) info.source = '方块实体 NBT · OutputSignal';
    else info.note = '缺少有效的 OutputSignal；点亮状态只能表示激活，无法确定 0–15 的具体输出。';
  } else if (name === 'redstone_torch' || name === 'unlit_redstone_torch') {
    active(name === 'redstone_torch', '已点亮', '已熄灭'); info.strength = info.active ? 15 : 0; info.source = '方块 ID（redstone_torch / unlit_redstone_torch）';
  } else if (name === 'redstone_block') {
    active(true, '持续供能'); info.strength = 15; info.source = '原版固定信号源';
  } else if (name === 'observer') {
    binary('powered_bit', '正在输出脉冲', '未输出脉冲');
    const f = facing6(p); direction('侦测方向', f); direction('输出方向', f ? OPPOSITE[f] : undefined);
    detail('脉冲时长', '1 红石刻 · 2 游戏刻');
  } else if (name === 'lever') {
    binary('open_bit');
  } else if (/_button$/.test(name)) {
    binary('button_pressed_bit');
  } else if (name === 'tripwire_hook') {
    binary('powered_bit'); detail('绊线连接', yesNo(flag(prop(p, 'attached_bit'))));
  } else if (/_pressure_plate$/.test(name)) {
    if (/^(light|heavy)_weighted/.test(name)) analog(); else binary('redstone_signal');
    if (!/^(light|heavy)_weighted/.test(name)) { const n = int(prop(p, 'redstone_signal')); info.strength = n === null ? null : n > 0 ? 15 : 0; }
  } else if (name === 'detector_rail') {
    binary('rail_data_bit');
  } else if (name === 'daylight_detector' || name === 'daylight_detector_inverted') {
    analog(); detail('反转模式', yesNo(name === 'daylight_detector_inverted'));
  } else if (name === 'sculk_sensor' || name === 'calibrated_sculk_sensor') {
    const phase = prop(p, 'sculk_sensor_phase');
    info.strength = null; active(phase === undefined ? null : phase !== '0');
    detail('阶段', ({ '0': '待命', '1': '激活', '2': '冷却' } as Record<string, string>)[phase ?? ''] ?? '未知');
  } else if (name === 'redstone_lamp' || name === 'lit_redstone_lamp') {
    consumer(name === 'lit_redstone_lamp', '已点亮', '未点亮');
  } else if (name === 'piston' || name === 'sticky_piston') {
    consumer(null); info.status = '状态未知';
    direction('伸出方向', facing6(p));
    info.note = '结构快照不保存活塞是否伸出；伸出的活塞会带着 *_piston_arm_collision 方块。';
  } else if (name === 'hopper') {
    const locked = flag(prop(p, 'toggle_bit'));
    consumer(locked === null ? null : locked, '已锁定', '可传输');
    info.active = locked; direction('漏斗朝向', facing6(p));
  } else if (name === 'dispenser' || name === 'dropper') {
    consumer(flag(prop(p, 'triggered_bit')), '已触发', '未触发'); direction('发射方向', facing6(p));
  } else if (name === 'golden_rail' || name === 'activator_rail') {
    consumer(flag(prop(p, 'rail_data_bit')));
  } else return null;
  return info;
}

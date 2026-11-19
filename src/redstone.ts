import type { RedstoneInfo } from './types.js';
import { blockState, unwrapNbt } from './inventory.js';
import { L } from './locale.js';

/**
 * Bedrock port of the Java renderer's `readRedstone`: reads what a structure snapshot actually saved (block states
 * and block-entity NBT). No propagation, ticking or guessed input levels.
 */

const DIRECTIONS: Record<string, [string, string]> = {
  north: ['North · −Z', '北 · −Z'], south: ['South · +Z', '南 · +Z'], east: ['East · +X', '东 · +X'],
  west: ['West · −X', '西 · −X'], up: ['Up · +Y', '上 · +Y'], down: ['Down · −Y', '下 · −Y'],
};
const OPPOSITE: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
const FACING6 = ['down', 'up', 'north', 'south', 'west', 'east'];
const LEGACY_DIRECTION = ['south', 'west', 'north', 'east'];
const UNKNOWN = () => L('Unknown', '未知');
const yesNo = (v: boolean | null) => (v === null ? UNKNOWN() : v ? L('Yes', '是') : L('No', '否'));

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
  const info: RedstoneInfo = {
    active: null, status: L('Unknown state', '状态未知'), strength: null, signalLabel: L('Output strength', '输出强度'),
    source: L('The structure saves no usable signal strength', '蓝图未保存可用的信号强度'), details: [], note: '',
  };
  const detail = (label: string, value: string) => info.details.push({ label, value });
  const direction = (label: string, value: string | undefined) => detail(label, value && DIRECTIONS[value] ? L(...DIRECTIONS[value]) : UNKNOWN());
  const active = (v: boolean | null, on = L('Active', '已激活'), off = L('Inactive', '未激活')) => {
    info.active = v;
    info.status = v === null ? L('Unknown state', '状态未知') : v ? on : off;
  };
  const binary = (property: string, on?: string, off?: string) => {
    active(flag(prop(p, property)), on, off);
    info.strength = info.active === null ? null : info.active ? 15 : 0;
    if (info.strength !== null) info.source = L(`Block state ${property} · vanilla outputs 0 or 15`, `方块状态 ${property} · 原版固定输出 0 / 15`);
  };
  const analog = (property = 'redstone_signal') => {
    info.strength = int(prop(p, property));
    active(info.strength === null ? null : info.strength > 0);
    if (info.strength !== null) info.source = L(`Block state ${property}`, `方块状态 ${property}`);
  };
  const consumer = (v: boolean | null, on?: string, off?: string) => {
    active(v, on, off);
    info.signalLabel = L('Input strength', '输入强度');
    info.source = L('Block states do not save the input signal level', '方块状态不保存输入信号的数值');
    info.note = L(
      'Whether it is working does not tell the input strength, nor does it mean the block outputs a redstone signal.',
      '工作状态不能用来推算输入强度，也不代表该方块输出红石信号。',
    );
  };

  if (name === 'redstone_wire') { analog(); info.signalLabel = L('Signal strength', '信号强度'); }
  else if (name === 'powered_repeater' || name === 'unpowered_repeater') {
    active(name === 'powered_repeater'); info.strength = info.active ? 15 : 0; info.source = L('Block ID (powered / unpowered)', '方块 ID（powered / unpowered）');
    const delay = int(prop(p, 'repeater_delay'), 0, 3);
    detail(L('Delay', '延迟'), delay === null ? UNKNOWN() : L(
      `${delay + 1} redstone ticks · ${(delay + 1) * 2} game ticks · ${((delay + 1) / 10).toFixed(1)} s`,
      `${delay + 1} 红石刻 · ${(delay + 1) * 2} 游戏刻 · ${((delay + 1) / 10).toFixed(1)} 秒`,
    ));
    const input = cardinal(p);
    direction(L('Input side', '输入方向'), input); direction(L('Output side', '输出方向'), input ? OPPOSITE[input] : undefined);
  } else if (name === 'powered_comparator' || name === 'unpowered_comparator') {
    active(name === 'powered_comparator' || flag(prop(p, 'output_lit_bit')) === true);
    const out = typeof nbt.OutputSignal === 'number' ? nbt.OutputSignal : null;
    info.strength = out !== null && out >= 0 && out <= 15 ? out : null;
    detail(L('Mode', '模式'), flag(prop(p, 'output_subtract_bit')) ? L('Subtract', '减法') : L('Compare', '比较'));
    const input = cardinal(p);
    direction(L('Input side', '输入方向'), input); direction(L('Output side', '输出方向'), input ? OPPOSITE[input] : undefined);
    if (info.strength !== null) info.source = L('Block entity NBT · OutputSignal', '方块实体 NBT · OutputSignal');
    else info.note = L(
      'No valid OutputSignal: being lit only tells whether it is active, not the exact output from 0 to 15.',
      '缺少有效的 OutputSignal；点亮状态只能表示激活，无法确定 0–15 的具体输出。',
    );
  } else if (name === 'redstone_torch' || name === 'unlit_redstone_torch') {
    active(name === 'redstone_torch', L('Lit', '已点亮'), L('Unlit', '已熄灭')); info.strength = info.active ? 15 : 0;
    info.source = L('Block ID (redstone_torch / unlit_redstone_torch)', '方块 ID（redstone_torch / unlit_redstone_torch）');
  } else if (name === 'redstone_block') {
    active(true, L('Always powered', '持续供能')); info.strength = 15; info.source = L('Fixed vanilla signal source', '原版固定信号源');
  } else if (name === 'observer') {
    binary('powered_bit', L('Emitting a pulse', '正在输出脉冲'), L('No pulse', '未输出脉冲'));
    const f = facing6(p); direction(L('Observed side', '侦测方向'), f); direction(L('Output side', '输出方向'), f ? OPPOSITE[f] : undefined);
    detail(L('Pulse length', '脉冲时长'), L('1 redstone tick · 2 game ticks', '1 红石刻 · 2 游戏刻'));
  } else if (name === 'lever') {
    binary('open_bit');
  } else if (/_button$/.test(name)) {
    binary('button_pressed_bit');
  } else if (name === 'tripwire_hook') {
    binary('powered_bit'); detail(L('Tripwire attached', '绊线连接'), yesNo(flag(prop(p, 'attached_bit'))));
  } else if (/_pressure_plate$/.test(name)) {
    if (/^(light|heavy)_weighted/.test(name)) analog(); else binary('redstone_signal');
    if (!/^(light|heavy)_weighted/.test(name)) { const n = int(prop(p, 'redstone_signal')); info.strength = n === null ? null : n > 0 ? 15 : 0; }
  } else if (name === 'detector_rail') {
    binary('rail_data_bit');
  } else if (name === 'daylight_detector' || name === 'daylight_detector_inverted') {
    analog(); detail(L('Inverted', '反转模式'), yesNo(name === 'daylight_detector_inverted'));
  } else if (name === 'sculk_sensor' || name === 'calibrated_sculk_sensor') {
    const phase = prop(p, 'sculk_sensor_phase');
    info.strength = null; active(phase === undefined ? null : phase !== '0');
    detail(L('Phase', '阶段'), ({ '0': L('Inactive', '待命'), '1': L('Active', '激活'), '2': L('Cooldown', '冷却') } as Record<string, string>)[phase ?? ''] ?? UNKNOWN());
  } else if (name === 'redstone_lamp' || name === 'lit_redstone_lamp') {
    consumer(name === 'lit_redstone_lamp', L('Lit', '已点亮'), L('Unlit', '未点亮'));
  } else if (name === 'piston' || name === 'sticky_piston') {
    consumer(null); info.status = L('Unknown state', '状态未知');
    direction(L('Pushes toward', '伸出方向'), facing6(p));
    info.note = L(
      'A structure snapshot does not save whether a piston is extended; an extended piston comes with a *_piston_arm_collision block.',
      '结构快照不保存活塞是否伸出；伸出的活塞会带着 *_piston_arm_collision 方块。',
    );
  } else if (name === 'hopper') {
    const locked = flag(prop(p, 'toggle_bit'));
    consumer(locked === null ? null : locked, L('Locked', '已锁定'), L('Transferring', '可传输'));
    info.active = locked; direction(L('Hopper faces', '漏斗朝向'), facing6(p));
  } else if (name === 'dispenser' || name === 'dropper') {
    consumer(flag(prop(p, 'triggered_bit')), L('Triggered', '已触发'), L('Not triggered', '未触发')); direction(L('Fires toward', '发射方向'), facing6(p));
  } else if (name === 'golden_rail' || name === 'activator_rail') {
    consumer(flag(prop(p, 'rail_data_bit')));
  } else return null;
  return info;
}

/** Bedrock's `facing_direction` of pistons: 0 down, 1 up, 2 south, 3 north, 4 east, 5 west. */
const PISTON_STEP: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];
type BlockReader = { schematicWrapper: { get_block_string?(x: number, y: number, z: number): string | undefined; get_block?(x: number, y: number, z: number): string | undefined } };
const blockAt = (schematic: BlockReader, [x, y, z]: [number, number, number]) => {
  const w = schematic.schematicWrapper;
  return blockState(w.get_block_string?.(x, y, z) ?? w.get_block?.(x, y, z) ?? 'minecraft:air');
};
const pistonStep = (properties: Record<string, string>) => {
  const raw = properties.facing_direction ?? properties['minecraft:facing_direction'];
  const named = ['down', 'up', 'south', 'north', 'east', 'west'].indexOf(String(raw).replace(/"/g, ''));
  return PISTON_STEP[named >= 0 ? named : Number(raw)];
};

/**
 * An extended piston is two blocks, the base and its arm (`*piston_arm_collision`), and the game treats them as one
 * piston. For a position on either part this returns both, or null when the position is not part of an extended piston.
 */
export function pistonParts(schematic: BlockReader, position: [number, number, number]): { base: [number, number, number]; head: [number, number, number] } | null {
  const here = blockAt(schematic, position);
  const name = here.id.replace(/^minecraft:/, '');
  const step = pistonStep(here.properties);
  if (!step) return null;
  if (name === 'piston' || name === 'sticky_piston') {
    const head: [number, number, number] = [position[0] + step[0], position[1] + step[1], position[2] + step[2]];
    return /^(sticky_)?piston_arm_collision$/.test(blockAt(schematic, head).id.replace(/^minecraft:/, '')) ? { base: position, head } : null;
  }
  if (/^(sticky_)?piston_arm_collision$/.test(name)) {
    const base: [number, number, number] = [position[0] - step[0], position[1] - step[1], position[2] - step[2]];
    return /^(sticky_)?piston$/.test(blockAt(schematic, base).id.replace(/^minecraft:/, '')) ? { base, head: position } : null;
  }
  return null;
}

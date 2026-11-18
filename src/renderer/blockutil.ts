import { BlockModel, DIRS, Dir, FaceTextures, Tint, cubeModel, orientTo } from './models';
import { ResourceStack } from './resources';
import { NbtCompound } from './nbt';
import { StateValue } from './structure';

export const stripNamespace = (n: string) => n.replace(/^minecraft:/, '');

export interface BlockRef {
  /** Identifier without the `minecraft:` prefix. */
  name: string;
  states: Record<string, StateValue>;
}

export interface BlockContext extends BlockRef {
  x: number;
  y: number;
  z: number;
  /** Block at an offset (layer 0). `null` when empty or outside the structure. */
  neighbor(dx: number, dy: number, dz: number): BlockRef | null;
  /** Is the neighbouring cell an opaque full cube? */
  isOpaque(dx: number, dy: number, dz: number): boolean;
  blockEntity?: NbtCompound;
  resources: ResourceStack;
}

/**
 * Return a model, `null` for "render nothing", or `undefined` to let the next
 * resolver (patterns → texture table → blocks.json → exact terrain key) try.
 */
export type BlockHandler = (ctx: BlockContext) => BlockModel | null | undefined;

// ------------------------------------------------------------ state helpers ---

export function st(states: Record<string, StateValue>, key: string): StateValue | undefined {
  return states[key] ?? states['minecraft:' + key];
}
export const truthy = (v: StateValue | undefined): boolean => v === 1 || v === '1' || v === 'true' || (v as unknown) === true;
export const num = (v: StateValue | undefined, d = 0): number => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !isNaN(+v) ? +v : d);
export const isDir = (v: unknown): v is Dir => typeof v === 'string' && (DIRS as string[]).includes(v);

/**
 * First texture ref that really exists in the resource pack. When none does, the first candidate is returned so the
 * atlas reports it in `mesh.stats.missingTextures` (the renderer never draws textures of its own).
 */
export function firstTexture(stack: ResourceStack, ...refs: string[]): string {
  return refs.find((r) => stack.hasTexture(r)) ?? refs[0];
}

/** Standard Bedrock `facing_direction` integer order. */
export const FACING6: Dir[] = ['down', 'up', 'north', 'south', 'west', 'east'];

/**
 * Pistons (and their arm-collision blocks) do NOT follow the table above for the four horizontal values.
 *
 * Measured on real structures: every extended piston carries a `*_piston_arm_collision` block (with the same
 * `facing_direction`) in the cell its arm occupies, and across 16 extended pistons the arm lies at
 *   2 → +z (south)   3 → −z (north)   4 → +x (east)   [5 → −x (west)]   1 → +y   0 → −y
 * i.e. north/south *and* east/west are swapped compared with `FACING6`. Pass your own table to
 * `createDefaultRegistry({ pistonFacing })` if your files disagree.
 */
export const PISTON_FACING6: Dir[] = ['down', 'up', 'south', 'north', 'east', 'west'];

export function facingDirection(states: Record<string, StateValue>, table: Dir[] = FACING6): Dir | undefined {
  const v = st(states, 'facing_direction');
  if (typeof v === 'string' && isDir(v)) return v;
  if (typeof v === 'number') return table[v];
  return undefined;
}

export function cardinal(states: Record<string, StateValue>): Dir | undefined {
  const v = st(states, 'cardinal_direction');
  return isDir(v) ? v : undefined;
}

// --------------------------------------------------------------- registry ---

/**
 * A handler that runs before the registry's own handlers and receives their result lazily (`base()`), e.g. to take the
 * geometry from another source but keep the registry's material flags. Return `undefined` to use `base()` as is.
 */
export type PrimaryHandler = (ctx: BlockContext, base: () => BlockModel | null | undefined) => BlockModel | null | undefined;

export class BlockRegistry {
  private exact = new Map<string, BlockHandler>();
  private patterns: [RegExp, BlockHandler][] = [];
  private traitCache = new Map<string, { opaque: boolean }>();
  fallback?: BlockHandler;
  /** Runs first for every block (the default registry puts HoloPrint's shape data here). */
  primary?: PrimaryHandler;

  /** Register a handler for exact block ids (without `minecraft:`). Later registrations replace earlier ones. */
  register(names: string | string[], handler: BlockHandler): this {
    for (const n of Array.isArray(names) ? names : [names]) this.exact.set(stripNamespace(n), handler);
    return this;
  }
  registerPattern(re: RegExp, handler: BlockHandler): this {
    this.patterns.push([re, handler]);
    return this;
  }

  resolve(ctx: BlockContext): BlockModel | null | undefined {
    if (this.primary) {
      let done = false, b: BlockModel | null | undefined;
      const base = () => { if (!done) { b = this.resolveOwn(ctx); done = true; } return b; };
      const r = this.primary(ctx, base);
      return r !== undefined ? r : base();
    }
    return this.resolveOwn(ctx);
  }

  /** The registry's own handlers only (exact names, patterns, fallback), without `primary`. */
  resolveOwn(ctx: BlockContext): BlockModel | null | undefined {
    const h = this.exact.get(ctx.name);
    if (h) { const r = h(ctx); if (r !== undefined) return r; }
    for (const [re, ph] of this.patterns) {
      if (re.test(ctx.name)) { const r = ph(ctx); if (r !== undefined) return r; }
    }
    return this.fallback ? this.fallback(ctx) : undefined;
  }

  /** Context-free facts about a block (used for culling & redstone connection logic). */
  traits(ref: BlockRef, stack: ResourceStack): { opaque: boolean } {
    const key = ref.name + JSON.stringify(ref.states);
    let t = this.traitCache.get(key);
    if (!t) {
      let m: BlockModel | null | undefined;
      try {
        m = this.resolve({
          ...ref, x: 0, y: 0, z: 0,
          neighbor: () => null, isOpaque: () => false, resources: stack,
        });
      } catch { m = undefined; }
      t = { opaque: m === undefined ? true : !!m?.opaque };
      this.traitCache.set(key, t);
    }
    return t;
  }
}

// ------------------------------------------------------------ cube textures ---

export type Faces6 = Record<Dir, string>;

export interface CubeSpec {
  faces: Faces6;
  tint?: Partial<Record<Dir, Tint>>;
  opaque?: boolean;
  layer?: 'translucent';
  emissive?: boolean;
  cullSame?: boolean;
  alpha?: number;
  /** Faces describe the `y` axis orientation; rotate using `pillar_axis`. */
  pillar?: boolean;
}

export const all6 = (t: string): Faces6 => ({ down: t, up: t, north: t, south: t, west: t, east: t });
export const col6 = (side: string, top = side, bottom = top): Faces6 =>
  ({ down: bottom, up: top, north: side, south: side, west: side, east: side });

export const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
export const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];

const solid = (t: string, extra: Partial<CubeSpec> = {}): CubeSpec => ({ faces: all6(t), opaque: true, ...extra });
const column = (side: string, top?: string, bottom?: string, extra: Partial<CubeSpec> = {}): CubeSpec =>
  ({ faces: col6(side, top, bottom), opaque: true, ...extra });

const TABLE = new Map<string, CubeSpec>();
const def = (names: string | string[], spec: CubeSpec) => { for (const n of Array.isArray(names) ? names : [names]) TABLE.set(n, spec); };

// --- natural blocks
def('stone', solid('stone#0')); def('granite', solid('stone#1')); def('polished_granite', solid('stone#2'));
def('diorite', solid('stone#3')); def('polished_diorite', solid('stone#4'));
def('andesite', solid('stone#5')); def('polished_andesite', solid('stone#6'));
def('cobblestone', solid('cobblestone')); def('mossy_cobblestone', solid('cobblestone_mossy'));
def('bedrock', solid('bedrock')); def('dirt', solid('dirt#0')); def('coarse_dirt', solid('dirt#1'));
def('sand', solid('sand#0')); def('red_sand', solid('sand#1')); def('gravel', solid('gravel')); def('clay', solid('clay'));
def('grass_block', {
  faces: { up: 'grass_top', down: 'dirt#0', north: 'grass_side|mask:grass', south: 'grass_side|mask:grass', west: 'grass_side|mask:grass', east: 'grass_side|mask:grass' },
  tint: { up: 'grass' }, opaque: true,
});
def('podzol', column('dirt_podzol_side', 'dirt_podzol_top', 'dirt#0'));
def('mycelium', column('mycelium_side#0', 'mycelium_top#0', 'dirt#0'));
for (const [n, k] of [['coal', 'coal'], ['iron', 'iron'], ['gold', 'gold'], ['diamond', 'diamond'], ['emerald', 'emerald'], ['lapis', 'lapis'], ['redstone', 'redstone']] as const) {
  def(`${n}_ore`, solid(`${k}_ore`)); def(`${n}_block`, solid(`${k}_block`));
}
def('lit_redstone_ore', solid('redstone_ore', { emissive: true }));
def('quartz_ore', solid('quartz_ore')); def('redstone_block', solid('redstone_block'));
def('obsidian', solid('obsidian')); def('netherrack', solid('netherrack')); def('soul_sand', solid('soul_sand'));
def('glowstone', solid('glowstone', { emissive: true })); def('sea_lantern', solid('sea_lantern', { emissive: true }));
def('magma', solid('magma', { emissive: true }));
def('nether_wart_block', solid('nether_wart_block')); def('end_stone', solid('end_stone'));
def(['end_bricks', 'end_stone_bricks'], solid('end_bricks'));
def(['brick_block', 'bricks'], solid('brick')); def('nether_brick', solid('nether_brick')); def('red_nether_brick', solid('red_nether_brick'));
def('stone_bricks', solid('stonebrick#0')); def('stonebrick', solid('stonebrick#0'));
def('mossy_stone_bricks', solid('stonebrick#1')); def('cracked_stone_bricks', solid('stonebrick#2')); def('chiseled_stone_bricks', solid('stonebrick#3'));
def('smooth_stone', solid('smooth_stone'));
def('sponge', solid('sponge#0')); def('wet_sponge', solid('sponge#1'));
def('snow', solid('snow')); def('packed_ice', solid('ice_packed')); def('blue_ice', solid('blue_ice'));
def('ice', { faces: all6('ice'), layer: 'translucent', cullSame: true, alpha: 0.8 });
def('slime', { faces: all6('slime_block'), layer: 'translucent', cullSame: true, alpha: 0.85 });
def('glass', { faces: all6('glass'), cullSame: true });
def('hardened_clay', solid('hardened_clay')); def('terracotta', solid('hardened_clay'));
def('hay_block', { ...column('hayblock_side', 'hayblock_top'), pillar: true });
def('bone_block', { ...column('bone_block_side', 'bone_block_top'), pillar: true });
def('melon_block', column('melon_side', 'melon_top')); def('melon', column('melon_side', 'melon_top'));
def('pumpkin', column('pumpkin_side#0', 'pumpkin_top#0'));
def('prismarine', solid('prismarine#0')); def('prismarine_bricks', solid('prismarine_bricks')); def('dark_prismarine', solid('dark_prismarine'));
def('purpur_block', column('purpur_block_side#0', 'purpur_block_top#0', 'purpur_block_bottom#0'));
def('purpur_pillar', { ...column('purpur_block_side#2', 'purpur_block_top#2', 'purpur_block_bottom#2'), pillar: true });
def('bookshelf', column('bookshelf', 'bookshelf_top'));
def('tnt', column('tnt_side', 'tnt_top', 'tnt_bottom'));
def('jukebox', column('jukebox_side', 'jukebox_top')); def('noteblock', solid('noteblock'));
def('crafting_table', { faces: { up: 'crafting_table_top', down: 'planks#0', north: 'crafting_table_side', south: 'crafting_table_front', west: 'crafting_table_front', east: 'crafting_table_side' }, opaque: true });
def('redstone_lamp', solid('redstone_lamp_off')); def('lit_redstone_lamp', solid('redstone_lamp_on', { emissive: true }));
def('sandstone', column('sandstone_side#0', 'sandstone_top#0', 'sandstone_bottom#0'));
def('chiseled_sandstone', column('sandstone_side#1', 'sandstone_top#1', 'sandstone_bottom#1'));
def('cut_sandstone', column('sandstone_side#2', 'sandstone_top#2', 'sandstone_bottom#2'));
def('smooth_sandstone', solid('smooth_sandstone'));
def('red_sandstone', column('redsandstone_side#0', 'redsandstone_top#0', 'redsandstone_bottom#0'));
def('chiseled_red_sandstone', column('redsandstone_side#1', 'redsandstone_top#1', 'redsandstone_bottom#1'));
def('cut_red_sandstone', column('redsandstone_side#2', 'redsandstone_top#2', 'redsandstone_bottom#2'));
def('smooth_red_sandstone', solid('smooth_red_sandstone'));
def('quartz_block', column('quartz_block_side#0', 'quartz_block_top#0', 'quartz_block_bottom#0'));
def('chiseled_quartz_block', { ...column('quartz_block_side#1', 'quartz_block_top#1', 'quartz_block_bottom#1'), pillar: true });
def('quartz_pillar', { ...column('quartz_block_side#2', 'quartz_block_top#2', 'quartz_block_bottom#2'), pillar: true });
def('smooth_quartz', column('quartz_block_side#3', 'quartz_block_top#3', 'quartz_block_bottom#3'));
def('lava', solid('still_lava', { emissive: true })); def('flowing_lava', solid('still_lava', { emissive: true }));

/** Map a base-block name to a texture set, trying the usual naming variants. */
function lookupCube(name: string, stack: ResourceStack): CubeSpec | undefined {
  const t = TABLE.get(name);
  if (t) return t;

  let m: RegExpMatchArray | null;
  const colorIdx = (c: string) => COLORS.indexOf(c);
  if ((m = name.match(/^(.+)_wool$/)) && colorIdx(m[1]) >= 0) return solid(`wool#${colorIdx(m[1])}`);
  if ((m = name.match(/^(.+)_concrete_powder$/)) && colorIdx(m[1]) >= 0) return solid(`concretePowder#${colorIdx(m[1])}`);
  if ((m = name.match(/^(.+)_concrete$/)) && colorIdx(m[1]) >= 0) return solid(`concrete#${colorIdx(m[1])}`);
  if ((m = name.match(/^(.+)_stained_glass$/)) && colorIdx(m[1]) >= 0)
    return { faces: all6(`stained_glass#${colorIdx(m[1])}`), layer: 'translucent', cullSame: true, alpha: 0.9 };
  if ((m = name.match(/^(.+)_terracotta$/)) && colorIdx(m[1]) >= 0) return solid(`stained_clay#${colorIdx(m[1])}`);
  if ((m = name.match(/^(.+)_glazed_terracotta$/))) return solid(`${m[1] === 'light_gray' ? 'silver' : m[1]}_glazed_terracotta`);
  if ((m = name.match(/^(.+)_planks$/)) && WOODS.includes(m[1])) return solid(`planks#${WOODS.indexOf(m[1])}`);
  if ((m = name.match(/^stripped_(.+)_log$/)) && WOODS.includes(m[1]))
    return { ...column(`stripped_${m[1]}_log_side`, `stripped_${m[1]}_log_top`), pillar: true };
  if ((m = name.match(/^(.+)_log$/)) && WOODS.includes(m[1])) {
    const i = WOODS.indexOf(m[1]);
    return { ...(i < 4 ? column(`log_side#${i}`, `log_top#${i}`) : column(`log_side2#${i - 4}`, `log_top2#${i - 4}`)), pillar: true };
  }
  if ((m = name.match(/^(.+)_wood$/)) && WOODS.includes(m[1]))
    return { ...solid(`wood#${WOODS.indexOf(m[1]) * 2}`), pillar: true }; // bark on all six sides (`wood` holds bark, stripped, bark, stripped …)
  if ((m = name.match(/^(.+)_leaves$/)) && WOODS.includes(m[1])) {
    const i = WOODS.indexOf(m[1]);
    return { faces: all6(i < 4 ? `leaves#${i}` : `leaves2#${i - 4}`), tint: leafTints(name), cullSame: false };
  }

  // modern blocks.json from a supplied resource pack
  const bj = stack.blocksJson.get(name);
  if (bj && bj.textures) {
    const t = bj.textures;
    if (typeof t === 'string') return /_leaves$/.test(name) ? { ...solid(t), opaque: false, tint: leafTints(name), cullSame: false } : solid(t);
    const g = (...keys: string[]) => keys.map((k) => (t as Record<string, string>)[k]).find((v) => typeof v === 'string');
    const any = g('side', 'up', 'down', 'north', 'south', 'east', 'west') ?? 'missing';
    return {
      opaque: true, pillar: PILLAR.test(name),
      faces: {
        up: g('up', 'top') ?? any, down: g('down', 'bottom') ?? any,
        north: g('north', 'side') ?? any, south: g('south', 'side') ?? any,
        west: g('west', 'side') ?? any, east: g('east', 'side') ?? any,
      },
    };
  }
  if (stack.terrain.has(name)) return solid(name);
  return modernCube(name, stack);
}

// ------------------------------------------------- blocks added after 1.14 ---

/**
 * Leaf colours: spruce and birch use fixed colours, cherry / azalea / pale oak leaves are not tinted, the rest takes the
 * biome foliage colour.
 */
function leafTints(name: string): CubeSpec['tint'] {
  const wood = /^(.+)_leaves$/.exec(name)?.[1];
  if (!wood || /^(cherry|azalea|flowering_azalea|pale_oak)$/.test(wood)) return undefined;
  const t = wood === 'spruce' ? 0x619961 : wood === 'birch' ? 0x80a755 : 'foliage';
  return Object.fromEntries(DIRS.map((d) => [d, t])) as CubeSpec['tint'];
}

/** Names that are not full cubes (or need a dedicated model): never guessed as a cube from a texture file. */
const NOT_A_CUBE = /(stairs|slab|wall|fence|door|trapdoor|button|plate|sign|bars|chest|carpet|pane|torch|lantern|chain|campfire|sapling|propagule|vine|bush|flower|roots|candle|cluster|_bud$|rod$|sensor|shrieker|spawner|vault|crafter|shelf|bookshelf|pot$|frame|banner|head|skull|bed$|golem|petals|litter|egg|dripleaf|lichen|vein|fungus|bulb|anchor|honey_block|honeycomb_block|^target$)/;
/** Cube-like families whose texture files follow the block name. */
const CUBE_FAMILY = /^(((exposed_|weathered_|oxidized_)?(copper_block|copper|cut_copper|chiseled_copper|copper_grate|raw_copper_block))|copper_ore|deepslate(_.+)?|cobbled_deepslate|polished_deepslate|cracked_deepslate_(bricks|tiles)|chiseled_deepslate|reinforced_deepslate|infested_deepslate|tuff|polished_tuff|tuff_bricks|chiseled_tuff|chiseled_tuff_bricks|calcite|amethyst_block|budding_amethyst|dripstone_block|moss_block|pale_moss_block|mud|packed_mud|mud_bricks|rooted_dirt|muddy_mangrove_roots|mangrove_roots|blackstone|polished_blackstone|polished_blackstone_bricks|cracked_polished_blackstone_bricks|chiseled_polished_blackstone|gilded_blackstone|basalt|polished_basalt|smooth_basalt|netherite_block|ancient_debris|crying_obsidian|lodestone|shroomlight|soul_soil|nether_gold_ore|chiseled_nether_bricks|cracked_nether_bricks|crimson_nylium|warped_nylium|warped_wart_block|sculk|sculk_catalyst|(ochre|verdant|pearlescent)_froglight|raw_iron_block|raw_gold_block|resin_block|resin_bricks|chiseled_resin_bricks|powder_snow|(.+_)?(planks|log|stem|wood|hyphae|leaves)|bamboo_block|stripped_bamboo_block|bamboo_mosaic|quartz_bricks|(.+_)?ore)$/;
/** Blocks whose faces follow `pillar_axis`. */
const PILLAR = /(_log|_stem|_wood|_hyphae|_froglight)$|^(basalt|polished_basalt|deepslate|infested_deepslate|muddy_mangrove_roots|bamboo_block|stripped_bamboo_block)$/;
const MODERN_ALIAS: Record<string, string> = { honeycomb_block: 'honeycomb', copper: 'copper_block', rooted_dirt: 'dirt_with_roots' };

/**
 * Cube textures for blocks that are not in the 1.14-era table, found by file name (`target_top`, `copper_bulb`,
 * `deepslate/deepslate_top` …). Used for packs that only replace image files (no `terrain_texture.json` entries for
 * newer blocks), e.g. Faithful. Returns `undefined` — i.e. "unknown block" — when no texture file matches.
 */
function modernCube(name: string, stack: ResourceStack): CubeSpec | undefined {
  const n0 = name.replace(/^waxed_/, '');
  const n = n0;
  const tex = MODERN_ALIAS[n] ?? n;           // texture-file name when it differs from the block id
  const has = (k: string) => stack.hasTexture(k);
  if (n === 'target') {
    return has('target_side') && has('target_top') ? { ...column('target_side', 'target_top', 'target_top') } : undefined;
  }
  if (!/^(muddy_)?mangrove_roots$/.test(n) && (NOT_A_CUBE.test(n) || !CUBE_FAMILY.test(n))) return undefined;
  const pillar = PILLAR.test(n);
  // wood blocks: bark on all six sides for `_wood` / `_hyphae`
  let m: RegExpMatchArray | null;
  if ((m = n.match(/^(stripped_)?(.+?)_(wood|hyphae)$/))) {
    const [, stripped, kind, ] = m;
    const log = m[3] === 'hyphae' ? 'stem' : 'log';
    for (const cand of [`${stripped ?? ''}${kind}_${log}_side`, `${stripped ?? ''}${kind}_${log === 'log' ? 'stem' : 'log'}_side`]) if (has(cand)) return { ...solid(cand), pillar: true };
    return undefined;
  }
  const sideKeys = [`${tex}_side`, tex, ...(n.endsWith('_stem') ? [`${n.replace(/_stem$/, '_log')}_side`] : []), ...(n.endsWith('_log') ? [`${n.replace(/_log$/, '_stem')}_side`] : [])];
  const topKeys = [`${tex}_top`, ...(n.endsWith('_stem') ? [`${n.replace(/_stem$/, '_log')}_top`] : []), ...(n.endsWith('_log') ? [`${n.replace(/_log$/, '_stem')}_top`] : [])];
  const side = sideKeys.find(has) ?? (/_leaves$/.test(n) && has(`${n}_opaque`) ? `${n}_opaque` : undefined);
  if (!side) return undefined;
  const top = topKeys.find(has);
  const leaves = /_leaves$/.test(n);
  const tint = leafTints(n);
  if (leaves) return { faces: all6(side), tint, cullSame: false };
  const grate = /copper_grate$|^mangrove_roots$/.test(n);
  if (top) {
    const bottomKey = /nylium$/.test(n) ? 'netherrack' : has(`${tex}_bottom`) ? `${tex}_bottom` : top;
    return { ...column(side, top, bottomKey), pillar, opaque: !grate };
  }
  return { ...solid(side), pillar, opaque: !grate };
}

const NAME_ALIASES: Record<string, string[]> = {
  stone_brick: ['stone_bricks'], brick: ['bricks'], mossy_stone_brick: ['mossy_stone_bricks'],
  stone: ['stone'], normal_stone: ['stone'], stone_block: ['smooth_stone'], smooth_stone: ['smooth_stone'],
  quartz: ['quartz_block'], smooth_quartz: ['smooth_quartz'], purpur: ['purpur_block'],
  end_stone_brick: ['end_stone_bricks'], prismarine_brick: ['prismarine_bricks'], petrified_oak: ['oak_planks'],
  cut_sandstone: ['cut_sandstone'], cut_red_sandstone: ['cut_red_sandstone'], red_nether_brick: ['red_nether_brick'],
};

/**
 * Texture set for a *base* block name such as `oak`, `cobblestone` or `stone_brick`
 * (the part in front of `_stairs`, `_slab`, `_wall` …).
 */
export function baseCube(base: string, stack: ResourceStack): CubeSpec | undefined {
  const candidates = [...(NAME_ALIASES[base] ?? []), base, `${base}_planks`, `${base}_block`, `${base}s`, `${base}_bricks`];
  for (const c of candidates) { const s = lookupCube(c, stack); if (s) return s; }
  return undefined;
}

export function cubeSpec(name: string, stack: ResourceStack): CubeSpec | undefined {
  return lookupCube(name, stack);
}

/** Cube model for a spec, applying `pillar_axis` when the spec is a pillar. */
export function specToModel(spec: CubeSpec, states: Record<string, StateValue> = {}): BlockModel {
  const tint: Partial<Record<Dir, Tint>> | undefined = spec.tint;
  const m = cubeModel(spec.faces as FaceTextures, {
    opaque: spec.opaque ?? false,
    layer: spec.layer, emissive: spec.emissive, cullSame: spec.cullSame, alpha: spec.alpha, static: true,
  });
  if (tint) for (const d of DIRS) { const f = m.elements[0].faces[d]; if (f && tint[d]) f.tint = tint[d]; }
  if (spec.pillar) {
    const axis = st(states, 'pillar_axis');
    if (axis === 'x') { m.rotX = 90; m.rotY = 90; }
    else if (axis === 'z') { m.rotX = 90; }
  }
  return m;
}

/** Rotate a model so that its default `from` direction faces `to`. */
export function oriented(model: BlockModel, from: Dir, to: Dir): BlockModel {
  const { x, y } = orientTo(from, to);
  return { ...model, rotX: x, rotY: y };
}

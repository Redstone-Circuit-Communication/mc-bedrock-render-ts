/**
 * Writing the sample structures the way the game writes them: blocks with all their states, entities with the game's
 * fields, block entities for the blocks that have them. Shared by scripts/generate-coverage-structures.ts and tools that
 * write test structures.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { buildMcStructure, StateInput } from '../../src/renderer/structure';
import { T, Tagged } from '../../src/renderer/nbt';
import { attributeList, PropertyValue, SpawnDefaults } from './entity-defaults';

/**
 * Every block is written with all of its states, as the game writes them: a block saved without states drew all of its
 * variants at once. Mojang's block metadata for the pack's release lists each block's states and their values; the first
 * value is the game's default. Written states override the defaults; a state the block does not have is reported.
 */
const BLOCK_METADATA = 'https://cdn.jsdelivr.net/gh/Mojang/bedrock-samples@v1.26.60.5/metadata/vanilladata_modules/mojang-blocks.json';
type Property = { type: string; values: (string | number | boolean)[] };
let blockStates = new Map<string, Map<string, Property>>();
export const unknownStates = new Set<string>();
export async function loadBlockStates() {
  const file = join('.cache', 'mojang-blocks-v1.26.60.5.json');
  if (!existsSync(file)) {
    const response = await fetch(BLOCK_METADATA);
    if (!response.ok) throw new Error(`cannot download ${BLOCK_METADATA}: HTTP ${response.status}`);
    mkdirSync('.cache', { recursive: true });
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const meta = JSON.parse(readFileSync(file, 'utf8'));
  const props = new Map<string, Property>(meta.block_properties.map((p: any) => [p.name, { type: p.type, values: p.values.map((v: any) => v.value) }]));
  blockStates = new Map(meta.data_items.map((b: any) => [b.name, new Map((b.properties ?? []).map((p: any) => [p.name, props.get(p.name)!]))]));
}
// The scenes name directions in words; a block that stores a direction as a number gets the number the game uses for it
// (pistons and their arms count their faces differently from dispensers, hoppers and the rest), and the reverse.
const FACING = ['down', 'up', 'north', 'south', 'west', 'east'];
const PISTON_FACING = ['down', 'up', 'south', 'north', 'east', 'west'];
const CARDINAL = ['south', 'west', 'north', 'east'];
function asWritten(name: string, props: Map<string, Property>, key: string, value: StateInput): [string, StateInput] {
  if (props.has(key)) return [key, value];
  if (key === 'minecraft:facing_direction' && props.has('facing_direction'))
    return ['facing_direction', (/piston/.test(name) ? PISTON_FACING : FACING).indexOf(String(value))];
  if (key === 'minecraft:cardinal_direction' && props.has('direction')) return ['direction', CARDINAL.indexOf(String(value))];
  if (key === 'direction' && props.has('minecraft:cardinal_direction')) return ['minecraft:cardinal_direction', CARDINAL[Number(value)]];
  return [key, value];
}
function withDefaults(name: string, written: Record<string, StateInput> = {}): Record<string, StateInput> {
  const props = blockStates.get(name);
  if (!props) return written; // an id this release does not list (legacy names): as written
  const states: Record<string, StateInput> = {};
  for (const [key, p] of props) states[key] = p.values[0];
  for (const [k, v] of Object.entries(written)) {
    const [key, value] = asWritten(name, props, k, v);
    const p = props.get(key);
    if (!p) { unknownStates.add(`${name} ${key}`); continue; }
    states[key] = p.type === 'bool' ? Boolean(value) : value;
  }
  return states;
}

/**
 * Entities are written the way the game writes them, and only ones the game can create from saved data: a structure
 * holding a player or a client-only definition (the education `agent`, the `bed` and `skull` renderers) crashed the game
 * when loaded. Which entities are summonable and which are mobs comes from Mojang's behaviour pack of the same release
 * (scripts/data/bedrock-entity-kinds.json, see its "source").
 *
 * A structure is loaded without running the spawn event, and a mob's attributes come only from its saved `Attributes`
 * list. Without it the game used the engine's defaults: mobs ran several times too fast and all had the same health. So
 * every entity is written in the state the spawn event leaves it in — its component groups, attributes, entity
 * properties and variants — taken from the behaviour pack by scripts/extract-entity-data.ts
 * (scripts/data/bedrock-entity-spawn.json). The fields follow game-saved structures (tests/entity-nbt.test.ts compares
 * them with mobs the game saved).
 */
const KINDS: Record<string, { summonable: boolean; living: boolean }> = JSON.parse(readFileSync(join('scripts', 'data', 'bedrock-entity-kinds.json'), 'utf8')).entities;
type Spawned = SpawnDefaults & { young?: SpawnDefaults };
const SPAWN: Record<string, Spawned> = JSON.parse(readFileSync(join('scripts', 'data', 'bedrock-entity-spawn.json'), 'utf8')).entities;
/** Kept in every world although `/summon` does not take these names (villagers since 1.10). */
const SAVED_IN_WORLDS = new Set(['minecraft:villager_v2', 'minecraft:zombie_villager_v2']);
/** Made by the game's code rather than a behaviour file; the game saves them with an empty `definitions` list. */
const BUILT_IN = new Set(['minecraft:painting', 'minecraft:item', 'minecraft:falling_block']);
/** Why an entity cannot go into a structure the game loads, or null when it can. */
export function unwritable(id: string): string | null {
  if (BUILT_IN.has(id) || SAVED_IN_WORLDS.has(id)) return null;
  if (!KINDS[id]) return 'no behaviour definition (client-only)';
  return KINDS[id].summonable ? null : 'not summonable';
}
const slot = (name = '', extra: Record<string, Tagged> = {}) =>
  T.compound({ Count: T.byte(name ? 1 : 0), Damage: T.short(0), Name: T.string(name ? 'minecraft:' + name : ''), WasPickedUp: T.byte(0), ...extra });
const FLAGS = ['Chested', 'Color', 'Color2', 'Invulnerable', 'IsAngry', 'IsAutonomous', 'IsBaby', 'IsEating', 'IsGliding', 'IsGlobal', 'IsIllagerCaptain', 'IsOrphaned', 'IsOutOfControl', 'IsRoaring', 'IsScared', 'IsStunned', 'IsSwimming', 'IsTamed', 'IsTrusting', 'LootDropped', 'Saddled', 'Sheared', 'ShowBottom', 'Sitting'];
export const definitions = (...groups: string[]) => T.list('string', groups.map((g) => T.string(g)));
/** The game's version string in the inventories it writes (from a structure the game saved). */
const INVENTORY_VERSION = '1.26.51';
/** A container entity's inventory as the game writes it: every slot, empty ones too, and the version that wrote it. */
const inventory = (slots: number) => ({
  ChestItems: T.list('compound', [...Array(slots).keys()].map((n) => T.compound({ Count: T.byte(0), Damage: T.short(0), Name: T.string(''), Slot: T.byte(n), WasPickedUp: T.byte(0) }))),
  InventoryVersion: T.string(INVENTORY_VERSION),
});
/** Fields the game writes for boats besides the common ones (from game-saved boats). */
const vehicle = () => ({ LeasherID: T.long(-1n), TradeExperience: T.int(0), TradeTier: T.int(0), canPickupItems: T.byte(1), hasSetCanPickupItems: T.byte(1) });
/** Data some entities need besides the common fields. */
const ACTOR_DATA: Record<string, () => Record<string, Tagged>> = {
  'minecraft:chest_minecart': () => inventory(27),
  'minecraft:hopper_minecart': () => inventory(5),
  'minecraft:boat': vehicle,
  'minecraft:chest_boat': () => ({ ...vehicle(), ...inventory(27) }),
  'minecraft:armor_stand': () => ({ Pose: T.compound({ LastSignal: T.int(0), PoseIndex: T.int(0) }) }),
  'minecraft:tnt': () => ({ Fuse: T.byte(80) }),
  'minecraft:xp_orb': () => ({ Age: T.short(0), 'experience value': T.int(3) }),
  'minecraft:item': () => ({ Item: slot('diamond'), Age: T.short(0), Health: T.short(5), OwnerID: T.long(-1n) }),
  'minecraft:falling_block': () => ({ FallingBlock: T.compound({ name: T.string('minecraft:sand'), states: T.compound({}), version: T.int(18168865) }), Time: T.byte(0) }),
  'minecraft:painting': () => ({ Motive: T.string('Kebab'), Direction: T.byte(0) }),
  'minecraft:bat': () => ({ BatFlags: T.byte(0) }),
  'minecraft:ender_dragon': () => ({ LastDimensionId: T.int(0) }),
};
/**
 * What a mob holds after spawning. The game rolls it from a loot table; these are the usual picks, so the mobs that
 * fight with them can (a skeleton without its bow has no ranged attack). Piglins follow their spawn group (ranged or
 * melee).
 */
function mainhand(id: string, groups: string[]): string {
  switch (id) {
    case 'minecraft:skeleton': case 'minecraft:stray': case 'minecraft:bogged': case 'minecraft:parched': return 'bow';
    case 'minecraft:wither_skeleton': return 'stone_sword';
    case 'minecraft:pillager': return 'crossbow';
    case 'minecraft:vindicator': return 'iron_axe';
    case 'minecraft:vex': return 'iron_sword';
    case 'minecraft:zombie_pigman': return 'golden_sword';
    case 'minecraft:piglin_brute': return 'golden_axe';
    case 'minecraft:piglin': return groups.includes('+ranged_unit') ? 'crossbow' : 'golden_sword';
    default: return '';
  }
}
/** Skeletons also save what they hold as `ItemInHand` (game-saved skeletons do). */
const ITEM_IN_HAND = new Set(['minecraft:skeleton', 'minecraft:stray', 'minecraft:bogged', 'minecraft:parched', 'minecraft:wither_skeleton']);
/** Mobs the game saves without these fields (game-saved bats and ender dragons). */
const NO_EXP_DROP = new Set(['minecraft:bat', 'minecraft:ender_dragon', 'minecraft:armor_stand']);
const NO_AIR = new Set(['minecraft:armor_stand', 'minecraft:ender_dragon']);
const FLOAT32_MAX = 3.4028234663852886e38;
const propertyTag = (p: PropertyValue): Tagged =>
  p.type === 'bool' ? T.byte(p.value ? 1 : 0) : p.type === 'int' ? T.int(Number(p.value)) : p.type === 'float' ? T.float(Number(p.value)) : T.string(String(p.value));
/**
 * Entities whose saved position is above the surface they stand on, as the game writes them: a minecart's is 0.35 higher
 * (without it the minecart sank into the floor and fell through when loaded), a dropped item's 0.125.
 */
const POS_Y_OFFSET: Record<string, number> = {
  'minecraft:minecart': 0.35, 'minecraft:chest_minecart': 0.35, 'minecraft:hopper_minecart': 0.35, 'minecraft:tnt_minecart': 0.35,
  'minecraft:command_block_minecart': 0.35, 'minecraft:item': 0.125,
};
export interface EntityOptions {
  /** The state of a baby of the entity (its spawn event's baby branch) instead of an adult. */
  baby?: boolean;
}
function actor(id: string, uniqueId: bigint, pos: [number, number, number], yaw: number, extra: Record<string, Tagged>, opts: EntityOptions): Record<string, Tagged> {
  const entry = SPAWN[id];
  if (!entry && !BUILT_IN.has(id)) throw new Error(`${id}: no spawn data in scripts/data/bedrock-entity-spawn.json (run pnpm data:entities)`);
  const sp: SpawnDefaults = (opts.baby ? entry?.young : entry) ?? entry ?? { definitions: [] };
  if (opts.baby && !entry?.young) throw new Error(`${id}: the spawn event makes no baby`);
  const living = KINDS[id]?.living ?? false;
  const nbt: Record<string, Tagged> = {
    ...Object.fromEntries(FLAGS.map((k) => [k, T.byte(0)])),
    Color: T.byte(sp.color ?? 0), Color2: T.byte(sp.color2 ?? 0), IsBaby: T.byte(sp.baby ? 1 : 0),
    FallDistance: T.float(0), MarkVariant: T.int(sp.mark_variant ?? 0), OnGround: T.byte(1),
    OwnerNew: T.long(-1n), PortalCooldown: T.int(0), Pos: T.list('float', [pos[0], pos[1] + (POS_Y_OFFSET[id] ?? 0), pos[2]].map((v) => T.float(v))), Rotation: T.list('float', [T.float(yaw), T.float(0)]),
    SkinID: T.int(sp.skin_id ?? 0), Strength: T.int(sp.strength?.[0] ?? 0), StrengthMax: T.int(sp.strength?.[1] ?? 0), Tags: T.list('string', []), UniqueID: T.long(uniqueId), Variant: T.int(sp.variant ?? 0),
    definitions: definitions(...sp.definitions), identifier: T.string(id), internalComponents: T.compound({}),
  };
  // the game writes a motion for entities that are not resting on the ground; mobs stand on the floor
  if (!living) nbt.Motion = T.list('float', [T.float(0), T.float(0), T.float(0)]);
  if (living) {
    const groups = sp.definitions;
    const hand = mainhand(id, groups);
    Object.assign(nbt, {
      Air: T.short(300), Armor: T.list('compound', [0, 1, 2, 3, 4].map(() => slot())), Dead: T.byte(0), DeathTime: T.short(0), HurtTime: T.short(0),
      IsPregnant: T.byte(0), LeasherID: T.long(-1n), Mainhand: T.list('compound', [slot(hand)]), Offhand: T.list('compound', [slot()]),
      NaturalSpawn: T.byte(0), Persistent: T.byte(1), Surface: T.byte(0), TargetID: T.long(-1n), TradeExperience: T.int(0), TradeTier: T.int(0),
      boundX: T.int(0), boundY: T.int(0), boundZ: T.int(0), canPickupItems: T.byte(0), hasBoundOrigin: T.byte(0), hasSetCanPickupItems: T.byte(1),
      expDropEnabled: T.byte(1),
    });
    if (hand && ITEM_IN_HAND.has(id)) nbt.ItemInHand = slot(hand);
    if (sp.families?.includes('monster') || id === 'minecraft:ender_dragon') nbt.SpawnedByNight = T.byte(0);
    if (sp.components?.includes('minecraft:breedable')) Object.assign(nbt, { BreedCooldown: T.int(0), InLove: T.int(0), LoveCause: T.long(0n) });
    if (sp.components?.includes('minecraft:tamemount')) Object.assign(nbt, { Temper: T.int(0), SkipBodySlotUpgrade: T.byte(1) });
    if (NO_EXP_DROP.has(id)) delete nbt.expDropEnabled;
    if (NO_AIR.has(id)) delete nbt.Air;
    if (!sp.attributes) throw new Error(`${id}: a mob without attributes in the spawn data`);
    nbt.Attributes = T.list('compound', attributeList(sp.attributes).map((a) => T.compound({
      Base: T.float(a.Base), Current: T.float(a.Current), DefaultMax: T.float(Math.min(a.DefaultMax, FLOAT32_MAX)), DefaultMin: T.float(a.DefaultMin),
      Max: T.float(Math.min(a.Max, FLOAT32_MAX)), Min: T.float(a.Min), Name: T.string(a.Name),
    })));
  }
  if (sp.properties) nbt.properties = T.compound(Object.fromEntries(Object.entries(sp.properties).map(([k, p]) => [k, propertyTag(p)])));
  if (sp.spawn_entries) nbt.entries = T.list('compound', sp.spawn_entries.map((e) => T.compound({ SpawnTimer: T.int(e.timer), StopSpawning: T.byte(e.stopped ? 1 : 0) })));
  return { ...nbt, ...(ACTOR_DATA[id]?.() ?? {}), ...extra };
}

/**
 * Block entities as the game writes them (the fields of game-saved structures, in the current layout with
 * BlockEntityVersion 0) for the blocks the sample scenes use; the scene's own data goes on top. The game writes one for
 * every such block, and a block saved without it was reset to its default state when loaded (pistons, dispensers and
 * droppers all faced down).
 */
const versioned = () => ({ BlockEntityVersion: T.int(0) });
const container = () => ({ Items: T.list('compound', []) });
const furnace = () => ({ ...versioned(), BurnDuration: T.short(0), BurnTime: T.short(0), CookTime: T.short(0), ...container(), StoredXPInt: T.int(0) });
const BLOCK_ENTITIES: [RegExp, string, () => Record<string, Tagged>][] = [
  [/^minecraft:(sticky_)?piston$/, 'PistonArm', () => ({ AttachedBlocks: T.list('int', []), ...versioned(), BreakBlocks: T.list('int', []), LastProgress: T.float(0), NewState: T.byte(0), Progress: T.float(0), State: T.byte(0), Sticky: T.byte(0), isMovable: T.byte(1) })],
  [/^minecraft:hopper$/, 'Hopper', () => ({ ...versioned(), ...container(), TransferCooldown: T.int(0) })],
  [/^minecraft:dispenser$/, 'Dispenser', () => ({ ...versioned(), ...container() })],
  [/^minecraft:dropper$/, 'Dropper', () => ({ ...versioned(), ...container() })],
  [/^minecraft:(un)?powered_comparator$/, 'Comparator', () => ({ ...versioned(), OutputSignal: T.int(0) })],
  [/^minecraft:daylight_detector(_inverted)?$/, 'DaylightDetector', versioned],
  [/^minecraft:(trapped_chest|chest|(waxed_)?((exposed|weathered|oxidized)_)?copper_chest)$/, 'Chest', () => ({ ...versioned(), Findable: T.byte(0), ...container() })],
  [/^minecraft:ender_chest$/, 'EnderChest', versioned],
  [/^minecraft:barrel$/, 'Barrel', () => ({ ...versioned(), Findable: T.byte(0), ...container() })],
  [/^minecraft:[a-z_]*shulker_box$/, 'ShulkerBox', () => ({ Findable: T.byte(0), ...container(), facing: T.byte(1), isMovable: T.byte(1) })],
  [/^minecraft:(lit_)?furnace$/, 'Furnace', furnace],
  [/^minecraft:(lit_)?blast_furnace$/, 'BlastFurnace', furnace],
  [/^minecraft:(lit_)?smoker$/, 'Smoker', furnace],
  [/^minecraft:brewing_stand$/, 'BrewingStand', () => ({ CookTime: T.short(0), FuelAmount: T.short(0), FuelTotal: T.short(0), ...container(), isMovable: T.byte(1) })],
  [/^minecraft:chiseled_bookshelf$/, 'ChiseledBookshelf', () => ({ ...versioned(), ...container(), LastInteractedSlot: T.int(0) })],
  [/^minecraft:decorated_pot$/, 'DecoratedPot', versioned],
];
/** Bedrock pistons' facing_direction: 0 down, 1 up, 2 south, 3 north, 4 east, 5 west (checked on game-saved pistons). */
const PISTON_STEP: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];

type B = { name: string; states?: Record<string, StateInput> };
export class Scene {
  blocks = new Map<string, B>();
  /** The liquid layer: water a block stands in (corals, kelp, seagrass …). */
  liquids = new Map<string, B>();
  be = new Map<string, Record<string, Tagged>>();
  entities: Record<string, Tagged>[] = [];
  floor: B | null = { name: 'minecraft:stone' };
  /** 1 (default): what the samples have always been; 2: the layout the game writes now (see `BuildOptions.formatVersion`). */
  formatVersion: 1 | 2 = 1;
  constructor(public size: [number, number, number]) {}
  put(x: number, y: number, z: number, name: string, states: Record<string, StateInput> = {}, nbt?: Record<string, Tagged>) {
    const full = name.includes(':') ? name : 'minecraft:' + name;
    this.blocks.set(`${x},${y},${z}`, { name: full, states: withDefaults(full, states) });
    if (nbt) this.be.set(`${x},${y},${z}`, nbt);
  }
  /** Water in the liquid layer of a cell: the block there stands in it, as the game stores a waterlogged block. */
  water(x: number, y: number, z: number) {
    this.liquids.set(`${x},${y},${z}`, { name: 'minecraft:water', states: withDefaults('minecraft:water', { liquid_depth: 0 }) });
  }
  entity(id: string, x: number, y: number, z: number, yaw = 0, extra: Record<string, Tagged> = {}, opts: EntityOptions = {}) {
    const full = id.includes(':') ? id : 'minecraft:' + id;
    const why = unwritable(full);
    if (why) throw new Error(`${full} cannot go into a structure the game loads: ${why}`);
    // unique ids in the range the game uses: large negative numbers
    this.entities.push(actor(full, -1_000_000_000_000n - BigInt(this.entities.length + 1), [x, y, z], yaw, extra, opts));
  }
  /** The block entity at a cell: the game's fields for the block, an extended piston's arm state, then the scene's data. */
  blockEntity(x: number, y: number, z: number): Record<string, Tagged> | null {
    const block = this.blocks.get(`${x},${y},${z}`), given = this.be.get(`${x},${y},${z}`);
    const kind = block && BLOCK_ENTITIES.find(([pattern]) => pattern.test(block.name));
    if (!kind) return given ?? null;
    const extra: Record<string, Tagged> = {};
    if (kind[1] === 'PistonArm') {
      if (block.name.includes('sticky')) extra.Sticky = T.byte(1);
      const step = PISTON_STEP[Number(block.states?.facing_direction ?? 0)] ?? [0, -1, 0];
      if (/arm_collision$/.test(this.blocks.get(`${x + step[0]},${y + step[1]},${z + step[2]}`)?.name ?? ''))
        // as the game saves an extended piston: fully out, and not movable while extended
        Object.assign(extra, { State: T.byte(2), NewState: T.byte(2), Progress: T.float(1), LastProgress: T.float(1), isMovable: T.byte(0) });
    }
    return { ...kind[2](), ...extra, ...(given ?? {}), id: T.string(kind[1]), x: T.int(x), y: T.int(y), z: T.int(z) };
  }
  bytes(): Uint8Array {
    const floor = this.floor && { name: this.floor.name, states: withDefaults(this.floor.name, this.floor.states) };
    return buildMcStructure({
      size: this.size, entities: this.entities, formatVersion: this.formatVersion,
      // the floor fills y = 0 except where a scene puts a block of its own (a redstone block powering a piston)
      blockAt: (x, y, z) => this.blocks.get(`${x},${y},${z}`) ?? (y === 0 ? floor : null),
      blockEntityAt: (x, y, z) => this.blockEntity(x, y, z),
      liquidAt: (x, y, z) => this.liquids.get(`${x},${y},${z}`) ?? null,
    });
  }
}
/** An inventory item as the game writes it. */
export const item = (slot: number, name: string, count = 1) => T.compound({ Count: T.byte(count), Damage: T.short(0), Name: T.string('minecraft:' + name), Slot: T.byte(slot), WasPickedUp: T.byte(0) });
export const items = (...it: Tagged[]) => ({ Items: T.list('compound', it) });

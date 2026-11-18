/**
 * Old Bedrock block ids → today's ids, for HoloPrint's shape data.
 *
 * Bedrock "flattened" many blocks (1.20.x – 1.21.x): `red_flower` + `flower_type` became `poppy`, `blue_orchid` …, `double_plant`
 * + `double_plant_type` became `sunflower`, `lilac` …, the coral ids lost their colour state. HoloPrint's shape data (and
 * neoHoloprintDB's) only knows the new ids, so an old id matched no shape and fell back to the default full cube: the flower
 * sprite was drawn on all six faces ("a ring of flowers"). Structures saved by older game versions, tools that never
 * upgraded, and the bundled all-blocks demo still use the old ids, so they are translated here before the shape lookup.
 *
 * Only the type state is consumed (`flower_type`, `double_plant_type` …); every other state is kept (`upper_block_bit`,
 * `coral_direction` …). Missing type states take the game's default (the first value). Blocks that only differ by
 * texture (`stone` + `stone_type`, `wool` + `color` …) are not here: HoloPrint resolves those through the pack's
 * blocks.json and its `texture_variants`, which still know the old ids.
 */
export interface LegacyResult {
	name: string;
	states: Record<string, unknown>;
}

const pick = (table: Record<string, string>, value: unknown, fallback: string) => table[String(value)] ?? fallback;
const without = (states: Record<string, unknown>, ...keys: string[]) => {
	const out = { ...states };
	for (const k of keys) delete out[k];
	return out;
};

const RED_FLOWER: Record<string, string> = {
	poppy: 'poppy', orchid: 'blue_orchid', allium: 'allium', houstonia: 'azure_bluet', tulip_red: 'red_tulip', tulip_orange: 'orange_tulip',
	tulip_white: 'white_tulip', tulip_pink: 'pink_tulip', oxeye: 'oxeye_daisy', cornflower: 'cornflower', lily_of_the_valley: 'lily_of_the_valley',
};
const DOUBLE_PLANT: Record<string, string> = { sunflower: 'sunflower', syringa: 'lilac', grass: 'tall_grass', fern: 'large_fern', rose: 'rose_bush', paeonia: 'peony' };
const TALL_GRASS: Record<string, string> = { default: 'short_grass', tall: 'short_grass', fern: 'fern', snow: 'short_grass' };
const SAPLING: Record<string, string> = { oak: 'oak_sapling', spruce: 'spruce_sapling', birch: 'birch_sapling', jungle: 'jungle_sapling', acacia: 'acacia_sapling', roofed_oak: 'dark_oak_sapling' };
/** coral colour → species (the coral ids lost `coral_color` in 1.20.x) */
const CORAL: Record<string, string> = { blue: 'tube', pink: 'brain', purple: 'bubble', red: 'fire', yellow: 'horn' };
/** wall fans: three ids, `coral_hang_type_bit` picks one of their two colours */
const HANG_COLORS: Record<string, string[]> = { coral_fan_hang: ['blue', 'pink'], coral_fan_hang2: ['purple', 'red'], coral_fan_hang3: ['yellow'] };
/** plain renames */
const RENAMED: Record<string, string> = { yellow_flower: 'dandelion', tripWire: 'trip_wire', grass_path: 'dirt_path', seaLantern: 'sea_lantern' };

export function modernBlock(name: string, states: Record<string, unknown> = {}): LegacyResult | undefined {
	if (RENAMED[name]) return { name: RENAMED[name], states };
	switch (name) {
		case 'red_flower':
			return { name: pick(RED_FLOWER, states.flower_type, 'poppy'), states: without(states, 'flower_type') };
		case 'double_plant':
			return { name: pick(DOUBLE_PLANT, states.double_plant_type, 'sunflower'), states: without(states, 'double_plant_type') };
		case 'tallgrass':
			return { name: pick(TALL_GRASS, states.tall_grass_type, 'short_grass'), states: without(states, 'tall_grass_type') };
		case 'sapling':
			return { name: pick(SAPLING, states.sapling_type, 'oak_sapling'), states: without(states, 'sapling_type', 'age_bit') };
	}
	const color = (d = 'blue') => CORAL[String(states.coral_color ?? d)] ?? CORAL[d];
	const dead = Number(states.dead_bit ?? 0) === 1 ? 'dead_' : '';
	if (name === 'coral') return { name: `${dead}${color()}_coral`, states: without(states, 'coral_color', 'dead_bit') };
	if (name === 'coral_block') return { name: `${dead}${color()}_coral_block`, states: without(states, 'coral_color', 'dead_bit') };
	if (name === 'coral_fan') return { name: `${dead}${color()}_coral_fan`, states: without(states, 'coral_color', 'dead_bit') };
	if (name === 'coral_fan_dead') return { name: `dead_${color()}_coral_fan`, states: without(states, 'coral_color', 'dead_bit') };
	if (HANG_COLORS[name]) {
		const c = HANG_COLORS[name];
		return { name: `${dead}${CORAL[c[Number(states.coral_hang_type_bit ?? 0)] ?? c[0]]}_coral_wall_fan`, states: without(states, 'coral_hang_type_bit', 'dead_bit') };
	}
	return undefined;
}

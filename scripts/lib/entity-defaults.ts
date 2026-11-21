/**
 * What an entity looks like right after the game spawns it, worked out from its behaviour-pack file, and the NBT the
 * game writes for it. A structure is loaded without running the spawn event, and a mob's attributes are read from the
 * saved `Attributes` list only: a mob saved without that list got the engine's defaults (it ran several times too fast and
 * every mob had the same health), and one saved without the spawn event's component groups lacked their behaviour.
 *
 * The spawn event is resolved deterministically, so the sample structures do not change from one run to the next:
 *   - `randomize`: the option with the largest weight (the first one on a tie), leaving out options that make a baby or a
 *     jockey when there is another (a strider is a baby more often than not; the samples show adults);
 *   - `first_valid`: the first entry whose filters pass;
 *   - ranges (`range_min` / `range_max`): the middle, health rounded to a whole number;
 *   - filters: evaluated in a fixed setting — normal difficulty, a plains biome by day, nothing riding or targeting;
 *     a test this file does not know counts as false and is reported.
 */

export type PropertyType = 'bool' | 'int' | 'float' | 'enum';
export interface PropertyValue { type: PropertyType; value: boolean | number | string }

/** The attributes the game saves for a mob, before the defaults every mob shares (see `attributeList`). */
export interface AttributeSpec {
  /** [value, max] */
  health: [number, number];
  movement: number;
  underwater_movement?: number;
  lava_movement?: number;
  /** [value, max] */
  follow_range?: [number, number];
  /** [value, max] */
  knockback_resistance?: [number, number];
  /** [min, max]; only mobs with `minecraft:attack` have it */
  attack_damage?: [number, number];
  /** horses, donkeys, mules … */
  jump_strength?: number;
}

export interface SpawnDefaults {
  /** As the game writes them: `+identifier`, then `+group` / `-group` in the order the spawn event applied them. */
  definitions: string[];
  /** Mobs only. */
  attributes?: AttributeSpec;
  properties?: Record<string, PropertyValue>;
  variant?: number;
  mark_variant?: number;
  skin_id?: number;
  color?: number;
  color2?: number;
  baby?: boolean;
  /** [value, max] (llamas) */
  strength?: [number, number];
  /**
   * `minecraft:spawn_entity` entries (a chicken laying eggs, a wandering trader's llamas …): ticks to the next spawn, and
   * whether the entry has stopped. A `single_use` entry fires right after the mob spawns, so it is saved as done (a sample
   * wandering trader would bring two more llamas every time it is loaded).
   */
  spawn_entries?: { timer: number; stopped: boolean }[];
  /** `minecraft:type_family` */
  families?: string[];
  /** Components that decide which fields the game saves (breeding, taming …), when present. */
  components?: string[];
}
/** Components whose presence changes what the game writes for a mob. */
const SAVED_COMPONENTS = ['minecraft:breedable', 'minecraft:tamemount', 'minecraft:is_tamed', 'minecraft:equippable'];

/** The setting the spawn event's filters are evaluated in. */
export interface SpawnContext {
  difficulty: string;
  biomeTags: string[];
  daytime: boolean;
  temperature: number;
  altitude: number;
}
export const DEFAULT_CONTEXT: SpawnContext = {
  difficulty: 'normal', biomeTags: ['overworld', 'plains', 'animal', 'monster'], daytime: true, temperature: 0.8, altitude: 64,
};

const FLT_MAX = 3.4028234663852886e38;
type Json = any;

const isObj = (v: unknown): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** A number or a `{ range_min, range_max }` / `[min, max]` range: its middle. */
function pick(v: Json, d = 0): number {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length === 2) return (num(v[0]) + num(v[1])) / 2;
  if (isObj(v) && ('range_min' in v || 'range_max' in v)) return (num(v.range_min) + num(v.range_max, num(v.range_min))) / 2;
  return d;
}
const round = (n: number, digits = 6) => Number(n.toFixed(digits));

/** Mojang's JSON allows comments and the odd trailing comma. */
export function parseLenientJson(text: string): Json {
  let out = '', i = 0, inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); i = i < 0 ? text.length : i + 2; continue; }
    out += c;
    i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** A literal value of `set_property` or a property default; Molang expressions give undefined. */
function literal(v: Json, type: PropertyType, values: Json[] | undefined): boolean | number | string | undefined {
  if (type === 'bool') {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 1) return true;
    if (v === 'false' || v === 0) return false;
    return undefined;
  }
  if (type === 'int' || type === 'float') {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : undefined;
    return n === undefined ? undefined : type === 'int' ? Math.trunc(n) : n;
  }
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/^'(.*)'$/, '$1');
  return values?.includes(s) ? s : undefined;
}

export interface Resolved { defaults: SpawnDefaults; warnings: string[]; components: Record<string, Json> }

/** The spawned state of the entity in a behaviour-pack file (`{ "minecraft:entity": … }`). */
export function spawnDefaults(file: Json, opts: { living?: boolean; context?: SpawnContext; young?: boolean } = {}): Resolved {
  const ctx = opts.context ?? DEFAULT_CONTEXT;
  const ent = file?.['minecraft:entity'];
  if (!isObj(ent)) throw new Error('not a behaviour-pack entity file (no "minecraft:entity")');
  const id = String(ent.description?.identifier ?? '');
  const groups: Record<string, Json> = isObj(ent.component_groups) ? ent.component_groups : {};
  const events: Record<string, Json> = isObj(ent.events) ? ent.events : {};
  const base: Record<string, Json> = isObj(ent.components) ? ent.components : {};
  const warnings: string[] = [];
  const warn = (w: string) => { if (!warnings.includes(w)) warnings.push(w); };

  const log: string[] = ['+' + id];
  const active: string[] = [];
  const merged = () => {
    const c: Record<string, Json> = { ...base };
    for (const g of active) Object.assign(c, isObj(groups[g]) ? groups[g] : {});
    return c;
  };

  // entity properties: their defaults, then what the spawn event sets
  const propDefs: Record<string, Json> = isObj(ent.description?.properties) ? ent.description.properties : {};
  const props = new Map<string, PropertyValue>();
  for (const [name, p] of Object.entries(propDefs)) {
    const type = String(p?.type ?? '') as PropertyType;
    if (!['bool', 'int', 'float', 'enum'].includes(type)) { warn(`property ${name}: unknown type ${p?.type}`); continue; }
    const values = Array.isArray(p.values) ? p.values : undefined;
    let value = literal(p.default, type, values);
    if (value === undefined) {
      if (p.default !== undefined) warn(`property ${name}: default ${JSON.stringify(p.default)} is not a literal, used the first allowed value`);
      value = type === 'bool' ? false : type === 'enum' ? String(values?.[0] ?? '') : Array.isArray(p.range) ? num(p.range[0]) : 0;
    }
    props.set(name, { type, value });
  }

  const compare = (actual: Json, op: string, expected: Json): boolean => {
    switch (op) {
      case 'not': case '!=': case '<>': return actual !== expected;
      case '<': return actual < expected;
      case '<=': return actual <= expected;
      case '>': return actual > expected;
      case '>=': return actual >= expected;
      default: return actual === expected; // equals, ==, =, is
    }
  };
  const test = (f: Record<string, Json>): boolean => {
    if ('all_of' in f) return [f.all_of].flat().every((x: Json) => filter(x));
    if ('any_of' in f) return [f.any_of].flat().some((x: Json) => filter(x));
    if ('none_of' in f) return ![f.none_of].flat().some((x: Json) => filter(x));
    const name = String(f.test ?? '');
    const op = String(f.operator ?? 'equals');
    if ((f.subject ?? 'self') !== 'self') return false; // nothing else is there when a mob spawns on its own
    const c = merged();
    const v = f.value;
    switch (name) {
      case 'is_difficulty': return compare(ctx.difficulty, op, v);
      case 'has_biome_tag': return compare(ctx.biomeTags.includes(String(v)), op, true);
      case 'is_biome': return compare(ctx.biomeTags.includes(String(v)), op, true);
      case 'is_daytime': return compare(ctx.daytime, op, v ?? true);
      case 'is_temperature_value': return compare(ctx.temperature, op, num(v));
      case 'is_temperature_type': return compare('medium', op, v);
      case 'is_altitude': return compare(ctx.altitude, op, num(v));
      case 'is_snow_covered': case 'is_underground': case 'has_equipment': case 'is_game_rule': case 'is_underwater': case 'in_water': case 'in_water_or_rain': case 'in_lava': case 'is_riding':
      case 'has_target': case 'is_leashed': case 'has_rider': case 'is_sleeping': case 'in_nether': case 'in_overworld':
        return compare(name === 'in_overworld', op, v ?? true);
      case 'random_chance': return num(v, 2) <= 1; // 1 in N: only a certainty counts
      case 'has_component': return compare(String(v) in c, op, true);
      case 'is_family': return compare([c['minecraft:type_family']?.family ?? []].flat().includes(String(v)), op, true);
      case 'is_variant': return compare(num(c['minecraft:variant']?.value), op, num(v));
      case 'is_mark_variant': return compare(num(c['minecraft:mark_variant']?.value), op, num(v));
      case 'is_skin_id': return compare(num(c['minecraft:skin_id']?.value), op, num(v));
      case 'is_color': return compare(num(c['minecraft:color']?.value), op, v);
      case 'is_baby': return compare('minecraft:is_baby' in c, op, v ?? true);
      case 'has_property': return compare(props.has(String(v)), op, true);
      case 'bool_property': case 'int_property': case 'float_property': case 'enum_property': {
        const p = props.get(String(f.domain));
        if (!p) return false;
        return compare(p.value, op, name === 'bool_property' ? (v ?? true) : v);
      }
      default:
        warn(`filter test "${name}" is not evaluated (counted as false)`);
        return false;
    }
  };
  const filter = (f: Json): boolean => (Array.isArray(f) ? f.every(filter) : isObj(f) ? test(f) : true);

  const apply = (node: Json, depth: number): void => {
    if (!isObj(node)) return;
    if (depth > 24) { warn('events nested too deep'); return; }
    if (node.filters && !filter(node.filters)) return;
    for (const g of [node.remove?.component_groups ?? []].flat()) {
      log.push('-' + g);
      const i = active.indexOf(g);
      if (i >= 0) active.splice(i, 1);
    }
    for (const g of [node.add?.component_groups ?? []].flat()) {
      // the game leaves a group the file does not define out of the saved list (zombies add `minecraft:on_foot`)
      if (!(g in groups)) { warn(`component group ${g} is added but not defined (left out, as the game does)`); continue; }
      log.push('+' + g);
      const i = active.indexOf(g);
      if (i >= 0) active.splice(i, 1);
      active.push(g);
    }
    if (isObj(node.set_property)) for (const [name, raw] of Object.entries(node.set_property)) {
      const p = props.get(name);
      if (!p) { warn(`set_property of unknown property ${name}`); continue; }
      const value = literal(raw, p.type, propDefs[name]?.values);
      if (value === undefined) warn(`set_property ${name}: ${JSON.stringify(raw)} is not a literal, kept ${JSON.stringify(p.value)}`);
      else p.value = value;
    }
    if (Array.isArray(node.randomize) && node.randomize.length) {
      // `young`: the baby instead (a sample ghastling)
      const young = (o: Json) => /baby|jockey/.test(JSON.stringify([o?.trigger ?? null, o?.add ?? null]));
      const baby = (o: Json) => /baby/.test(JSON.stringify([o?.trigger ?? null, o?.add ?? null])) && !/jockey/.test(JSON.stringify(o?.trigger ?? ''));
      const options = opts.young && node.randomize.some(baby) ? node.randomize.filter(baby)
        : node.randomize.some((o: Json) => !young(o)) ? node.randomize.filter((o: Json) => !young(o)) : node.randomize;
      let best = options[0];
      for (const o of options) if (num(o?.weight, 1) > num(best?.weight, 1)) best = o;
      apply(best, depth + 1);
    }
    if (Array.isArray(node.sequence)) for (const s of node.sequence) apply(s, depth + 1);
    // the first entry whose filters pass
    if (Array.isArray(node.first_valid)) {
      const first = node.first_valid.find((o: Json) => isObj(o) && (!o.filters || filter(o.filters)));
      if (first) apply({ ...first, filters: undefined }, depth + 1);
    }
    if (node.trigger) {
      const t = typeof node.trigger === 'string' ? { event: node.trigger } : node.trigger;
      if ((t.target ?? 'self') === 'self') {
        if (events[t.event]) apply(events[t.event], depth + 1);
        else warn(`trigger of unknown event ${t.event}`);
      }
    }
  };
  if (events['minecraft:entity_spawned']) apply(events['minecraft:entity_spawned'], 0);

  const c = merged();
  const d: SpawnDefaults = { definitions: log };
  if (opts.living) {
    const h = c['minecraft:health'];
    if (!isObj(h)) warn('a mob without minecraft:health');
    const hv = Math.round(pick(h?.value, 20));
    const mv = c['minecraft:movement'];
    const a: AttributeSpec = {
      health: [hv, Math.round(typeof h?.max === 'number' ? h.max : hv)],
      movement: round(pick(isObj(mv) ? mv.value : mv, 0)),
    };
    const one = (key: string) => {
      const x = c[key];
      return x === undefined ? undefined : round(pick(isObj(x) ? x.value : x));
    };
    const uw = one('minecraft:underwater_movement'); if (uw !== undefined) a.underwater_movement = uw;
    const lava = one('minecraft:lava_movement'); if (lava !== undefined) a.lava_movement = lava;
    const fr = c['minecraft:follow_range'];
    if (fr !== undefined) {
      const v = round(pick(isObj(fr) ? fr.value : fr, 16));
      a.follow_range = [v, round(isObj(fr) && typeof fr.max === 'number' ? fr.max : 2048)];
    }
    const kb = c['minecraft:knockback_resistance'];
    if (kb !== undefined) {
      const v = round(pick(isObj(kb) ? kb.value : kb, 0));
      a.knockback_resistance = [v, round(isObj(kb) && typeof kb.max === 'number' ? kb.max : Math.max(1, v))];
    }
    const at = c['minecraft:attack'];
    if (isObj(at) && at.damage !== undefined) {
      const dmg = at.damage;
      a.attack_damage = Array.isArray(dmg) ? [num(dmg[0]), num(dmg[1], num(dmg[0]))]
        : isObj(dmg) ? [num(dmg.range_min), num(dmg.range_max, num(dmg.range_min))] : [num(dmg), num(dmg)];
    }
    const js = c['minecraft:horse.jump_strength'];
    if (js !== undefined) a.jump_strength = round(pick(isObj(js) ? js.value : js));
    d.attributes = a;
  }
  if (props.size) d.properties = Object.fromEntries(props);
  const value = (key: string) => (isObj(c[key]) && typeof c[key].value === 'number' ? c[key].value : undefined);
  const vv = value('minecraft:variant'); if (vv !== undefined) d.variant = vv;
  const mk = value('minecraft:mark_variant'); if (mk !== undefined) d.mark_variant = mk;
  const sk = value('minecraft:skin_id'); if (sk !== undefined) d.skin_id = sk;
  const co = value('minecraft:color'); if (co !== undefined) d.color = co;
  const c2 = value('minecraft:color2'); if (c2 !== undefined) d.color2 = c2;
  if ('minecraft:is_baby' in c) d.baby = true;
  const st = c['minecraft:strength'];
  if (isObj(st)) d.strength = [Math.round(pick(st.value, 0)), Math.round(num(st.max, pick(st.value, 0)))];
  const se = c['minecraft:spawn_entity'];
  if (se !== undefined) {
    const entries = isObj(se) && 'entities' in se ? [se.entities].flat() : [se].flat();
    d.spawn_entries = entries.filter(isObj).map((e) => e.single_use
      ? { timer: 0, stopped: true }
      : { timer: Math.round(((num(e.min_wait_time, 300) + num(e.max_wait_time, 600)) / 2) * 20), stopped: false });
  }
  const fam = c['minecraft:type_family']?.family;
  if (Array.isArray(fam) && fam.length) d.families = fam.map(String);
  const saved = SAVED_COMPONENTS.filter((k) => k in c);
  if (saved.length) d.components = saved;
  return { defaults: d, warnings, components: c };
}

export type AttributeEntry = { Name: string; Base: number; Current: number; Min: number; Max: number; DefaultMin: number; DefaultMax: number };

/** The `Attributes` list in the order and with the bounds the game writes (compared with game-saved mobs). */
export function attributeList(a: AttributeSpec): AttributeEntry[] {
  const at = (name: string, value: number, min: number, max: number): AttributeEntry =>
    ({ Name: 'minecraft:' + name, Base: value, Current: value, Min: min, Max: max, DefaultMin: min, DefaultMax: max });
  const out = [
    at('health', a.health[0], 0, a.health[1]),
    at('follow_range', a.follow_range?.[0] ?? 16, 0, a.follow_range?.[1] ?? 2048),
    at('knockback_resistance', a.knockback_resistance?.[0] ?? 0, -2, a.knockback_resistance?.[1] ?? 1),
    at('movement', a.movement, 0, FLT_MAX),
    at('underwater_movement', a.underwater_movement ?? 0.02, 0, FLT_MAX),
    at('lava_movement', a.lava_movement ?? 0.02, 0, FLT_MAX),
  ];
  if (a.attack_damage) out.push({ ...at('attack_damage', a.attack_damage[0], a.attack_damage[0], a.attack_damage[1]) });
  out.push(at('absorption', 0, 0, 16), at('luck', 0, -1024, 1024));
  if (a.jump_strength !== undefined) out.push(at('horse.jump_strength', a.jump_strength, 0, FLT_MAX));
  out.push(at('friction_modifier', 1, 0, 256), at('bounciness', 0, 0, 1), at('air_drag_modifier', 1, 0, 256));
  return out;
}

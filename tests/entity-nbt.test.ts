/**
 * The entities and piston block entities that scripts/lib/scene.ts writes, compared with ones the game saved
 * (tests/fixtures/game-saved-entities.mcstructure: a structure exported from the game, 1.26.51, holding chickens, creepers,
 * skeletons, zombies, spiders, bats, horses, an ender dragon, boats, chest boats, an experience orb, five retracted
 * and five extended pistons and dispensers facing every way). Also the spawn-event resolution of
 * scripts/lib/entity-defaults.ts, and the sample structures as published.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Scene } from '../scripts/lib/scene';
import { spawnDefaults } from '../scripts/lib/entity-defaults';
import { fields, items, readTypedNbt, TypedTag } from './helpers/typed-nbt';

const GAME = readTypedNbt(new Uint8Array(readFileSync('tests/fixtures/game-saved-entities.mcstructure')));
const structureOf = (root: TypedTag) => fields(fields(root).structure);
const gameEntities = items(structureOf(GAME).entities).map(fields);
const firstOf = (id: string) => gameEntities.find((e) => (e.identifier as any)?.v === id)!;
const str = (t: TypedTag | undefined) => (t?.t === 'string' ? t.v : '');
const defs = (e: Record<string, TypedTag>) => items(e.definitions).map(str);

function written(id: string): Record<string, TypedTag> {
  const s = new Scene([3, 3, 3]);
  s.entity(id, 1.5, 1, 1.5);
  return fields(items(structureOf(readTypedNbt(s.bytes())).entities)[0]);
}

/**
 * Fields that depend on what happened to the entity in the world rather than on what it is: riders (`LinksTag`), a motion
 * while it was in the air, and `Persistent`, which the samples set so their mobs do not despawn.
 */
const SITUATIONAL = new Set(['LinksTag', 'Motion', 'Persistent']);
const SAVED = ['minecraft:chicken', 'minecraft:creeper', 'minecraft:skeleton', 'minecraft:zombie', 'minecraft:spider', 'minecraft:bat',
  'minecraft:horse', 'minecraft:ender_dragon', 'minecraft:boat', 'minecraft:chest_boat', 'minecraft:xp_orb'];

test('entities are written with the fields and tag types the game saves', () => {
  for (const id of SAVED) {
    const game = firstOf(id), ours = written(id);
    assert.ok(game, `${id} in the fixture`);
    const missing = Object.keys(game).filter((k) => !(k in ours) && !SITUATIONAL.has(k));
    const extra = Object.keys(ours).filter((k) => !(k in game) && !SITUATIONAL.has(k));
    assert.deepEqual(missing, [], `${id}: fields the game writes`);
    assert.deepEqual(extra, [], `${id}: fields the game does not write`);
    for (const k of Object.keys(game)) {
      if (!(k in ours)) continue;
      // an empty list's element type is `end` in the game's files and the item type in ours; both load
      const g = game[k], o = ours[k];
      assert.equal(o.t, g.t, `${id}.${k} tag type`);
      if (g.t === 'list' && o.t === 'list' && g.v.length && o.v.length) assert.equal(o.of, g.of, `${id}.${k} list type`);
      if (g.t === 'compound' && k !== 'internalComponents')
        for (const [kk, gv] of Object.entries(g.v)) {
          if (kk === 'tag') continue; // an item's own data (the fixture's skeleton has an enchanted bow)
          assert.equal(fields(o)[kk]?.t, gv.t, `${id}.${k}.${kk} tag type`);
        }
    }
  }
});

test('mobs carry the attribute list the game saves: same attributes, order and bounds, values from the behaviour pack', () => {
  const mobs = SAVED.filter((id) => 'Attributes' in firstOf(id));
  assert.equal(mobs.length, 8);
  for (const id of mobs) {
    const g = items(firstOf(id).Attributes).map(fields), o = items(written(id).Attributes).map(fields);
    assert.deepEqual(o.map((a) => str(a.Name)), g.map((a) => str(a.Name)), `${id}: attribute names and order`);
    g.forEach((ga, i) => {
      const name = str(ga.Name), oa = o[i];
      for (const k of ['Min', 'Max', 'DefaultMin', 'DefaultMax']) {
        assert.equal(oa[k].t, 'float');
        // a horse's health is rolled when it spawns, and becomes its maximum
        if (id === 'minecraft:horse' && name === 'minecraft:health') continue;
        assert.equal((oa[k] as any).v, (ga[k] as any).v, `${id} ${name}.${k}`);
      }
      // the base value (current values in the fixture differ where a mob was hurt); horses roll speed and jump
      if (id !== 'minecraft:horse' && !ga.Modifiers)
        assert.ok(Math.abs((oa.Base as any).v - (ga.Base as any).v) < 1e-6, `${id} ${name}: base ${(oa.Base as any).v} vs ${(ga.Base as any).v}`);
    });
  }
});

test('mobs carry the component groups their spawn event adds, as the game saved them', () => {
  for (const id of ['minecraft:chicken', 'minecraft:creeper', 'minecraft:zombie', 'minecraft:bat', 'minecraft:boat', 'minecraft:chest_boat', 'minecraft:xp_orb'])
    assert.deepEqual(defs(written(id)), defs(firstOf(id)), id);
  // what the fixture's world added later (spiders turn hostile at night, the dragon took off) or chose differently
  // (a hard-difficulty skeleton, a horse's random coat)
  assert.deepEqual(defs(written('minecraft:spider')), defs(firstOf('minecraft:spider')).slice(0, 2));
  assert.deepEqual(defs(written('minecraft:ender_dragon')), defs(firstOf('minecraft:ender_dragon')).slice(0, 2));
  assert.deepEqual(defs(written('minecraft:skeleton')), ['+minecraft:skeleton', '+minecraft:ranged_attack']);
  assert.deepEqual(defs(written('minecraft:horse')).slice(0, 3), defs(firstOf('minecraft:horse')).slice(0, 3));
  // entity properties with the game's tag types (the zombie's bool is a byte)
  assert.equal(fields(written('minecraft:zombie').properties)['minecraft:is_riding_zombie_horse'].t, 'byte');
  assert.equal(str(fields(written('minecraft:chicken').properties)['minecraft:climate_variant']), 'temperate');
});

test('a skeleton holds its bow, saved twice as the game does', () => {
  const s = written('minecraft:skeleton');
  assert.equal(str(fields(items(s.Mainhand)[0]).Name), 'minecraft:bow');
  assert.equal(str(fields(s.ItemInHand).Name), 'minecraft:bow');
});

test('pistons: retracted and extended block entities match game-saved ones', () => {
  // the fixture's pistons, keyed by extended or not
  const st = structureOf(GAME);
  const pal = items(fields(fields(st.palette).default).block_palette).map(fields);
  const posData = fields(fields(fields(st.palette).default).block_position_data);
  const layer = items(st.block_indices)[0] as any;
  const game: Record<string, Record<string, TypedTag>> = {};
  for (const [i, entry] of Object.entries(posData)) {
    const be = fields(fields(entry).block_entity_data);
    if (str(be.id) !== 'PistonArm') continue;
    assert.equal(str(pal[layer.v[Number(i)]].name), 'minecraft:piston');
    game[(be.State as any).v === 2 ? 'extended' : 'retracted'] ??= be;
  }
  assert.ok(game.extended && game.retracted);
  // the same two pistons written by a scene: facing east (4), one with its arm out
  const s = new Scene([6, 3, 3]);
  s.put(1, 1, 1, 'piston', { facing_direction: 4 }); s.put(2, 1, 1, 'piston_arm_collision', { facing_direction: 4 });
  s.put(4, 1, 0, 'piston', { facing_direction: 4 });
  const ours = readTypedNbt(s.bytes());
  const oData = fields(fields(fields(structureOf(ours).palette).default).block_position_data);
  const be = (x: number, y: number, z: number) => fields(fields(oData[String((x * 3 + y) * 3 + z)]).block_entity_data);
  for (const [kind, o] of [['extended', be(1, 1, 1)], ['retracted', be(4, 1, 0)]] as const) {
    const g = game[kind];
    assert.deepEqual(Object.keys(o).sort(), Object.keys(g).sort(), `${kind} fields`);
    for (const k of Object.keys(g)) {
      assert.equal(o[k].t, g[k].t, `${kind}.${k} type`);
      if (!['x', 'y', 'z', 'AttachedBlocks', 'BreakBlocks'].includes(k)) assert.deepEqual((o[k] as any).v, (g[k] as any).v, `${kind}.${k}`);
    }
  }
  // the arm itself has no block entity, in the game's files and ours
  assert.equal(Object.keys(be(2, 1, 1)).length, 0);
});

test('spawn events: groups the file does not define are left out, adults preferred, first_valid, literal properties', () => {
  const file = {
    'minecraft:entity': {
      description: { identifier: 'test:mob', properties: { 'test:climate': { type: 'enum', values: ['temperate', 'warm', 'cold'], default: 'temperate' }, 'test:on': { type: 'bool', default: false } } },
      components: { 'minecraft:health': { value: { range_min: 15, range_max: 30 } }, 'minecraft:movement': { value: 0.25 } },
      component_groups: {
        adult: { 'minecraft:attack': { damage: [2, 4] } },
        baby: { 'minecraft:is_baby': {}, 'minecraft:movement': { value: 0.35 } },
        cold: {},
      },
      events: {
        'minecraft:entity_spawned': {
          sequence: [
            { randomize: [{ weight: 40, trigger: 'grow' }, { weight: 50, trigger: 'spawn_baby' }, { weight: 10, trigger: 'spawn_jockey' }] },
            { first_valid: [
              { filters: { test: 'has_biome_tag', value: 'cold' }, add: { component_groups: ['cold'] } },
              { filters: { test: 'is_difficulty', value: 'normal' }, set_property: { 'test:climate': 'warm', 'test:on': true } },
              { set_property: { 'test:climate': 'cold' } },
            ] },
          ],
        },
        grow: { add: { component_groups: ['adult', 'undefined_group'] } },
        spawn_baby: { add: { component_groups: ['baby'] } },
        spawn_jockey: { add: { component_groups: ['baby'] } },
      },
    },
  };
  const { defaults, warnings } = spawnDefaults(file, { living: true });
  assert.deepEqual(defaults.definitions, ['+test:mob', '+adult']);
  assert.ok(warnings.some((w) => w.includes('undefined_group')));
  assert.deepEqual(defaults.attributes, { health: [23, 23], movement: 0.25, attack_damage: [2, 4] });
  assert.deepEqual(defaults.properties, { 'test:climate': { type: 'enum', value: 'warm' }, 'test:on': { type: 'bool', value: true } });
  const young = spawnDefaults(file, { living: true, young: true }).defaults;
  assert.deepEqual(young.definitions, ['+test:mob', '+baby']);
  assert.equal(young.baby, true);
  assert.equal(young.attributes?.movement, 0.35);
});

test('the sample structures: every mob has its attributes and stands on a block, not inside one', () => {
  for (const name of ['all-entities', 'entities-demo', 'five-entities', 'inspection-demo']) {
    const st = structureOf(readTypedNbt(new Uint8Array(readFileSync(`example/public/schematics/${name}.mcstructure`))));
    const [sx, sy, sz] = items(fields(readTypedNbt(new Uint8Array(readFileSync(`example/public/schematics/${name}.mcstructure`)))).size).map((t: any) => t.v);
    const pal = items(fields(fields(st.palette).default).block_palette).map((p) => str(fields(p).name));
    const layer = (items(st.block_indices)[0] as any).v.map((t: any) => (typeof t === 'number' ? t : t.v));
    const blockAt = (x: number, y: number, z: number) =>
      x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 'minecraft:air' : pal[layer[(x * sy + y) * sz + z]];
    for (const e of items(st.entities).map(fields)) {
      const id = str(e.identifier);
      const [x, y, z] = items(e.Pos).map((t: any) => t.v);
      if (id === 'minecraft:painting') continue;
      if ('Air' in e || id === 'minecraft:ender_dragon' || id === 'minecraft:armor_stand') {
        const attrs = items(e.Attributes).map((a) => str(fields(a).Name));
        assert.ok(attrs.includes('minecraft:health') && attrs.includes('minecraft:movement'), `${name}: ${id} has attributes`);
      }
      assert.equal(blockAt(Math.floor(x), Math.floor(y), Math.floor(z)), 'minecraft:air', `${name}: ${id} at ${x},${y},${z} is not inside a block`);
      if (id !== 'minecraft:allay') assert.notEqual(blockAt(Math.floor(x), Math.floor(y) - 1, Math.floor(z)), 'minecraft:air', `${name}: ${id} stands on a block`);
    }
  }
});

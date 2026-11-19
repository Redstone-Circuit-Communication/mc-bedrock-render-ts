import { AnimContext, AnimationLibrary, applyAnimation } from './animation';
import {
  BonePose, Geometry, GeometryLibrary, M, emitGeometry, mulM, rotYM, scaleM, translateM,
} from './geometry';
import { LayerBuilder, MeshLayerData } from './layer';
import { MolangEnv, createMolangEnv, evalMolang, molangNumber, molangTruthy } from './molang';
import { V3 } from './models';
import { DRAGON_MIRRORED } from './geometry';
import { NbtCompound } from './nbt';
import { ResourceStack, perStack } from './resources';
import { McStructure, StateValue } from './structure';
import { BlockRegistry } from './blockutil';
import { createDefaultRegistry } from './blocks';
import { boatTexturePath, boatTextureKey, builtinDraws, heldBlockDraws, installBuiltinGeometries } from './entity-builtin';

// ------------------------------------------------------------- definitions ---

export interface ClientEntityDef {
  identifier: string;
  textures: Record<string, string>;
  geometry: Record<string, string>;
  materials: Record<string, string>;
  renderControllers: (string | Record<string, string>)[];
  animations: Map<string, string>;
  animate: any[];
  initialize: string[];
  preAnimation: string[];
  scale?: string | number;
  /**
   * Format 1.8 entities list the controllers the game plays by itself (`description.animation_controllers`, short name → id);
   * format 1.10 moved them into `animations` + `scripts.animate`. Played only when there is no `scripts.animate`.
   */
  controllers: [string, string][];
}

const lowerKeys = <T>(o: Record<string, T> | undefined): Record<string, T> =>
  Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
const versionKey = (v: unknown): number => {
  const p = String(v ?? '0').split('.').map((x) => parseInt(x, 10) || 0);
  return p[0] * 1e6 + (p[1] ?? 0) * 1e3 + (p[2] ?? 0);
};
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : []);

/** Everything needed to turn an entity identifier into geometry + texture + pose. */
export class EntityLibrary {
  readonly defs = new Map<string, ClientEntityDef>();
  readonly geometries: GeometryLibrary;
  readonly animations: AnimationLibrary;
  readonly renderControllers = new Map<string, any>();
  /** `query.*` names evaluated but not provided by the entity data (they evaluate to 0). */
  readonly unsupportedQueries = new Set<string>();

  constructor(readonly stack: ResourceStack) {
    this.geometries = new GeometryLibrary(stack);
    this.animations = new AnimationLibrary(stack);
    installBuiltinGeometries(this.geometries);

    const versions = new Map<string, number>();
    for (const path of stack.paths('entity/')) {
      if (!path.endsWith('.json')) continue;
      const bytes = stack.get(path);
      if (!bytes) continue;
      let d: any;
      try { d = stack.parseJson(bytes)['minecraft:client_entity']?.description; } catch { continue; }
      if (!d?.identifier) continue;
      const id = String(d.identifier).toLowerCase();
      // several files may define the same entity for different engine versions: keep the newest
      const ver = versionKey(d.min_engine_version);
      if ((versions.get(id) ?? -1) > ver) continue;
      versions.set(id, ver);
      const scripts = d.scripts ?? {};
      this.defs.set(id, {
        identifier: id,
        textures: lowerKeys(d.textures),
        geometry: lowerKeys(d.geometry),
        materials: lowerKeys(d.materials),
        renderControllers: d.render_controllers ?? [],
        animations: new Map(Object.entries<string>(d.animations ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()])),
        animate: scripts.animate ?? [],
        initialize: asList(scripts.initialize),
        preAnimation: asList(scripts.pre_animation),
        scale: scripts.scale,
        controllers: (Array.isArray(d.animation_controllers) ? d.animation_controllers : []).flatMap((e: any) =>
          Object.entries<any>(e && typeof e === 'object' ? e : {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()] as [string, string])),
      });
    }
    for (const path of stack.paths('render_controllers/')) {
      if (!path.endsWith('.json')) continue;
      for (const bytes of stack.getAll(path)) {   // every pack's version: controllers are merged by identifier
        try {
          for (const [k, v] of Object.entries<any>(stack.parseJson(bytes).render_controllers ?? {})) this.renderControllers.set(k.toLowerCase(), v);
        } catch { /* ignore */ }
      }
    }
  }

  getDef(identifier: string): ClientEntityDef | undefined {
    const id = identifier.toLowerCase();
    return this.defs.get(id) ?? this.defs.get(id.includes(':') ? id : `minecraft:${id}`);
  }
}

/**
 * The entities whose own controller is used (see `legacyControllers`). Only these are verified: playing every format 1.8
 * entity's controller sank the wolf by a block, the polar bear by 0.7 and the parrot by 0.4 and stretched the enderman to 3.5
 * (the game would have to give those controllers' `query` / `variable` values; the standing posture is not what they compute
 * from our defaults). The check that finds such a mistake is `tests/entity-poses.test.ts`: nothing may be pushed below the ground.
 */
const LEGACY_CONTROLLER_ENTITIES = new Set(['minecraft:spider', 'minecraft:cave_spider', 'minecraft:blaze', 'minecraft:cat', 'minecraft:ocelot']);

/**
 * The animation controllers a format 1.8 entity runs on its own: those of its name (or of the owner named in its animation ids:
 * the cave spider declares `animation.spider.*`) that only use animations the entity declares, one per set of animations.
 * `controller.animation.spider.move` is `default_leg_pose` + `walk` weighted by `query.modified_move_speed` (0 at rest) + `look_at_target`.
 */
export function legacyControllers(lib: EntityLibrary, def: ClientEntityDef): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/_/g, '');
  const owners = new Set<string>([norm(def.identifier.replace(/^minecraft:/, ''))]);
  for (const aid of def.animations.values()) { const m = /^animation\.([^.]+)\./.exec(aid); if (m) owners.add(norm(m[1])); }
  const out: string[] = [], seen = new Set<string>();
  for (const cid of [...lib.animations.controllers.keys()].sort()) {
    const m = /^controller\.animation\.([^.]+)\./.exec(cid);
    if (!m || !owners.has(norm(m[1]))) continue;
    const refs = new Set<string>();
    for (const st of Object.values<any>(lib.animations.controllers.get(cid)?.states ?? {})) for (const a of st.animations ?? []) refs.add(String(typeof a === 'string' ? a : Object.keys(a)[0]).toLowerCase());
    if (!refs.size || [...refs].some((r) => !def.animations.has(r))) continue;
    const key = [...refs].sort().join(','); if (seen.has(key)) continue;
    seen.add(key); out.push(cid);
  }
  return out;
}

/** Entity library for a stack, cached per stack and rebuilt when its packs change. */
export const entityLibraryFor = perStack((stack) => new EntityLibrary(stack));

// --------------------------------------------------------------- instances ---

export interface EntityInstance {
  identifier: string;
  /** Feet position in blocks, relative to the structure's minimum corner. */
  pos: V3;
  /** Degrees, Bedrock convention (0 = facing south). */
  yaw?: number;
  /** Values for `query.*` (names without prefix, lower-case). */
  queries?: Record<string, number>;
  /** Pick `textures[textureKey]` / `geometry[geometryKey]` directly instead of using render controllers. */
  textureKey?: string;
  geometryKey?: string;
  hideBones?: string[];
  /** Model-space translation applied before placing (1/16 blocks). */
  modelOffset?: V3;
  /** Full model→structure matrix; overrides `pos`/`yaw`. */
  world?: M;
  scale?: number;
  /** The entity's compound from the structure (used by the hard-coded entities: painting motive, item, falling block …). */
  nbt?: NbtCompound;
}

export interface EntityDraw {
  /** A 2D sprite that always faces the camera (see SPRITE_GEOMETRY). */
  billboard?: boolean;
  texturePath: string;
  geometry: Geometry;
  poses: Map<string, BonePose>;
  isVisible: (bone: string) => boolean;
  color: [number, number, number];
  alpha: number;
  emissive: boolean;
  /** Alpha only marks which pixels exist (glow strength), it is not transparency. */
  alphaIsGlow: boolean;
  layer: 'solid' | 'translucent';
  world: M;
  /** UVs are 0..16 over the first square frame of the image, whatever its resolution (block / item textures). */
  uvUnit16?: boolean;
  /**
   * How the material reads the texture's alpha (see MATERIAL_ALPHA). `mask`: alpha only says which pixels exist (any alpha > 0 is
   * drawn opaque, lit as usual) and, with `tint`, how much of the dye colour each pixel takes. Default: alpha test at 0.5.
   */
  alphaMode?: 'cutout' | 'glow' | 'mask';
  /** Dye colour of a change-colour material (sheep wool, wolf and cat collars), applied in proportion to the texel's alpha. */
  tint?: [number, number, number];
  /** More texture slots of the render controller, painted over the first in order (the game's multitexture materials). */
  layers?: string[];
  /** The render controller's `overlay_color` at rest: rgb mixed into every texel by `a`. */
  overlay?: [number, number, number, number];
}

/**
 * Geometries of entities the game draws as 2D sprites that always face the camera: the fireballs, thrown items (snowball, egg,
 * ender pearl, potions) and the fishing hook's bobber. Java's renderer does the same (`faceCamera`).
 */
const SPRITE_GEOMETRY = /^geometry\.(fireball|item_sprite)$/;

/**
 * Materials whose texture alpha is not transparency. The resource packs carry no `materials/entity.material`, so this is the
 * vanilla definition by name, checked against the textures (every one of them stores a single tiny alpha value on exactly the
 * pixels in question; drawn with the usual 0.5 alpha test those pixels were thrown away):
 * - glow (`entity_emissive_alpha`): alpha < 1 marks glowing pixels, 0 is a hole. Spider and cave spider (their 20 eye pixels have
 *   alpha 3), enderman (6 eye pixels, alpha 3), phantom (4 eye pixels, alpha 18). Their eyes were missing.
 * - whole-glow: every visible pixel glows (blaze, glow squid: all alpha 90; magma cube: 29 / 126); drawn unlit like the blaze.
 * - change colour (`entity_change_color`): alpha is the dye mask. Sheep (593 skin pixels at alpha 3 = no dye, the wool at 255 takes the
 *   wool colour; the skin, face and legs were missing), the collars of tamed wolves and cats (the body at alpha 1 or 4).
 */
const EMISSIVE_ALPHA_MATERIALS = new Set(['spider', 'enderman', 'phantom']);
const WHOLE_GLOW_MATERIALS = /emissive|^blaze|^glow_squid$|^magma_cube$/i;
const CHANGE_COLOR_MATERIALS = new Set(['sheep', 'wolf', 'cat']);
/** Bedrock dye order → colour (the game's wool / collar dye colours). */
const DYE_RGB = ['f9fffe', 'f9801d', 'c74ebd', '3ab3da', 'fed83d', '80c71f', 'f38baa', '474f52', '9d9d97', '169c9c', '8932b8', '3c44aa', '835432', '5e7c16', 'b02e26', '1d1d21']
  .map((h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]);
/** The enchantment glint slot (`Texture.enchanted`): a shimmer the shader scrolls over the item, not a picture of its own. */
const GLINT_TEXTURE = /(^|\/)misc\/enchanted_/i;

const QUERY_DEFAULTS: Record<string, number> = {
  is_on_ground: 1, is_alive: 1, is_baby: 0, variant: 0, mark_variant: 0, skin_id: 0, color: 0, color2: 0,
  is_sheared: 0, is_saddled: 0, is_tamed: 0, scale: 1, body_y_rotation: 0, is_sneaking: 0,
  // an entity saved in a structure is at full health (the iron golem draws its crack overlay from health / max_health)
  health: 20, max_health: 20,
};

/** Full health of entities whose render controllers depend on it (iron golem cracks, wither armour); everything else is 20. */
const MAX_HEALTH: Record<string, number> = { 'minecraft:iron_golem': 100, 'minecraft:wither': 300, 'minecraft:ender_dragon': 200, 'minecraft:warden': 500, 'minecraft:ravager': 100 };

/** `query.property('name')` for properties the behaviour pack defines (not in resource packs): their default values. */
const PROPERTY_DEFAULTS: Record<string, string | number> = {
  'minecraft:climate_variant': 'temperate',
  // the sulfur cube is see-through only while it holds a block (archetype ≠ 'none'); without this default `query.property` gave 0,
  // `0 != 'none'` was true, and every sulfur cube lost its opaque core and showed an empty shell
  'minecraft:sulfur_cube_archetype': 'none',
};

/**
 * Entities that the game hides at the start of their life: their render controllers make every part visible only after some
 * time has passed. A saved entity has been around for a while, so these get a moment of their life where they are visible.
 *  - evocation fangs show while `variable.animation_progress` is above 0 (it grows from `query.life_span` and
 *    `query.life_time`): with a 22-tick life and half a second gone, the jaws are half open;
 *  - wind charges show after flying for 0.2 seconds.
 */
/**
 * Entities whose saved yaw is half a turn from the way their model faces: the ender dragon's yaw points backwards (the
 * game's dragon renderer leaves out the 180° turn other mobs get), so at yaw 0 it faces south like every other mob, as in
 * Java Edition.
 */
const YAW_OFFSET: Record<string, number> = { 'minecraft:ender_dragon': 180 };

/**
 * Babies whose size lives in the behaviour pack (`minecraft:scale` of the baby component group), which a resource pack does
 * not carry: a ghastling is 0.2375 of a happy ghast.
 */
const BABY_SCALE: Record<string, number> = { 'minecraft:happy_ghast': 0.2375 };

const DEFAULT_RENDER_CONTROLLER = { geometry: 'Geometry.default', materials: [{ '*': 'Material.default' }], textures: ['Texture.default'] };

const VISIBLE_MOMENT: Record<string, Record<string, number>> = {
  'minecraft:evocation_fang': { life_span: 22, life_time: 0.5 },
  'minecraft:wind_charge_projectile': { life_time: 0.5 },
  'minecraft:breeze_wind_charge_projectile': { life_time: 0.5 },
};

function makeQuery(lib: EntityLibrary, inst: EntityInstance): MolangEnv['query'] {
  const q: Record<string, number> = { ...QUERY_DEFAULTS, ...VISIBLE_MOMENT[inst.identifier.toLowerCase()] };
  q.health = q.max_health = MAX_HEALTH[inst.identifier.toLowerCase()] ?? 20;
  for (const [k, v] of Object.entries(inst.queries ?? {})) q[k.toLowerCase()] = v;
  return (name, args) => {
    const n = name.toLowerCase().replace(/^q\./, '');
    if (n === 'property' || n === 'has_property') {
      const key = String(args?.[0] ?? '');
      const saved = (inst.nbt?.properties as Record<string, unknown> | undefined)?.[key];
      const v = typeof saved === 'string' || typeof saved === 'number' ? saved : PROPERTY_DEFAULTS[key];
      return n === 'has_property' ? (v === undefined ? 0 : 1) : v ?? 0;
    }
    if (n in q) return q[n];
    lib.unsupportedQueries.add(n);
    return 0;
  };
}

const globToRegex = (g: string) =>
  new RegExp('^' + g.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

const handleKey = (v: unknown): string | null =>
  typeof v === 'string' && v.includes('.') ? v.slice(v.indexOf('.') + 1) : null;

/** Each bone's rest channels (for Molang's `this`): position (see below) and the geometry rotation. First geometry that has the bone wins (default first). */
function restPose(lib: EntityLibrary, def: { geometry: Record<string, string> }): Map<string, { pos: V3; rot: V3 }> {
  const out = new Map<string, { pos: V3; rot: V3 }>();
  const ids = [def.geometry.default, ...Object.values(def.geometry)].filter((x): x is string => !!x);
  for (const id of new Set(ids)) {
    const geo = lib.geometries.get(id);
    if (!geo) continue;
    const byName = new Map(geo.bones.map((b) => [b.name.toLowerCase(), b]));
    for (const b of geo.bones) {
      const key = b.name.toLowerCase();
      if (out.has(key)) continue;
      // a child bone rests at its pivot relative to its parent's (the guardian's spikes: 24 above the head); a root bone at 0
      // (the dragon's head and neck: their variables are offsets from the entity origin) — the old Java rotation-point convention
      const parent = b.parent ? byName.get(b.parent.toLowerCase()) : undefined;
      // The position channel is the old Java rotation point: a child's is relative to its parent's pivot, a root bone's to the
      // model origin 24 px above the feet (Java model space). Measured on the wolf, whose setup animation writes Java's ModelWolf
      // rotation points (body "-14 - this" / "2 - this", legs "-16 - this", tail "-12 - this"): only with root = pivot - (0, 24, 0)
      // do the body, legs and tail stay where the geometry has them (with root = 0 the wolf sank 14-16 px, the enderman's body
      // rose 11 px over its own head); the guardian's spikes (children) fixed the child rule.
      const pos: V3 = parent ? [b.pivot[0] - parent.pivot[0], b.pivot[1] - parent.pivot[1], b.pivot[2] - parent.pivot[2]] : [b.pivot[0], b.pivot[1] - 24, b.pivot[2]];
      out.set(key, { pos, rot: [...b.rotation] as V3 });
    }
  }
  return out;
}

/** Resolve one entity instance to a list of draw calls (geometry + texture + pose). */
export function planEntity(lib: EntityLibrary, inst: EntityInstance): EntityDraw[] {
  const def = lib.getDef(inst.identifier);
  if (!def) return [];

  const env = createMolangEnv(makeQuery(lib, inst));
  for (const s of def.initialize) evalMolang(s, env);
  for (const s of def.preAnimation) evalMolang(s, env);
  const baby = molangNumber(evalMolang('query.is_baby', env)) ? BABY_SCALE[inst.identifier.toLowerCase()] ?? 1 : 1;
  const entityScale = (def.scale != null ? molangNumber(evalMolang(def.scale, env)) || 1 : 1) * (inst.scale ?? 1) * baby;

  const poses = new Map<string, BonePose>();
  const ctx: AnimContext = { lib: lib.animations, shortNames: new Map(def.animations), env, poses, rest: restPose(lib, def) };
  for (const e of def.animate) {
    if (typeof e === 'string') applyAnimation(ctx, e, undefined);
    else for (const [short, expr] of Object.entries<any>(e)) applyAnimation(ctx, short, expr);
  }
  // A format 1.8 client entity has no `scripts.animate`: the game plays its animation controller (`controller.animation.<name>.move`)
  // by itself. Without this the spider's legs stayed straight rods, the blaze's rods never took their places …
  // the dragon's right-hand limbs are mirrored copies of the left ones (geometry.ts): mirror their pose as well, so the same
  // flap turns both wings up together (a mirror negates rotation about y and z, and the x offset)
  // (the pack writes some right-hand values already mirrored — `wingtip1` is the negative of `wingtip` — and others not —
  // `wing1` equals `wing`: a component is negated only when it matches the left one rather than its mirror)
  if (/(^|:)ender_dragon$/.test(def.identifier)) for (const b of DRAGON_MIRRORED) {
    const p = poses.get(b), l = poses.get(b.slice(0, -1));
    if (!p) continue;
    const flip = (right: number, left: number | undefined) => (left === undefined || Math.abs(right - left) <= Math.abs(right + left) ? -right : right);
    p.rot[1] = flip(p.rot[1], l?.rot[1]);
    p.rot[2] = flip(p.rot[2], l?.rot[2]);
    p.pos[0] = flip(p.pos[0], l?.pos[0]);
  }
  // A format 1.8 client entity names the controllers the game plays on its own (`animation_controllers`): the enderman's base pose
  // (head on top of the body), the wolf's setup (body and mane turned level), the spider's leg pose … Entities that name none fall
  // back to the controllers found by name, for the few verified before (legacyControllers).
  // (the controllers' short names are their own namespace: the wolf calls both its setup animation and the controller that plays it
  // `wolf_setup`, so a controller is registered under an alias of its own, not over the animation's name)
  if (!def.animate.length && def.controllers.length) def.controllers.forEach(([, cid], i) => { const alias = `#controller${i}`; ctx.shortNames.set(alias, cid); applyAnimation(ctx, alias, undefined); });
  else if (!def.animate.length && LEGACY_CONTROLLER_ENTITIES.has(def.identifier)) legacyControllers(lib, def).forEach((cid, i) => { const short = `legacy_controller_${i}`; ctx.shortNames.set(short, cid); applyAnimation(ctx, short, undefined); });

  // model space (x = entity's left, y up, z = back) → structure space
  const [px, py, pz] = inst.pos;
  const off = inst.modelOffset ?? [0, 0, 0];
  const s = entityScale / 16;
  const world: M = inst.world ?? mulM(
    translateM(px, py, pz),
    mulM(rotYM(-((inst.yaw ?? 0) + (YAW_OFFSET[inst.identifier.toLowerCase()] ?? 0))), mulM(scaleM(s, s, -s), translateM(off[0], off[1], off[2]))),
  );
  const hidden = new Set((inst.hideBones ?? []).map((b) => b.toLowerCase()));
  const baseVisible = (b: string) => !hidden.has(b);

  const draws: EntityDraw[] = [];
  // an entity turned to the camera by its animation (the experience orb's `animation.actor.billboard`) is a sprite as well
  const facesCamera = [...def.animations.values()].some((id) => /camera_rotation/i.test(JSON.stringify(lib.animations.animations.get(id) ?? '')));
  const texPathOf = (texKey: string | null): string | undefined => {
    if (!texKey) return undefined;
    let texPath = def.textures[texKey];
    if (!texPath && /(^|:)(chest_)?boat$/.test(def.identifier)) {
      texPath = boatTexturePath(lib.stack, texKey, def.identifier.endsWith('chest_boat')) ?? def.textures.default;
    }
    return texPath;
  };
  /**
   * One draw per render controller. Its `textures` are the material's texture SLOTS, not separate pictures: the game combines them in
   * one pass (multitexture: llama decor, horse markings, villager professions …) or uses them as the enchantment glint. Drawing the
   * geometry once per slot put the glint (a grey gradient) over potions and the experience bottle as a sprite of its own.
   */
  const push = (geoKey: string | null, texKeys: (string | null)[], matKey: string | null, isVisible: (b: string) => boolean, extra: Partial<EntityDraw> = {}) => {
    if (!geoKey) return;
    const geoId = def.geometry[geoKey];
    const paths = texKeys.map(texPathOf).filter((p): p is string => !!p && !GLINT_TEXTURE.test(p));
    const geo = geoId ? lib.geometries.get(geoId) : null;
    if (!geo || !paths.length) return;
    const mat = ((matKey ? def.materials[matKey] : undefined) ?? '').toLowerCase();
    // The pack's materials/entity.material may be absent, so classify by name.
    const alphaIsGlow = WHOLE_GLOW_MATERIALS.test(mat);
    const mask = !alphaIsGlow && (EMISSIVE_ALPHA_MATERIALS.has(mat) || CHANGE_COLOR_MATERIALS.has(mat));
    const translucent = !alphaIsGlow && !mask && /alpha_?blend|translucent|transparent|ghost|_outer$/i.test(mat);
    const dye = CHANGE_COLOR_MATERIALS.has(mat) ? DYE_RGB[(inst.queries?.color ?? 0) & 15] : undefined;
    draws.push({
      billboard: SPRITE_GEOMETRY.test(geo.id) || facesCamera,
      texturePath: paths[0], geometry: geo, poses, isVisible,
      color: [1, 1, 1], alpha: 1, emissive: alphaIsGlow, alphaIsGlow,
      layer: translucent ? 'translucent' : 'solid', world,
      alphaMode: alphaIsGlow ? 'glow' : mask ? 'mask' : 'cutout',
      ...(dye ? { tint: dye } : {}), ...(paths.length > 1 ? { layers: paths.slice(1) } : {}),
      ...extra,
    });
  };

  // block entities / entities without render controllers: explicit keys
  if (inst.textureKey || def.renderControllers.length === 0) {
    push(inst.geometryKey ?? 'default', [inst.textureKey ?? 'default'], 'default', baseVisible);
    return draws;
  }

  for (const entry of def.renderControllers) {
    const [name, cond] = typeof entry === 'string' ? [entry, undefined] : (Object.entries(entry)[0] ?? ['', undefined]);
    if (cond !== undefined && !molangTruthy(evalMolang(cond, env))) continue;
    // A controller that no pack defines is the plain default one (default geometry, material and texture). Mojang's published
    // pack references `controller.render.iron_golem` without defining it; the game's own files define it exactly so.
    const rc = lib.renderControllers.get(name.toLowerCase()) ?? DEFAULT_RENDER_CONTROLLER;

    env.arrays.clear();
    for (const group of Object.values<any>(rc.arrays ?? {})) {
      for (const [arrName, items] of Object.entries<any>(group)) env.arrays.set(arrName.toLowerCase(), (items as string[]).map((x) => String(x).toLowerCase()));
    }

    const geoKey = handleKey(evalMolang(rc.geometry, env));
    let matKey: string | null = 'default';
    for (const m of rc.materials ?? []) {
      const [pat, expr] = Object.entries<any>(m)[0] ?? [];
      if (pat === '*') { matKey = handleKey(evalMolang(expr, env)); break; }
    }

    // part visibility: later entries override earlier ones
    const rules: [RegExp, boolean][] = [];
    for (const pv of rc.part_visibility ?? []) {
      for (const [pat, val] of Object.entries<any>(pv)) {
        rules.push([globToRegex(pat), typeof val === 'boolean' ? val : molangTruthy(evalMolang(val, env))]);
      }
    }
    const isVisible = (b: string) => {
      if (!baseVisible(b)) return false;
      let v = true;
      for (const [re, show] of rules) if (re.test(b)) v = show;
      return v;
    };

    const slots: unknown[] = Array.isArray(rc.textures) ? rc.textures : rc.textures != null ? [rc.textures] : [];
    const extra: Partial<EntityDraw> = {};
    if (rc.overlay_color && typeof rc.overlay_color === 'object') {
      // evaluated at rest (life_time 0): the experience orb's green-yellow over its grey texture; `this` is the previous overlay (none)
      const c = ['r', 'g', 'b', 'a'].map((k) => molangNumber(evalMolang(rc.overlay_color[k] ?? 0, env)));
      if (c[3] > 0) extra.overlay = c.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number, number];
    }
    if (rc.ignore_lighting === true) extra.emissive = true;
    push(geoKey, slots.map((t) => handleKey(evalMolang(t as string, env))), matKey, isVisible, extra);
  }
  return draws;
}

// ------------------------------------------------------- structure sources ---

const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : d);

/** `health` / `max_health` from the entity's `Attributes` list, when it has one. */
function healthOf(e: NbtCompound): Record<string, number> {
  const list = Array.isArray(e.Attributes) ? e.Attributes : [];
  for (const a of list as NbtCompound[]) {
    if (String(a?.Name ?? '').replace(/^minecraft:/, '') === 'health') return { health: num(a.Current, 20), max_health: num(a.Max, 20) };
  }
  return {};
}

/**
 * Free-standing entities stored in the structure's `entities` list.
 *
 * The game saves entity positions in world coordinates, so `structure_world_origin` is subtracted. Structures written by
 * other tools often store them relative to the structure instead; when more entities fall inside the structure's box
 * without the subtraction than with it, the positions are taken as they are.
 */
export function entityInstancesFromStructure(structure: McStructure): EntityInstance[] {
  type Raw = { e: NbtCompound; id: string; pos: V3 };
  const raws: Raw[] = [];
  for (const e of structure.entities) {
    const id = String(e.identifier ?? e.id ?? '');
    const pos = e.Pos;
    if (!id || !Array.isArray(pos) || pos.length < 3) continue;
    raws.push({ e, id, pos: [num(pos[0]), num(pos[1]), num(pos[2])] });
  }
  const inside = (p: V3) => p.every((v, a) => v >= -2 && v <= structure.size[a] + 2);
  const shifted = (r: Raw): V3 => [r.pos[0] - structure.origin[0], r.pos[1] - structure.origin[1], r.pos[2] - structure.origin[2]];
  const useRaw = raws.filter((r) => inside(r.pos)).length > raws.filter((r) => inside(shifted(r))).length;
  const out: EntityInstance[] = [];
  // `query.is_in_water`: a fish out of water flops on its side (the game's animation does that too), in water it swims upright
  const inWater = (p: V3): number => {
    const x = Math.floor(p[0]), y = Math.floor(p[1] + 0.2), z = Math.floor(p[2]);
    if (!structure.inBounds(x, y, z)) return 0;
    for (const layer of [0, 1]) if (/(^|:)(flowing_)?water$/.test(structure.blockAt(x, y, z, layer)?.name ?? '')) return 1;
    return 0;
  };
  for (const { e, id, pos } of raws) {
    const rot = Array.isArray(e.Rotation) ? e.Rotation : [0, 0];
    const defs = Array.isArray(e.definitions) ? e.definitions.map(String) : [];
    const queries: Record<string, number> = {
      variant: num(e.Variant), mark_variant: num(e.MarkVariant), skin_id: num(e.SkinID),
      color: num(e.Color), color2: num(e.Color2),
      is_sheared: num(e.Sheared), is_saddled: num(e.Saddled), is_tamed: num(e.IsTamed ?? e.Tamed),
      ...(healthOf(e)),
      is_baby: num(e.IsBaby) || (num(e.Age) < 0 ? 1 : 0) || (defs.some((d) => /_baby\b/.test(d)) ? 1 : 0),
      is_in_water: inWater(useRaw ? pos : [pos[0] - structure.origin[0], pos[1] - structure.origin[1], pos[2] - structure.origin[2]]),
    };
    out.push({
      identifier: id,
      pos: useRaw ? pos : [pos[0] - structure.origin[0], pos[1] - structure.origin[1], pos[2] - structure.origin[2]],
      yaw: num(rot[0]), queries, nbt: e,
      ...(/(^|:)(chest_)?boat$/.test(id) ? { textureKey: boatTextureKey(e) } : {}),
    });
  }
  return out;
}

/** Bedrock dye order (also the bed/wool data values). */
export const DYE_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'silver', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

const BED_DIRECTION: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // south, west, north, east (foot → head)
const SKULL_TYPES = ['skeleton', 'wither', 'zombie', 'steve', 'creeper', 'dragon'];
const FACING6 = ['down', 'up', 'north', 'south', 'west', 'east'];
const OUT: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };

function skullKeyFromName(name: string): string | undefined {
  if (name.includes('wither')) return 'wither';
  if (name.includes('skeleton')) return 'skeleton';
  if (name.includes('zombie')) return 'zombie';
  if (name.includes('creeper')) return 'creeper';
  if (name.includes('dragon')) return 'dragon';
  if (name.includes('player')) return 'steve';
  return undefined;
}

/**
 * Block entities whose geometry and texture are declared by the pack but whose
 * placement is hard-coded in the game: beds, shulker boxes, mob heads.
 */
export function blockEntityInstances(structure: McStructure): EntityInstance[] {
  const out: EntityInstance[] = [];
  structure.forEachBlock((x, y, z, entry) => {
    const name = entry.name.replace(/^minecraft:/, '');
    const st = entry.states as Record<string, StateValue>;
    const be = structure.blockEntityAt(x, y, z);
    const state = (k: string) => st[k] ?? st['minecraft:' + k];

    const flatBed = /^(?!straw)(.+)_bed$/.exec(name);
    if (name === 'bed' || flatBed) {
      if (!Number(state('head_piece_bit'))) return; // the model spans both halves; draw it once
      const [dx, dz] = BED_DIRECTION[Number(state('direction')) & 3];
      const px = dz, pz = -dx;
      const color = flatBed ? (flatBed[1] === 'light_gray' ? 'silver' : flatBed[1]) : DYE_COLORS[num(be?.color, 0) & 15];
      const T: V3 = [x + 0.5 - dx * 1.5 - px * 0.5, y + 9 / 16, z + 0.5 - dz * 1.5 - pz * 0.5];
      const world: M = [px / 16, dx / 16, 0, T[0], 0, 0, -1 / 16, T[1], pz / 16, dz / 16, 0, T[2]];
      out.push({ identifier: 'minecraft:bed', pos: [x, y, z], textureKey: color, geometryKey: 'default', world });
    } else if (/shulker_box$/.test(name)) {
      const m = name.match(/^(.*)_shulker_box$/);
      const c = !m ? 'undyed' : m[1] === 'light_gray' ? 'silver' : m[1];
      out.push({
        identifier: 'minecraft:shulker', pos: [x + 0.5, y, z + 0.5], textureKey: c, geometryKey: 'default', hideBones: ['head'],
      });
    } else if (name === 'skull' || /_skull$|_head$/.test(name)) {
      const key = skullKeyFromName(name) ?? SKULL_TYPES[num(be?.SkullType, 3)] ?? 'steve';
      const facing = state('facing_direction');
      const dir = typeof facing === 'number' ? FACING6[facing] : String(facing ?? 'up');
      if (dir === 'up' || dir === 'down' || !(dir in OUT)) {
        out.push({
          identifier: 'minecraft:skull', pos: [x + 0.5, y, z + 0.5], yaw: num(be?.Rotation, 0),
          textureKey: key, geometryKey: key, modelOffset: [0, -24, 0],
        });
      } else {
        const [ox, oz] = OUT[dir];
        out.push({
          identifier: 'minecraft:skull', pos: [x + 0.5 + ox * 0.25, y + 0.25, z + 0.5 + oz * 0.25],
          yaw: (Math.atan2(-ox, oz) * 180) / Math.PI, textureKey: key, geometryKey: key, modelOffset: [0, -24, 0],
        });
      }
    }
  });
  return out;
}

// ----------------------------------------------------------------- batches ---

export interface TextureBatch {
  /** Texture path inside the resource pack, e.g. `textures/entity/cow/cow`. */
  path: string;
  image: { width: number; height: number; data: Uint8Array };
  solid: MeshLayerData;
  translucent: MeshLayerData;
  /** Unlit (glowing) entity texture: drawn with the texture as emissive map, like the Java package's emissive materials. */
  emissive?: boolean;
}

/** One entity (or block entity) of the structure and how it was drawn — the Bedrock counterpart of Java's `EntityRecord`. */
export interface EntityRecord {
  key: string;
  id: string;
  /** Feet position in blocks, relative to the structure's minimum corner. */
  position: [number, number, number];
  rotation: [number, number];
  nbt: NbtCompound;
  /** Axis-aligned box of what was drawn (blocks, relative to the structure's minimum corner); used for picking. */
  bounds?: { min: V3; max: V3 };
  /** model: drawn from a pack model · builtin: drawn from the renderer's own shape · unsupported: no definition anywhere. */
  status: 'model' | 'builtin' | 'unsupported';
  note?: string;
}

export interface EntityBuildResult {
  batches: TextureBatch[];
  entities: number;
  unknownEntities: string[];
  missingTextures: string[];
  records: EntityRecord[];
  /** Entities that have a definition but produced no faces. */
  undrawnEntities: string[];
}

/** The image a draw samples: its texture, the layers painted over it, and what its material does with alpha (one cache entry each). */
function imageKey(d: EntityDraw): string {
  const mode = d.alphaMode ?? (d.alphaIsGlow ? 'glow' : 'cutout');
  return [d.texturePath, ...(d.layers ?? [])].join('|') + (mode === 'cutout' ? '' : '#' + mode)
    + (d.tint ? '#tint' + d.tint.map((v) => v.toFixed(3)).join(',') : '') + (d.overlay ? '#over' + d.overlay.map((v) => v.toFixed(3)).join(',') : '');
}

async function prepareImage(stack: ResourceStack, d: EntityDraw): Promise<Awaited<ReturnType<ResourceStack['loadImage']>>> {
  const img = await stack.loadImage(d.texturePath);
  const mode = d.alphaMode ?? (d.alphaIsGlow ? 'glow' : 'cutout');
  if (!img || (mode === 'cutout' && !d.layers?.length && !d.overlay)) return img;
  const data = new Uint8Array(img.data);
  // multitexture: each further slot is painted over the first with its own alpha (sampled at the base's resolution)
  for (const path of d.layers ?? []) {
    const l = await stack.loadImage(path);
    if (!l) continue;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const j = (Math.floor((y * l.height) / img.height) * l.width + Math.floor((x * l.width) / img.width)) * 4;
      const la = l.data[j + 3] / 255;
      if (la <= 0) continue;
      const ba = data[i + 3] / 255, oa = la + ba * (1 - la);
      for (let c = 0; c < 3; c++) data[i + c] = Math.round((l.data[j + c] * la + data[i + c] * ba * (1 - la)) / oa);
      data[i + 3] = Math.round(oa * 255);
    }
  }
  // the dye goes only where a texture carries a mask (a tamed wolf's or cat's collar texture, the sheep's): the wild wolf's texture is
  // opaque everywhere and would otherwise take the collar colour all over
  let masked = false;
  if (d.tint) for (let i = 3; i < data.length && !masked; i += 4) masked = data[i] > 0 && data[i] < 128;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    if (mode !== 'cutout') {
      // the alpha was a mask (glow strength or dye amount): every pixel that exists is drawn
      if (d.tint && masked) for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * (1 + (d.tint[c] - 1) * (a / 255)));
      data[i + 3] = 255;
    }
    if (d.overlay) for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] + (d.overlay[c] * 255 - data[i + c]) * d.overlay[3]);
  }
  return { ...img, data };
}

export async function buildEntityBatches(
  structure: McStructure, stack: ResourceStack, instances?: EntityInstance[], registry?: BlockRegistry,
): Promise<EntityBuildResult> {
  const lib = entityLibraryFor(stack);
  const reg = registry ?? createDefaultRegistry();
  const all = instances ?? [...entityInstancesFromStructure(structure), ...blockEntityInstances(structure)];
  const unknown = new Set<string>();
  const planned: EntityDraw[] = [];
  const records: EntityRecord[] = [];
  const owners: number[] = [];
  let drawn = 0;

  all.forEach((inst, i) => {
    const idx = records.length;
    const own = (ds: EntityDraw[]) => { planned.push(...ds); for (let k = 0; k < ds.length; k++) owners.push(idx); };
    const record = (status: EntityRecord['status'], note?: string) => records.push({
      key: `${inst.identifier}#${i}`, id: inst.identifier, position: [...inst.pos] as V3, rotation: [inst.yaw ?? 0, 0],
      nbt: inst.nbt ?? {}, status, note,
    });
    let draws: EntityDraw[] = [];
    if (lib.getDef(inst.identifier)) draws = planEntity(lib, inst);
    if (!draws.length) {
      const b = builtinDraws(inst, stack, reg);
      if (b) { own(b); drawn++; record('builtin'); return; }
    }
    if (!lib.getDef(inst.identifier)) { unknown.add(inst.identifier); record('unsupported', 'no client entity definition in the resource pack(s)'); return; }
    own(draws.length ? [...draws, ...heldBlockDraws(inst, stack, reg)] : draws);
    drawn++;
    record('model', draws.length ? undefined : 'the definition has no drawable geometry/texture');
  });

  // load every texture first: geometries without a declared size use the image's size
  const images = new Map<string, Awaited<ReturnType<ResourceStack['loadImage']>>>();
  for (const d of planned) {
    const key = imageKey(d);
    if (images.has(key)) continue;
    images.set(key, await prepareImage(stack, d));
  }

  const groups = new Map<string, { solid: LayerBuilder; translucent: LayerBuilder }>();
  const missing = new Set<string>();
  for (let di = 0; di < planned.length; di++) {
    const d = planned[di];
    const key = imageKey(d);
    const img = images.get(key);
    if (!img) { missing.add(d.texturePath); continue; }
    const gkey = key + (d.emissive ? '#emissive' : '');
    let g = groups.get(gkey);
    if (!g) { g = { solid: new LayerBuilder(), translucent: new LayerBuilder() }; groups.set(gkey, g); }
    const sink = d.layer === 'translucent' ? g.translucent : g.solid;
    const from = sink.posLength;
    emitGeometry(d.geometry, {
      poses: d.poses, isVisible: d.isVisible, world: d.world, color: d.color, alpha: d.alpha, emissive: d.emissive, billboard: d.billboard,
      texW: d.uvUnit16 ? 16 : d.geometry.texW ?? img.width,
      texH: d.uvUnit16 ? (16 * img.height) / img.width : d.geometry.texH ?? img.height,
    }, sink);
    // grow the owner's bounding box by what this draw added
    const rec = records[owners[di]];
    for (let p = from; p < sink.posLength; p += 3) {
      const b = (rec.bounds ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
      for (let a = 0; a < 3; a++) { const v = sink.posAt(p + a); if (v < b.min[a]) b.min[a] = v; if (v > b.max[a]) b.max[a] = v; }
    }
  }

  const batches: TextureBatch[] = [];
  for (const [gkey, g] of groups) {
    const key = gkey.replace(/#emissive$/, '');
    batches.push({ path: key.replace(/[|#].*$/, ''), image: images.get(key)!, solid: g.solid.finish(), translucent: g.translucent.finish(), ...(gkey.endsWith('#emissive') ? { emissive: true } : {}) });
  }
  // an entity counts as drawn only when it produced faces (a definition alone draws nothing)
  const undrawn = records.filter((r) => r.status !== 'unsupported' && !r.bounds).map((r) => r.id);
  for (const r of records) if (r.status === 'model' && !r.bounds && !r.note) r.note = 'drew no faces (invisible at rest, or its texture is missing)';
  return { batches, entities: records.filter((r) => r.bounds).length, unknownEntities: [...unknown].sort(), missingTextures: [...missing], records, undrawnEntities: [...new Set(undrawn)].sort() };
}

export type { NbtCompound };

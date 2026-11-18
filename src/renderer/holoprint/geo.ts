/**
 * Block geometry from HoloPrint's block shape data (blockShapes / blockShapeGeos / blockStateDefinitions /
 * blockEigenvariants, shipped in ./data).
 *
 * This is a TypeScript port of the poly-mesh path of HoloPrint's `BlockGeoMaker.js`
 * (https://github.com/SuperLlama88888/holoprint, CC BY-NC-SA 4.0 — see ./data/LICENSE-HoloPrint.txt), taken from the
 * neoHoloprintDB package (which also accepts `shape<textures/…>` special textures). It is a port, not a rewrite: the cube
 * expansion (`if`, `copy`, `copy_block`, `block_states`, `${…}` interpolation), cube merging / inner-face culling, UV
 * calculation (including `uv_rot`, `flip_textures_*`, `box_uv` and the 180° turn of up/down faces), cube rotations and the
 * block-state-driven whole-block rotations and texture variants follow the original line by line. Differences:
 *   - no hologram scaling (`config.SCALE`) and no texture atlas: faces keep a texture *reference*, resolved by `textures.ts`;
 *   - `extra_rots` are applied innermost first for every vertex (the original reverses the array once per vertex, which only
 *     matters for two or more nested rotations);
 *   - errors are collected in `warnings` instead of being logged.
 *
 * Coordinates are HoloPrint's: pixels (0..16 per block) in Bedrock geometry space, where +x points **west** (the face called
 * `west` sits at x = 16). `hp-model.ts` mirrors x to get world space (+x = east).
 */

export type Vec3 = [number, number, number];
type Vec2 = [number, number];

export interface HpBlock {
  name: string;
  states?: Record<string, unknown>;
  block_entity_data?: Record<string, unknown>;
  '#copied_via_copy_block'?: boolean;
}

export interface HpTextureRef {
  /** Top-left corner and size in normalised texture coordinates (0..1, v downwards). */
  uv: Vec2;
  uv_size: Vec2;
  block_name?: string;
  texture_face?: string;
  variant?: number;
  terrain_texture_override?: string;
  texture_path_override?: string;
  tint?: Vec3;
}

export interface HpVertex {
  pos: Vec3;
  /** Texture corner: bit 0 = right edge of the UV rectangle, bit 1 = bottom edge. */
  corner: number;
}

export interface HpFace {
  normal: Vec3;
  tex: HpTextureRef;
  vertices: [HpVertex, HpVertex, HpVertex, HpVertex];
  fullbright: boolean;
  /** The face comes from a zero-thickness cube (a plane, visible from both sides). */
  flat: boolean;
  /**
   * Its cube is not closed (fewer than six faces): the backs of its faces can be seen through the gap — a hopper's bowl has no
   * inner walls, the inside is the back of the outer walls — so it is drawn from both sides. A closed cube's backs never show.
   */
  open?: boolean;
  /** Face name in HoloPrint's convention (before the whole-block rotation). */
  face: string;
}

export interface HoloData {
  blockShapes: { patterns: Record<string, string>; individual_blocks: Record<string, string> };
  blockShapeGeos: Record<string, any[]>;
  blockStateDefinitions: { rotations: any; texture_variants: any };
  blockEigenvariants: Record<string, number>;
}

const FACE_NAMES = ['west', 'east', 'down', 'up', 'north', 'south'] as const;
const SIDE_FACES = ['west', 'east', 'north', 'south'];

// ---------------------------------------------------------------- vector helpers (utils.js)

const addVec3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subVec3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mulVec3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const addVec2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const crossProduct = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalizeVec3 = (v: Vec3): Vec3 => mulVec3(v, 1 / Math.hypot(...v));
function rotateDeg([x, y]: Vec2, deg: number): Vec2 {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}
function mulMat4(m: number[][], [x, y, z, w = 1]: number[]): number[] {
  return m.map((r) => r[0] * x + r[1] * y + r[2] * z + r[3] * w);
}
export function hexColorToClampedTriplet(hex: string): Vec3 {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return [1, 1, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

/** Strip the namespace; HoloPrint's data uses bare names. */
export const hpName = (n: string) => n.replace(/^minecraft:/, '');

/** `shape{textures/…}` (HoloPrint) or `shape<textures/…>` (neoHoloprintDB). */
export function splitSpecialTexture(blockShape: string): { shape: string; texture?: string } {
  const m = /^(?:(\w+)\{(textures\/[\w/]+)\}|(\w+)<(textures\/[\w/]+)>)$/.exec(blockShape);
  return m ? { shape: m[1] ?? m[3], texture: m[2] ?? m[4] } : { shape: blockShape };
}

// ---------------------------------------------------------------- the geometry maker

export class HoloGeometry {
  readonly warnings: string[] = [];
  private individual: Record<string, string>;
  private patterns: [RegExp, string][];
  private geos: Record<string, any[]>;
  private eigenvariants: Record<string, number>;
  private globalRotations: Record<string, any>;
  private shapeRotations = new Map<string, any>();
  private nameRotations = new Map<string, any>();
  private globalVariants: Record<string, any>;
  private shapeVariants = new Map<string, any>();
  private nameVariants = new Map<string, any>();
  private namePatternVariants: [RegExp, any][] = [];
  private shapeCache = new Map<string, string>();

  constructor(data: HoloData) {
    this.individual = data.blockShapes.individual_blocks;
    this.patterns = Object.entries(data.blockShapes.patterns).map(([re, shape]) => [new RegExp(re), shape]);
    this.geos = data.blockShapeGeos;
    this.eigenvariants = data.blockEigenvariants;
    const defs = data.blockStateDefinitions;
    this.globalRotations = defs.rotations['*'];
    for (const [shapes, d] of Object.entries<any>(defs.rotations.block_shapes ?? {})) for (const s of shapes.split(',')) this.shapeRotations.set(s, d);
    for (const [names, d] of Object.entries<any>(defs.rotations.block_names ?? {})) for (const n of names.split(',')) this.nameRotations.set(n, d);
    this.globalVariants = defs.texture_variants['*'];
    for (const [shapes, d] of Object.entries<any>(defs.texture_variants.block_shapes ?? {})) for (const s of shapes.split(',')) this.shapeVariants.set(s, d);
    for (const [names, d] of Object.entries<any>(defs.texture_variants.block_names ?? {})) {
      if (names.startsWith('/') && names.endsWith('/')) this.namePatternVariants.push([new RegExp(names.slice(1, -1)), d]);
      else for (const n of names.split(',')) this.nameVariants.set(n, d);
    }
  }

  private warn(msg: string) {
    if (this.warnings.length < 500) this.warnings.push(msg);
  }

  /** Block name → HoloPrint block shape (exact entry, then the first matching pattern, then `block`). */
  shapeOf(blockName: string): string {
    const name = hpName(blockName);
    const cached = this.shapeCache.get(name);
    if (cached) return cached;
    const shape = this.individual[name] ?? this.patterns.find(([re]) => re.test(name))?.[1] ?? 'block';
    this.shapeCache.set(name, shape);
    return shape;
  }

  /** Does HoloPrint have a geometry for this shape name? */
  hasShape(shape: string): boolean {
    return shape in this.geos;
  }

  /** Every face of a block in HoloPrint space, whole-block rotation applied. `[]` = nothing to draw. */
  faces(block: HpBlock): HpFace[] {
    block = { ...block, name: hpName(block.name) };
    let shape = this.shapeOf(block.name);
    const { faces } = this.makeFaces(block, shape);
    if (!faces) return [];
    shape = splitSpecialTexture(shape).shape;
    const rotation = this.blockRotation(block, shape);
    if (rotation) {
      for (const f of faces) {
        f.normal = this.applyEulerRotation(f.normal, rotation, [0, 0, 0]);
        for (const v of f.vertices) v.pos = this.applyEulerRotation(v.pos, rotation, [8, 8, 8]);
      }
    }
    return faces;
  }

  /** Block-entity fields and custom (neighbour-derived) variables the shape of this block reads. */
  requirements(blockName: string): { entity: Set<string>; vars: Set<string> } {
    const entity = new Set<string>(), vars = new Set<string>();
    const seen = new Set<string>();
    const walk = (shape: string) => {
      if (seen.has(shape)) return;
      seen.add(shape);
      for (const c of this.geos[shape] ?? []) {
        if (typeof c.if === 'string') {
          for (const term of c.if.replace(/\s/g, '').split(/&&|\|\|/)) {
            const m = /^(entity\.)?([A-Za-z_][\w:]*)/.exec(term);
            if (m) (m[1] ? entity : vars).add(m[2]);
          }
        }
        // interpolations: `${entity.X}` / `${#block_entity_data.X}` read block-entity fields, `${#block_states.X}` reads a state
        // (the brewing stand's arms take `has_bottle` from `brewing_stand_slot_a_bit` …: without that state the arms vanished)
        const scan = (str: string) => {
          for (const e of str.matchAll(/entity\.(\w+)|#block_entity_data\.(\w+)/g)) entity.add(e[1] ?? e[2]);
          for (const e of str.matchAll(/#block_states\.([\w:]+)/g)) vars.add(e[1]);
        };
        for (const v of Object.values<any>(c)) {
          if (typeof v === 'string') scan(v);
          else if (v && typeof v === 'object' && !Array.isArray(v)) for (const s of Object.values<any>(v)) if (typeof s === 'string') scan(s);
        }
        if (typeof c.copy_block === 'string') { const m = /^entity\.(.+)$/.exec(c.copy_block); if (m) entity.add(m[1]); }
        if (typeof c.copy === 'string') walk(c.copy);
      }
    };
    walk(splitSpecialTexture(this.shapeOf(blockName)).shape);
    return { entity, vars };
  }

  // ------------------------------------------------------------ #makePolyMeshTemplateFaces

  private makeFaces(block: HpBlock, blockShape: string): { faces?: HpFace[] } {
    let specialTexture: string | undefined;
    ({ shape: blockShape, texture: specialTexture } = splitSpecialTexture(blockShape));

    let unfiltered: any[] = clone(this.geos[blockShape]);
    if (!unfiltered) {
      this.warn(`no geometry for block shape ${blockShape}; using "block"`);
      unfiltered = clone(this.geos.block);
    }
    const filtered: any[] = [];
    const allFaces: HpFace[] = [];
    while (unfiltered.length) {
      const cube = unfiltered.shift();
      if ('block_states' in cube) {
        const override: HpBlock = clone(block);
        for (const k in cube.block_states) {
          if (typeof cube.block_states[k] === 'string') cube.block_states[k] = this.interpolate(block, cube.block_states[k], cube);
        }
        override.states = { ...override.states, ...cube.block_states };
        cube.block_override = override;
        delete cube.block_states;
      }
      if ('if' in cube) {
        if (!this.checkConditional(cube.block_override ?? block, cube.if)) continue;
        delete cube.if;
      }
      if ('terrain_texture' in cube) cube.terrain_texture = this.interpolate(cube.block_override ?? block, cube.terrain_texture, cube);
      if ('copy' in cube) {
        if (cube.copy === blockShape) { this.warn(`cannot copy the same block shape: ${blockShape}`); continue; }
        let copied: any[] = clone(this.geos[cube.copy]);
        if (!copied) { this.warn(`no geometry for block shape ${cube.copy}; using "block"`); copied = clone(this.geos.block); }
        const fields = Object.keys(cube).filter((f) => !['copy', 'rot', 'pivot', 'translate'].includes(f));
        for (const cc of copied) {
          if ('translate' in cube) cc.translate = addVec3(cc.translate ?? [0, 0, 0], cube.translate);
          for (const field of fields) {
            if (field === 'flip_textures_horizontally' || field === 'flip_textures_vertically') {
              const set = new Set<string>(cc[field] ?? []);
              for (const face of cube[field]) set.has(face) ? set.delete(face) : set.add(face);
              cc[field] = [...set];
            } else if (typeof cc[field] === 'object' && cc[field] !== null) {
              cc[field] = { ...cube[field], ...cc[field] }; // the copied cube's own fields win
            } else {
              cc[field] ??= clone(cube[field]);
            }
          }
          if ('rot' in cube) {
            if ('rot' in cc) {
              cc.extra_rots ??= [];
              cc.extra_rots.unshift({ rot: cube.rot, pivot: cube.pivot ?? [8, 8, 8] });
            } else {
              cc.rot = cube.rot;
              cc.pivot = cube.pivot ?? cc.pivot;
            }
          }
        }
        unfiltered.push(...copied);
      } else if ('copy_block' in cube) {
        const m = /^entity\.(.+)$/.exec(cube.copy_block);
        if (!m) { this.warn(`badly formatted copy_block: ${cube.copy_block}`); continue; }
        const toCopy = clone((block.block_entity_data as any)?.[m[1]]);
        if (!toCopy || typeof toCopy.name !== 'string') { this.warn(`no block entity property ${m[1]} on ${block.name}`); continue; }
        toCopy.name = hpName(toCopy.name);
        if (toCopy.name === 'air') continue;
        toCopy['#copied_via_copy_block'] = true;
        const { faces: newFaces } = this.makeFaces(toCopy, this.shapeOf(toCopy.name));
        if (!newFaces) continue;
        if ('translate' in cube) for (const f of newFaces) for (const v of f.vertices) v.pos = addVec3(v.pos, cube.translate);
        allFaces.push(...newFaces);
      } else {
        filtered.push(cube);
      }
    }
    if (filtered.length === 0) return allFaces.length ? { faces: allFaces } : {};

    const cubes = this.optimizeGeometry(filtered);
    cubes.sort((a, b) => a.size[0] * a.size[1] * a.size[2] - b.size[0] * b.size[1] * b.size[2]); // larger cubes later (slime, honey)

    const blockName = block.name;
    const variant = this.textureVariant(block);
    let variantWithoutEigen: number | undefined;
    let allCubesAreFlat = true;
    for (const cube of cubes) {
      const uv = this.calculateUv(cube);
      const [w, h, d] = cube.size as Vec3;
      // a zero-thickness cube keeps one face; it is drawn double-sided
      if (w === 0) for (const f of ['east', 'down', 'up', 'north', 'south']) delete uv[f];
      if (h === 0) for (const f of ['west', 'east', 'up', 'north', 'south']) delete uv[f];
      if (d === 0) for (const f of ['west', 'east', 'down', 'up', 'south']) delete uv[f];

      let cubeVariant: number;
      if ('variant' in cube) cubeVariant = cube.variant;
      else if (cube.ignore_eigenvariant) {
        if ('block_override' in cube) cubeVariant = this.textureVariant(cube.block_override, true);
        else cubeVariant = variantWithoutEigen ??= this.textureVariant(block, true);
      } else if ('block_override' in cube) cubeVariant = this.textureVariant(cube.block_override);
      else cubeVariant = variant;

      const faces: HpFace[] = [];
      const textureSize: Vec2 = cube.texture_size ?? [16, 16];
      for (const [faceName, face] of Object.entries(uv)) {
        const isSide = SIDE_FACES.includes(faceName);
        let textureFace: string = cube.textures?.[faceName] ?? (isSide ? cube.textures?.side : undefined) ?? cube.textures?.['*'] ?? faceName;
        if (textureFace === 'none') continue;
        textureFace = this.interpolate(cube.block_override ?? block, textureFace, cube);
        const ref: HpTextureRef = {
          uv: [face.uv[0] / textureSize[0], face.uv[1] / textureSize[1]],
          uv_size: [face.uv_size[0] / textureSize[0], face.uv_size[1] / textureSize[1]],
          block_name: blockName,
          texture_face: textureFace,
          variant: cubeVariant,
        };
        if (textureFace === '#tex') {
          if (specialTexture) ref.texture_path_override = specialTexture;
          else this.warn(`no #tex for block ${blockName} (shape ${blockShape})`);
        } else if (/^textures\/.+[^/]$/.test(textureFace)) {
          ref.texture_path_override = textureFace;
        } else if (cube.terrain_texture) {
          delete ref.block_name;
          delete ref.texture_face;
          ref.terrain_texture_override = cube.terrain_texture;
        }
        if (ref.texture_path_override) { delete ref.block_name; delete ref.texture_face; delete ref.variant; }
        if ('tint' in cube) {
          const tint = this.interpolate(cube.block_override ?? block, String(cube.tint), cube);
          if (tint[0] === '#') ref.tint = hexColorToClampedTriplet(tint);
          else { const code = 2 ** 32 + Number(tint); ref.tint = [(code >> 16) & 0xff, (code >> 8) & 0xff, code & 0xff].map((x) => x / 255) as Vec3; } // cauldron: 32-bit ARGB
        }

        const vertices = this.getVertices(cube, faceName);
        let uvRot: number | undefined = cube.uv_rot?.[faceName] ?? (isSide ? cube.uv_rot?.side : undefined) ?? cube.uv_rot?.['*'];
        if (uvRot) {
          while (uvRot >= 90) {
            [vertices[0].corner, vertices[1].corner, vertices[3].corner, vertices[2].corner] = [vertices[2].corner, vertices[0].corner, vertices[1].corner, vertices[3].corner];
            uvRot -= 90;
          }
          while (uvRot <= -90) {
            [vertices[2].corner, vertices[0].corner, vertices[1].corner, vertices[3].corner] = [vertices[0].corner, vertices[1].corner, vertices[3].corner, vertices[2].corner];
            uvRot += 90;
          }
        }
        const has = (list: string[] | undefined, f: string) => !!list?.includes(f);
        let flipH = +has(cube.flip_textures_horizontally, faceName) ^ +(isSide && has(cube.flip_textures_horizontally, 'side')) ^ +has(cube.flip_textures_horizontally, '*');
        let flipV = +has(cube.flip_textures_vertically, faceName) ^ +(isSide && has(cube.flip_textures_vertically, 'side')) ^ +has(cube.flip_textures_vertically, '*');
        if ('box_uv' in cube) { // box UV flips some faces by itself
          flipH ^= +(faceName !== 'north' && faceName !== 'south');
          flipV ^= +(faceName === 'up');
        }
        const upDown = +(faceName === 'down' || faceName === 'up'); // up/down faces are turned 180° in MC: flip both axes
        if (upDown ^ flipH) {
          [vertices[0].corner, vertices[1].corner] = [vertices[1].corner, vertices[0].corner];
          [vertices[2].corner, vertices[3].corner] = [vertices[3].corner, vertices[2].corner];
        }
        if (upDown ^ flipV) {
          [vertices[0].corner, vertices[2].corner] = [vertices[2].corner, vertices[0].corner];
          [vertices[1].corner, vertices[3].corner] = [vertices[3].corner, vertices[1].corner];
        }
        for (const v of vertices) {
          if ('rot' in cube) v.pos = this.applyEulerRotation(v.pos, cube.rot, cube.pivot ?? [8, 8, 8]);
          const extra: any[] = cube.extra_rots ?? [];
          for (let i = extra.length - 1; i >= 0; i--) v.pos = this.applyEulerRotation(v.pos, extra[i].rot, extra[i].pivot);
          if ('translate' in cube) v.pos = addVec3(v.pos, cube.translate);
          if ('transform' in cube) {
            const t = mulMat4(cube.transform, v.pos);
            v.pos = mulVec3([t[0], t[1], t[2]], 1 / t[3]);
          }
        }
        faces.push({
          normal: this.surfaceNormal(vertices), tex: ref, vertices, fullbright: !!cube.fullbright,
          flat: w === 0 || h === 0 || d === 0, face: faceName,
        });
      }
      const closed = faces.length === 6 && !(w === 0 || h === 0 || d === 0);
      for (const f of faces) f.open = !closed;
      if (faces.length === 1 && !('culled_faces' in cube)) {
        if (faces[0].normal[1] < 0) faces[0].normal = mulVec3(faces[0].normal, -1);
      } else allCubesAreFlat = false;
      allFaces.push(...faces);
    }
    if (allCubesAreFlat) for (const f of allFaces) f.fullbright = true; // only flat textures: always at full brightness
    return { faces: allFaces };
  }

  // ------------------------------------------------------------ rotations

  private blockRotation(block: HpBlock, blockShape: string): Vec3 | null {
    const byShape = this.shapeRotations.get(blockShape);
    const byName = this.nameRotations.get(block.name);
    let rotation: Vec3 | null = null;
    for (const [k, v] of this.statesAndEntityData(block)) {
      const rotations = byName?.[k] ?? byShape?.[k] ?? this.globalRotations[k];
      if (!rotations) continue;
      if (!(String(v) in rotations)) { this.warn(`rotation state ${k}=${v} not found on ${block.name}`); continue; }
      rotation = rotation ? addVec3(rotation, rotations[String(v)]) : rotations[String(v)];
    }
    return rotation;
  }

  /** Euler rotation in the order X, Y, Z (angles in degrees, negated as in HoloPrint). */
  private applyEulerRotation(pos: Vec3, rot: Vec3, pivot: Vec3): Vec3 {
    const r = subVec3(pos, pivot);
    [r[1], r[2]] = rotateDeg([r[1], r[2]], -rot[0]);
    [r[0], r[2]] = rotateDeg([r[0], r[2]], -rot[1]);
    [r[0], r[1]] = rotateDeg([r[0], r[1]], -rot[2]);
    return addVec3(r, pivot);
  }

  private statesAndEntityData(block: HpBlock): [string, unknown][] {
    return [...Object.entries(block.states ?? {}), ...Object.entries(block.block_entity_data ?? {}).map(([k, v]) => [`entity.${k}`, v] as [string, unknown])];
  }

  // ------------------------------------------------------------ merging / inner-face culling

  private optimizeGeometry(cubes: any[]): any[] {
    const unoptimizable = cubes.filter((c) => 'rot' in c), optimizable = cubes.filter((c) => !('rot' in c));
    for (const c of optimizable) if ('translate' in c) c.pos = addVec3(c.pos, c.translate);
    const groups = new Map(optimizable.map((c) => [c, this.mergingGroup(c)] as [any, number | string]));
    const merged: any[] = [];
    for (let cube1 of optimizable) {
      tryMerging: while (true) {
        for (const [i, cube2] of merged.entries()) {
          const mergeable = groups.get(cube1) === groups.get(cube2); // NaN never equals NaN
          if (this.tryMergeOneWayAndCull(cube1, cube2, mergeable)) {
            this.restoreCulled(cube1);
            merged.splice(i, 1);
            continue tryMerging;
          } else if (this.tryMergeOneWayAndCull(cube2, cube1, mergeable)) {
            this.restoreCulled(cube2);
            merged.splice(i, 1);
            cube1 = cube2;
            continue tryMerging;
          }
        }
        break;
      }
      merged.push(cube1);
    }
    for (const c of merged) if ('translate' in c) c.pos = subVec3(c.pos, c.translate);
    return [...unoptimizable, ...merged];
  }

  private restoreCulled(cube: any) {
    for (const [face, before] of Object.entries<any>(cube.culled_faces ?? {})) {
      if (before) cube.textures[face] = before;
      else delete cube.textures[face];
    }
    delete cube.culled_faces;
  }

  private mergingGroup(cube: any): number | string {
    if (cube.disable_merging || 'translate' in cube || 'uv' in cube || 'uv_sizes' in cube || 'uv_rot' in cube || 'box_uv' in cube) return NaN;
    return JSON.stringify([cube.id, cube.textures, cube.texture_size, cube.block_override, cube.terrain_texture, cube.variant, cube.ignore_eigenvariant, cube.tint, cube.fullbright, cube.flip_textures_horizontally, cube.flip_textures_vertically, cube.arrays, cube.neo_special_texture]); // neoHoloprintDB adds `id`: cubes with different ids stay separate
  }

  private tryMergeOneWayAndCull(c1: any, c2: any, mergeable: boolean): boolean {
    const [x1, y1, z1] = c1.pos, [w1, h1, d1] = c1.size, [x2, y2, z2] = c2.pos, [w2, h2, d2] = c2.size;
    if (x1 + w1 === x2) {
      if (mergeable && y1 === y2 && z1 === z2 && h1 === h2 && d1 === d2) { c1.size[0] += w2; return true; }
    } else if (y1 + h1 === y2) {
      if (mergeable && x1 === x2 && z1 === z2 && w1 === w2 && d1 === d2) { c1.size[1] += h2; return true; }
    } else if (z1 + d1 === z2) {
      if (mergeable && x1 === x2 && y1 === y2 && w1 === w2 && h1 === h2) { c1.size[2] += d2; return true; }
    }
    if (w1 === 0 || h1 === 0 || d1 === 0 || w2 === 0 || h2 === 0 || d2 === 0) return false; // flat cubes are never culled
    const cull = (c: any, face: string) => {
      c.textures ??= {};
      if (c.textures[face] !== 'none') { c.culled_faces ??= {}; c.culled_faces[face] = c.textures[face]; }
      c.textures[face] = 'none';
    };
    if (x1 < x2 && x1 + w1 >= x2 && x1 + w1 <= x2 + w2) {
      if (y1 >= y2 && y1 + h1 <= y2 + h2 && z1 >= z2 && z1 + d1 <= z2 + d2) cull(c1, 'west');
      if (y2 >= y1 && y2 + h2 <= y1 + h1 && z2 >= z1 && z2 + d2 <= z1 + d1) cull(c2, 'east');
    }
    if (y1 < y2 && y1 + h1 >= y2 && y1 + h1 <= y2 + h2) {
      if (x1 >= x2 && x1 + w1 <= x2 + w2 && z1 >= z2 && z1 + d1 <= z2 + d2) cull(c1, 'up');
      if (x2 >= x1 && x2 + w2 <= x1 + w1 && z2 >= z1 && z2 + d2 <= z1 + d1) cull(c2, 'down');
    }
    if (z1 < z2 && z1 + d1 >= z2 && z1 + d1 <= z2 + d2) {
      if (x1 >= x2 && x1 + w1 <= x2 + w2 && y1 >= y2 && y1 + h1 <= y2 + h2) cull(c1, 'south');
      if (x2 >= x1 && x2 + w2 <= x1 + w1 && y2 >= y1 && y2 + h2 <= y1 + h1) cull(c2, 'north');
    }
    return false;
  }

  // ------------------------------------------------------------ texture variants

  /** Index into a terrain_texture.json texture array; -1 = not decided by states. */
  textureVariant(block: HpBlock, ignoreEigenvariant = false): number {
    const name = block.name;
    const eigen = name in this.eigenvariants;
    if (!ignoreEigenvariant && eigen) return this.eigenvariants[name];
    if (!block.states && !block.block_entity_data) return -1;
    const shape = this.shapeOf(name); // the original block's shape, also for copied shapes
    const entries = this.statesAndEntityData(block);
    const byShape = this.shapeVariants.get(splitSpecialTexture(shape).shape) ?? this.shapeVariants.get(shape);
    const exclusiveAdd = (defs: any) => {
      let v = 0;
      for (const [k, val] of entries) {
        if (!(k in defs)) continue;
        if (!(String(val) in defs[k])) { this.warn(`texture variant ${k}=${val} not found on ${name}`); continue; }
        v += defs[k][String(val)];
      }
      return v;
    };
    if (byShape?.['#exclusive_add']) return exclusiveAdd(byShape);
    const byName = this.nameVariants.get(name) ?? this.namePatternVariants.find(([re]) => re.test(name))?.[1];
    if (byName?.['#exclusive_add']) return exclusiveAdd(byName);
    let variant = -1;
    for (const [k, val] of entries) {
      const defs = byName?.[k] ?? byShape?.[k] ?? this.globalVariants[k];
      if (defs == undefined) continue;
      if (!(String(val) in defs)) { this.warn(`texture variant ${k}=${val} not found on ${name}`); continue; }
      variant = defs[String(val)];
    }
    return variant;
  }

  // ------------------------------------------------------------ UVs and vertices

  private calculateUv(cube: any): Record<string, { uv: Vec2; uv_size: Vec2 }> {
    const [x, y, z] = cube.pos as Vec3, [w, h, d] = cube.size as Vec3;
    if ('box_uv' in cube) {
      const s: Vec3 = cube.box_uv_size ?? cube.size;
      const uv: Record<string, { uv: Vec2; uv_size: Vec2 }> = {
        up: { uv: [s[2], 0], uv_size: [s[0], s[2]] },
        down: { uv: [s[0] + s[2], 0], uv_size: [s[0], s[2]] },
        west: { uv: [0, s[2]], uv_size: [s[2], s[1]] },
        north: { uv: [s[2], s[2]], uv_size: [s[0], s[1]] },
        east: { uv: [s[0] + s[2], s[2]], uv_size: [s[2], s[1]] },
        south: { uv: [s[0] + s[2] * 2, s[2]], uv_size: [s[0], s[1]] },
      };
      for (const f of Object.values(uv)) f.uv = addVec2(f.uv, cube.box_uv);
      return uv;
    }
    // Bedrock projects the texture of the full block face onto the cube face and cuts it out (see how fences look)
    const pick = (face: string, side: boolean, dflt: Vec2, dfltSize: Vec2) => ({
      uv: cube.uv?.[face] ?? (side ? cube.uv?.side : undefined) ?? cube.uv?.['*'] ?? dflt,
      uv_size: cube.uv_sizes?.[face] ?? (side ? cube.uv_sizes?.side : undefined) ?? cube.uv_sizes?.['*'] ?? dfltSize,
    });
    return {
      west: pick('west', true, [z, 16 - y - h], [d, h]),
      east: pick('east', true, [16 - z - d, 16 - y - h], [d, h]),
      down: pick('down', false, [16 - x - w, 16 - z - d], [w, d]),
      up: pick('up', false, [16 - x - w, z], [w, d]),
      north: pick('north', true, [x, 16 - y - h], [w, h]),
      south: pick('south', true, [16 - x - w, 16 - y - h], [w, h]),
    };
  }

  private getVertices(cube: any, faceName: string): [HpVertex, HpVertex, HpVertex, HpVertex] {
    const { pos, size } = cube;
    const corners: Record<string, number[][]> = {
      west: [[1, 1, 0], [1, 1, 1], [1, 0, 0], [1, 0, 1]],
      east: [[0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 0, 0]],
      down: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]],
      up: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]],
      north: [[0, 1, 0], [1, 1, 0], [0, 0, 0], [1, 0, 0]],
      south: [[1, 1, 1], [0, 1, 1], [1, 0, 1], [0, 0, 1]],
    };
    return corners[faceName].map(([a, b, c], i) => ({
      pos: [pos[0] + size[0] * a, pos[1] + size[1] * b, pos[2] + size[2] * c] as Vec3,
      corner: i,
    })) as [HpVertex, HpVertex, HpVertex, HpVertex];
  }

  private surfaceNormal(v: HpVertex[]): Vec3 {
    return normalizeVec3(crossProduct(subVec3(v[1].pos, v[0].pos), subVec3(v[2].pos, v[0].pos)));
  }

  // ------------------------------------------------------------ conditionals and interpolation

  checkConditional(block: HpBlock, conditional: string): boolean {
    const trimmed = conditional.replace(/\s/g, '');
    const ops = trimmed.match(/&&|\|\|/g) ?? [];
    const values = trimmed.split(/&&|\|\|/).map((expr) => {
      if (expr === '#copied_via_copy_block') return block['#copied_via_copy_block'] === true;
      if (expr === '!#copied_via_copy_block') return block['#copied_via_copy_block'] !== true;
      const m = /^((?:entity\.)?[\w:&-?]+)(==|>|<|>=|<=|!=)(-?\w+)$/.exec(expr);
      if (!m) { this.warn(`badly formatted condition "${expr}" in "${conditional}"`); return true; }
      const [, term, op, expected] = m;
      const tm = /^(entity\.)?([\w:]+)(?:(\?\?|&)(-?\d+))?$/.exec(term);
      if (!tm) { this.warn(`badly formatted condition term ${term}`); return true; }
      const [, usingEntity, name, operator, operandString] = tm;
      const obj = (usingEntity ? block.block_entity_data : block.states) as Record<string, any> | undefined;
      if (!obj) { this.warn(`no ${usingEntity ? 'block entity data' : 'states'} on ${block.name}`); return true; }
      if (operator !== '??' && !(name in obj)) { this.warn(`missing ${usingEntity ? 'entity.' : ''}${name} on ${block.name}`); return true; }
      let actual: any = obj[name];
      if (operator) {
        const operand = Number(operandString);
        if (Number.isNaN(operand)) { this.warn(`operand ${operandString} is not a number`); return true; }
        actual = operator === '&' ? actual & operand : actual ?? operand;
      }
      switch (op) {
        // loose comparisons on purpose: states can be numbers, strings or booleans in NBT and in the data
        case '==': return actual == expected;
        case '>': return actual > expected;
        case '<': return actual < expected;
        case '>=': return actual >= expected;
        case '<=': return actual <= expected;
        case '!=': return actual != expected;
      }
      return true;
    });
    const andRes: boolean[] = [values[0]]; // && before ||
    ops.forEach((op, i) => {
      if (op === '&&') andRes[andRes.length - 1] &&= values[i + 1];
      else andRes.push(values[i + 1]);
    });
    return andRes.some((x) => x);
  }

  interpolate(block: HpBlock, full: string, cube: any): string {
    let whole: string | undefined;
    const out = full.replace(/\$\{([^}]+)\}/g, (bracketed, expression: string) => {
      if (whole !== undefined) return '';
      const am = /^Array\.(\w+)\[([^[]+)\]$/.exec(expression);
      if (am) {
        const [, arrayName, indexVar] = am;
        const arr = cube?.arrays?.[arrayName];
        if (!arr) { this.warn(`no array ${arrayName}`); return ''; }
        let index: any;
        if (indexVar.startsWith('entity.')) {
          const p = indexVar.slice(7);
          if (!block.block_entity_data || !(p in block.block_entity_data)) { this.warn(`no block entity property ${p} on ${block.name}`); return ''; }
          index = block.block_entity_data[p];
        } else {
          if (!block.states || !(indexVar in block.states)) { this.warn(`no block state ${indexVar} on ${block.name}`); return ''; }
          index = block.states[indexVar];
        }
        if (!(index in arr)) { this.warn(`array index out of bounds: ${arrayName}[${index}]`); return ''; }
        return arr[index];
      }
      const m = /^(#block_name|#block_states|#block_entity_data)((?:\.\w+|\[-?\d+\])*)(\[(-?\d+):(-?\d*)\]|\[:(-?\d+)\])?(?:\?\?(.+))?$/.exec(expression.replace(/\s/g, ''));
      if (!m) { this.warn(`badly formatted expression ${bracketed}`); return ''; }
      const [, special, chain, ...sliceAndDefault] = m;
      let value: any = special === '#block_name' ? block.name : special === '#block_states' ? block.states : block.block_entity_data;
      for (const prop of chain.match(/\.\w+|\[-?\d+\]/g) ?? []) {
        const keys = /^\.(\w+)|\[(\d+)\]$/.exec(prop)!;
        value = value?.[keys[1] ?? keys[2]];
      }
      if (sliceAndDefault[0] !== undefined) {
        value = value?.slice(sliceAndDefault[1] === undefined ? undefined : Number(sliceAndDefault[1]),
          sliceAndDefault[3] !== undefined ? Number(sliceAndDefault[3]) : sliceAndDefault[2] === '' ? undefined : Number(sliceAndDefault[2]));
      }
      if (value == undefined || value === '') {
        if (sliceAndDefault[4] !== undefined) {
          const dflt = sliceAndDefault[4];
          const sw = /SET_WHOLE_STRING\(([^)]+)\)/.exec(dflt);
          if (sw) { whole = sw[1]; return ''; }
          value = dflt;
        } else { this.warn(`nothing for ${special}${chain} on ${block.name}`); return ''; }
      }
      return String(value);
    });
    return whole ?? out;
  }
}

export { FACE_NAMES };

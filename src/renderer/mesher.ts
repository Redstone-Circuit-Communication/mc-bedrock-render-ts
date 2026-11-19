import { BlockContext, BlockRef, BlockRegistry, createDefaultRegistry, stripNamespace } from './blocks';
import {
  BlockModel, DIRS, DIR_VEC, Dir, Element, FaceSpec, Tint, V3, cubeModel, rotX, rotY, rotateDir,
} from './models';
import { Atlas, MISSING_TEXTURE, ResourcePack, ResourceStack, buildAtlas } from './resources';
import { EntityRecord, TextureBatch, buildEntityBatches } from './entity';
import { LayerBuilder, MeshLayerData } from './layer';
import { McStructure } from './structure';
import { DEFAULT_TINTS, FACE_VERTS, autoCull, defaultUv, elementRotate, elementRotateDir, shadeOf, tintToRgb } from './face';
import { emitPalette, pause } from './mesher-palette';
import type { MeshChunk } from './mesher-palette';

export type { MeshLayerData } from './layer';
export type { MeshChunk } from './mesher-palette';
export { abortError, isAbortError } from './mesher-palette';

// ------------------------------------------------------------------ types ---

export interface StructureMesh {
  /** Opaque + alpha-tested geometry. */
  solid: MeshLayerData;
  /** Alpha-blended geometry (stained glass, water, ice …). */
  translucent: MeshLayerData;
  atlas: Atlas;
  /** Entities and block entities: one batch per entity texture. */
  entityBatches: TextureBatch[];
  /** Every entity / block entity of the structure and how it was drawn. */
  entityRecords: EntityRecord[];
  size: V3;
  stats: {
    blocks: number;
    faces: number;
    /** Block ids the registry has no model for. */
    unknownBlocks: string[];
    /** Texture refs missing from the resource pack(s). */
    missingTextures: string[];
    /** Entities + block entities that actually produced faces. */
    entities: number;
    /** Entity identifiers without a client entity definition in the pack(s). */
    unknownEntities: string[];
    /** Entities that have a definition but drew no faces (their model / texture is missing, or they are invisible at rest). */
    undrawnEntities: string[];
    /** Entity texture paths missing from the pack(s). */
    missingEntityTextures: string[];
    /** Which mesher produced the blocks: `ts` (shared TypeScript core) or `legacy` (single pass). `wasm` stays in the type for compatibility; since 1.6.0 it never occurs. */
    meshBackend: 'wasm' | 'ts' | 'legacy';
    /** Milliseconds per stage (model resolution, atlas, block meshing, entities and the palette mesher's own steps) plus two counters of the palette mesher. */
    timings: Record<string, number>;
  };
}

export interface MeshOptions {
  /** Provide your own registry to add / override block shapes. */
  registry?: BlockRegistry;
  /** What to do with blocks that have no model. Default `placeholder`. */
  unknownBlocks?: 'placeholder' | 'skip';
  /** Biome colours (0xRRGGBB). */
  tints?: { grass?: number; foliage?: number; water?: number };
  /**
   * Darken the corners of faces next to solid blocks the way the game's smooth lighting does (default true). Only the
   * palette backends (`ts`, `wasm`) compute it; `legacy` draws without.
   */
  ambientOcclusion?: boolean;
  /** Render the second block layer (waterlogging). Default true. */
  liquidLayer?: boolean;
  /** Render entities and block entities (beds, shulker boxes, heads). Default true. */
  entities?: boolean;
  /**
   * How the blocks are meshed. `ts` (default): palette items + 16³ chunks through the shared TypeScript mesh core;
   * `legacy`: the original single-pass mesher. `wasm` is accepted and gives `ts`: the embedded wasm builder was removed in 1.6.0
   * (its source is schematic-renderer's, AGPL-3.0; see NOTICE.md).
   */
  backend?: 'wasm' | 'ts' | 'legacy';
}

export { DEFAULT_TINTS } from './face';

/**
 * Progressive loading (the renderer's `chunkLoading`): the texture atlas is handed out first, then every non-empty 16³
 * chunk as soon as it is meshed (bottom layer first), each taking at least `minChunkMs`. The promise still resolves with
 * the whole mesh (stats, entity batches) at the end. The legacy mesher has no chunks: its result comes as one chunk.
 */
export interface MeshProgress {
  onAtlas?(atlas: Atlas, size: V3): void | Promise<void>;
  onChunk?(chunk: MeshChunk, done: number, total: number): void | Promise<void>;
  minChunkMs?: number;
  /** Cancels between two chunks with an `AbortError`. */
  signal?: AbortSignal;
}

// --------------------------------------------------------------- geometry ---

/** Every texture ref a model uses. */
function collectRefs(m: BlockModel, into: Set<string>): void {
  for (const el of m.elements) for (const d of DIRS) { const f = el.faces[d]; if (f) into.add(f.tex); }
  for (const q of m.quads ?? []) into.add(q.tex);
}

const WATER_NAMES = new Set(['water', 'flowing_water']);
/** Blocks whose handler always returns `null` (nothing to draw here), so the result can be cached per palette entry. */
const ALWAYS_NULL = /^(air|cave_air|void_air|structure_void|barrier|light_block|light|allow|deny|border_block|invisible_bedrock|bed|skull|.+_head|.+_skull|(.+_)?shulker_box|piston_arm_collision|sticky_piston_arm_collision|moving_block|movingblock|bubble_column)$/;

// ------------------------------------------------------------------ main ---

/**
 * Turn a parsed structure into GPU-ready vertex data plus a texture atlas.
 * `resources` may be a pack, a list of packs (later ones win) or a stack.
 */
export async function buildStructureMesh(
  structure: McStructure,
  resources: ResourceStack | ResourcePack | ResourcePack[],
  opts: MeshOptions = {},
  progress?: MeshProgress,
): Promise<StructureMesh> {
  const stack = resources instanceof ResourceStack ? resources
    : new ResourceStack(Array.isArray(resources) ? resources : [resources]);
  const T0 = performance.now();
  const registry = opts.registry ?? createDefaultRegistry();
  const tints = { ...DEFAULT_TINTS, ...opts.tints };
  const [sx, sy, sz] = structure.size;

  // palette → BlockRef
  const refs: BlockRef[] = structure.palette.map((p) => ({ name: stripNamespace(p.name), states: p.states }));
  const refAt = (x: number, y: number, z: number): BlockRef | null => {
    const pi = structure.paletteIndexAt(x, y, z, 0);
    return pi < 0 ? null : refs[pi] ?? null;
  };
  const hasWater = (x: number, y: number, z: number): boolean => {
    if (opts.liquidLayer === false) return false;
    const pi = structure.paletteIndexAt(x, y, z, 1);
    return pi >= 0 && !!refs[pi] && WATER_NAMES.has(refs[pi].name);
  };

  // ---- pass 1: resolve a model for every cell
  const total = sx * sy * sz;
  const models: (BlockModel | null)[] = new Array(total).fill(null);
  const liquid = new Uint8Array(total);
  const staticCache = new Map<number, BlockModel | null>();
  const unknown = new Set<string>();
  const textureRefs = new Set<string>([MISSING_TEXTURE]);
  let blockCount = 0;

  const makeCtx = (x: number, y: number, z: number, ref: BlockRef): BlockContext => ({
    name: ref.name,
    states: ref.states,
    x, y, z,
    neighbor: (dx, dy, dz) => refAt(x + dx, y + dy, z + dz),
    isOpaque: (dx, dy, dz) => {
      const n = refAt(x + dx, y + dy, z + dz);
      return !!n && registry.traits(n, stack).opaque;
    },
    blockEntity: structure.blockEntityAt(x, y, z),
    resources: stack,
  });

  for (let x = 0; x < sx; x++)
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++) {
        const i = structure.index(x, y, z);
        const pi = structure.layers[0]?.[i] ?? -1;
        if (hasWater(x, y, z)) liquid[i] = 1;
        if (pi < 0) continue;
        const ref = refs[pi];
        if (!ref) continue;

        let model: BlockModel | null | undefined;
        if (staticCache.has(pi)) model = staticCache.get(pi);
        else {
          try { model = registry.resolve(makeCtx(x, y, z, ref)); }
          catch (err) { console.warn(`mcstructure-renderer: model for ${ref.name} failed`, err); model = undefined; }
          if (model && model.static) staticCache.set(pi, model);
          else if (model === null && ALWAYS_NULL.test(ref.name)) staticCache.set(pi, null);
        }
        if (model === undefined) {
          unknown.add(ref.name);
          model = opts.unknownBlocks === 'skip' ? null : { ...cubeModel(MISSING_TEXTURE), static: true };
        }
        if (model) {
          models[i] = model;
          collectRefs(model, textureRefs);
          blockCount++;
        }
      }

  // water for the liquid layer (and plain water blocks are handled by the registry)
  const waterModelFor = (x: number, y: number, z: number): BlockModel | null => {
    const m = registry.resolve(makeCtx(x, y, z, { name: 'water', states: { liquid_depth: 0 } }));
    return m ?? null;
  };
  const liquidModels = new Map<number, BlockModel>();
  for (let i = 0; i < total; i++) {
    if (!liquid[i]) continue;
    const z = i % sz, y = Math.floor(i / sz) % sy, x = Math.floor(i / (sz * sy));
    const cur = models[i];
    if (cur && cur.cullKey === 'water') continue;
    const wm = waterModelFor(x, y, z);
    if (wm) { liquidModels.set(i, wm); collectRefs(wm, textureRefs); }
  }

  const T1 = performance.now();
  const atlas = await buildAtlas(stack, textureRefs, tints);
  await progress?.onAtlas?.(atlas, [sx, sy, sz]);
  await pause(0, progress?.signal);
  const T2 = performance.now();

  // ---- pass 2: emit geometry
  const emitLegacy = () => {
    const solid = new LayerBuilder();
    const translucent = new LayerBuilder();
    let faceCount = 0;

    // opaque cells as a flat byte map: the culling test below runs once per candidate face
    const opaque = new Uint8Array(total);
    for (let i = 0; i < total; i++) if (models[i]?.opaque) opaque[i] = 1;

    /** Identity used by `cullSame` for the neighbouring cell (glass next to glass, water next to water …). */
    const keyAt = (i: number, x: number, y: number, z: number): string | undefined => {
      const m = models[i];
      if (m?.cullSame) return m.cullKey ?? refAt(x, y, z)?.name;
      if (liquid[i]) return 'water';
      if (m && m.cullKey) return m.cullKey;
      return undefined;
    };

    const emit = (model: BlockModel, x: number, y: number, z: number, selfKey: string | undefined) => {
      const rx = model.rotX ?? 0, ry = model.rotY ?? 0;
      for (const el of model.elements) {
        const layer = el.layer ?? model.layer;
        const builder = layer === 'translucent' ? translucent : solid;
        const alpha = layer === 'translucent' ? el.alpha ?? model.alpha ?? 1 : 1;
        for (const dir of DIRS) {
          const face = el.faces[dir];
          if (!face) continue;

          // --- culling
          const cullDir = face.cull !== undefined ? face.cull : autoCull(el, dir);
          if (cullDir) {
            const wd = rotateDir(cullDir, rx, ry);
            const v = DIR_VEC[wd];
            const nx = x + v[0], ny = y + v[1], nz = z + v[2];
            if (structure.inBounds(nx, ny, nz)) {
              const ni = structure.index(nx, ny, nz);
              if (opaque[ni]) continue;
              if (model.cullSame && selfKey && keyAt(ni, nx, ny, nz) === selfKey) continue;
            }
          }

          // --- positions
          const fv = FACE_VERTS[dir];
          const pts: V3[] = fv.map(([ax, ay, az]) => {
            let p: V3 = [ax ? el.to[0] : el.from[0], ay ? el.to[1] : el.from[1], az ? el.to[2] : el.from[2]];
            if (el.rotation) p = elementRotate(p, el.rotation);
            const q = rotY(rotX([p[0] - 8, p[1] - 8, p[2] - 8], rx), ry);
            return [x + (q[0] + 8) / 16, y + (q[1] + 8) / 16, z + (q[2] + 8) / 16];
          });

          // --- uvs
          const rect = atlas.rects.get(face.tex) ?? atlas.rects.get(MISSING_TEXTURE)!;
          const [u0, v0, u1, v1] = face.uv ?? defaultUv(dir, el.from, el.to);
          const rot = face.rot ?? 0;
          const uvs: [number, number][] = [];
          for (let i = 0; i < 4; i++) {
            const j = (i + 4 - rot / 90) % 4;
            // clamp: an element that sticks out of its cell must not sample the neighbouring atlas tile
            const u = Math.min(16, Math.max(0, j === 0 || j === 1 ? u0 : u1));
            const v = Math.min(16, Math.max(0, j === 0 || j === 3 ? v0 : v1));
            uvs.push([
              rect[0] + (u / 16) * (rect[2] - rect[0]),
              rect[1] + (v / 16) * (rect[3] - rect[1]),
            ]);
          }

          // --- colour (shading × tint)
          let n: V3 = DIR_VEC[dir];
          if (el.rotation) n = elementRotateDir(n, el.rotation);
          n = rotY(rotX(n, rx), ry);
          const shade = model.emissive || el.shade === false ? 1 : shadeOf(n);
          const [tr, tg, tb] = tintToRgb(face.tint, tints);
          // translucent solids are single-sided (see MeshLayerData.normals); zero-thickness boxes stay double-sided
          const thin = el.from[0] === el.to[0] || el.from[1] === el.to[1] || el.from[2] === el.to[2];
          builder.quad(pts, uvs, [shade * tr, shade * tg, shade * tb, alpha], layer === 'translucent' && !thin ? n : undefined);
          faceCount++;
        }
      }
      // free quads (HoloPrint geometry)
      for (const q of model.quads ?? []) {
        const layer = q.layer ?? model.layer;
        const builder = layer === 'translucent' ? translucent : solid;
        const alpha = layer === 'translucent' ? q.alpha ?? model.alpha ?? 1 : 1;
        if (q.cull && !model.noCull) {
          const v = DIR_VEC[rotateDir(q.cull, rx, ry)];
          const nx = x + v[0], ny = y + v[1], nz = z + v[2];
          if (structure.inBounds(nx, ny, nz)) {
            const ni = structure.index(nx, ny, nz);
            if (opaque[ni]) continue;
            if (model.cullSame && selfKey && keyAt(ni, nx, ny, nz) === selfKey) continue;
          }
        }
        const pts: V3[] = q.pos.map((p) => {
          const r = rotY(rotX([p[0] - 8, p[1] - 8, p[2] - 8], rx), ry);
          return [x + (r[0] + 8) / 16, y + (r[1] + 8) / 16, z + (r[2] + 8) / 16] as V3;
        });
        const rect = atlas.rects.get(q.tex) ?? atlas.rects.get(MISSING_TEXTURE)!;
        const uvs = q.uv.map(([u, v]) => [
          rect[0] + (Math.min(16, Math.max(0, u)) / 16) * (rect[2] - rect[0]),
          rect[1] + (Math.min(16, Math.max(0, v)) / 16) * (rect[3] - rect[1]),
        ] as [number, number]);
        const n = rotY(rotX(q.normal, rx), ry);
        const shade = model.emissive || q.shade === false ? 1 : shadeOf(n);
        const [tr, tg, tb] = tintToRgb(q.tint, tints);
        builder.quad(pts, uvs, [shade * tr, shade * tg, shade * tb, alpha], layer === 'translucent' && !q.flat ? n : undefined);
        faceCount++;
      }
    };

    for (let x = 0; x < sx; x++)
      for (let y = 0; y < sy; y++)
        for (let z = 0; z < sz; z++) {
          const i = structure.index(x, y, z);
          const m = models[i];
          if (m) emit(m, x, y, z, m.cullKey ?? refAt(x, y, z)?.name);
          const lm = liquidModels.get(i);
          if (lm) emit(lm, x, y, z, 'water');
        }
    return { solid: solid.finish(), translucent: translucent.finish(), faceCount, backend: 'legacy' as const };
  };

  const onChunk = progress?.onChunk;
  const stream = onChunk ? { onChunk, minChunkMs: progress?.minChunkMs, signal: progress?.signal } : undefined;
  const palette = opts.backend === 'legacy' ? null : await emitPalette({
    structure, models, liquidModels, atlas, tints, backend: opts.backend ?? 'ts', ambientOcclusion: opts.ambientOcclusion ?? true,
    nameAt: (x, y, z) => refAt(x, y, z)?.name, stream,
  });
  let emitted: Awaited<ReturnType<typeof emitPalette>> | ReturnType<typeof emitLegacy>;
  if (palette) emitted = palette;
  else {
    emitted = emitLegacy();
    if (onChunk && emitted.faceCount) await onChunk({ solid: emitted.solid, translucent: emitted.translucent, origin: [0, 0, 0] }, 1, 1);
  }
  await pause(0, progress?.signal);
  const T3 = performance.now();

  const ent = opts.entities === false
    ? { batches: [], entities: 0, unknownEntities: [], missingTextures: [], records: [] as EntityRecord[], undrawnEntities: [] as string[] }
    : await buildEntityBatches(structure, stack, undefined, registry);

  return {
    solid: emitted.solid,
    translucent: emitted.translucent,
    atlas,
    entityBatches: ent.batches,
    entityRecords: ent.records,
    size: [sx, sy, sz],
    stats: {
      blocks: blockCount,
      faces: emitted.faceCount,
      unknownBlocks: [...unknown].sort(),
      missingTextures: atlas.missing,
      entities: ent.entities,
      unknownEntities: ent.unknownEntities,
      undrawnEntities: ent.undrawnEntities,
      missingEntityTextures: ent.missingTextures,
      meshBackend: emitted.backend,
      timings: { resolveMs: T1 - T0, atlasMs: T2 - T1, meshMs: T3 - T2, entitiesMs: performance.now() - T3, ...('timings' in emitted ? emitted.timings : {}) },
    },
  };
}

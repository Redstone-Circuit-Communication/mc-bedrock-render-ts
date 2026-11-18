import { MeshBackend, MeshBackendName, createMeshBackend } from '../mesh/backends';
import type { MeshData, PaletteItem } from '../mesh/core/types';
import { FACE_VERTS, Tints, defaultUv, elementRotate, elementRotateDir, shadeOf, tintToRgb } from './face';
import { MeshLayerData } from './layer';
import { BlockModel, DIRS, DIR_VEC, Dir, Element, Quad, V3, rotX, rotY, rotateDir } from './models';
import { Atlas, MISSING_TEXTURE } from './resources';
import { McStructure } from './structure';

/**
 * Palette mesher: every distinct block model becomes a palette item (geometry in block-local coordinates, one geometry
 * per colour), the structure is cut into 16³ chunks, and the shared TypeScript mesh core culls hidden faces and merges
 * the visible ones. Colours (shade × tint × alpha) come from the material
 * of each geometry, so the result is the same vertex-colour mesh the single-pass mesher produces.
 */

export interface PaletteEmitContext {
  structure: McStructure;
  /** Layer-0 model per cell (`structure.index` order). */
  models: (BlockModel | null)[];
  /** Water drawn for the waterlogging layer, per cell. */
  liquidModels: Map<number, BlockModel>;
  nameAt: (x: number, y: number, z: number) => string | undefined;
  atlas: Atlas;
  tints: Tints;
  backend: MeshBackendName;
  chunk?: number;
  /** Hand every chunk out as soon as it is meshed (progressive loading). Without it the chunks are only merged. */
  stream?: ChunkStream;
}

/** One meshed chunk: the geometry of the blocks inside it, in structure (block) coordinates. */
export interface MeshChunk { solid: MeshLayerData; translucent: MeshLayerData; origin: V3 }

/**
 * Progressive loading: every non-empty chunk goes to `onChunk` (awaited) before the next one is meshed, bottom layer first,
 * and a chunk takes at least `minChunkMs` milliseconds (the rest of the time is spent waiting), so a slow device gets the
 * main thread back between chunks. `signal` stops it between two chunks with an `AbortError`.
 */
export interface ChunkStream {
  onChunk(chunk: MeshChunk, done: number, total: number): void | Promise<void>;
  minChunkMs?: number;
  signal?: AbortSignal;
}

/** The `AbortError` both libraries throw when a load is cancelled (a newer load, `dispose`, an aborted signal). */
export function abortError(): Error {
  return typeof DOMException === 'function' ? new DOMException('结构加载已取消', 'AbortError') : Object.assign(new Error('结构加载已取消'), { name: 'AbortError' });
}
export const isAbortError = (e: unknown): boolean => !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw abortError(); }
/** Wait `ms`, or less when `signal` aborts (then throw). */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) { throwIfAborted(signal); return Promise.resolve(); }
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const done = () => { signal?.removeEventListener('abort', stop); resolve(); };
    const timer = setTimeout(done, ms);
    const stop = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

export interface PaletteEmitResult { solid: MeshLayerData; translucent: MeshLayerData; faceCount: number; backend: 'wasm' | 'ts'; timings: Record<string, number> }

type Category = 'solid' | 'translucent';

/** Split a model into its solid and translucent elements (a cell can only hold one palette item per pass). */
function splitByLayer(model: BlockModel): { solid: BlockModel | null; translucent: BlockModel | null } {
  const solid: Element[] = [], trans: Element[] = [];
  for (const el of model.elements) ((el.layer ?? model.layer) === 'translucent' ? trans : solid).push(el);
  const qs: Quad[] = [], qt: Quad[] = [];
  for (const q of model.quads ?? []) ((q.layer ?? model.layer) === 'translucent' ? qt : qs).push(q);
  if (!trans.length && !qt.length) return { solid: model, translucent: null };
  if (!solid.length && !qs.length) return { solid: null, translucent: model };
  return { solid: { ...model, elements: solid, quads: qs }, translucent: { ...model, elements: trans, quads: qt, opaque: false } };
}

/** Does the model draw anything? */
const hasGeometry = (m: BlockModel | null | undefined): m is BlockModel => !!m && (m.elements.length > 0 || (m.quads?.length ?? 0) > 0);

const EMPTY_LAYER = (): MeshLayerData => ({ positions: new Float32Array(0), uvs: new Float32Array(0), colors: new Float32Array(0), indices: new Uint32Array(0) });

export async function emitPalette(ctx: PaletteEmitContext): Promise<PaletteEmitResult> {
  const backend: MeshBackend = await createMeshBackend(ctx.backend);
  try {
    return await build(ctx, backend);
  } finally {
    backend.dispose();
  }
}

async function build(ctx: PaletteEmitContext, backend: MeshBackend): Promise<PaletteEmitResult> {
  const tm: Record<string, number> = { paletteMs: 0, listsMs: 0, backendMs: 0, decodeMs: 0, mergeMs: 0 };
  let tick = performance.now();
  const lap = (k: string) => { const n = performance.now(); tm[k] += n - tick; tick = n; };
  const { structure, models, liquidModels, atlas, tints } = ctx;
  const [sx, sy, sz] = structure.size, total = sx * sy * sz, CH = ctx.chunk ?? 16;

  // ---------------------------------------------------------- palette
  const items: PaletteItem[] = [];
  const materials: [number, number, number, number][] = [];
  const materialIndex = new Map<string, number>();
  /** Materials of faces seen from both sides (planes, faces of boxes that are not closed): their normals reach the core as they are
   *  (it still hides them next to an opaque neighbour) and become zero only in the output, where zero means "draw both sides". */
  const twoSidedMaterial = new Set<number>();
  const material = (c: [number, number, number, number], twoSided = false): number => {
    const k = c.join(',') + (twoSided ? '|2' : '');
    let i = materialIndex.get(k);
    if (i === undefined) { i = materials.length; materials.push(c); materialIndex.set(k, i); if (twoSided) twoSidedMaterial.add(i); }
    return i;
  };

  // ------------------------------------------------------------------ occlusion
  // Which faces of a block hide the neighbour's face next to them. Same rule as the Java package (`getBlockOcclusionFlags`):
  // a direction occludes when completely opaque faces fill its whole 16 × 16 boundary plane. A slab hides what lies
  // against its flat side, a stair hides its back, a piston hides its bottom; a grate or a leaf block (alpha holes) hides
  // nothing. A model used to occlude on all six sides or on none (`model.opaque`), which also let blocks with see-through
  // textures hide the faces behind them.
  const FACE_BIT: Record<Dir, number> = { west: 0, east: 1, down: 2, up: 3, north: 4, south: 5 };
  const texOpaque = new Map<string, boolean>();
  /** Is every pixel of the texture's atlas tile opaque? (the whole tile: conservative for sub-regions of big textures) */
  const isOpaqueTexture = (ref: string): boolean => {
    let v = texOpaque.get(ref);
    if (v !== undefined) return v;
    const r = atlas.rects.get(ref);
    v = !!r;
    if (r) {
      const x0 = Math.round(r[0] * atlas.width), x1 = Math.round(r[2] * atlas.width), y0 = Math.round(r[1] * atlas.height), y1 = Math.round(r[3] * atlas.height);
      scan: for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (atlas.data[(y * atlas.width + x) * 4 + 3] < 255) { v = false; break scan; }
    }
    texOpaque.set(ref, v);
    return v;
  };
  const AXIS: Record<Dir, number> = { west: 0, east: 0, down: 1, up: 1, north: 2, south: 2 };
  const SIGN: Record<Dir, number> = { west: -1, east: 1, down: -1, up: 1, north: -1, south: 1 };
  const occlusionFlags = (model: BlockModel): number => {
    const covered = new Map<Dir, Uint8Array>();
    const mark = (dir: Dir, lo: V3, hi: V3): void => {
      const [b, c] = [0, 1, 2].filter((a) => a !== AXIS[dir]);
      let g = covered.get(dir);
      if (!g) covered.set(dir, (g = new Uint8Array(256)));
      const y0 = Math.max(0, Math.ceil(lo[c] - 0.01)), y1 = Math.min(16, Math.floor(hi[c] + 0.01));
      const x0 = Math.max(0, Math.ceil(lo[b] - 0.01)), x1 = Math.min(16, Math.floor(hi[b] + 0.01));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * 16 + x] = 1;
    };
    for (const el of model.elements) {
      if (el.rotation || (el.layer ?? model.layer) === 'translucent') continue;
      for (const dir of DIRS) {
        const face = el.faces[dir];
        if (!face || !isOpaqueTexture(face.tex)) continue;
        const a = AXIS[dir];
        if (SIGN[dir] > 0 ? el.to[a] < 15.99 : el.from[a] > 0.01) continue; // not on the cell boundary
        mark(dir, el.from, el.to);
      }
    }
    for (const q of model.quads ?? []) {
      if (q.flat || (q.layer ?? model.layer) === 'translucent' || !isOpaqueTexture(q.tex)) continue;
      const dir = DIRS.find((d) => DIR_VEC[d][0] * q.normal[0] + DIR_VEC[d][1] * q.normal[1] + DIR_VEC[d][2] * q.normal[2] > 0.99);
      if (!dir) continue;
      const a = AXIS[dir], plane = SIGN[dir] > 0 ? 16 : 0;
      if (!q.pos.every((p) => Math.abs(p[a] - plane) < 0.01)) continue;
      mark(dir, [0, 1, 2].map((i) => Math.min(...q.pos.map((p) => p[i]))) as V3, [0, 1, 2].map((i) => Math.max(...q.pos.map((p) => p[i]))) as V3);
    }
    let flags = 0;
    const rx = model.rotX ?? 0, ry = model.rotY ?? 0;
    for (const [dir, g] of covered) if (g.every((v) => v === 1)) flags |= 1 << FACE_BIT[rotateDir(dir, rx, ry)];
    return flags;
  };

  /** Geometry of one block (centred on the origin, no culling): the faces of `emit` in the single-pass mesher. */
  /** Does a face (in the block's centred coordinates, the cell is -0.5 … 0.5) reach outside its own cell? */
  const leavesCell = (pts: V3[]): boolean => pts.some((p) => Math.abs(p[0]) > 0.5 + 1e-4 || Math.abs(p[1]) > 0.5 + 1e-4 || Math.abs(p[2]) > 0.5 + 1e-4);
  const geometries = (model: BlockModel, category: Category) => {
    const rx = model.rotX ?? 0, ry = model.rotY ?? 0;
    const acc = new Map<number, { pos: number[]; nor: number[]; uv: number[]; idx: number[] }>();
    for (const el of model.elements) {
      const layer = el.layer ?? model.layer;
      const alpha = layer === 'translucent' ? el.alpha ?? model.alpha ?? 1 : 1;
      for (const dir of DIRS) {
        const face = el.faces[dir];
        if (!face) continue;
        const pts = FACE_VERTS[dir].map(([ax, ay, az]) => {
          let p: V3 = [ax ? el.to[0] : el.from[0], ay ? el.to[1] : el.from[1], az ? el.to[2] : el.from[2]];
          if (el.rotation) p = elementRotate(p, el.rotation);
          const q = rotY(rotX([p[0] - 8, p[1] - 8, p[2] - 8], rx), ry);
          return [q[0] / 16, q[1] / 16, q[2] / 16] as V3; // (q + 8) / 16 − ½
        });
        const rect = atlas.rects.get(face.tex) ?? atlas.rects.get(MISSING_TEXTURE)!;
        const [u0, v0, u1, v1] = face.uv ?? defaultUv(dir, el.from, el.to);
        const rot = face.rot ?? 0;
        const uvs: number[] = [];
        for (let i = 0; i < 4; i++) {
          const j = (i + 4 - rot / 90) % 4;
          const u = Math.min(16, Math.max(0, j === 0 || j === 1 ? u0 : u1));
          const v = Math.min(16, Math.max(0, j === 0 || j === 3 ? v0 : v1));
          uvs.push(rect[0] + (u / 16) * (rect[2] - rect[0]), rect[1] + (v / 16) * (rect[3] - rect[1]));
        }
        let n: V3 = DIR_VEC[dir];
        if (el.rotation) n = elementRotateDir(n, el.rotation);
        n = rotY(rotX(n, rx), ry);
        const shade = model.emissive || el.shade === false ? 1 : shadeOf(n);
        const [tr, tg, tb] = tintToRgb(face.tint, tints);
        const flatEl = el.from[0] === el.to[0] || el.from[1] === el.to[1] || el.from[2] === el.to[2];
        const mi = material([shade * tr, shade * tg, shade * tb, alpha], flatEl || !DIRS.every((d) => el.faces[d]));
        let a = acc.get(mi);
        if (!a) acc.set(mi, (a = { pos: [], nor: [], uv: [], idx: [] }));
        const base = a.pos.length / 3;
        // A zero normal marks a face drawn from both sides (the viewer culls back faces of everything else, as the Java package
        // draws blocks FrontSide) and a face the core never culls (the core takes a face on a cell boundary for a face of THIS cell,
        // which is wrong for one that leaves it). Both sides: zero-thickness planes, and every face of a box that is not closed —
        // through its missing side the backs of the others show (a hopper's rims). A closed box's backs are always hidden.
        const flat = category === 'translucent' && flatEl;
        const keep = flat || model.noCull || leavesCell(pts);
        for (const p of pts) { a.pos.push(p[0], p[1], p[2]); if (keep) a.nor.push(0, 0, 0); else a.nor.push(n[0], n[1], n[2]); }
        a.uv.push(...uvs);
        a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    // free quads (HoloPrint geometry). Flat (double-sided) quads that lie exactly on a cell boundary move inwards by a hair:
    // the mesh core hides boundary faces next to opaque neighbours, and a ladder or a vine on a wall must stay visible.
    for (const q of model.quads ?? []) {
      const layer = q.layer ?? model.layer;
      const alpha = layer === 'translucent' ? q.alpha ?? model.alpha ?? 1 : 1;
      // the plane's own axis only (all four corners share that coordinate), and only when it is 0 or 16
      const plane = q.cull === false ? [0, 1, 2].find((ax) => q.pos.every((p) => p[ax] === q.pos[0][ax]) && (q.pos[0][ax] <= 0 || q.pos[0][ax] >= 16)) : undefined;
      const pts = q.pos.map((p) => {
        let c = p;
        if (plane !== undefined) { c = [...p] as V3; c[plane] += c[plane] <= 0 ? 0.002 : -0.002; }
        const r = rotY(rotX([c[0] - 8, c[1] - 8, c[2] - 8], rx), ry);
        return [r[0] / 16, r[1] / 16, r[2] / 16] as V3;
      });
      const rect = atlas.rects.get(q.tex) ?? atlas.rects.get(MISSING_TEXTURE)!;
      const uvs: number[] = [];
      for (const [u, v] of q.uv) uvs.push(rect[0] + (Math.min(16, Math.max(0, u)) / 16) * (rect[2] - rect[0]), rect[1] + (Math.min(16, Math.max(0, v)) / 16) * (rect[3] - rect[1]));
      const n = rotY(rotX(q.normal, rx), ry);
      const shade = model.emissive || q.shade === false ? 1 : shadeOf(n);
      const [tr, tg, tb] = tintToRgb(q.tint, tints);
      const mi = material([shade * tr, shade * tg, shade * tb, alpha], !!q.flat || !!q.twoSided);
      let a = acc.get(mi);
      if (!a) acc.set(mi, (a = { pos: [], nor: [], uv: [], idx: [] }));
      const base = a.pos.length / 3;
      const planar = (category === 'translucent' && !!q.flat) || model.noCull || leavesCell(pts);
      for (const p of pts) { a.pos.push(p[0], p[1], p[2]); if (planar) a.nor.push(0, 0, 0); else a.nor.push(n[0], n[1], n[2]); }
      a.uv.push(...uvs);
      a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return [...acc].map(([mi, a]) => ({
      positions: Float32Array.from(a.pos), normals: Float32Array.from(a.nor), uvs: Float32Array.from(a.uv),
      indices: Uint32Array.from(a.idx), materialIndex: mi,
    }));
  };

  const byIdentity = new Map<BlockModel, Map<string, number>>();
  const byKey = new Map<string, number>();
  const variant = (model: BlockModel, category: Category, group: string): number => {
    const gk = `${category}|${group}`;
    let perModel = byIdentity.get(model);
    const hit = perModel?.get(gk);
    if (hit !== undefined) return hit;
    tm.stringified = (tm.stringified ?? 0) + 1;
    const key = `${gk}|${JSON.stringify(model)}`;
    let index = byKey.get(key);
    if (index === undefined) {
      index = items.length;
      items.push({
        index, category, occlusionFlags: category === 'solid' ? occlusionFlags(model) : 0, selfOcclusionFlags: model.cullSame ? 63 : 0,
        cullGroup: model.cullSame ? group : '', geometries: geometries(model, category),
      });
      byKey.set(key, index);
    }
    if (!perModel) byIdentity.set(model, (perModel = new Map()));
    perModel.set(gk, index);
    return index;
  };

  // one palette item per cell and pass. Static models are shared objects, so the common case is a single Map lookup;
  // only `cullSame` models (glass, water …) also depend on the block name and take the slower path.
  const solidItem = new Int32Array(total).fill(-1), transItem = new Int32Array(total).fill(-1);
  const fast = new Map<BlockModel, [number, number]>();
  for (let i = 0; i < total; i++) {
    const m = models[i];
    if (m) {
      let hit = m.cullSame ? undefined : fast.get(m);
      if (!hit) {
        const z = i % sz, y = Math.floor(i / sz) % sy, x = Math.floor(i / (sz * sy));
        const group = m.cullSame ? m.cullKey ?? ctx.nameAt(x, y, z) ?? '' : '';
        const parts = splitByLayer(m);
        hit = [
          hasGeometry(parts.solid) ? variant(parts.solid, 'solid', group) : -1,
          hasGeometry(parts.translucent) ? variant(parts.translucent, 'translucent', group) : -1,
        ];
        if (!m.cullSame) fast.set(m, hit);
      }
      solidItem[i] = hit[0]; transItem[i] = hit[1];
    }
    const lm = liquidModels.get(i);
    if (lm && transItem[i] < 0) {
      const parts = splitByLayer(lm);
      const t = parts.translucent ?? parts.solid;
      if (hasGeometry(t)) transItem[i] = variant(t, 'translucent', 'water');
    }
  }
  tm.paletteItems = items.length;
  if (!items.length) return { solid: EMPTY_LAYER(), translucent: EMPTY_LAYER(), faceCount: 0, backend: backend.name, timings: tm };
  lap('paletteMs');
  backend.updatePalette(items);
  lap('backendMs');

  const relevant = (p: number) => p >= 0 && (items[p].occlusionFlags !== 0 || !!items[p].cullGroup);
  const opaqueItem = (p: number) => p >= 0 && items[p].occlusionFlags !== 0;

  // ---------------------------------------------------------- chunks
  type Part = { positions: Float32Array; uvs: Float32Array; colors: Float32Array; indices: Uint32Array; normals?: Float32Array };
  const parts: Record<Category, Part[]> = { solid: [], translucent: [] };
  const decode = (mesh: MeshData, ox: number, oy: number, oz: number): Part => {
    const V = mesh.positions.length / 3, scale = mesh.positions instanceof Int16Array ? 1 / 1024 : 1;
    // the TypeScript core emits only the vertices it uses (the wasm builder removed in 1.6.0 kept those of culled faces and needed compacting)
    const used = V;
    const positions = new Float32Array(used * 3), uvs = new Float32Array(used * 2), colors = new Float32Array(used * 4);
    // normals for both layers: the viewer winds every face toward its normal and culls back faces (zero = drawn from both sides)
    const normals = new Float32Array(used * 3);
    for (let v = 0; v < V; v++) {
      const nv = v;
      if (normals) { normals[nv * 3] = mesh.normals[v * 3] / 127; normals[nv * 3 + 1] = mesh.normals[v * 3 + 1] / 127; normals[nv * 3 + 2] = mesh.normals[v * 3 + 2] / 127; }
      positions[nv * 3] = mesh.positions[v * 3] * scale + ox + 0.5;
      positions[nv * 3 + 1] = mesh.positions[v * 3 + 1] * scale + oy + 0.5;
      positions[nv * 3 + 2] = mesh.positions[v * 3 + 2] * scale + oz + 0.5;
      uvs[nv * 2] = mesh.uvs[v * 2]; uvs[nv * 2 + 1] = mesh.uvs[v * 2 + 1];
    }
    const indices = new Uint32Array(mesh.indices.length);
    for (let k = 0; k < indices.length; k++) indices[k] = mesh.indices[k];
    for (const g of mesh.groups) {
      const c = materials[g.materialIndex], both = twoSidedMaterial.has(g.materialIndex);
      for (let k = g.start; k < g.start + g.count; k++) {
        const nv = indices[k];
        colors[nv * 4] = c[0]; colors[nv * 4 + 1] = c[1]; colors[nv * 4 + 2] = c[2]; colors[nv * 4 + 3] = c[3];
        if (both) normals[nv * 3] = normals[nv * 3 + 1] = normals[nv * 3 + 2] = 0;
      }
    }
    return { positions, uvs, colors, indices, ...(normals ? { normals } : {}) };
  };

  const merge = (list: Part[]): MeshLayerData => {
    let v = 0, k = 0;
    for (const p of list) { v += p.positions.length / 3; k += p.indices.length; }
    const out: MeshLayerData = { positions: new Float32Array(v * 3), uvs: new Float32Array(v * 2), colors: new Float32Array(v * 4), indices: new Uint32Array(k) };
    if (list.some((p) => p.normals)) out.normals = new Float32Array(v * 3);
    let vo = 0, io = 0;
    for (const p of list) {
      out.positions.set(p.positions, vo * 3); out.uvs.set(p.uvs, vo * 2); out.colors.set(p.colors, vo * 4);
      if (p.normals) out.normals!.set(p.normals, vo * 3);
      for (let j = 0; j < p.indices.length; j++) out.indices[io++] = p.indices[j] + vo;
      vo += p.positions.length / 3;
    }
    return out;
  };

  // the chunks that hold something to draw, in meshing order (x, y, z); streamed loads go bottom layer first
  const nx = Math.ceil(sx / CH), ny = Math.ceil(sy / CH), nz = Math.ceil(sz / CH);
  const filled = new Uint8Array(nx * ny * nz);
  for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
    const i = (x * sy + y) * sz + z;
    if (solidItem[i] >= 0 || transItem[i] >= 0) filled[(Math.floor(x / CH) * ny + Math.floor(y / CH)) * nz + Math.floor(z / CH)] = 1;
  }
  const boxes: V3[] = [];
  for (let bx = 0; bx < nx; bx++) for (let by = 0; by < ny; by++) for (let bz = 0; bz < nz; bz++) if (filled[(bx * ny + by) * nz + bz]) boxes.push([bx * CH, by * CH, bz * CH]);
  const stream = ctx.stream;
  if (stream) boxes.sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2]);
  let done = 0;
  throwIfAborted(stream?.signal);

  for (const [cx, cy, cz] of boxes) {
    const started = performance.now();
    const own: Record<Category, Part[]> = { solid: [], translucent: [] };
    const x1 = Math.min(sx, cx + CH), y1 = Math.min(sy, cy + CH), z1 = Math.min(sz, cz + CH);
    const sBlocks: number[] = [], tBlocks: number[] = [], sApron: number[] = [], tApron: number[] = [];
    for (let x = cx - 1; x <= x1; x++) for (let y = cy - 1; y <= y1; y++) for (let z = cz - 1; z <= z1; z++) {
      if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) continue;
      const i = (x * sy + y) * sz + z, s = solidItem[i], t = transItem[i];
      if (s < 0 && t < 0) continue;
      const inside = x >= cx && x < x1 && y >= cy && y < y1 && z >= cz && z < z1;
      if (inside) {
        if (s >= 0) sBlocks.push(x, y, z, s);
        if (t >= 0) tBlocks.push(x, y, z, t);
        if (opaqueItem(s) && t < 0) tApron.push(x, y, z, s);            // opaque cells hide translucent faces next to them
      } else {
        if (relevant(s)) { sApron.push(x, y, z, s); if (opaqueItem(s)) tApron.push(x, y, z, s); }
        if (relevant(t)) tApron.push(x, y, z, t);
      }
    }
    lap('listsMs');
    for (const [blocks, apron, category] of [[sBlocks, sApron, 'solid'], [tBlocks, tApron, 'translucent']] as const) {
      if (!blocks.length) continue;
      const r = backend.build({ blocks: Int32Array.from(blocks), apron: Int32Array.from(apron), origin: [cx, cy, cz] });
      lap('backendMs');
      for (const mesh of r.meshes) {
        const part = decode(mesh, cx, cy, cz), cat = mesh.category === 'translucent' ? 'translucent' : category;
        parts[cat].push(part);
        if (stream) own[cat].push(part);
      }
      lap('decodeMs');
    }
    if (stream) {
      await stream.onChunk({ solid: merge(own.solid), translucent: merge(own.translucent), origin: [cx, cy, cz] }, ++done, boxes.length);
      // the time spent meshing counts towards the minimum; the rest is a pause (the main thread is free)
      await pause((stream.minChunkMs ?? 0) - (performance.now() - started), stream.signal);
      tick = performance.now();
    }
  }
  const solid = merge(parts.solid), translucent = merge(parts.translucent);
  lap('mergeMs');
  return { solid, translucent, faceCount: (solid.indices.length + translucent.indices.length) / 6, backend: backend.name, timings: tm };
}

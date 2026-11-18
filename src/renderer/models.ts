/**
 * Block model representation. It mirrors Java Edition's JSON model format
 * (cuboid elements, per-face UVs, single-axis element rotation, whole-model
 * x/y rotation in 90° steps) because that is what every Minecraft block shape
 * can be expressed in, and because texture orientation then behaves like the
 * game: textures rotate together with the geometry.
 *
 * Coordinates are in 1/16 block units. +x = east, +y = up, +z = south.
 */

export type Dir = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';
export type V3 = [number, number, number];

export const DIRS: Dir[] = ['down', 'up', 'north', 'south', 'west', 'east'];
export const HORIZONTAL: Dir[] = ['north', 'east', 'south', 'west'];

export const DIR_VEC: Record<Dir, V3> = {
  down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0],
};
export const OPPOSITE: Record<Dir, Dir> = {
  down: 'up', up: 'down', north: 'south', south: 'north', west: 'east', east: 'west',
};

/** `number` = 0xRRGGBB multiplier; named tints use the renderer's biome colours. */
export type Tint = number | 'grass' | 'foliage' | 'water' | null;

export interface FaceSpec {
  /** Texture ref: terrain key, `key#variant`, or `@textures/blocks/file`. */
  tex: string;
  /** [u0, v0, u1, v1] in 0..16 texture space (origin top-left). Default: derived from the element box. */
  uv?: [number, number, number, number];
  rot?: 0 | 90 | 180 | 270;
  /** Face lies on a cell boundary in this direction and can be hidden by an opaque neighbour. Default: auto. */
  cull?: Dir | false;
  tint?: Tint;
}

export interface Element {
  from: V3;
  to: V3;
  faces: Partial<Record<Dir, FaceSpec>>;
  rotation?: { origin: V3; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean };
  /** false = no directional shading (e.g. emissive blocks). Default true. */
  shade?: boolean;
  /** Draw this element in the alpha-blended pass even when the rest of the model is solid (cauldron water …). */
  layer?: 'solid' | 'translucent';
  /** Vertex alpha for a translucent element (0..1). */
  alpha?: number;
}

/**
 * A free quad (for shapes that are not axis-aligned boxes with single-axis rotations: HoloPrint geometry with Euler rotations,
 * transforms and per-vertex texture corners). Positions are block-local, 1/16 units, world orientation (+x east), applied
 * *before* the model's rotX / rotY. Drawn double-sided like everything else.
 */
export interface Quad {
  pos: [V3, V3, V3, V3];
  /** Per-vertex texture coordinates in 0..16 texture space (origin top-left), same order as `pos`. */
  uv: [[number, number], [number, number], [number, number], [number, number]];
  tex: string;
  normal: V3;
  tint?: Tint;
  /** The quad lies on this cell boundary facing outwards: hidden when the neighbour there is an opaque cube. */
  cull?: Dir | false;
  /** false = no directional shading. */
  shade?: boolean;
  layer?: 'solid' | 'translucent';
  alpha?: number;
  /** Zero-thickness plane (a pane of a cross, a portal …): visible from both sides, never back-face culled. */
  flat?: boolean;
  /** A face of a box that is not closed (its back can be seen through the box's open side): drawn from both sides. */
  twoSided?: boolean;
}

export interface BlockModel {
  /** Never cull a face against a neighbour (a piston's arm reaches past its own cell). */
  noCull?: boolean;
  elements: Element[];
  /** Free quads drawn in addition to `elements` (HoloPrint geometry). */
  quads?: Quad[];
  /** Whole-model rotation about the block centre (Java convention), degrees, multiples of 90. */
  rotX?: number;
  rotY?: number;
  /** Alpha-blended pass instead of the alpha-tested one. */
  layer?: 'solid' | 'translucent';
  /** A full opaque cube: hides the faces of neighbours that touch it. */
  opaque?: boolean;
  /** Fully bright regardless of face direction (glowstone, lit lamps, lava …). */
  emissive?: boolean;
  /** Hide faces that touch another block of the same kind (glass, water, ice …). */
  cullSame?: boolean;
  /** Vertex alpha for the translucent pass (0..1). */
  alpha?: number;
  /** Identity used by `cullSame` (defaults to the block name). */
  cullKey?: string;
  /** The model depends only on block name + states, so it can be cached per palette entry. */
  static?: boolean;
}

// ------------------------------------------------------------- builders ---

export type FaceTextures = string | Partial<Record<Dir, string>>;

/** Build the six faces of a box from a texture or per-face textures. */
export function faces(tex: FaceTextures, extra: Partial<FaceSpec> = {}, only?: Dir[]): Partial<Record<Dir, FaceSpec>> {
  const out: Partial<Record<Dir, FaceSpec>> = {};
  for (const d of only ?? DIRS) {
    const t = typeof tex === 'string' ? tex : tex[d];
    if (t) out[d] = { tex: t, ...extra };
  }
  return out;
}

export function box(from: V3, to: V3, f: Partial<Record<Dir, FaceSpec>>, extra: Partial<Element> = {}): Element {
  return { from, to, faces: f, ...extra };
}

/** Full cube with per-face textures. */
export function cubeModel(tex: FaceTextures, opts: Partial<BlockModel> & { tint?: Tint } = {}): BlockModel {
  const { tint, ...model } = opts;
  return {
    elements: [box([0, 0, 0], [16, 16, 16], faces(tex, tint ? { tint } : {}))],
    opaque: true,
    ...model,
  };
}

// ------------------------------------------------------------ rotations ---

const COS: Record<number, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Record<number, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };
const norm90 = (d: number) => ((Math.round(d / 90) * 90) % 360 + 360) % 360;

/** Java-style x rotation: +90° turns north → down. */
export function rotX(v: V3, deg: number): V3 {
  const c = COS[norm90(deg)], s = SIN[norm90(deg)];
  return [v[0], v[1] * c + v[2] * s, -v[1] * s + v[2] * c];
}
/** Java-style y rotation: +90° turns north → east (clockwise seen from above). */
export function rotY(v: V3, deg: number): V3 {
  const c = COS[norm90(deg)], s = SIN[norm90(deg)];
  return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c];
}

export function vecToDir(v: V3): Dir {
  const [x, y, z] = v;
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (ay >= ax && ay >= az) return y > 0 ? 'up' : 'down';
  if (ax >= az) return x > 0 ? 'east' : 'west';
  return z > 0 ? 'south' : 'north';
}

export function rotateDir(d: Dir, rx: number, ry: number): Dir {
  return vecToDir(rotY(rotX(DIR_VEC[d], rx), ry));
}

/**
 * Find the Java-style (x, y) rotation that turns `from` into `to`.
 * Prefers y = 0 for vertical targets (matches vanilla blockstates).
 */
export function orientTo(from: Dir, to: Dir): { x: number; y: number } {
  for (const x of [0, 90, 180, 270])
    for (const y of [0, 90, 180, 270])
      if (rotateDir(from, x, y) === to) return { x, y };
  return { x: 0, y: 0 };
}

/** Y rotation (degrees) that takes `north` to the given horizontal direction. */
export function yawOf(d: Dir): number {
  return ({ north: 0, east: 90, south: 180, west: 270, up: 0, down: 0 } as Record<Dir, number>)[d];
}

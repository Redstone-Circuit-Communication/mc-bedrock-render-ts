import { Dir, Element, Tint, V3 } from './models';

/** Biome colours (0xRRGGBB) used for tinted faces. */
/**
 * Biome colours of the plains biome, as the game draws grass and leaves there (and as the Java renderer does). The greener
 * 0x79c05a / 0x48b518 are the defaults the game uses for item icons, not for blocks in the world.
 */
export const DEFAULT_TINTS = { grass: 0x91bd59, foliage: 0x77ab2f, water: 0x44aff5 };
export type Tints = typeof DEFAULT_TINTS;

// Face geometry shared by the single-pass mesher and the palette mesher (moved verbatim out of mesher.ts).

/** Vertex order per face (counter-clockwise seen from outside) — same as Java's FaceInfo. */
export const FACE_VERTS: Record<Dir, [number, number, number][]> = {
  down: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
  up: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  north: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]],
  south: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]],
  west: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]],
  east: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]],
};

export function defaultUv(dir: Dir, f: V3, t: V3): [number, number, number, number] {
  const [x1, y1, z1] = f, [x2, y2, z2] = t;
  switch (dir) {
    case 'down': return [x1, 16 - z2, x2, 16 - z1];
    case 'up': return [x1, z1, x2, z2];
    case 'north': return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case 'south': return [x1, 16 - y2, x2, 16 - y1];
    case 'west': return [z1, 16 - y2, z2, 16 - y1];
    case 'east': return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
  }
}

export function autoCull(el: Element, dir: Dir): Dir | false {
  if (el.rotation) return false;
  switch (dir) {
    case 'west': return el.from[0] === 0 && el.to[0] <= 16 ? dir : false;
    case 'east': return el.to[0] === 16 && el.from[0] >= 0 ? dir : false;
    case 'down': return el.from[1] === 0 && el.to[1] <= 16 ? dir : false;
    case 'up': return el.to[1] === 16 && el.from[1] >= 0 ? dir : false;
    case 'north': return el.from[2] === 0 && el.to[2] <= 16 ? dir : false;
    case 'south': return el.to[2] === 16 && el.from[2] >= 0 ? dir : false;
  }
}

export function elementRotate(p: V3, r: NonNullable<Element['rotation']>): V3 {
  const a = (r.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  let x = p[0] - r.origin[0], y = p[1] - r.origin[1], z = p[2] - r.origin[2];
  let sx = 1, sy = 1, sz = 1;
  switch (r.axis) {
    case 'x': [y, z] = [y * c - z * s, y * s + z * c]; sy = sz = r.rescale ? 1 / c : 1; break;
    case 'y': [x, z] = [x * c + z * s, -x * s + z * c]; sx = sz = r.rescale ? 1 / c : 1; break;
    case 'z': [x, y] = [x * c - y * s, x * s + y * c]; sx = sy = r.rescale ? 1 / c : 1; break;
  }
  return [r.origin[0] + x * sx, r.origin[1] + y * sy, r.origin[2] + z * sz];
}

export function elementRotateDir(v: V3, r: NonNullable<Element['rotation']>): V3 {
  const a = (r.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  let [x, y, z] = v;
  switch (r.axis) {
    case 'x': [y, z] = [y * c - z * s, y * s + z * c]; break;
    case 'y': [x, z] = [x * c + z * s, -x * s + z * c]; break;
    case 'z': [x, y] = [x * c - y * s, x * s + y * c]; break;
  }
  return [x, y, z];
}

/** Java-style directional shading for an arbitrary unit normal. */
/**
 * Face brightness baked into the mesh colours: 1. The light is three.js's, as in the Java package (AmbientLight 2.2 +
 * DirectionalLight 1.0 on MeshStandardMaterial, three-viewer.ts); the mesh colours carry tints and alpha only.
 */
export function shadeOf(_n: V3): number {
  return 1;
}

// ---------------------------------------------------------------- builder ---

export function tintToRgb(t: Tint | undefined, tints: Tints): [number, number, number] {
  if (t == null) return [1, 1, 1];
  const n = t === 'grass' ? tints.grass : t === 'foliage' ? tints.foliage : t === 'water' ? tints.water : t;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}


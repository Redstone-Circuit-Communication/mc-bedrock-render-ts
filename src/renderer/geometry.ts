import { LayerBuilder } from './layer';
import { Dir, V3 } from './models';
import { ResourceStack } from './resources';

// ------------------------------------------------------------ affine math ---

/** 3×4 row-major affine matrix (rotation/scale in the 3×3 part + translation). */
export type M = number[];
export const IDENT: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export function mulM(a: M, b: M): M {
  const r = new Array<number>(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
    r[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
  }
  return r;
}
export const translateM = (x: number, y: number, z: number): M => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
export const scaleM = (x: number, y: number, z: number): M => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0];
const DEG = Math.PI / 180;
const rx = (a: number): M => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; };
const ry = (a: number): M => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; };
const rz = (a: number): M => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; };

/** Plain right-handed rotation about +y (used for entity yaw). */
export const rotYM = (deg: number): M => ry(deg * DEG);

/**
 * Bedrock bone rotation. Model space is mirrored in y relative to Java's
 * (which is where Bedrock's angles come from), so the x and z angles flip
 * sign when expressed as ordinary right-handed matrices. Order: X, then Y, then Z.
 */
export function rotM(xDeg: number, yDeg: number, zDeg: number): M {
  return mulM(rz(-zDeg * DEG), mulM(ry(yDeg * DEG), rx(-xDeg * DEG)));
}
export function aroundPivot(m: M, p: V3): M {
  return mulM(translateM(p[0], p[1], p[2]), mulM(m, translateM(-p[0], -p[1], -p[2])));
}
export function applyM(m: M, p: V3): V3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}
export function applyDirM(m: M, v: V3): V3 {
  const o: V3 = [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
  ];
  const l = Math.hypot(o[0], o[1], o[2]) || 1;
  return [o[0] / l, o[1] / l, o[2] / l];
}

// -------------------------------------------------------------- data types ---

export interface FaceUv { uv: [number, number]; uv_size?: [number, number] }
export interface GeoCube {
  origin: V3;
  size: V3;
  /** `[u, v]` for box UV, or an explicit per-face map. */
  uv: [number, number] | Partial<Record<Dir, FaceUv>>;
  inflate: number;
  mirror: boolean;
  rotation?: V3;
  pivot?: V3;
}
export interface GeoBone {
  name: string;
  parent?: string;
  pivot: V3;
  /** Regular rotation: inherited by child bones. */
  rotation: V3;
  /** `bind_pose_rotation`: rotates this bone's own cubes only, not its children. */
  bindPose: V3;
  neverRender: boolean;
  cubes: GeoCube[];
}
export interface Geometry {
  id: string;
  /** Declared texture size, or `undefined` → the actual texture's size is used. */
  texW?: number;
  texH?: number;
  bones: GeoBone[];
}
/** Accumulated animation channels for one bone. */
export interface BonePose {
  rot: V3;
  pos: V3;
  scale: V3;
}

// ----------------------------------------------------------------- library ---

interface RawGeo { id: string; parent?: string; texW?: number; texH?: number; bones: any[] }

const v3 = (a: any, d: V3 = [0, 0, 0]): V3 =>
  Array.isArray(a) && a.length >= 3 ? [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0] : d;


/**
 * A bone of a child geometry (`geometry.child:geometry.parent`) that has the name of an inherited bone. Bedrock merges the
 * cubes instead of replacing the bone: unless the bone says `"reset": true` (which discards what
 * was inherited) the cubes are combined. Measured on the pack:
 *  - every bone that swaps the inherited cubes has `reset: true` (enderman 6, zombie villager 4);
 *  - a sheep's wool bones have no `reset` and need the skin under them: a 6-high wool sleeve on the 12-high skin leg, a wool
 *    cap on a head that sticks out further, and a witch's wart on the villager's nose (replacing them left the sheep without
 *    a head and with white stubs for legs);
 *  - the player's `leftArm` / `leftLeg` repeat the parent's cube at the same place with another uv: that one is overridden,
 *    not drawn twice (a second arm with the wrong skin region).
 * So a child cube replaces the parent cube it coincides with (same origin, size, rotation and pivot) and is added otherwise.
 */
export function mergeBone(parent: any, child: any): any {
  if (child.reset === true) return child;
  const place = (c: any) => JSON.stringify([c.origin, c.size, c.rotation ?? null, c.pivot ?? null]);
  const cubes: any[] = [...(parent.cubes ?? [])];
  for (const c of child.cubes ?? []) {
    const i = cubes.findIndex((x) => place(x) === place(c));
    if (i >= 0) cubes[i] = c; else cubes.push(c);
  }
  // only the cubes merge: the bone's own fields (pivot, mirror, bind pose …) stay the child's — the parent's left arm is
  // `mirror: true` and the player's is not, inheriting it flipped the player's arm uv
  return { ...child, cubes };
}

/**
 * Bones of a `minecraft:geometry` block that lost the `bind_pose_rotation` their legacy twin has.
 * A bone only inherits it when the new block poses it in no other way (no bone rotation, no bind pose, no cube rotation):
 * then the cubes are identical to the legacy ones and the rest pose is simply missing.
 */
export function inheritBindPose(bones: any[], legacy: any[] | undefined): any[] {
  if (!legacy?.length) return bones;
  const old = new Map(legacy.map((b) => [String(b.name).toLowerCase(), b]));
  return bones.map((b) => {
    const o = old.get(String(b.name).toLowerCase());
    const bind = o?.bind_pose_rotation;
    if (!Array.isArray(bind) || bind.every((v: number) => !v)) return b;
    if (b.rotation || b.bind_pose_rotation || (b.cubes ?? []).some((c: any) => c.rotation)) return b;
    return { ...b, bind_pose_rotation: bind };
  });
}

/** All `models/**\/*.json` geometries of a resource stack, with `a:b` inheritance resolved. */
export class GeometryLibrary {
  private raw = new Map<string, RawGeo>();
  private cache = new Map<string, Geometry | null>();
  /** Geometries the game provides but no pack ships (boat …); a pack's own definition always wins. */
  private builtins = new Map<string, Geometry>();

  constructor(stack: ResourceStack) {
    const files: any[] = [];
    for (const path of stack.paths('models/')) {
      if (!path.endsWith('.json')) continue;
      for (const bytes of stack.getAll(path)) {   // every pack's version: geometry is merged by identifier
        try { files.push(stack.parseJson(bytes)); } catch { /* unreadable file: skipped */ }
      }
    }
    // The same geometry can exist twice: an old `geometry.x` block and a `minecraft:geometry` block with that identifier
    // (the one that wins), in one file or in packs of different game versions. The new block keeps the cubes but dropped
    // `bind_pose_rotation`, the rest pose that lays a quadruped's upright-modelled body down (polar bear, cat, ocelot, fox,
    // llama, rabbit …) — see `inheritBindPose`. Old blocks are therefore collected from every file and pack first.
    const legacyBones = new Map<string, any[]>();
    for (const j of files)
      for (const [k, val] of Object.entries<any>(j ?? {}))
        if (k.startsWith('geometry.') && val && typeof val === 'object') legacyBones.set(k.toLowerCase().split(':')[0], val.bones ?? []);
    for (const j of files) {
      for (const [k, val] of Object.entries<any>(j ?? {})) {
        if (k.startsWith('geometry.') && val && typeof val === 'object') {
          const [id, parent] = k.toLowerCase().split(':');
          this.raw.set(id, { id, parent, texW: val.texturewidth, texH: val.textureheight, bones: val.bones ?? [] });
          legacyBones.set(id, val.bones ?? []);
        } else if (k === 'minecraft:geometry' && Array.isArray(val)) {
          for (const g of val) {
            const d = g.description ?? {};
            const id = String(d.identifier ?? '').toLowerCase().split(':')[0];
            if (id) this.raw.set(id, { id, texW: d.texture_width, texH: d.texture_height, bones: inheritBindPose(g.bones ?? [], legacyBones.get(id)) });
          }
        }
      }
    }
  }

  addBuiltin(geo: Geometry): void { this.builtins.set(geo.id.toLowerCase(), geo); this.cache.delete(geo.id.toLowerCase()); }
  has(id: string): boolean { return this.raw.has(id.toLowerCase()) || this.builtins.has(id.toLowerCase()); }
  ids(): string[] { return [...new Set([...this.raw.keys(), ...this.builtins.keys()])]; }

  get(id: string): Geometry | null {
    id = id.toLowerCase();
    if (this.cache.has(id)) return this.cache.get(id)!;
    const raw = this.raw.has(id) ? this.resolve(id, 0) : this.builtins.get(id) ?? null;
    const g = raw && id === 'geometry.dragon' ? dragonSegments(raw) : raw;
    this.cache.set(id, g);
    return g;
  }

  private resolve(id: string, depth: number): Geometry | null {
    const r = this.raw.get(id);
    if (!r || depth > 8) return null;
    let bones: any[] = [];
    let texW = r.texW, texH = r.texH;
    if (r.parent) {
      const p = this.resolveRaw(r.parent, depth + 1);
      if (p) { bones = [...p.bones]; texW ??= p.texW; texH ??= p.texH; }
    }
    for (const b of r.bones) {
      const i = bones.findIndex((x) => String(x.name).toLowerCase() === String(b.name).toLowerCase());
      if (i >= 0) bones[i] = mergeBone(bones[i], b); else bones.push(b);
    }
    return {
      id, texW, texH,
      bones: bones.map((b): GeoBone => ({
        name: String(b.name).toLowerCase(),
        parent: b.parent ? String(b.parent).toLowerCase() : undefined,
        pivot: v3(b.pivot),
        rotation: v3(b.rotation),
        bindPose: v3(b.bind_pose_rotation),
        neverRender: !!(b.neverRender ?? b.neverrender),
        cubes: (b.cubes ?? []).map((c: any): GeoCube => ({
          origin: v3(c.origin), size: v3(c.size), uv: c.uv ?? [0, 0],
          inflate: Number(c.inflate ?? b.inflate ?? 0) || 0,
          mirror: !!(c.mirror ?? b.mirror),
          rotation: c.rotation ? v3(c.rotation) : undefined,
          pivot: c.pivot ? v3(c.pivot) : undefined,
        })),
      })),
    };
  }

  private resolveRaw(id: string, depth: number): { bones: any[]; texW?: number; texH?: number } | null {
    const r = this.raw.get(id);
    if (!r || depth > 8) return null;
    let bones: any[] = [];
    let texW = r.texW, texH = r.texH;
    if (r.parent) {
      const p = this.resolveRaw(r.parent, depth + 1);
      if (p) { bones = [...p.bones]; texW ??= p.texW; texH ??= p.texH; }
    }
    for (const b of r.bones) {
      const i = bones.findIndex((x) => String(x.name).toLowerCase() === String(b.name).toLowerCase());
      if (i >= 0) bones[i] = mergeBone(bones[i], b); else bones.push(b);
    }
    return { bones, texW, texH };
  }
}

// ------------------------------------------------------------------ meshing ---

export interface EmitOptions {
  poses: Map<string, BonePose>;
  /** Called with the lower-case bone name. */
  isVisible: (bone: string) => boolean;
  /** Model space → output space (includes the 1/16 scale, the z flip, yaw and position). */
  world: M;
  color: [number, number, number];
  alpha: number;
  emissive: boolean;
  /** Texture size the UVs are normalised by (declared size, else the real image size). */
  texW: number;
  texH: number;
  /** Draw each flat plane once, as a sprite that always faces the camera (fireballs and thrown items are 2D sprites in the game). */
  billboard?: boolean;
  /** Called with every face emitted: its four corners, uv (0..1), outward normal and whether it belongs to a zero-thickness plane. */
  onQuad?: (pts: V3[], uvs: [number, number][], normal: V3, flat: boolean) => void;
}

// vertex tables: [xSel, ySel, zSel, uSel, vSel] (Sel 1 = max / u1 / v1)
type VT = [number, number, number, number, number];
const FACE_TABLE: Record<Dir, VT[]> = {
  // front of the entity is -z. u grows toward the viewer's right (= entity's left = +x) on the front.
  north: [[0, 1, 0, 0, 0], [1, 1, 0, 1, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]],
  south: [[1, 1, 1, 0, 0], [0, 1, 1, 1, 0], [0, 0, 1, 1, 1], [1, 0, 1, 0, 1]],
  east: [[1, 1, 0, 0, 0], [1, 1, 1, 1, 0], [1, 0, 1, 1, 1], [1, 0, 0, 0, 1]],
  west: [[0, 1, 1, 0, 0], [0, 1, 0, 1, 0], [0, 0, 0, 1, 1], [0, 0, 1, 0, 1]],
  up: [[0, 1, 1, 0, 0], [1, 1, 1, 1, 0], [1, 1, 0, 1, 1], [0, 1, 0, 0, 1]],
  // Same texture orientation as the up face (v0 toward +z, u0 toward −x), as Java's ModelPart.Cube maps its two horizontal faces:
  // the bottom of a zero-height plane shows the same shape as its top. It was flipped along z, so a flat plane drawn from both
  // sides showed its picture twice, once mirrored — the ender dragon's triangular wing membranes came out as rhombi.
  down: [[0, 0, 0, 0, 1], [1, 0, 0, 1, 1], [1, 0, 1, 1, 0], [0, 0, 1, 0, 0]],
};
const FACE_NORMAL: Record<Dir, V3> = {
  north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};
const FACE_ORDER: Dir[] = ['north', 'south', 'east', 'west', 'up', 'down'];
/** How far (blocks) each of two coincident faces of a flat plane moves along its own normal: far below a texel (1/16), far above the depth precision. */
const COINCIDENT_LIFT = 0.004;
const OPPOSITE: Record<Dir, Dir> = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };

/** Entity faces are lit by three.js like the blocks (face.ts): nothing is baked into the colours. */
function shadeOf(_n: V3): number {
  return 1;
}

/** Emit all visible cubes of a geometry into `sink`. Returns the number of faces. */
export function emitGeometry(geo: Geometry, o: EmitOptions, sink: LayerBuilder): number {
  const byName = new Map(geo.bones.map((b) => [b.name, b]));
  const memo = new Map<string, { own: M; inh: M }>();

  const matrices = (b: GeoBone, depth = 0): { own: M; inh: M } => {
    const hit = memo.get(b.name);
    if (hit) return hit;
    const parent = b.parent && depth < 32 ? byName.get(b.parent) : undefined;
    const parentInh = parent ? matrices(parent, depth + 1).inh : IDENT;
    const pose = o.poses.get(b.name);
    const rot: V3 = [b.rotation[0] + (pose?.rot[0] ?? 0), b.rotation[1] + (pose?.rot[1] ?? 0), b.rotation[2] + (pose?.rot[2] ?? 0)];
    const own: V3 = [rot[0] + b.bindPose[0], rot[1] + b.bindPose[1], rot[2] + b.bindPose[2]];
    const sc = pose?.scale ?? [1, 1, 1];
    const pos = pose?.pos ?? [0, 0, 0];
    const t = translateM(pos[0], pos[1], pos[2]);
    const mk = (r: V3) => mulM(parentInh, mulM(t, aroundPivot(mulM(rotM(r[0], r[1], r[2]), scaleM(sc[0], sc[1], sc[2])), b.pivot)));
    const res = { own: mk(own), inh: mk(rot) };
    memo.set(b.name, res);
    return res;
  };

  let faces = 0;
  for (const bone of geo.bones) {
    if (bone.neverRender || !o.isVisible(bone.name)) continue;
    const { own } = matrices(bone);
    for (const cube of bone.cubes) {
      let m = mulM(o.world, own);
      if (cube.rotation) {
        // A rotated cube without `pivot` turns about its own centre. Measured on the pack: minecart.v1.8 (four rotated cubes)
        // reproduces the explicit bone pivots of its v1.0 twin only with the cube centre, and so do pig.v3 and chicken.v1.12
        // (the pivot [0, 0, 0] sank the pig into the ground and flattened the chicken).
        const centre: V3 = [cube.origin[0] + cube.size[0] / 2, cube.origin[1] + cube.size[1] / 2, cube.origin[2] + cube.size[2] / 2];
        m = mulM(m, aroundPivot(rotM(cube.rotation[0], cube.rotation[1], cube.rotation[2]), cube.pivot ?? centre));
      }
      faces += emitCube(cube, m, geo, o, sink);
    }
  }
  return faces;
}

function emitCube(c: GeoCube, m: M, geo: Geometry, o: EmitOptions, sink: LayerBuilder): number {
  const inf = c.inflate;
  const lo: V3 = [c.origin[0] - inf, c.origin[1] - inf, c.origin[2] - inf];
  const hi: V3 = [c.origin[0] + c.size[0] + inf, c.origin[1] + c.size[1] + inf, c.origin[2] + c.size[2] + inf];
  const ext: V3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];

  // UV rectangles per face: [u, v, w, h]
  const rects: Partial<Record<Dir, [number, number, number, number]>> = {};
  let flipU = false;
  if (Array.isArray(c.uv)) {
    const dx = Math.floor(c.size[0]), dy = Math.floor(c.size[1]), dz = Math.floor(c.size[2]);
    const [u, v] = c.uv;
    rects.north = [u + dz, v + dz, dx, dy];
    rects.south = [u + 2 * dz + dx, v + dz, dx, dy];
    rects.east = [u + dz + dx, v + dz, dz, dy];
    rects.west = [u, v + dz, dz, dy];
    rects.up = [u + dz, v, dx, dz];
    rects.down = [u + dz + dx, v, dx, dz];
    if (c.mirror) { [rects.east, rects.west] = [rects.west, rects.east]; flipU = true; }
  } else {
    const dims: Record<Dir, [number, number]> = {
      north: [c.size[0], c.size[1]], south: [c.size[0], c.size[1]], east: [c.size[2], c.size[1]],
      west: [c.size[2], c.size[1]], up: [c.size[0], c.size[2]], down: [c.size[0], c.size[2]],
    };
    for (const d of FACE_ORDER) {
      const f = c.uv[d];
      if (!f) continue;
      const size = f.uv_size ?? dims[d];
      rects[d] = [f.uv[0], f.uv[1], size[0], size[1]];
    }
  }

  const spans: Record<Dir, [number, number]> = {
    north: [ext[0], ext[1]], south: [ext[0], ext[1]], east: [ext[2], ext[1]],
    west: [ext[2], ext[1]], up: [ext[0], ext[2]], down: [ext[0], ext[2]],
  };
  // a face with no area (east / west of a flat plane) is not drawn
  const drawn = (d: Dir) => !!rects[d] && spans[d][0] !== 0 && spans[d][1] !== 0;
  const flat = ext[0] === 0 || ext[1] === 0 || ext[2] === 0;
  let n = 0;
  for (const d of FACE_ORDER) {
    const r = rects[d];
    if (!r || !drawn(d)) continue;

    let u0 = r[0], u1 = r[0] + r[2];
    const v0 = r[1], v1 = r[1] + r[3];
    if (flipU) [u0, u1] = [u1, u0];

    const nrm = applyDirM(m, FACE_NORMAL[d]);
    // A zero-thickness plane carries its two sides as two COINCIDENT faces with their own uv (splash potion, bat wings,
    // allay wings …). Drawn at the same depth, the depth test picked either, so a plane could show its other side's texture
    // (the potion showed a grey plate instead of the bottle). The two faces are pushed apart along their own normals: from
    // either side the nearer one wins, and where its texel is transparent (an allay's wing has art on one side only) the
    // alpha test lets the other one show through, as before. Faces stay double-sided: the game draws entities without
    // back-face culling (Java: entityCutoutNoCull), and the inside of a rib cage or a translucent shell shows through.
    // a sprite shows one image: when both sides of the plane exist the pair collapses to one quad (the first); a plane that only
    // has one face (the fireball has just its south face) keeps that one
    if (o.billboard && flat && (d === 'south' || d === 'west' || d === 'down') && drawn(OPPOSITE[d])) continue;
    const lift = flat && drawn(OPPOSITE[d]) && !o.billboard ? COINCIDENT_LIFT : 0;
    const pts: V3[] = [];
    const uvs: [number, number][] = [];
    for (const [xs, ys, zs, us, vs] of FACE_TABLE[d]) {
      const p = applyM(m, [xs ? hi[0] : lo[0], ys ? hi[1] : lo[1], zs ? hi[2] : lo[2]]);
      pts.push(lift ? [p[0] + nrm[0] * lift, p[1] + nrm[1] * lift, p[2] + nrm[2] * lift] : p);
      uvs.push([(us ? u1 : u0) / o.texW, (vs ? v1 : v0) / o.texH]);
    }
    // Wind the quad around its outward normal. The entity transform mirrors z (model space has z pointing back), which
    // reverses the face table's winding: normals computed from it pointed into the body, and with shading on the shadow
    // lookup was pushed inside the entity along them, so every face sat in its own shadow and entities came out dark.
    const e1 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
    const e2 = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
    const facing = (e1[1] * e2[2] - e1[2] * e2[1]) * nrm[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * nrm[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * nrm[2];
    if (facing < 0) { [pts[1], pts[3]] = [pts[3], pts[1]]; [uvs[1], uvs[3]] = [uvs[3], uvs[1]]; }
    o.onQuad?.(pts, uvs, nrm, flat);
    const shade = o.emissive || o.billboard ? 1 : shadeOf(nrm);
    const rgba: [number, number, number, number] = [shade * o.color[0], shade * o.color[1], shade * o.color[2], o.alpha];
    if (o.billboard && flat) {
      const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const c: V3 = [0, 1, 2].map((a) => (pts[0][a] + pts[1][a] + pts[2][a] + pts[3][a]) / 4) as V3;
      sink.quad([c, c, c, c], uvs, rgba, undefined, [dist(pts[0], pts[1]) / 2, dist(pts[0], pts[3]) / 2]);
    } else sink.quad(pts, uvs, rgba);
    n++;
  }
  return n;
}

/**
 * The ender dragon's neck and tail are not in its geometry: there is one `neck` bone (a spine block and its plate), and the
 * game's dragon renderer draws it once per segment at the poses the animations give `neck1`…`neck5` and `tail1`…`tail12`
 * (the Java dragon does the same with its spine part). Without the segments the dragon had no neck or tail and its head
 * floated loose. The segments are copies of `neck` with its pivot; the `neck` bone itself is only a template.
 */
/** parent first: a child is moved by its parent's final pivot */
const DRAGON_CHAINS: [string, string][] = [
  ['wingtip', 'wing'], ['wingtip1', 'wing1'],
  ['frontlegtip', 'frontleg'], ['frontfoot', 'frontlegtip'], ['frontlegtip1', 'frontleg1'], ['frontfoot1', 'frontlegtip1'],
  ['rearlegtip', 'rearleg'], ['rearfoot', 'rearlegtip'], ['rearlegtip1', 'rearleg1'], ['rearfoot1', 'rearlegtip1'],
];
/** the dragon's right-hand limbs: drawn as the mirror of the left ones (entity.ts mirrors their pose too) */
export const DRAGON_MIRRORED = ['wing1', 'wingtip1', 'frontleg1', 'frontlegtip1', 'frontfoot1', 'rearleg1', 'rearlegtip1', 'rearfoot1'];
const DRAGON_SEGMENTS = [...Array.from({ length: 5 }, (_, i) => `neck${i + 1}`), ...Array.from({ length: 12 }, (_, i) => `tail${i + 1}`)];
function dragonSegments(g: Geometry): Geometry {
  const neck = g.bones.find((b) => b.name.toLowerCase() === 'neck');
  if (!neck || g.bones.some((b) => b.name.toLowerCase() === 'neck1')) return g;
  // every part hangs off `root`: its setup pose lifts the dragon 30 px and turns it round, and nothing in the geometry names
  // a parent (the game's renderer parents them itself), so without this the head, neck and tail stayed at the entity's feet
  const hasRoot = g.bones.some((b) => b.name.toLowerCase() === 'root');
  const under = (b: GeoBone): GeoBone => (hasRoot && !b.parent && b.name.toLowerCase() !== 'root' ? { ...b, parent: 'root' } : b);
  const copies = DRAGON_SEGMENTS.map((name) => under({ ...neck, name, parent: undefined, cubes: neck.cubes.map((c) => ({ ...c })) }));
  const bones = [...g.bones.map((b) => under(b === neck ? { ...b, neverRender: true } : b)), ...copies];
  // the limbs are chains (wing → tip, leg → tip → foot) whose children are written relative to their parent, Java-style
  // (`wingtip` at (-56, 24, 0) = 56 px along the wing): parent them and move each child by (parent's pivot - (0, 24, 0))
  const byName = new Map(bones.map((b, i) => [b.name.toLowerCase(), i]));
  for (const [child, parent] of DRAGON_CHAINS) {
    const ci = byName.get(child), pi = byName.get(parent);
    if (ci === undefined || pi === undefined) continue;
    const pp = bones[pi].pivot, d: V3 = [pp[0], pp[1] - 24, pp[2]];
    const c = bones[ci];
    const move = (v: V3): V3 => [v[0] + d[0], v[1] + d[1], v[2] + d[2]];
    bones[ci] = { ...c, parent, pivot: move(c.pivot), cubes: c.cubes.map((k) => ({ ...k, origin: move(k.origin), ...(k.pivot ? { pivot: move(k.pivot) } : {}) })) };
  }
  // the right-hand limbs are the left ones drawn under a mirror (Java: scale(-1, 1, 1)); their own cubes are the left limb
  // shifted 24 px, pointing back into the body. Use the mirror of the left limb (x negated, UVs flipped); planEntity
  // mirrors their pose the same way (DRAGON_MIRRORED)
  for (const right of DRAGON_MIRRORED) {
    const ri = byName.get(right), li = byName.get(right.slice(0, -1));
    if (ri === undefined || li === undefined) continue;
    const L = bones[li];
    const mx = (v: V3): V3 => [-v[0], v[1], v[2]];
    bones[ri] = {
      ...bones[ri], pivot: mx(L.pivot),
      cubes: L.cubes.map((k) => ({ ...k, origin: [-(k.origin[0] + k.size[0]), k.origin[1], k.origin[2]] as V3, mirror: !k.mirror, ...(k.pivot ? { pivot: mx(k.pivot) } : {}), ...(k.rotation ? { rotation: [k.rotation[0], -k.rotation[1], -k.rotation[2]] as V3 } : {}) })),
    };
  }
  return { ...g, bones };
}

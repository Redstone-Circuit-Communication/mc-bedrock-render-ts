import { V3 } from './models';

export interface MeshLayerData {
  /** xyz, in blocks, relative to the structure's minimum corner. */
  positions: Float32Array;
  /** uv into the texture, v = 0 at the top of the image. */
  uvs: Float32Array;
  /** rgba, already containing face shading and tint. */
  colors: Float32Array;
  indices: Uint32Array;
  /**
   * Outward face normal per vertex (xyz). Only the translucent layer carries it: the viewer drops translucent faces that
   * point away from the camera, so a glass cube shows its three near faces instead of all six (which made it far too
   * bright). A zero normal marks a double-sided plane that is kept from both sides.
   */
  normals?: Float32Array;
  /**
   * Camera-facing sprites (fireballs, thrown items …): per vertex the offset in the camera's right / up directions, in blocks.
   * The vertex position is then the sprite's CENTRE and the viewer draws it at `position + right * x + up * y`; an ordinary
   * vertex has (0, 0). Java's renderer turns such sprites to the camera on every frame in the same way.
   */
  billboards?: Float32Array;
}

/**
 * Accumulates quads into growable typed arrays (doubling capacity), so large structures do not build
 * multi-million-entry JS number arrays.
 */
export class LayerBuilder {
  private pos = new Float32Array(1024);
  private uv = new Float32Array(512);
  private col = new Float32Array(1024);
  private idx = new Uint32Array(512);
  private nor: Float32Array | null = null;
  private bb: Float32Array | null = null;
  private np = 0;
  private ni = 0;
  verts = 0;

  get empty(): boolean { return this.verts === 0; }
  /** Number of position floats written so far (3 per vertex). */
  get posLength(): number { return this.np; }
  posAt(i: number): number { return this.pos[i]; }

  private grow<T extends Float32Array | Uint32Array>(a: T, need: number): T {
    if (need <= a.length) return a;
    let n = a.length;
    while (n < need) n *= 2;
    const b = new (a.constructor as new (n: number) => T)(n);
    b.set(a);
    return b;
  }

  /** `normal` (outward) makes the quad single-sided in the viewer's translucent pass; omit it for a double-sided one. */
  /** `sprite` = half width / half height: the four points are then all the centre and the quad always faces the camera. */
  quad(p: V3[], uv: [number, number][], rgba: [number, number, number, number], normal?: V3, sprite?: [number, number]): void {
    const base = this.verts;
    if (sprite && !this.bb) this.bb = new Float32Array(Math.max(512, this.uv.length));
    if (this.bb) this.bb = this.grow(this.bb, base * 2 + 8);
    if (normal && !this.nor) this.nor = new Float32Array(Math.max(1024, this.pos.length));
    if (this.nor) this.nor = this.grow(this.nor, this.np + 12);
    this.pos = this.grow(this.pos, this.np + 12);
    this.uv = this.grow(this.uv, base * 2 + 8);
    this.col = this.grow(this.col, base * 4 + 16);
    this.idx = this.grow(this.idx, this.ni + 6);
    for (let i = 0; i < 4; i++) {
      this.pos[this.np++] = p[i][0]; this.pos[this.np++] = p[i][1]; this.pos[this.np++] = p[i][2];
      const u = (base + i) * 2; this.uv[u] = uv[i][0]; this.uv[u + 1] = uv[i][1];
      const c = (base + i) * 4; this.col[c] = rgba[0]; this.col[c + 1] = rgba[1]; this.col[c + 2] = rgba[2]; this.col[c + 3] = rgba[3];
    }
    if (this.bb) for (let i = 0; i < 4; i++) {
      const o = (base + i) * 2;
      // corners in the order top-left, top-right, bottom-right, bottom-left (the order the faces are emitted in)
      this.bb[o] = sprite ? (i === 0 || i === 3 ? -sprite[0] : sprite[0]) : 0;
      this.bb[o + 1] = sprite ? (i < 2 ? sprite[1] : -sprite[1]) : 0;
    }
    if (this.nor) for (let i = 0; i < 4; i++) {
      const o = (base + i) * 3;
      this.nor[o] = normal ? normal[0] : 0; this.nor[o + 1] = normal ? normal[1] : 0; this.nor[o + 2] = normal ? normal[2] : 0;
    }
    this.idx[this.ni++] = base; this.idx[this.ni++] = base + 1; this.idx[this.ni++] = base + 2;
    this.idx[this.ni++] = base; this.idx[this.ni++] = base + 2; this.idx[this.ni++] = base + 3;
    this.verts += 4;
  }

  finish(): MeshLayerData {
    return {
      positions: this.pos.slice(0, this.np),
      uvs: this.uv.slice(0, this.verts * 2),
      colors: this.col.slice(0, this.verts * 4),
      indices: this.idx.slice(0, this.ni),
      ...(this.nor ? { normals: this.nor.slice(0, this.verts * 3) } : {}),
      ...(this.bb ? { billboards: this.bb.slice(0, this.verts * 2) } : {}),
    };
  }
}

/**
 * Index buffer for drawing with back faces culled (the Java package draws blocks `FrontSide`): every triangle wound counter-clockwise
 * around its normal, and the triangles with a zero normal (drawn from both sides: planes, faces of boxes that are not closed) once
 * more the other way round. `null` for a layer without normals (entities: drawn from both sides, like Java's entityCutoutNoCull).
 */
export function singleSidedIndices(l: MeshLayerData): Uint32Array | null {
  const n = l.normals, p = l.positions, idx = l.indices;
  if (!n || n.length < p.length) return null;
  const twoSided = (v: number) => n[v * 3] * n[v * 3] + n[v * 3 + 1] * n[v * 3 + 1] + n[v * 3 + 2] * n[v * 3 + 2] < 0.25;
  let extra = 0;
  for (let t = 0; t < idx.length; t += 3) if (twoSided(idx[t])) extra += 3;
  const out = new Uint32Array(idx.length + extra);
  let o = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (twoSided(a)) { out[o++] = a; out[o++] = b; out[o++] = c; out[o++] = a; out[o++] = c; out[o++] = b; continue; }
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az, vx = p[c * 3] - ax, vy = p[c * 3 + 1] - ay, vz = p[c * 3 + 2] - az;
    const g = (uy * vz - uz * vy) * n[a * 3] + (uz * vx - ux * vz) * n[a * 3 + 1] + (ux * vy - uy * vx) * n[a * 3 + 2];
    if (g >= 0) { out[o++] = a; out[o++] = b; out[o++] = c; } else { out[o++] = a; out[o++] = c; out[o++] = b; }
  }
  return out;
}

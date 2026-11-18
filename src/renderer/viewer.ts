import { MeshLayerData, StructureMesh } from './mesher';
import type { Atlas } from './resources';
import type { TextureBatch } from './entity';

/** `shared`: the texture belongs to an earlier set of the same object (a chunk of a progressively loaded structure). */
interface GpuSet { texture: WebGLTexture; solid: GpuLayer | null; translucent: GpuLayer | null; shared?: boolean }

/** One mesh living in the viewer (a loaded structure). Toggle `visible` to hide it without freeing GPU memory. */
export class ViewerObject {
  /** @internal */ sets: GpuSet[] = [];
  /** @internal how many of `sets` are block geometry (the rest are entity batches) */
  blockSets = 1;
  private _visible = true;
  private _entities = true;
  constructor(private viewer: StructureViewer, readonly size: [number, number, number]) {}
  /** Draw the entity / block-entity batches (every set after the block atlas). */
  get entitiesVisible(): boolean { return this._entities; }
  set entitiesVisible(v: boolean) { if (v !== this._entities) { this._entities = v; this.viewer.requestRender(); } }
  get visible(): boolean { return this._visible; }
  set visible(v: boolean) { if (v !== this._visible) { this._visible = v; this.viewer.requestRender(); } }
  /** Ask the viewer for a redraw (used when something attached to this object changed). */
  invalidate(): void { this.viewer.requestRender(); }
  /** Progressive loading: show one more chunk of block geometry (uses the object's block atlas). Ignored once disposed. */
  appendBlocks(solid: MeshLayerData, translucent: MeshLayerData): void { this.viewer.appendBlocks(this, solid, translucent); }
  /** Progressive loading: the entity / block-entity batches, after the last chunk. */
  appendEntities(batches: TextureBatch[]): void { this.viewer.appendEntities(this, batches); }
  dispose(): void { this.viewer.removeObject(this); }
}

export interface CameraBasis { eye: [number, number, number]; fwd: [number, number, number]; right: [number, number, number]; up: [number, number, number]; }
export type ProjectionMode = 'perspective' | 'orthographic';

/** A set of line segments drawn on top of the structures (selection boxes, gizmos). `matrix` is column-major, model → structure space. */
export interface OverlayLines { positions: Float32Array; index?: ArrayLike<number> | null; matrix: ArrayLike<number>; color: [number, number, number]; opacity: number; depthTest: boolean }

export interface ViewerOptions {
  /** CSS colour string, or [r,g,b,a] in 0..1. Use alpha 0 for a transparent canvas. Default `#1b1d23`. */
  background?: string | [number, number, number, number];
  /** Vertical field of view in degrees. Default 45. */
  fov?: number;
  /** Ambient occlusion (default true, like the Java package's SSAO). */
  ssao?: boolean;
  /** Enable mouse / touch orbit controls. Default true. */
  controls?: boolean;
  /** Spin slowly around the structure. Default false. */
  autoRotate?: boolean;
  /** Degrees per second when `autoRotate` is on. Default 20. */
  autoRotateSpeed?: number;
  /** Multisample anti-aliasing. Default true. */
  antialias?: boolean;
  /** SMAA in the final pass (default true). */
  smaa?: boolean;
  /** MSAA samples of the post-processing render target (0 = off, the default; 4 is the usual "high"). */
  multisampling?: number;
  /** Draw the axis lines. Default false. */
  axes?: boolean;
  /** Cap on devicePixelRatio. Default 2. */
  maxPixelRatio?: number;
  /** Draw a block grid on the ground plane. Default false. */
  grid?: boolean;
  /** Start with an orthographic (isometric-style) projection. Default false. */
  orthographic?: boolean;
}

import { SSAOPass, SSAOParams } from './ssao';
import { singleSidedIndices } from './layer';

type Mat4 = Float32Array;

// aNormal: the outward normal of a translucent face, (0,0,0) for solid geometry and for double-sided planes. A face that
// looks away from the camera (vSide < 0) is dropped in the fragment shader: translucent solids are single-sided, so a
// glass cube shows its three near faces and not all six stacked on top of each other.
const VERT = `#version 300 es
in vec3 aPos; in vec2 aUv; in vec4 aColor; in vec3 aNormal; in vec2 aBb;
uniform mat4 uMvp; uniform vec3 uEye; uniform vec3 uFwd; uniform float uOrtho; uniform vec3 uRight; uniform vec3 uUp;
out vec2 vUv; out vec4 vColor; out float vSide;
void main() {
  vUv = aUv; vColor = aColor;
  // a sprite's four vertices are its centre; the offset in the camera's right / up directions (0 for everything else) spreads them
  vec3 pos = aPos + uRight * aBb.x + uUp * aBb.y;
  vec3 toEye = uOrtho > 0.5 ? -uFwd : uEye - pos;
  vSide = dot(aNormal, aNormal) < 0.01 ? 1.0 : dot(aNormal, toEye);
  gl_Position = uMvp * vec4(pos, 1.0);
}`;

const LINE_VERT = `#version 300 es
in vec3 aPos; uniform mat4 uMvp;
void main() { gl_Position = uMvp * vec4(aPos, 1.0); }`;

const LINE_FRAG = `#version 300 es
precision mediump float; uniform vec4 uColor; out vec4 outColor;
void main() { outColor = uColor; }`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUv; in vec4 vColor; in float vSide;
uniform sampler2D uAtlas; uniform float uAlphaTest;
out vec4 outColor;
void main() {
  if (vSide < 0.0) discard;
  vec4 t = texture(uAtlas, vUv);
  if (t.a < uAlphaTest) discard;
  // vColor carries the Java renderer's light (ambient 2.2 + directional 1.0, Lambert, linear); like its gamma pass (x²) followed by
  // the sRGB output (x^(1/2.2)) the lit colour is raised to 1/1.1
  outColor = vec4(pow(t.rgb * vColor.rgb, vec3(1.0 / 1.1)), t.a * vColor.a);
}`;

function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf;
  return m;
}

function ortho(halfW: number, halfH: number, near: number, far: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1 / halfW; m[5] = 1 / halfH; m[10] = -2 / (far - near); m[14] = -(far + near) / (far - near); m[15] = 1;
  return m;
}

function lookAt(eye: number[], target: number[], up: number[]): Mat4 {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx;
  m[4] = xy; m[5] = yy; m[6] = zy;
  m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

function parseColor(c: ViewerOptions['background']): [number, number, number, number] {
  if (Array.isArray(c)) return c;
  const s = (c ?? '#1b1d23').trim();
  const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, 1];
  }
  return [0.1, 0.11, 0.14, 1];
}

interface GpuLayer { vao: WebGLVertexArrayObject; bufs: WebGLBuffer[]; count: number; cull?: boolean }

/** Stand-alone WebGL2 renderer for {@link StructureMesh}es. No dependencies. */
export class StructureViewer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;

  /** Orbit camera state (radians / blocks). Change and call {@link requestRender}. */
  yaw = Math.PI / 4;
  pitch = 0.5;
  distance = 10;
  target: [number, number, number] = [0, 0, 0];

  autoRotate: boolean;
  autoRotateSpeed: number;
  fov: number;
  /** Ambient occlusion on (the Java package's default) / off. */
  ssaoEnabled: boolean;
  /** Same presets as the Java package (N8AO): perspective and isometric (orthographic) camera. */
  readonly ssaoPresets: { perspective: SSAOParams; isometric: SSAOParams } = {
    perspective: { aoRadius: 1, distanceFalloff: 0.4, intensity: 5 }, isometric: { aoRadius: 0.3, distanceFalloff: 0.1, intensity: 0.8 },
  };
  private ssao: SSAOPass | null = null;
  /** `orthographic` gives an isometric-style view (no perspective); `orthoZoom` > 1 zooms in. */
  projection: ProjectionMode;
  orthoZoom = 1;
  showGrid: boolean;
  /** X (red), Y (green), Z (blue) axis lines from the origin of the structure. Default false. */
  showAxes = false;
  /** Frames per second over the last second (0 while nothing is drawn). */
  fps = 0;
  /** Called after every drawn frame with the frame timestamp (ms). */
  onFrame?: (t: number) => void;
  /** Called once when the viewer goes from drawing frames to having nothing to draw. */
  onIdle?: () => void;
  /** Called whenever the camera (or anything else that needs a redraw) changed. */
  onCameraChange?: () => void;
  /** Called when the pointer lock is taken or released, and when the fly speed changes. */
  onPointerLockChange?: (locked: boolean) => void;
  onFlySpeedChange?: () => void;
  /** Supplies selection boxes / gizmos drawn as lines after the opaque pass. */
  overlays?: () => OverlayLines[];
  /** Triangles and draw calls of the last frame; frame timings when profiling is on. */
  readonly stats = { triangles: 0, drawCalls: 0, visibleObjects: 0 };
  profiling = false;
  readonly frameTimes: number[] = [];
  private rendering = false;

  /** First-person camera. While `enabled` it replaces the orbit camera. */
  readonly fly = {
    enabled: false, pos: [0, 0, 0] as [number, number, number], yaw: 0, pitch: 0,
    moveSpeed: 10.89, sprintMultiplier: 2, lookSensitivity: 0.8,
    keybinds: { forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD', up: 'Space', down: 'ShiftLeft', sprint: 'ControlLeft' },
  };

  private bg: [number, number, number, number];
  private program: WebGLProgram;
  private uMvp: WebGLUniformLocation;
  private uAlpha: WebGLUniformLocation;
  private uEye: WebGLUniformLocation;
  private uFwd: WebGLUniformLocation;
  private uOrtho: WebGLUniformLocation;
  private uRight: WebGLUniformLocation;
  private uUp: WebGLUniformLocation;
  private lineProgram: WebGLProgram;
  private overlayBuffers = new WeakMap<Float32Array, { vao: WebGLVertexArrayObject; buf: WebGLBuffer; ibo: WebGLBuffer | null; count: number; idx: ArrayLike<number> | null | undefined }>();
  private lineMvp: WebGLUniformLocation;
  private lineColor: WebGLUniformLocation;
  private grid: { minor: GpuLines | null; major: GpuLines | null; dirty: boolean } = { minor: null, major: null, dirty: true };
  private objects: ViewerObject[] = [];
  private radius = 1;
  private extent: [number, number, number] = [1, 1, 1];
  private raf = 0;
  private dirty = true;
  /**
   * Orbit interaction as in the Java renderer (three.js OrbitControls with the values of its CameraManager): rotateSpeed 0.8,
   * zoomSpeed 1.2, dampingFactor 0.08. A drag adds to a pending delta, every frame applies 8 % of it and keeps 92 %.
   */
  static readonly ORBIT = { rotateSpeed: 0.8, zoomSpeed: 1.2, dampingFactor: 0.08 };
  private pending = { yaw: 0, pitch: 0, panX: 0, panY: 0 };
  private lastT = 0;
  private lastRenderT = 0;
  private targetFps = 0;
  private suspended = false;
  private ro?: ResizeObserver;
  private maxDpr: number;
  private cleanup: (() => void)[] = [];
  private keys = new Set<string>();

  constructor(canvas: HTMLCanvasElement, opts: ViewerOptions = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: opts.antialias ?? true, alpha: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.bg = parseColor(opts.background);
    this.fov = ((opts.fov ?? 60) * Math.PI) / 180; // the Java package's perspective camera
    this.ssaoEnabled = opts.ssao ?? true;
    this.autoRotate = opts.autoRotate ?? false;
    this.autoRotateSpeed = opts.autoRotateSpeed ?? 20;
    this.maxDpr = opts.maxPixelRatio ?? 2;
    this.showGrid = opts.grid ?? false;
    this.showAxes = opts.axes ?? false;
    this.projection = opts.orthographic ? 'orthographic' : 'perspective';

    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader error: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const link = (vs: string, fs: string, attribs: string[]) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
      return p;
    };
    this.program = link(VERT, FRAG, ['aPos', 'aUv', 'aColor', 'aNormal', 'aBb']);
    this.uMvp = gl.getUniformLocation(this.program, 'uMvp')!;
    this.uEye = gl.getUniformLocation(this.program, 'uEye')!;
    this.uFwd = gl.getUniformLocation(this.program, 'uFwd')!;
    this.uOrtho = gl.getUniformLocation(this.program, 'uOrtho')!;
    this.uRight = gl.getUniformLocation(this.program, 'uRight')!;
    this.uUp = gl.getUniformLocation(this.program, 'uUp')!;
    gl.vertexAttrib2f(4, 0, 0); // layers without sprites: no offset
    gl.vertexAttrib3f(3, 0, 0, 0); // layers without normals (solid blocks, entities): never culled
    this.uAlpha = gl.getUniformLocation(this.program, 'uAlphaTest')!;
    this.lineProgram = link(LINE_VERT, LINE_FRAG, ['aPos']);
    try { this.ssao = new SSAOPass(gl, (vs, fs) => link(vs, fs, [])); } catch (e) { console.warn('mcstructure-renderer: no ambient occlusion', e); this.ssao = null; }
    this.lineMvp = gl.getUniformLocation(this.lineProgram, 'uMvp')!;
    this.lineColor = gl.getUniformLocation(this.lineProgram, 'uColor')!;

    if (opts.controls ?? true) this.bindControls();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => { this.dirty = true; });
      this.ro.observe(canvas);
    }
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------- content ---

  /** Show `mesh` and hide / free everything shown before (single-structure convenience). */
  setMesh(mesh: StructureMesh): ViewerObject {
    for (const o of [...this.objects]) o.dispose();
    const obj = this.addMesh(mesh);
    this.fitCamera();
    return obj;
  }

  /** Add a mesh next to the ones already shown. Dispose the returned object to remove it. */
  addMesh(mesh: StructureMesh): ViewerObject {
    const obj = new ViewerObject(this, mesh.size);
    obj.sets.push({
      texture: this.makeTexture(mesh.atlas.width, mesh.atlas.height, mesh.atlas.data),
      solid: this.upload(mesh.solid), translucent: this.upload(mesh.translucent),
    });
    for (const b of mesh.entityBatches) {
      obj.sets.push({
        texture: this.makeTexture(b.image.width, b.image.height, b.image.data),
        solid: this.upload(b.solid), translucent: this.upload(b.translucent),
      });
    }
    this.objects.push(obj);
    this.updateExtent();
    this.requestRender();
    return obj;
  }

  /**
   * Progressive loading: an object that only holds the block atlas for now. Its geometry comes chunk by chunk
   * (`obj.appendBlocks`), then the entities (`obj.appendEntities`); it is drawn the whole time.
   */
  beginMesh(size: [number, number, number], atlas: Atlas): ViewerObject {
    const obj = new ViewerObject(this, size);
    obj.sets.push({ texture: this.makeTexture(atlas.width, atlas.height, atlas.data), solid: null, translucent: null });
    this.objects.push(obj);
    this.updateExtent();
    this.requestRender();
    return obj;
  }

  /** @internal */
  appendBlocks(obj: ViewerObject, solid: MeshLayerData, translucent: MeshLayerData): void {
    const atlas = obj.sets[0];
    if (!atlas || !this.objects.includes(obj)) return;
    const set: GpuSet = { texture: atlas.texture, solid: this.upload(solid), translucent: this.upload(translucent), shared: true };
    if (!set.solid && !set.translucent) return;
    obj.sets.splice(obj.blockSets, 0, set);
    obj.blockSets++;
    this.requestRender();
  }

  /** @internal */
  appendEntities(obj: ViewerObject, batches: TextureBatch[]): void {
    if (!this.objects.includes(obj)) return;
    for (const b of batches) {
      obj.sets.push({ texture: this.makeTexture(b.image.width, b.image.height, b.image.data), solid: this.upload(b.solid), translucent: this.upload(b.translucent) });
    }
    if (batches.length) this.requestRender();
  }

  /** @internal */
  removeObject(obj: ViewerObject): void {
    const i = this.objects.indexOf(obj);
    if (i < 0) return;
    this.objects.splice(i, 1);
    this.freeSets(obj.sets);
    obj.sets = [];
    this.updateExtent();
    this.requestRender();
  }

  /** Objects currently held (visible or not). */
  get meshCount(): number { return this.objects.length; }
  /** Size of the box that holds every object, in blocks. */
  get sceneSize(): [number, number, number] { return [...this.extent]; }

  private updateExtent(): void {
    const e: [number, number, number] = [0, 0, 0];
    for (const o of this.objects) for (let i = 0; i < 3; i++) e[i] = Math.max(e[i], o.size[i]);
    this.extent = [Math.max(1, e[0]), Math.max(1, e[1]), Math.max(1, e[2])];
    this.radius = Math.hypot(...this.extent) / 2;
    this.grid.dirty = true;
  }

  private makeTexture(w: number, h: number, data: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** Re-frame the whole scene (orbit camera). */
  fitCamera(): void {
    this.target = [this.extent[0] / 2, this.extent[1] / 2, this.extent[2] / 2];
    this.distance = (this.radius / Math.sin(this.fov / 2)) * 1.05;
    this.orthoZoom = 1;
    this.requestRender();
  }

  private upload(l: MeshLayerData): GpuLayer | null {
    if (l.indices.length === 0) return null;
    const oriented = singleSidedIndices(l);
    if (oriented) l = { ...l, indices: oriented };
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const bufs: WebGLBuffer[] = [];
    const attr = (loc: number, data: Float32Array, size: number) => {
      const b = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      bufs.push(b);
    };
    attr(0, l.positions, 3); attr(1, l.uvs, 2); attr(2, l.colors, 4);
    if (l.normals) attr(3, l.normals, 3);
    if (l.billboards) attr(4, l.billboards, 2);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, l.indices, gl.STATIC_DRAW);
    bufs.push(ib);
    gl.bindVertexArray(null);
    return { vao, bufs, count: l.indices.length, cull: !!oriented };
  }

  private freeSets(sets: GpuSet[]): void {
    const gl = this.gl;
    for (const set of sets) {
      for (const l of [set.solid, set.translucent]) {
        if (!l) continue;
        gl.deleteVertexArray(l.vao);
        l.bufs.forEach((b) => gl.deleteBuffer(b));
      }
      if (!set.shared) gl.deleteTexture(set.texture);
    }
  }

  // --------------------------------------------------------------- camera ---

  /** Eye position and orthonormal camera axes of the camera that is currently active. */
  cameraBasis(): CameraBasis {
    let eye: [number, number, number], fwd: [number, number, number];
    if (this.fly.enabled) {
      const { yaw, pitch } = this.fly, cp = Math.cos(pitch);
      fwd = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
      eye = [...this.fly.pos];
    } else {
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      eye = [
        this.target[0] + this.distance * cp * Math.sin(this.yaw),
        this.target[1] + this.distance * sp,
        this.target[2] + this.distance * cp * Math.cos(this.yaw),
      ];
      fwd = [-cp * Math.sin(this.yaw), -sp, -cp * Math.cos(this.yaw)];
    }
    // right = fwd × worldUp, up = right × fwd
    let rx = fwd[1] * 0 - fwd[2] * 1, ry = fwd[2] * 0 - fwd[0] * 0, rz = fwd[0] * 1 - fwd[1] * 0;
    const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const up: [number, number, number] = [ry * fwd[2] - rz * fwd[1], rz * fwd[0] - rx * fwd[2], rx * fwd[1] - ry * fwd[0]];
    return { eye, fwd, right: [rx, ry, rz], up };
  }

  /** `true` when the orthographic projection is in use (never while flying). */
  get isOrthographic(): boolean { return this.projection === 'orthographic' && !this.fly.enabled; }

  private halfHeight(): number { return (this.distance * Math.tan(this.fov / 2)) / this.orthoZoom; }

  /** World-space ray through a point of the canvas; `nx`, `ny` in −1..1 (y up). */
  rayFromNdc(nx: number, ny: number): { origin: [number, number, number]; dir: [number, number, number] } {
    const b = this.cameraBasis();
    const aspect = (this.canvas.clientWidth || this.canvas.width) / (this.canvas.clientHeight || this.canvas.height || 1);
    if (this.isOrthographic) {
      const hh = this.halfHeight(), hw = hh * aspect;
      return {
        origin: [0, 1, 2].map((i) => b.eye[i] + b.right[i] * nx * hw + b.up[i] * ny * hh) as [number, number, number],
        dir: [...b.fwd],
      };
    }
    const th = Math.tan(this.fov / 2);
    const d = [0, 1, 2].map((i) => b.fwd[i] + b.right[i] * nx * th * aspect + b.up[i] * ny * th);
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return { origin: b.eye, dir: [d[0] / l, d[1] / l, d[2] / l] };
  }

  /** Place the orbit camera on the `direction` side of the target (e.g. `[0, 1, 0]` = view from above). */
  snapToDirection(direction: [number, number, number]): void {
    const l = Math.hypot(...direction) || 1;
    const [dx, dy, dz] = direction.map((v) => v / l);
    if (this.fly.enabled) this.disableFly();
    this.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.asin(dy)));
    if (Math.abs(dy) < 0.9999) this.yaw = Math.atan2(dx, dz);
    this.requestRender();
  }

  // ------------------------------------------------------------------ fly ---

  enableFly(): void {
    if (this.fly.enabled) return;
    const b = this.cameraBasis();
    this.fly.pos = [...b.eye];
    this.fly.yaw = Math.atan2(b.fwd[0], b.fwd[2]);
    this.fly.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.asin(b.fwd[1])));
    this.fly.enabled = true;
    this.requestRender();
  }

  disableFly(): void {
    if (!this.fly.enabled) return;
    this.unlockPointer();
    const b = this.cameraBasis();
    this.fly.enabled = false;
    this.keys.clear();
    this.target = [b.eye[0] + b.fwd[0] * this.distance, b.eye[1] + b.fwd[1] * this.distance, b.eye[2] + b.fwd[2] * this.distance];
    this.yaw = Math.atan2(-b.fwd[0], -b.fwd[2]);
    this.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.asin(-b.fwd[1])));
    this.requestRender();
  }

  /** Pointer lock must be requested from a user gesture. */
  lockPointer(): void { this.canvas.requestPointerLock?.(); }
  unlockPointer(): void { if (typeof document !== 'undefined' && document.pointerLockElement === this.canvas) document.exitPointerLock?.(); }
  get pointerLocked(): boolean { return typeof document !== 'undefined' && document.pointerLockElement === this.canvas; }

  // ------------------------------------------------------------ rendering ---

  requestRender(): void { this.dirty = true; this.onCameraChange?.(); }
  /** Alias of {@link requestRender} (the Java renderer calls it `invalidate`). */
  invalidate(): void { this.dirty = true; this.onCameraChange?.(); }
  get suspendedState(): boolean { return this.suspended; }
  setBackground(c: ViewerOptions['background']): void { this.bg = parseColor(c); this.dirty = true; }
  get backgroundColor(): [number, number, number, number] { return [...this.bg]; }
  setBackgroundAlpha(a: number): void { this.bg = [this.bg[0], this.bg[1], this.bg[2], a]; this.dirty = true; }
  setMaxPixelRatio(n: number): void { this.maxDpr = Math.max(0.25, n); this.dirty = true; }
  /** 0 = render whenever something changed (default). */
  setTargetFPS(n: number): void { this.targetFps = Math.max(0, n); }
  get maxPixelRatio(): number { return this.maxDpr; }
  suspend(): void { this.suspended = true; cancelAnimationFrame(this.raf); this.raf = 0; }
  resume(): void { if (!this.suspended) return; this.suspended = false; this.lastT = 0; this.dirty = true; this.raf = requestAnimationFrame(this.loop); }

  private loop(t: number): void {
    if (this.suspended) return;
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    if (this.autoRotate && !this.fly.enabled) { this.yaw += (this.autoRotateSpeed * Math.PI / 180) * dt; this.dirty = true; }
    if (this.fly.enabled && this.keys.size) { this.stepFly(dt); this.onCameraChange?.(); }
    if (!this.fly.enabled && this.stepOrbitDamping()) { this.dirty = true; this.onCameraChange?.(); }
    if (this.dirty && (!this.targetFps || t - this.lastRenderT >= 1000 / this.targetFps - 2)) {
      this.dirty = false; this.rendering = true;
      const gap = t - this.lastRenderT; this.lastRenderT = t;
      if (gap > 0 && gap < 1000) this.fps = this.fps ? this.fps * 0.9 + (1000 / gap) * 0.1 : 1000 / gap;
      const t0 = this.profiling ? performance.now() : 0;
      this.render();
      if (this.profiling) { this.frameTimes.push(performance.now() - t0); if (this.frameTimes.length > 240) this.frameTimes.shift(); }
      this.onFrame?.(t);
    } else if (!this.dirty && this.rendering) { this.rendering = false; this.fps = 0; this.onIdle?.(); }
    this.raf = requestAnimationFrame(this.loop);
  }

  private stepFly(dt: number): void {
    const k = this.fly.keybinds, f = this.fly;
    const sp = f.moveSpeed * (this.keys.has(k.sprint) ? f.sprintMultiplier : 1) * dt;
    const b = this.cameraBasis();
    const mv = (v: number[], s: number) => { for (let i = 0; i < 3; i++) f.pos[i] += v[i] * s; };
    if (this.keys.has(k.forward)) mv(b.fwd, sp);
    if (this.keys.has(k.backward)) mv(b.fwd, -sp);
    if (this.keys.has(k.right)) mv(b.right, sp);
    if (this.keys.has(k.left)) mv(b.right, -sp);
    if (this.keys.has(k.up)) f.pos[1] += sp;
    if (this.keys.has(k.down)) f.pos[1] -= sp;
    this.dirty = true;
  }

  /** Fixed drawing-buffer size while a sized screenshot / recording frame is taken. */
  private sizeOverride: { w: number; h: number } | null = null;

  private resize(): void {
    if (this.sizeOverride) { const { w, h } = this.sizeOverride; if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; } return; }
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  private buildGrid(): void {
    const gl = this.gl;
    for (const k of ['minor', 'major'] as const) { const g = this.grid[k]; if (g) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.buf); } this.grid[k] = null; }
    const pad = 8, x0 = -pad, z0 = -pad, x1 = Math.ceil(this.extent[0]) + pad, z1 = Math.ceil(this.extent[2]) + pad;
    const minor: number[] = [], major: number[] = [];
    for (let x = x0; x <= x1; x++) (x % 16 === 0 ? major : minor).push(x, 0, z0, x, 0, z1);
    for (let z = z0; z <= z1; z++) (z % 16 === 0 ? major : minor).push(x0, 0, z, x1, 0, z);
    const make = (data: number[]): GpuLines | null => {
      if (!data.length) return null;
      const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
      const buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      return { vao, buf, count: data.length / 3 };
    };
    this.grid.minor = make(minor); this.grid.major = make(major); this.grid.dirty = false;
  }

  /** Draw one frame immediately. */
  render(): void {
    const gl = this.gl;
    this.resize();
    const clear: [number, number, number, number] = [this.bg[0] * this.bg[3], this.bg[1] * this.bg[3], this.bg[2] * this.bg[3], this.bg[3]];
    const live = this.objects.filter((o) => o.visible);
    // ambient occlusion (the Java package's N8AO presets): the solid pass goes to an offscreen target first
    const ao = live.length && this.ssaoEnabled ? this.ssao : null;
    if (ao) ao.begin(this.canvas.width, this.canvas.height, clear);
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    if (!live.length) return;

    const b = this.cameraBasis();
    const aspect = this.canvas.width / this.canvas.height;
    const view = lookAt(b.eye, [b.eye[0] + b.fwd[0], b.eye[1] + b.fwd[1], b.eye[2] + b.fwd[2]], [0, 1, 0]);
    let proj: Mat4;
    if (this.isOrthographic) {
      const hh = this.halfHeight();
      proj = ortho(hh * aspect, hh, -this.radius * 4, this.distance + this.radius * 4);
    } else if (this.fly.enabled) proj = perspective(this.fov, aspect, 0.05, Math.max(1024, this.radius * 8));
    else proj = perspective(this.fov, aspect, Math.max(0.05, this.distance - this.radius * 2), this.distance + this.radius * 4);
    const mvp = mul(proj, view);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uMvp, false, mvp);
    gl.uniform3f(this.uEye, b.eye[0], b.eye[1], b.eye[2]);
    gl.uniform3f(this.uFwd, b.fwd[0], b.fwd[1], b.fwd[2]);
    gl.uniform3f(this.uRight, b.right[0], b.right[1], b.right[2]);
    gl.uniform3f(this.uUp, b.up[0], b.up[1], b.up[2]);
    gl.uniform1f(this.uOrtho, this.isOrthographic ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.frontFace(gl.CCW); gl.cullFace(gl.BACK);

    let tris = 0, calls = 0;
    const draw = (layer: GpuLayer | null, tex: WebGLTexture) => {
      if (!layer) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // blocks: back faces culled (oriented index buffer); entities and layers without normals: both sides, as before
      if (layer.cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(layer.vao);
      gl.drawElements(gl.TRIANGLES, layer.count, gl.UNSIGNED_INT, 0);
      tris += layer.count / 3; calls++;
    };
    const setsOf = (o: ViewerObject) => (o.entitiesVisible ? o.sets : o.sets.slice(0, o.blockSets));
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.uniform1f(this.uAlpha, 0.5);
    for (const o of live) for (const set of setsOf(o)) draw(set.solid, set.texture);
    if (ao) { ao.occlude(proj, this.isOrthographic ? this.ssaoPresets.isometric : this.ssaoPresets.perspective); gl.useProgram(this.program); }

    if (this.showGrid) {
      if (this.grid.dirty) this.buildGrid();
      gl.useProgram(this.lineProgram);
      gl.uniformMatrix4fv(this.lineMvp, false, mvp);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      for (const [g, c] of [[this.grid.minor, [1, 1, 1, 0.16]], [this.grid.major, [1, 1, 1, 0.42]]] as const) {
        if (!g) continue;
        gl.uniform4f(this.lineColor, c[0], c[1], c[2], c[3]);
        gl.bindVertexArray(g.vao); gl.drawArrays(gl.LINES, 0, g.count);
      }
      gl.useProgram(this.program);
    }

    const overlays = [...(this.showAxes ? this.axesLines() : []), ...(this.overlays?.() ?? [])];
    if (overlays.length) this.drawOverlays(overlays, mvp);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(this.uAlpha, 0.01);
    for (const o of live) for (const set of setsOf(o)) draw(set.translucent, set.texture);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    if (ao) ao.present();
    gl.bindVertexArray(null);
    this.stats.triangles = tris; this.stats.drawCalls = calls; this.stats.visibleObjects = live.length;
  }

  private axes: { size: number; lines: OverlayLines[] } | null = null;
  private axesLines(): OverlayLines[] {
    const size = Math.ceil(Math.max(...this.extent)) + 2;
    if (this.axes?.size !== size) {
      const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      type V3 = [number, number, number];
      const mk = (end: V3, color: V3): OverlayLines => ({ positions: new Float32Array([0, 0, 0, ...end]), matrix: I, color, opacity: 1, depthTest: true });
      this.axes = { size, lines: [mk([size, 0, 0], [1, 0.25, 0.25]), mk([0, size, 0], [0.35, 1, 0.35]), mk([0, 0, size], [0.35, 0.55, 1])] };
    }
    return this.axes.lines;
  }

  private drawOverlays(list: OverlayLines[], mvp: Mat4): void {
    const gl = this.gl;
    gl.useProgram(this.lineProgram);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    for (const o of list) {
      let g = this.overlayBuffers.get(o.positions);
      if (!g || g.idx !== o.index) {
        if (g) { gl.deleteVertexArray(g.vao); gl.deleteBuffer(g.buf); if (g.ibo) gl.deleteBuffer(g.ibo); }
        const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
        const buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, o.positions, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        let ibo: WebGLBuffer | null = null;
        if (o.index && o.index.length) { ibo = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, Uint32Array.from(o.index as ArrayLike<number>), gl.STATIC_DRAW); }
        g = { vao, buf, ibo, count: o.index && o.index.length ? o.index.length : o.positions.length / 3, idx: o.index };
        this.overlayBuffers.set(o.positions, g);
      }
      gl.uniformMatrix4fv(this.lineMvp, false, mul(mvp, Float32Array.from(o.matrix as ArrayLike<number>)));
      gl.uniform4f(this.lineColor, o.color[0], o.color[1], o.color[2], o.opacity);
      if (o.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      gl.bindVertexArray(g.vao);
      if (g.ibo) gl.drawElements(gl.LINES, g.count, gl.UNSIGNED_INT, 0); else gl.drawArrays(gl.LINES, 0, g.count);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
  }

  /** Image of the current frame (PNG by default). */
  screenshot(type = 'image/png', quality?: number, opts: { width?: number; height?: number; transparent?: boolean } = {}): Promise<Blob> {
    const bg = this.bg;
    const sized = !!(opts.width || opts.height);
    if (sized) {
      const aspect = this.canvas.clientWidth && this.canvas.clientHeight ? this.canvas.clientWidth / this.canvas.clientHeight : this.canvas.width / this.canvas.height;
      const w = Math.max(1, Math.round(opts.width ?? (opts.height as number) * aspect)), h = Math.max(1, Math.round(opts.height ?? (opts.width as number) / aspect));
      this.sizeOverride = { w, h };
    }
    if (opts.transparent) this.bg = [bg[0], bg[1], bg[2], 0];
    try {
      this.render();
      // toBlob copies the bitmap when it is called, so the size and background can go back at once (no frame in between is
      // painted at the wrong size) and the picture is redrawn for the screen before the browser paints
      const blob = new Promise<Blob>((res, rej) => this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), opts.transparent && type === 'image/jpeg' ? 'image/png' : type, quality));
      this.bg = bg;
      if (sized) { this.sizeOverride = null; this.render(); }
      this.dirty = true;
      return blob;
    } catch (e) {
      this.bg = bg;
      this.sizeOverride = null;
      this.dirty = true;
      throw e;
    }
  }

  /** Draw one frame at a fixed drawing-buffer size (recording); `null` goes back to the element size. */
  setCaptureSize(size: { width: number; height: number } | null): void {
    this.sizeOverride = size && { w: Math.max(1, Math.round(size.width)), h: Math.max(1, Math.round(size.height)) };
    this.dirty = true;
  }

  // -------------------------------------------------------------- controls ---

  private bindControls(): void {
    const c = this.canvas;
    c.style.touchAction = 'none';
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;

    const look = (dx: number, dy: number) => {
      const k = 0.0025 * this.fly.lookSensitivity;
      this.fly.yaw -= dx * k;
      this.fly.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, this.fly.pitch - dy * k));
    };
    const zoom = (factor: number) => {
      if (this.isOrthographic) this.orthoZoom = Math.max(0.05, Math.min(200, this.orthoZoom / factor));
      else this.distance = Math.min(1000, Math.max(1, this.distance * factor)); // the Java camera's min / max distance
    };

    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const move = (e: PointerEvent) => {
      if (this.fly.enabled && this.pointerLocked) { look(e.movementX, e.movementY); this.dirty = true; return; }
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.fly.enabled) { look(dx, dy); this.dirty = true; return; }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) zoom(pinch / d);
        pinch = d;
      } else if (e.buttons & 2 || e.shiftKey || e.ctrlKey || e.metaKey) { this.pending.panX += dx; this.pending.panY += dy; }
      else if (e.buttons & 4) {
        // OrbitControls: the middle button dollies (drag down = out), 0.95 ^ (zoomSpeed · |Δy · 0.01|)
        const s = Math.pow(0.95, StructureViewer.ORBIT.zoomSpeed * Math.abs(dy * 0.01));
        if (dy) zoom(dy > 0 ? 1 / s : s);
      }
      else {
        // OrbitControls: rotateLeft / rotateUp(2π · delta / clientHeight · rotateSpeed)
        const k = (2 * Math.PI * StructureViewer.ORBIT.rotateSpeed) / Math.max(1, this.canvas.clientHeight);
        this.pending.yaw += dx * k; this.pending.pitch += dy * k;
      }
      this.dirty = true;
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.fly.enabled) { this.fly.moveSpeed = Math.max(0.1, Math.min(43.556, this.fly.moveSpeed * Math.exp(-e.deltaY * 0.001))); this.onFlySpeedChange?.(); }
      else {
        // OrbitControls: getZoomScale = 0.95 ^ (zoomSpeed · |deltaY · 0.01|); a wheel notch is 100
        const s = Math.pow(0.95, StructureViewer.ORBIT.zoomSpeed * Math.abs(e.deltaY * 0.01));
        zoom(e.deltaY > 0 ? 1 / s : s);
      }
      this.dirty = true;
    };
    const ctx = (e: Event) => e.preventDefault();
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || !!t?.isContentEditable; };
    const kd = (e: KeyboardEvent) => { if (this.fly.enabled && !typing(e)) { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); } };
    const ku = (e: KeyboardEvent) => { this.keys.delete(e.code); };
    const blur = () => this.keys.clear();
    const plc = () => { this.dirty = true; this.onPointerLockChange?.(this.pointerLocked); };

    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('contextmenu', ctx);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    document.addEventListener('pointerlockchange', plc);
    this.cleanup.push(() => {
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
      c.removeEventListener('wheel', wheel); c.removeEventListener('contextmenu', ctx);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
      document.removeEventListener('pointerlockchange', plc);
    });
  }

  /** One OrbitControls update: apply `dampingFactor` of what is pending, keep the rest. Returns whether the camera moved. */
  private stepOrbitDamping(): boolean {
    const p = this.pending, f = StructureViewer.ORBIT.dampingFactor;
    if (!p.yaw && !p.pitch && !p.panX && !p.panY) return false;
    this.yaw -= p.yaw * f;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + p.pitch * f));
    if (p.panX || p.panY) this.pan(p.panX * f, p.panY * f);
    const keep = 1 - f;
    p.yaw *= keep; p.pitch *= keep; p.panX *= keep; p.panY *= keep;
    const eps = 1e-5;
    if (Math.abs(p.yaw) < eps) p.yaw = 0;
    if (Math.abs(p.pitch) < eps) p.pitch = 0;
    if (Math.abs(p.panX) < 0.01) p.panX = 0;
    if (Math.abs(p.panY) < 0.01) p.panY = 0;
    return true;
  }

  private pan(dx: number, dy: number): void {
    const k = this.isOrthographic
      ? (this.halfHeight() * 2) / this.canvas.clientHeight
      : (this.distance * Math.tan(this.fov / 2) * 2) / this.canvas.clientHeight;
    // OrbitControls with screenSpacePanning (three.js' default, the Java camera): along the camera's right and UP vectors, so a
    // vertical drag moves the view in the screen plane. It used to lift the target straight up in the world, which from a camera
    // looking down slid the structure the wrong way
    const b = this.cameraBasis();
    for (let i = 0; i < 3; i++) this.target[i] += -b.right[i] * dx * k + b.up[i] * dy * k;
  }

  dispose(): void {
    this.suspended = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.unlockPointer();
    this.cleanup.forEach((f) => f());
    for (const o of [...this.objects]) o.dispose();
    for (const k of ['minor', 'major'] as const) { const g = this.grid[k]; if (g) { this.gl.deleteVertexArray(g.vao); this.gl.deleteBuffer(g.buf); } }
    this.ssao?.dispose();
    this.gl.deleteProgram(this.program);
    this.gl.deleteProgram(this.lineProgram);
  }
}

interface GpuLines { vao: WebGLVertexArrayObject; buf: WebGLBuffer; count: number; }
const PITCH_MAX = Math.PI / 2 - 0.001;

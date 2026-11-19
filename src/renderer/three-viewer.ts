/**
 * The viewer, drawn by the Java package's rendering stack with the Java package's settings — nothing of the drawing is written here:
 *
 * - renderer (RenderManager): `new THREE.WebGLRenderer({ alpha, antialias, powerPreference: 'high-performance', preserveDrawingBuffer })`
 * - lights (SceneManager): `AmbientLight(0xffffff, 2.2)`, `DirectionalLight(0xffffff, 1)` at (20, 20, −20)
 * - blocks (cubane/AssetLoader): `MeshStandardMaterial({ map, side: FrontSide, alphaTest })`, nearest filtering, the texture's colour
 *   space left alone; translucent faces like its liquids (`transparent`, `depthWrite: false`); tints as material colour (here per vertex)
 * - entities (cubane/EntityRenderer): `MeshStandardMaterial`, textures in `LinearSRGBColorSpace`, drawn from both sides
 * - camera (CameraManager / CameraWrapper): `PerspectiveCamera(60, aspect, 0.1, 1000)` under three's `OrbitControls` with the
 *   perspective preset (damping 0.08, distance 1 … 1000, pan 1.0, rotate 0.8, zoom 1.2); the isometric preset for the orthographic camera
 * - post-processing (RenderManager.initComposer / initDefaultPasses / setSSAOEnabled): postprocessing's `EffectComposer` →
 *   `RenderPass` → n8ao's `N8AOPostPass` (aoRadius 1, distanceFalloff 0.4, intensity 5, gammaCorrection off, quality Medium; isometric
 *   0.3 / 0.1 / 0.8) → `EffectPass(GammaCorrectionEffect(0.5), SMAAEffect())`; `GammaCorrectionEffect` is this package's own pass with the same curve (see gamma-effect.ts).
 *
 * What is this package's own: the geometry (block meshes from the shared mesh core, entities from the Bedrock pack), the camera
 * state accessors the rest of the package uses (yaw / pitch / distance / target over OrbitControls), fly mode, and the overlays.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer, EffectPass, RenderPass, SMAAEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { GammaCorrectionEffect } from './gamma-effect';
import type { MeshLayerData, StructureMesh } from './mesher';
import type { Atlas } from './resources';
import type { TextureBatch } from './entity';
import type { CameraBasis, OverlayLines, ProjectionMode, ViewerOptions } from './viewer';

type V3 = [number, number, number];
const PITCH_MAX = 1.55;
/** Orbit pitch limit: like OrbitControls' `makeSafe`, a hair short of straight up / down so the view direction stays defined. */
const ORBIT_PITCH_MAX = Math.PI / 2 - 1e-6;
/** The Java package's camera presets (CameraManager) and SSAO presets (RenderManager). */
// minDistance 0.05: the host can bring the camera right up to a block (it used to stop one block away)
const PERSPECTIVE_CONTROLS = { enableDamping: true, dampingFactor: 0.08, minDistance: 0.05, maxDistance: 1000, enableZoom: true, enableRotate: true, enablePan: true, panSpeed: 1.0, rotateSpeed: 0.8, zoomSpeed: 1.2 };
const ISOMETRIC_CONTROLS = { ...PERSPECTIVE_CONTROLS, minDistance: 5, maxDistance: 500, minPolarAngle: Math.PI / 8, maxPolarAngle: Math.PI / 2.1 };

function parseColor(c: ViewerOptions['background']): [number, number, number, number] {
  if (Array.isArray(c)) return c;
  const s = (c ?? '#1b1d23').trim();
  const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return [0.1, 0.11, 0.14, 1];
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, 1];
}

/** Nearest-filtered texture of raw RGBA bytes (row 0 = v 0, as the mesh UVs expect). */
function dataTexture(w: number, h: number, data: Uint8Array, colorSpace: string): any {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.flipY = false; t.colorSpace = colorSpace; t.needsUpdate = true;
  return t;
}


/**
 * Geometry of a mesh layer. With normals (blocks), every triangle is wound counter-clockwise around its normal, so FrontSide shows
 * the outside, and a triangle with a zero normal (a plane, a face of a box that is not closed: seen from both sides) gets two copies
 * with their own vertices, the back one reversed with the normal negated. Without normals (entities) the layer is drawn DoubleSide
 * with computed normals. Vertex colours are tints, multiplied with the texture as they are (see below).
 */
function layerGeometry(l: MeshLayerData): { geo: any; oriented: boolean } | null {
  const idx = l.indices;
  if (!idx.length) return null;
  const P = l.positions, U = l.uvs, C = l.colors, N = l.normals;
  const vcount = P.length / 3;
  const zero = (v: number) => !N || N[v * 3] * N[v * 3] + N[v * 3 + 1] * N[v * 3 + 1] + N[v * 3 + 2] * N[v * 3 + 2] < 0.25;
  let twoSided = 0;
  if (N && N.length >= P.length) for (let t = 0; t < idx.length; t += 3) if (zero(idx[t])) twoSided++;
  const oriented = !!N && N.length >= P.length;
  const nv = vcount + twoSided * 6;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 4);
  pos.set(P); uv.set(U);
  if (oriented) nor.set(N!);
  // the tints multiply the texture as they are: this pipeline shows texture colours unchanged, so a linear tint would come
  // out darker and more saturated than in the game and the Java renderer (grass looked far too green)
  for (let v = 0; v < vcount; v++) for (let k = 0; k < 4; k++) col[v * 4 + k] = C[v * 4 + k];
  const index = new Uint32Array(oriented ? idx.length + twoSided * 3 : idx.length);
  if (!oriented) index.set(idx);
  else {
    let v = vcount, o = 0;
    const copy = (src: number, nx: number, ny: number, nz: number) => {
      for (let k = 0; k < 3; k++) pos[v * 3 + k] = P[src * 3 + k];
      uv[v * 2] = U[src * 2]; uv[v * 2 + 1] = U[src * 2 + 1];
      for (let k = 0; k < 4; k++) col[v * 4 + k] = col[src * 4 + k];
      nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
      return v++;
    };
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
      let gx = uy * wz - uz * wy, gy = uz * wx - ux * wz, gz = ux * wy - uy * wx;
      if (zero(a)) {
        const len = Math.hypot(gx, gy, gz) || 1; gx /= len; gy /= len; gz /= len;
        index[o++] = copy(a, gx, gy, gz); index[o++] = copy(b, gx, gy, gz); index[o++] = copy(c, gx, gy, gz);
        const a2 = copy(a, -gx, -gy, -gz), b2 = copy(b, -gx, -gy, -gz), c2 = copy(c, -gx, -gy, -gz);
        index[o++] = a2; index[o++] = c2; index[o++] = b2;
      } else if (gx * N![a * 3] + gy * N![a * 3 + 1] + gz * N![a * 3 + 2] >= 0) { index[o++] = a; index[o++] = b; index[o++] = c; }
      else { index[o++] = a; index[o++] = c; index[o++] = b; }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  if (oriented) geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  else geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return { geo, oriented };
}

/** One structure in the viewer. Same members as the WebGL2 viewer's `ViewerObject`. */
export class ThreeViewerObject {
  /** @internal */ readonly group = new THREE.Group();
  /** @internal */ readonly blocks = new THREE.Group();
  /** @internal */ readonly entities = new THREE.Group();
  /** @internal */ atlas: any = null;
  /** @internal */ owned: { dispose(): void }[] = [];
  /** @internal */ billboards: { attr: any; centers: Float32Array; offsets: Float32Array }[] = [];
  blockSets = 1;
  constructor(private viewer: ThreeStructureViewer, readonly size: [number, number, number]) { this.group.add(this.blocks, this.entities); }
  get entitiesVisible(): boolean { return this.entities.visible; }
  set entitiesVisible(v: boolean) { if (v !== this.entities.visible) { this.entities.visible = v; this.viewer.requestRender(); } }
  get visible(): boolean { return this.group.visible; }
  set visible(v: boolean) { if (v !== this.group.visible) { this.group.visible = v; this.viewer.requestRender(); } }
  invalidate(): void { this.viewer.requestRender(); }
  appendBlocks(solid: MeshLayerData, translucent: MeshLayerData): void { this.viewer.appendBlocks(this, solid, translucent); }
  appendEntities(batches: TextureBatch[]): void { this.viewer.appendEntities(this, batches); }
  dispose(): void { this.viewer.removeObject(this); }
}

export class ThreeStructureViewer {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: any;
  readonly scene: any = new THREE.Scene();
  private persp: any;
  private ortho: any;
  private controls: any = null;
  private composer: any = null;
  private n8ao: any = null;
  private objects: ThreeViewerObject[] = [];
  private extent: V3 = [1, 1, 1];
  private radius = 1;
  private bg: [number, number, number, number];
  private maxDpr: number;
  private dirty = true;
  private raf = 0;
  private suspended = false;
  private rendering = false;
  private lastT = 0;
  private lastRenderT = 0;
  private targetFps = 0;
  private cleanup: (() => void)[] = [];
  private keys = new Set<string>();
  private sizeOverride: { w: number; h: number } | null = null;
  private helpers: { grid: any; axes: any; overlay: any } = { grid: null, axes: null, overlay: new THREE.Group() };
  private gridFor = '';
  private _showGrid: boolean;
  private _showAxes: boolean;
  private _projection: ProjectionMode;
  private _ssao: boolean;
  /** The SceneManager lights, kept for the lightweight shading (setShading). */
  private ambientLight: any;
  private sunLight: any;
  private hemiLight: any = null;
  private shading = false;
  private shadingQuality: 'normal' | 'high' = 'normal';
  /** Anti-aliasing of the post-processing chain: SMAA in the final pass, MSAA samples of the composer's render target. */
  private smaa = true;
  private multisampling = 0;
  private orthoHalf = 10;
  private _fov = Math.PI / 3;
  private _autoRotateSpeed = 20;
  get fov(): number { return this._fov; }
  set fov(f: number) { this._fov = f; if (this.persp) { this.persp.fov = (f * 180) / Math.PI; this.persp.updateProjectionMatrix(); } this.requestRender(); }
  /** Degrees per second (OrbitControls' autoRotateSpeed is 2π/60 · speed rad/s). */
  get autoRotateSpeed(): number { return this._autoRotateSpeed; }
  set autoRotateSpeed(s: number) { this._autoRotateSpeed = s; if (this.controls) this.controls.autoRotateSpeed = s / 6; }
  fps = 0;
  profiling = false;
  readonly frameTimes: number[] = [];
  readonly stats = { triangles: 0, drawCalls: 0, visibleObjects: 0 };
  // stronger than before (1 / 0.4 / 5 and 0.3 / 0.1 / 0.8): the occlusion was barely visible, same change as the Java RenderManager
  readonly ssaoPresets = { perspective: { aoRadius: 2, distanceFalloff: 1, intensity: 6 }, isometric: { aoRadius: 1.2, distanceFalloff: 0.6, intensity: 3 } };
  onFrame?: (t: number) => void;
  onIdle?: () => void;
  onCameraChange?: () => void;
  onPointerLockChange?: (locked: boolean) => void;
  onFlySpeedChange?: () => void;
  overlays?: () => OverlayLines[];
  readonly fly = {
    enabled: false, pos: [0, 0, 0] as V3, yaw: 0, pitch: 0, moveSpeed: 10.89, sprintMultiplier: 2, lookSensitivity: 0.8,
    keybinds: { forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD', up: 'Space', down: 'ShiftLeft', sprint: 'ControlLeft' },
  };

  constructor(canvas: HTMLCanvasElement, opts: ViewerOptions = {}) {
    this.canvas = canvas;
    // RenderManager.initWebGLRenderer
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: opts.antialias ?? true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.bg = parseColor(opts.background);
    this.maxDpr = opts.maxPixelRatio ?? 2;
    this._fov = ((opts.fov ?? 60) * Math.PI) / 180;
    this._autoRotateSpeed = opts.autoRotateSpeed ?? 20;
    this._showGrid = opts.grid ?? false;
    this._showAxes = opts.axes ?? false;
    this._ssao = opts.ssao ?? true;
    this.smaa = opts.smaa ?? true;
    this.multisampling = Math.max(0, Math.min(8, Math.round(opts.multisampling ?? 0)));
    this._projection = opts.orthographic ? 'orthographic' : 'perspective';
    // SceneManager
    this.ambientLight = new THREE.AmbientLight(0xffffff, 2.2);
    this.scene.add(this.ambientLight);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(20, 20, -20);
    this.scene.add(sun);
    this.sunLight = sun;
    this.scene.add(this.helpers.overlay);
    this.applyBackground();
    // CameraWrapper
    this.persp = new THREE.PerspectiveCamera((this.fov * 180) / Math.PI, 1, 0.1, 1000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.persp.position.set(10, 10, 10);
    this.ortho.position.set(10, 10, 10);
    if (opts.controls ?? true) this.bindFlyKeys();
    this.makeControls(opts.controls ?? true);
    this.controls.autoRotate = opts.autoRotate ?? false;
    this.resize();
    this.makeComposer();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // --------------------------------------------------------------- camera ---

  get camera(): any { return this._projection === 'orthographic' ? this.ortho : this.persp; }
  get projection(): ProjectionMode { return this._projection; }
  set projection(p: ProjectionMode) {
    if (p === this._projection) return;
    const target = this.target, yaw = this.yaw, pitch = this.pitch, distance = this.distance;
    this._projection = p;
    if (p === 'orthographic') this.orthoHalf = distance * Math.tan(this.fov / 2);
    this.makeControls(this.controls?.enabled ?? true);
    this.setOrbit(target, yaw, pitch, distance);
    this.makeComposer();
    this.requestRender();
  }
  get isOrthographic(): boolean { return this._projection === 'orthographic' && !this.fly.enabled; }
  get orthoZoom(): number { return this.ortho.zoom; }
  set orthoZoom(z: number) { this.ortho.zoom = Math.max(0.05, z); this.ortho.updateProjectionMatrix(); this.requestRender(); }

  /** CameraManager: OrbitControls with the perspective or the isometric preset. */
  private makeControls(enabled: boolean): void {
    const autoRotate = this.controls?.autoRotate ?? false;
    this.controls?.dispose();
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, this._projection === 'orthographic' ? ISOMETRIC_CONTROLS : PERSPECTIVE_CONTROLS);
    this.controls.enabled = enabled && !this.fly.enabled;
    this.controls.autoRotate = autoRotate;
    this.controls.autoRotateSpeed = this.autoRotateSpeed / 6; // OrbitControls: 2π/60 · speed rad/s; ours: degrees per second
    this.controls.addEventListener('change', () => { this.dirty = true; this.onCameraChange?.(); });
  }

  /** Polar angle limits of the orbit controls (radians from straight up); a projection change applies its preset again. */
  get polarLimits(): [number, number] { return [this.controls?.minPolarAngle ?? 0, this.controls?.maxPolarAngle ?? Math.PI]; }
  setPolarLimits(min: number, max: number): void {
    if (!this.controls) return;
    this.controls.minPolarAngle = min;
    this.controls.maxPolarAngle = max;
  }

  get target(): V3 { const t = this.controls.target; return [t.x, t.y, t.z]; }
  set target(t: V3) { this.setOrbit(t, this.yaw, this.pitch, this.distance); }
  private get offset(): any { return this.camera.position.clone().sub(this.controls.target); }
  get distance(): number { return this._projection === 'orthographic' ? this.offset.length() : this.offset.length(); }
  set distance(d: number) { this.setOrbit(this.target, this.yaw, this.pitch, d); }
  get yaw(): number { const o = this.offset; return Math.atan2(o.x, o.z); }
  set yaw(y: number) { this.setOrbit(this.target, y, this.pitch, this.distance); }
  get pitch(): number { const o = this.offset; return Math.asin(Math.max(-1, Math.min(1, o.y / (o.length() || 1)))); }
  set pitch(p: number) { this.setOrbit(this.target, this.yaw, p, this.distance); }
  get autoRotate(): boolean { return !!this.controls?.autoRotate; }
  set autoRotate(v: boolean) { if (this.controls) this.controls.autoRotate = v; this.requestRender(); }

  /** The orbit camera at `distance` from `target`, on the side given by yaw / pitch (the WebGL2 viewer's convention). */
  private setOrbit(target: V3, yaw: number, pitch: number, distance: number): void {
    const p = Math.max(-ORBIT_PITCH_MAX, Math.min(ORBIT_PITCH_MAX, pitch)), d = Math.max(0.01, distance);
    const cp = Math.cos(p);
    this.controls.target.set(target[0], target[1], target[2]);
    for (const cam of [this.persp, this.ortho]) {
      cam.position.set(target[0] + d * cp * Math.sin(yaw), target[1] + d * Math.sin(p), target[2] + d * cp * Math.cos(yaw));
      cam.lookAt(target[0], target[1], target[2]);
    }
    this.controls.update();
    this.requestRender();
  }

  /** Host framing (CameraControls.setFrame): field of view in radians (perspective) or half the visible height (orthographic). */
  setFrame(yaw: number, pitch: number, distance?: number, fov?: number, halfHeight?: number): void {
    if (fov !== undefined && Number.isFinite(fov) && fov > 0) this.fov = fov;
    if (halfHeight !== undefined && Number.isFinite(halfHeight) && halfHeight > 0) { this.orthoHalf = halfHeight; this.ortho.zoom = 1; this.resize(); }
    const d = distance !== undefined && Number.isFinite(distance) && distance > 0 ? distance : this.distance;
    if (this.controls) this.controls.minDistance = Math.min(this.controls.minDistance, d);
    this.setOrbit(this.target, yaw, pitch, d);
  }
  /** Half the visible height of the orthographic camera at its current zoom. */
  get orthoHalfHeight(): number { return this.orthoHalf / (this.ortho.zoom || 1); }
  /** First person driven by the host: the eye at `eye` looking along `dir`; the orbit target stays one block ahead of the eye. */
  setEye(eye: V3, dir: V3): void {
    const t: V3 = [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]];
    this.controls.target.set(t[0], t[1], t[2]);
    for (const cam of [this.persp, this.ortho]) { cam.position.set(eye[0], eye[1], eye[2]); cam.lookAt(t[0], t[1], t[2]); }
    this.requestRender();
  }
  /** Mouse and touch input of the orbit controls (off while the host drives a first-person camera). */
  setInputEnabled(on: boolean): void { if (this.controls) this.controls.enabled = on && !this.fly.enabled; }

  cameraBasis(): CameraBasis {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const e = cam.position, f = new THREE.Vector3(), r = new THREE.Vector3(1, 0, 0), u = new THREE.Vector3(0, 1, 0);
    cam.getWorldDirection(f); r.applyQuaternion(cam.quaternion); u.applyQuaternion(cam.quaternion);
    return { eye: [e.x, e.y, e.z], fwd: [f.x, f.y, f.z], right: [r.x, r.y, r.z], up: [u.x, u.y, u.z] };
  }

  rayFromNdc(nx: number, ny: number): { origin: V3; dir: V3 } {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const o = rc.ray.origin, d = rc.ray.direction;
    return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
  }

  /** Re-frame the whole scene. */
  fitCamera(): void {
    if (this.fly.enabled) this.disableFly();
    const d = (this.radius / Math.sin(this.fov / 2)) * 1.05;
    this.orthoHalf = d * Math.tan(this.fov / 2);
    this.ortho.zoom = 1; this.ortho.updateProjectionMatrix();
    this.setOrbit([this.extent[0] / 2, this.extent[1] / 2, this.extent[2] / 2], this.yaw, this.pitch, d);
  }

  snapToDirection(direction: V3): void {
    const l = Math.hypot(...direction) || 1;
    const [dx, dy, dz] = direction.map((v) => v / l);
    if (this.fly.enabled) this.disableFly();
    this.setOrbit(this.target, Math.abs(dy) < 0.9999 ? Math.atan2(dx, dz) : this.yaw, Math.asin(dy), this.distance);
  }

  // ------------------------------------------------------------ fly mode ---

  enableFly(): void {
    if (this.fly.enabled) return;
    const b = this.cameraBasis();
    this.fly.pos = [...b.eye];
    this.fly.yaw = Math.atan2(b.fwd[0], b.fwd[2]);
    this.fly.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.asin(b.fwd[1])));
    this.fly.enabled = true;
    if (this.controls) this.controls.enabled = false;
    if (this._projection === 'orthographic') this.makeComposer();
    this.applyFly();
  }

  disableFly(): void {
    if (!this.fly.enabled) return;
    this.unlockPointer();
    const b = this.cameraBasis(), d = this.distance || 10;
    this.fly.enabled = false;
    this.keys.clear();
    if (this.controls) this.controls.enabled = true;
    this.setOrbit([b.eye[0] + b.fwd[0] * d, b.eye[1] + b.fwd[1] * d, b.eye[2] + b.fwd[2] * d], Math.atan2(-b.fwd[0], -b.fwd[2]), Math.asin(-b.fwd[1]), d);
    if (this._projection === 'orthographic') this.makeComposer();
  }

  private applyFly(): void {
    const f = this.fly, cp = Math.cos(f.pitch);
    this.persp.position.set(f.pos[0], f.pos[1], f.pos[2]);
    this.persp.lookAt(f.pos[0] + Math.sin(f.yaw) * cp, f.pos[1] + Math.sin(f.pitch), f.pos[2] + Math.cos(f.yaw) * cp);
    this.requestRender();
  }

  lockPointer(): void { this.canvas.requestPointerLock?.(); }
  unlockPointer(): void { if (typeof document !== 'undefined' && document.pointerLockElement === this.canvas) document.exitPointerLock?.(); }
  get pointerLocked(): boolean { return typeof document !== 'undefined' && document.pointerLockElement === this.canvas; }

  private bindFlyKeys(): void {
    const c = this.canvas;
    const look = (dx: number, dy: number) => {
      const k = 0.0025 * this.fly.lookSensitivity;
      this.fly.yaw -= dx * k;
      this.fly.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, this.fly.pitch - dy * k));
      this.applyFly();
    };
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { if (this.fly.enabled) drag = { x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      if (!this.fly.enabled) return;
      if (this.pointerLocked) { look(e.movementX, e.movementY); return; }
      if (drag) { look(e.clientX - drag.x, e.clientY - drag.y); drag = { x: e.clientX, y: e.clientY }; }
    };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => {
      if (!this.fly.enabled) return;
      e.preventDefault();
      this.fly.moveSpeed = Math.max(0.1, Math.min(43.556, this.fly.moveSpeed * Math.exp(-e.deltaY * 0.001)));
      this.onFlySpeedChange?.();
    };
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || !!t?.isContentEditable; };
    const kd = (e: KeyboardEvent) => { if (this.fly.enabled && !typing(e)) { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); } };
    const ku = (e: KeyboardEvent) => { this.keys.delete(e.code); };
    const blur = () => this.keys.clear();
    const plc = () => { this.dirty = true; this.onPointerLockChange?.(this.pointerLocked); };
    const ctx = (e: Event) => e.preventDefault();
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up);
    c.addEventListener('wheel', wheel, { passive: false }); c.addEventListener('contextmenu', ctx);
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', blur);
    document.addEventListener('pointerlockchange', plc);
    this.cleanup.push(() => {
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up);
      c.removeEventListener('wheel', wheel); c.removeEventListener('contextmenu', ctx);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
      document.removeEventListener('pointerlockchange', plc);
    });
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
    this.applyFly();
  }

  // ------------------------------------------------------- post-processing ---

  /**
   * Lightweight shading (for capable devices): a warm sun with soft shadows fitted to the structure and a sky / ground
   * hemisphere light in place of most of the flat ambient light. Same numbers as the Java package's src/shading.ts.
   * Off restores the original lights. Refits itself when the structure changes.
   */
  setShading(on: boolean, quality: 'normal' | 'high' = 'normal'): void {
    const gl = this.renderer, was = gl.shadowMap.enabled, sun = this.sunLight;
    this.shading = on; this.shadingQuality = quality;
    if (on) {
      if (!this.hemiLight) { this.hemiLight = new THREE.HemisphereLight(0xcfe3ff, 0x8a7350, 1.1); this.scene.add(this.hemiLight); }
      const c = new THREE.Vector3(this.extent[0] / 2, this.extent[1] / 2, this.extent[2] / 2);
      const r = Math.max(8, this.radius);
      const az = (-35 * Math.PI) / 180, el = (52 * Math.PI) / 180;
      sun.position.set(c.x + Math.cos(el) * Math.sin(az) * r * 2, c.y + Math.sin(el) * r * 2, c.z + Math.cos(el) * Math.cos(az) * r * 2);
      sun.target.position.copy(c);
      if (!sun.target.parent) this.scene.add(sun.target);
      sun.color.setHex(0xfff0d8); sun.intensity = 2.6; this.ambientLight.intensity = 0.9;
      sun.castShadow = true;
      Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: r * 4 });
      sun.shadow.camera.updateProjectionMatrix();
      const size = quality === 'high' ? 4096 : 2048;
      if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
      sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.06; sun.shadow.radius = 2;
      gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.PCFShadowMap; gl.shadowMap.needsUpdate = true;
      // every mesh casts and receives shadows — glass, leaves and plants too (only part of the scene did before); both faces go
      // into the shadow map, or a one-sided surface with no back face towards the sun (slab, carpet, plant quad) lets the light through
      this.scene.traverse((o: any) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) m.shadowSide = THREE.DoubleSide;
      });
    } else {
      if (this.hemiLight) { this.hemiLight.removeFromParent(); this.hemiLight = null; }
      sun.color.setHex(0xffffff); sun.intensity = 1; sun.position.set(20, 20, -20); sun.castShadow = false;
      this.ambientLight.intensity = 2.2;
      gl.shadowMap.enabled = false;
    }
    if (was !== gl.shadowMap.enabled) this.scene.traverse((o: any) => { if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true; });
    this.requestRender();
  }

  get ssaoEnabled(): boolean { return this._ssao; }
  set ssaoEnabled(on: boolean) { this._ssao = on; if (this.n8ao) this.n8ao.enabled = on; this.requestRender(); }

  /** RenderManager.initComposer + initDefaultPasses + setSSAOEnabled, for the current camera. */
  private makeComposer(): void {
    this.composer?.dispose?.();
    const cam = this.fly.enabled ? this.persp : this.camera;
    const composer = new EffectComposer(this.renderer, { multisampling: this.multisampling });
    composer.addPass(new RenderPass(this.scene, cam));
    const w = Math.max(1, this.renderer.domElement.width), h = Math.max(1, this.renderer.domElement.height);
    try {
      const ao = new N8AOPostPass(this.scene, cam, w, h);
      const p = this.isOrthographic ? this.ssaoPresets.isometric : this.ssaoPresets.perspective;
      ao.configuration.aoRadius = p.aoRadius;
      ao.configuration.distanceFalloff = p.distanceFalloff;
      ao.configuration.intensity = p.intensity;
      ao.configuration.gammaCorrection = false;
      ao.setQualityMode('Medium');
      ao.enabled = this._ssao;
      composer.addPass(ao, 1);
      this.n8ao = ao;
    } catch (e) { console.warn('mcstructure-renderer: N8AO SSAO failed to initialise', e); this.n8ao = null; }
    const effects = this.smaa ? new EffectPass(cam, new GammaCorrectionEffect(0.5), new SMAAEffect()) : new EffectPass(cam, new GammaCorrectionEffect(0.5));
    effects.renderToScreen = true;
    composer.addPass(effects);
    this.composer = composer;
  }

  /** Apply edited SSAO presets to the running pass. */
  applySSAOPreset(): void {
    if (!this.n8ao) return;
    const p = this.isOrthographic ? this.ssaoPresets.isometric : this.ssaoPresets.perspective;
    Object.assign(this.n8ao.configuration, { aoRadius: p.aoRadius, distanceFalloff: p.distanceFalloff, intensity: p.intensity });
    this.requestRender();
  }

  // ------------------------------------------------------------- content ---

  setMesh(mesh: StructureMesh): ThreeViewerObject {
    for (const o of [...this.objects]) o.dispose();
    const obj = this.addMesh(mesh);
    this.fitCamera();
    return obj;
  }

  addMesh(mesh: StructureMesh): ThreeViewerObject {
    const obj = this.beginMesh(mesh.size, mesh.atlas);
    this.appendBlocks(obj, mesh.solid, mesh.translucent);
    this.appendEntities(obj, mesh.entityBatches);
    return obj;
  }

  beginMesh(size: [number, number, number], atlas: Atlas): ThreeViewerObject {
    const obj = new ThreeViewerObject(this, size);
    // cubane/AssetLoader: nearest filtering, the texture's colour space left unset
    obj.atlas = dataTexture(atlas.width, atlas.height, atlas.data, THREE.NoColorSpace);
    obj.owned.push(obj.atlas);
    this.objects.push(obj);
    this.scene.add(obj.group);
    this.updateExtent();
    this.requestRender();
    return obj;
  }

  appendBlocks(obj: ThreeViewerObject, solid: MeshLayerData, translucent: MeshLayerData): void {
    if (!this.objects.includes(obj) || !obj.atlas) return;
    for (const [l, trans] of [[solid, false], [translucent, true]] as const) {
      const g = layerGeometry(l);
      if (!g) continue;
      // cubane/AssetLoader: MeshStandardMaterial, FrontSide; translucent faces like its liquids (transparent, no depth write)
      const mat = new THREE.MeshStandardMaterial({
        map: obj.atlas, vertexColors: true, side: g.oriented ? THREE.FrontSide : THREE.DoubleSide,
        ...(trans ? { transparent: true, depthWrite: false, alphaTest: 0.01 } : { alphaTest: 0.5 }),
      });
      const mesh = new THREE.Mesh(g.geo, mat);
      if (trans) mesh.renderOrder = 1;
      obj.blocks.add(mesh);
      obj.owned.push(g.geo, mat);
    }
    this.requestRender();
  }

  appendEntities(obj: ThreeViewerObject, batches: TextureBatch[]): void {
    if (!this.objects.includes(obj)) return;
    for (const b of batches) {
      // cubane/EntityRenderer: entity textures in LinearSRGBColorSpace, MeshStandardMaterial
      const tex = dataTexture(b.image.width, b.image.height, b.image.data, THREE.LinearSRGBColorSpace);
      obj.owned.push(tex);
      for (const [l, trans] of [[b.solid, false], [b.translucent, true]] as const) {
        const g = layerGeometry(l);
        if (!g) continue;
        const mat = new THREE.MeshStandardMaterial({
          map: tex, vertexColors: true, side: THREE.DoubleSide,
          ...(trans ? { transparent: true, depthWrite: false, alphaTest: 0.01 } : { alphaTest: 0.5 }),
        });
        if (b.emissive) { mat.emissiveMap = tex; mat.emissive = new THREE.Color(0xffffff); mat.color = new THREE.Color(0); }
        const mesh = new THREE.Mesh(g.geo, mat);
        if (trans) mesh.renderOrder = 1;
        if (l.billboards) {
          // camera-facing sprites: the vertices sit at the sprite's centre; spread them along the camera's right / up each frame
          const attr = g.geo.getAttribute('position');
          obj.billboards.push({ attr, centers: Float32Array.from(attr.array), offsets: l.billboards });
          mesh.frustumCulled = false;
        }
        obj.entities.add(mesh);
        obj.owned.push(g.geo, mat);
      }
    }
    this.requestRender();
  }

  removeObject(obj: ThreeViewerObject): void {
    const i = this.objects.indexOf(obj);
    if (i < 0) return;
    this.objects.splice(i, 1);
    this.scene.remove(obj.group);
    for (const r of obj.owned) r.dispose();
    obj.owned = [];
    this.updateExtent();
    this.requestRender();
  }

  get meshCount(): number { return this.objects.length; }
  get sceneSize(): [number, number, number] { return [...this.extent]; }

  private updateExtent(): void {
    const e: V3 = [0, 0, 0];
    for (const o of this.objects) for (let i = 0; i < 3; i++) e[i] = Math.max(e[i], o.size[i]);
    this.extent = [Math.max(1, e[0]), Math.max(1, e[1]), Math.max(1, e[2])];
    this.radius = Math.hypot(...this.extent) / 2;
    // the structure changed: refit the sun's shadow box (and cast / receive on the new meshes)
    if (this.shading) queueMicrotask(() => { if (this.shading) this.setShading(true, this.shadingQuality); });
  }

  // ------------------------------------------------------------- helpers ---

  get showGrid(): boolean { return this._showGrid; }
  set showGrid(v: boolean) { this._showGrid = v; this.requestRender(); }
  get showAxes(): boolean { return this._showAxes; }
  set showAxes(v: boolean) { this._showAxes = v; this.requestRender(); }

  private updateHelpers(): void {
    const key = this.extent.join(',');
    if (this._showGrid && this.gridFor !== key) {
      if (this.helpers.grid) { this.scene.remove(this.helpers.grid); this.helpers.grid.traverse((o: any) => { o.geometry?.dispose(); o.material?.dispose(); }); }
      const pad = 8, x0 = -pad, z0 = -pad, x1 = Math.ceil(this.extent[0]) + pad, z1 = Math.ceil(this.extent[2]) + pad;
      const minor: number[] = [], major: number[] = [];
      for (let x = x0; x <= x1; x++) (x % 16 === 0 ? major : minor).push(x, 0, z0, x, 0, z1);
      for (let z = z0; z <= z1; z++) (z % 16 === 0 ? major : minor).push(x0, 0, z, x1, 0, z);
      const grp = new THREE.Group();
      for (const [data, opacity] of [[minor, 0.16], [major, 0.42]] as const) {
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
        grp.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false })));
      }
      this.helpers.grid = grp; this.gridFor = key; this.scene.add(grp);
    }
    if (this.helpers.grid) this.helpers.grid.visible = this._showGrid;
    if (this._showAxes && !this.helpers.axes) { this.helpers.axes = new THREE.AxesHelper(Math.ceil(Math.max(...this.extent)) + 2); this.scene.add(this.helpers.axes); }
    if (this.helpers.axes) this.helpers.axes.visible = this._showAxes;
    // overlays (selection boxes …) are rebuilt every frame: they are few and change with the selection
    const ov = this.helpers.overlay;
    for (const c of [...ov.children]) { ov.remove(c); c.geometry.dispose(); c.material.dispose(); }
    for (const o of this.overlays?.() ?? []) {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(o.positions, 3));
      if (o.index && o.index.length) geo.setIndex(Array.from(o.index as ArrayLike<number>));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(o.color[0], o.color[1], o.color[2]), transparent: o.opacity < 1, opacity: o.opacity, depthTest: o.depthTest }));
      line.matrixAutoUpdate = false; line.matrix.fromArray(Array.from(o.matrix as ArrayLike<number>)); line.renderOrder = 2;
      ov.add(line);
    }
  }

  // ------------------------------------------------------------ rendering ---

  requestRender(): void { this.dirty = true; this.onCameraChange?.(); }
  invalidate(): void { this.dirty = true; this.onCameraChange?.(); }
  get suspendedState(): boolean { return this.suspended; }
  setBackground(c: ViewerOptions['background']): void { this.bg = parseColor(c); this.applyBackground(); this.dirty = true; }
  get backgroundColor(): [number, number, number, number] { return [...this.bg]; }
  setBackgroundAlpha(a: number): void { this.bg = [this.bg[0], this.bg[1], this.bg[2], a]; this.applyBackground(); this.dirty = true; }
  /** SceneManager.setBackgroundColor: an opaque colour is the scene background; a transparent canvas clears to alpha. */
  private applyBackground(): void {
    const c = new THREE.Color().setRGB(this.bg[0], this.bg[1], this.bg[2], THREE.SRGBColorSpace);
    if (this.bg[3] >= 1) { this.scene.background = c; this.renderer.setClearColor(c, 1); }
    else { this.scene.background = null; this.renderer.setClearColor(c, this.bg[3]); }
  }
  setMaxPixelRatio(n: number): void { this.maxDpr = Math.max(0.25, n); this.resize(true); this.dirty = true; }
  get maxPixelRatio(): number { return this.maxDpr; }
  setTargetFPS(n: number): void { this.targetFps = Math.max(0, n); }
  suspend(): void { this.suspended = true; cancelAnimationFrame(this.raf); this.raf = 0; }
  resume(): void { if (!this.suspended) return; this.suspended = false; this.lastT = 0; this.dirty = true; this.raf = requestAnimationFrame(this.loop); }
  /** Fixed drawing-buffer size while recording (null = follow the canvas again). */
  setCaptureSize(size: { width: number; height: number } | null): void {
    this.sizeOverride = size ? { w: Math.max(1, Math.round(size.width)), h: Math.max(1, Math.round(size.height)) } : null;
    this.resize(true); this.dirty = true;
  }

  private resize(force = false): void {
    let w: number, h: number, dpr: number;
    if (this.sizeOverride) { w = this.sizeOverride.w; h = this.sizeOverride.h; dpr = 1; }
    else { dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr); w = Math.max(1, this.canvas.clientWidth); h = Math.max(1, this.canvas.clientHeight); }
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    if (!force && this.canvas.width === cw && this.canvas.height === ch) return;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h, false);
    const aspect = w / h;
    this.persp.aspect = aspect; this.persp.updateProjectionMatrix();
    const hh = this.orthoHalf;
    this.ortho.left = -hh * aspect; this.ortho.right = hh * aspect; this.ortho.top = hh; this.ortho.bottom = -hh; this.ortho.updateProjectionMatrix();
  }

  /** Draw one frame now (the Java RenderManager's `composer.render()`). */
  render(): void {
    this.resize();
    this.updateHelpers();
    const cam = this.fly.enabled ? this.persp : this.camera;
    if (this.objects.some((o) => o.billboards.length)) {
      const b = this.cameraBasis();
      for (const o of this.objects) for (const bb of o.billboards) {
        const a = bb.attr.array as Float32Array;
        for (let v = 0; v < bb.offsets.length / 2; v++) {
          const ox = bb.offsets[v * 2], oy = bb.offsets[v * 2 + 1];
          for (let k = 0; k < 3; k++) a[v * 3 + k] = bb.centers[v * 3 + k] + b.right[k] * ox + b.up[k] * oy;
        }
        bb.attr.needsUpdate = true;
      }
    }
    this.renderer.info.reset();
    this.renderer.info.autoReset = false;
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, cam);
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.visibleObjects = this.objects.filter((o) => o.visible).length;
  }

  private loop(t: number): void {
    if (this.suspended) return;
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    if (this.fly.enabled && this.keys.size) { this.stepFly(dt); this.onCameraChange?.(); }
    if (!this.fly.enabled && this.controls?.update(dt)) { this.dirty = true; this.onCameraChange?.(); }
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

  screenshot(type = 'image/png', quality?: number, opts: { width?: number; height?: number; transparent?: boolean } = {}): Promise<Blob> {
    const bg = this.bg;
    if (opts.width || opts.height) {
      const aspect = this.canvas.clientWidth && this.canvas.clientHeight ? this.canvas.clientWidth / this.canvas.clientHeight : this.canvas.width / this.canvas.height;
      const w = Math.max(1, Math.round(opts.width ?? (opts.height as number) * aspect)), h = Math.max(1, Math.round(opts.height ?? (opts.width as number) / aspect));
      this.sizeOverride = { w, h }; this.resize(true);
    }
    if (opts.transparent) { this.bg = [bg[0], bg[1], bg[2], 0]; this.applyBackground(); }
    try {
      this.render();
      return new Promise<Blob>((res, rej) => this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), opts.transparent && type === 'image/jpeg' ? 'image/png' : type, quality));
    } finally {
      this.bg = bg; this.applyBackground();
      if (opts.width || opts.height) { this.sizeOverride = null; this.resize(true); }
      this.render();
    }
  }

  dispose(): void {
    this.suspended = true;
    cancelAnimationFrame(this.raf);
    this.unlockPointer();
    this.cleanup.forEach((f) => f());
    for (const o of [...this.objects]) o.dispose();
    this.controls?.dispose();
    this.composer?.dispose?.();
    this.renderer.dispose();
  }
}

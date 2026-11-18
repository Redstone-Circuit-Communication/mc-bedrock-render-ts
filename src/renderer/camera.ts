import { EventEmitter } from './events';
import { RecordingManager } from './recorder';
import type { StructureViewer } from './viewer';

/** Minimal three.js-style vector so host code written against the Java renderer (`camera.position.x`, `.clone()` …) keeps working. */
export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: { x: number; y: number; z: number }): this { return this.set(v.x, v.y, v.z); }
  clone(): Vec3 { return new Vec3(this.x, this.y, this.z); }
  add(v: Vec3): this { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v: Vec3): this { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
  addScaledVector(v: Vec3, s: number): this { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
  multiplyScalar(s: number): this { return this.set(this.x * s, this.y * s, this.z * s); }
  negate(): this { return this.set(-this.x, -this.y, -this.z); }
  length(): number { return Math.hypot(this.x, this.y, this.z); }
  normalize(): this { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v: Vec3): number { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  toArray(): [number, number, number] { return [this.x, this.y, this.z]; }
  fromArray(a: ArrayLike<number>): this { return this.set(a[0], a[1], a[2]); }
}

/** three.js-style quaternion (`_x … _w` and `x … w`), so code that compares / copies camera quaternions keeps working. */
export class Quat {
  _x = 0; _y = 0; _z = 0; _w = 1;
  constructor(x = 0, y = 0, z = 0, w = 1) { this._x = x; this._y = y; this._z = z; this._w = w; }
  get x() { return this._x; } set x(v: number) { this._x = v; }
  get y() { return this._y; } set y(v: number) { this._y = v; }
  get z() { return this._z; } set z(v: number) { this._z = v; }
  get w() { return this._w; } set w(v: number) { this._w = v; }
  set(x: number, y: number, z: number, w: number): this { this._x = x; this._y = y; this._z = z; this._w = w; return this; }
  copy(q: { x: number; y: number; z: number; w: number }): this { return this.set(q.x, q.y, q.z, q.w); }
  clone(): Quat { return new Quat(this._x, this._y, this._z, this._w); }
  equals(q: { _x: number; _y: number; _z: number; _w: number }): boolean { return q._x === this._x && q._y === this._y && q._z === this._z && q._w === this._w; }
}

/** Axis-aligned box with the parts of three's Box3 that host code reads (`min`, `max`, `getCenter`, `getSize`, `containsPoint`). */
export class Box3 {
  constructor(public min = new Vec3(Infinity, Infinity, Infinity), public max = new Vec3(-Infinity, -Infinity, -Infinity)) {}
  getCenter(out = new Vec3()): Vec3 { return out.set((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2, (this.min.z + this.max.z) / 2); }
  getSize(out = new Vec3()): Vec3 { return out.set(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z); }
  containsPoint(p: { x: number; y: number; z: number }): boolean { return p.x >= this.min.x && p.x <= this.max.x && p.y >= this.min.y && p.y <= this.max.y && p.z >= this.min.z && p.z <= this.max.z; }
  clone(): Box3 { return new Box3(this.min.clone(), this.max.clone()); }
  isEmpty(): boolean { return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z; }
  /** Grow to include `b` (an empty box adds nothing). */
  union(b: Box3): this {
    if (b.isEmpty()) return this;
    this.min.set(Math.min(this.min.x, b.min.x), Math.min(this.min.y, b.min.y), Math.min(this.min.z, b.min.z));
    this.max.set(Math.max(this.max.x, b.max.x), Math.max(this.max.y, b.max.y), Math.max(this.max.z, b.max.z));
    return this;
  }
}

export type CameraPreset = 'perspective' | 'isometric' | 'perspective_fpv';

/** Read-only view of the viewer's active camera (mirrors the parts of a three.js camera the host code touches). */
export class CameraView {
  constructor(private v: StructureViewer) {}
  get position(): Vec3 { return new Vec3(...this.v.cameraBasis().eye); }
  get isOrthographicCamera(): boolean { return this.v.isOrthographic; }
  get isPerspectiveCamera(): boolean { return !this.v.isOrthographic; }
  get fov(): number { return (this.v.fov * 180) / Math.PI; }
  /** Camera orientation (looks down −z with +y up, like a three.js camera). */
  get quaternion(): Quat {
    const b = this.v.cameraBasis();
    const [r, u] = [b.right, b.up], k = [-b.fwd[0], -b.fwd[1], -b.fwd[2]];
    const m11 = r[0], m12 = u[0], m13 = k[0], m21 = r[1], m22 = u[1], m23 = k[1], m31 = r[2], m32 = u[2], m33 = k[2];
    const tr = m11 + m22 + m33;
    if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); return new Quat((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s); }
    if (m11 > m22 && m11 > m33) { const s = 2 * Math.sqrt(1 + m11 - m22 - m33); return new Quat(0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s); }
    if (m22 > m33) { const s = 2 * Math.sqrt(1 + m22 - m11 - m33); return new Quat((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s); }
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22); return new Quat((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s);
  }
  get zoom(): number { return this.v.orthoZoom; }
  set zoom(z: number) { this.v.orthoZoom = Math.max(0.05, z); this.v.invalidate(); }
  get aspect(): number { return (this.v.canvas.clientWidth || 1) / (this.v.canvas.clientHeight || 1); }
  /** Half-height of the orthographic frustum in blocks at the target. */
  get top(): number { return (this.v.distance * Math.tan(this.v.fov / 2)); }
  get bottom(): number { return -this.top; }
  getWorldDirection(out = new Vec3()): Vec3 { return out.fromArray(this.v.cameraBasis().fwd); }
  updateProjectionMatrix(): void { this.v.invalidate(); }
}

/** Orbit-controls facade: `target`, polar limits and `update()` like three's OrbitControls. */
export class OrbitFacade {
  minPolarAngle = 0;
  maxPolarAngle = Math.PI;
  constructor(private v: StructureViewer) {}
  get target(): Vec3 {
    const self = this, t = this.v.target;
    // writes to the returned vector (copy / set …) are applied on the next update()
    const vec = new Vec3(t[0], t[1], t[2]);
    return new Proxy(vec, { set(o, k, val) { (o as any)[k] = val; if (k === 'x' || k === 'y' || k === 'z') { self.v.target = [o.x, o.y, o.z]; self.v.invalidate(); } return true; } });
  }
  update(): void { this.v.invalidate(); }
}

export interface FlyOptions {
  showOverlay?: boolean; moveSpeed?: number; sprintMultiplier?: number; lookSensitivity?: number;
  keybinds?: Partial<StructureViewer['fly']['keybinds']>;
}

/** The Java renderer's `flyControls`: lock / unlock the pointer, read and set the speed, `speedChange` events. */
export class FlyControlsFacade extends EventEmitter {
  constructor(private viewer: StructureViewer) { super(); }
  lock(): void { this.viewer.lockPointer(); }
  unlock(): void { this.viewer.unlockPointer(); }
  get isLocked(): boolean { return this.viewer.pointerLocked; }
  getMoveSpeed(): number { return this.viewer.fly.moveSpeed; }
  setMoveSpeed(v: number): void { this.viewer.fly.moveSpeed = Math.max(0.1, Math.min(43.556, v)); this.emit('speedChange', this.viewer.fly.moveSpeed); }
}

/**
 * Same surface as the Java renderer's CameraManager as far as the product layer and the example use it: an event
 * emitter (`cameraChanged`, `cameraMove`, `propertyChanged`, `flyControlsLocked`, `flyControlsUnlocked`) that drives the
 * viewer's orbit / orthographic / first-person cameras.
 */
export class CameraManager extends EventEmitter {
  cameraOptions: { preserveCameraOnUpdate?: boolean; position?: [number, number, number]; defaultCameraPreset?: CameraPreset; fov?: number } = {};
  activeCameraPreset: CameraPreset = 'perspective';
  readonly activeCamera: { camera: CameraView };
  readonly flyControls: FlyControlsFacade;
  /** Screenshots and recordings (the Java renderer keeps its recording manager here too). */
  readonly recordingManager: RecordingManager;
  private orbit: OrbitFacade;

  constructor(private viewer: StructureViewer) {
    super();
    this.activeCamera = { camera: new CameraView(viewer) };
    this.orbit = new OrbitFacade(viewer);
    this.flyControls = new FlyControlsFacade(viewer);
    this.recordingManager = new RecordingManager(viewer);
    if (viewer.isOrthographic) this.activeCameraPreset = 'isometric';
    viewer.onCameraChange = () => { this.emit('cameraChanged'); this.emit('cameraMove'); };
    viewer.onFlySpeedChange = () => this.flyControls.emit('speedChange', viewer.fly.moveSpeed);
    viewer.onPointerLockChange = (locked) => this.emit(locked ? 'flyControlsLocked' : 'flyControlsUnlocked');
  }

  get activeControls(): OrbitFacade | undefined { return this.viewer.fly.enabled ? undefined : this.orbit; }

  initializeFlyControls(o: FlyOptions = {}): void { this.setFlyControlsSettings(o); }
  setFlyControlsSettings(o: FlyOptions): void {
    const f = this.viewer.fly;
    if (o.moveSpeed !== undefined) f.moveSpeed = o.moveSpeed;
    if (o.sprintMultiplier !== undefined) f.sprintMultiplier = o.sprintMultiplier;
    if (o.lookSensitivity !== undefined) f.lookSensitivity = o.lookSensitivity;
    if (o.keybinds) Object.assign(f.keybinds, o.keybinds);
  }
  enableFlyControls(): void { this.viewer.enableFly(); this.activeCameraPreset = 'perspective_fpv'; this.emit('propertyChanged'); }
  disableFlyControls(): void { this.viewer.disableFly(); if (this.activeCameraPreset === 'perspective_fpv') this.activeCameraPreset = this.viewer.isOrthographic ? 'isometric' : 'perspective'; this.emit('propertyChanged'); }
  toggleFlyControls(): boolean { this.isFlyControlsEnabled() ? this.disableFlyControls() : this.enableFlyControls(); return this.isFlyControlsEnabled(); }
  getFlyControlsSettings(): { moveSpeed: number; sprintMultiplier: number; lookSensitivity: number; keybinds: StructureViewer['fly']['keybinds'] } {
    const f = this.viewer.fly;
    return { moveSpeed: f.moveSpeed, sprintMultiplier: f.sprintMultiplier, lookSensitivity: f.lookSensitivity, keybinds: { ...f.keybinds } };
  }
  isFlyControlsEnabled(): boolean { return this.viewer.fly.enabled; }
  isFlyControlsLocked(): boolean { return this.viewer.fly.enabled && this.viewer.pointerLocked; }

  /** The camera presets, like the Java CameraManager's static table (here only the names; the viewer derives the pose). */
  static readonly CAMERA_PRESETS: Record<CameraPreset, { type: 'perspective' | 'orthographic' }> = {
    perspective: { type: 'perspective' }, isometric: { type: 'orthographic' }, perspective_fpv: { type: 'perspective' },
  };

  stopAutoOrbit(): void { this.viewer.autoRotate = false; this.emit('propertyChanged'); }
  startAutoOrbit(): void { this.viewer.autoRotate = true; this.viewer.invalidate(); this.emit('propertyChanged'); }
  isAutoOrbitEnabled(): boolean { return this.viewer.autoRotate; }
  /** Flip the orbit; returns the new state. */
  toggleAutoOrbit(): boolean { this.isAutoOrbitEnabled() ? this.stopAutoOrbit() : this.startAutoOrbit(); return this.isAutoOrbitEnabled(); }
  /** Seconds for one turn (at least 1). */
  setAutoOrbitDuration(duration: number): void { this.viewer.autoRotateSpeed = 360 / Math.max(1, duration); }
  getAutoOrbitDuration(): number { return 360 / this.viewer.autoRotateSpeed; }
  /** The Bedrock viewer has no camera animations (the camera moves instantly), so this is always false. */
  isCurrentlyAnimating(): boolean { return false; }
  /** Look at a point (block coordinates) from where the camera is. */
  lookAt(target: { x: number; y: number; z: number } | [number, number, number]): void {
    const t = Array.isArray(target) ? target : [target.x, target.y, target.z];
    this.viewer.target = [t[0], t[1], t[2]];
    this.viewer.invalidate();
  }
  lookAtSchematicsCenter(): void { const e = this.viewer.sceneSize; this.lookAt([e[0] / 2, e[1] / 2, e[2] / 2]); }
  /** Re-evaluate the projection after the canvas size changed. */
  updateAspectRatio(_aspect?: number): void { this.viewer.invalidate(); }
  update(_deltaTime = 0): void { this.viewer.invalidate(); }
  getCameraSettings() {
    return { autoOrbitEnabled: this.isAutoOrbitEnabled(), autoOrbitDuration: this.getAutoOrbitDuration(), preset: this.activeCameraPreset, fov: this.activeCamera.camera.fov };
  }

  /** Pitch (0–89°, looking down) and yaw of the isometric camera. */
  setIsometricAngles(pitchDegrees: number, yawDegrees = 45, refocus = true): void {
    const v = this.viewer;
    if (this.activeCameraPreset !== 'isometric') this.switchCameraPreset('isometric');
    v.pitch = (Math.max(0, Math.min(89, pitchDegrees)) * Math.PI) / 180;
    v.yaw = (yawDegrees * Math.PI) / 180;
    if (refocus) v.fitCamera();
    v.invalidate();
  }
  resetIsometricAngles(refocus = true): void { this.setIsometricAngles((Math.atan(1 / Math.SQRT2) * 180) / Math.PI, 45, refocus); }
  getIsometricAngles(): { pitch: number; yaw: number } | null {
    return this.activeCameraPreset === 'isometric' ? { pitch: (this.viewer.pitch * 180) / Math.PI, yaw: (this.viewer.yaw * 180) / Math.PI } : null;
  }
  dispose(): void { this.recordingManager.dispose(); this.stopAutoOrbit(); this.removeAllListeners?.(); }
  /** There are no camera animations; kept so host code can call it unconditionally. */
  stopAnimation(): void { /* nothing to stop */ }

  switchCameraPreset(preset: CameraPreset, opts: { preserveView?: boolean; target?: { x: number; y: number; z: number } } = {}): void {
    const v = this.viewer;
    if (preset === 'perspective_fpv') { this.enableFlyControls(); return; }
    if (v.fly.enabled) v.disableFly();
    v.projection = preset === 'isometric' ? 'orthographic' : 'perspective';
    if (opts.target) v.target = [opts.target.x, opts.target.y, opts.target.z];
    if (preset === 'isometric' && !opts.preserveView) { v.yaw = Math.PI / 4; v.pitch = Math.atan(1 / Math.SQRT2); }
    v.orthoZoom = 1;
    this.activeCameraPreset = preset;
    v.invalidate();
    this.emit('propertyChanged');
  }

  async focusOnSchematics(o: { animationDuration?: number; preserveCamera?: boolean; padding?: number } = {}): Promise<void> {
    const v = this.viewer;
    if (v.fly.enabled) v.disableFly();
    const keep = o.preserveCamera ?? false;
    const yaw = v.yaw, pitch = v.pitch;
    v.fitCamera();
    if (o.padding !== undefined) v.distance *= 1 + o.padding - 0.05;
    if (keep) { v.yaw = yaw; v.pitch = pitch; }
    v.invalidate();
  }

  /** Look at the target from the `direction` side. */
  snapToDirection(direction: [number, number, number], _animated = false): void { this.viewer.snapToDirection(direction); }
}

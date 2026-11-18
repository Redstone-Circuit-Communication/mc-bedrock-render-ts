import { Vec3 } from './renderer/camera.js';
import type { LoadedStructure } from './renderer/manager.js';
import type { McStructureRenderer } from './renderer/renderer.js';
import type { Position } from './types.js';

export type ViewMode = 'orbit' | 'first' | 'ortho';
/** Who moves the camera in first-person mode: the built-in fly controls (pointer lock, WASD), or the host via setPose. */
export interface ModeOptions { input?: 'builtin' | 'host' }
/** A framing the host computes itself (docs/UNIFIED_API.md, "Frames"): angles in radians, distance and halfHeight in blocks. */
export interface CameraFrame { yaw: number; pitch: number; distance?: number; fov?: number; halfHeight?: number }
/** First-person eye: position in world space, look direction as yaw (0 = towards +z, increasing towards +x) and pitch (> 0 up). */
export interface CameraPose { x: number; y: number; z: number; yaw: number; pitch: number }

/** The host-camera members of the three.js viewer (renderer.viewer is typed as the WebGL2 viewer, which has none of them). */
interface HostViewer {
  setFrame?(yaw: number, pitch: number, distance?: number, fov?: number, halfHeight?: number): void;
  readonly orthoHalfHeight?: number;
  setEye?(eye: [number, number, number], dir: [number, number, number]): void;
  setInputEnabled?(on: boolean): void;
}

/** Camera operations only. Buttons, keyboard shortcuts and axis UI belong to the host. Same API as the Java renderer's CameraControls. */
export class CameraControls {
  readonly manager: McStructureRenderer['cameraManager'];
  mode: ViewMode = 'orbit';
  distance = 20;
  /** First-person mode driven by the host (setPose) instead of the built-in fly controls. */
  hostInput = false;

  constructor(readonly renderer: McStructureRenderer) {
    this.manager = renderer.cameraManager;
    this.manager.cameraOptions.preserveCameraOnUpdate = true;
    this.manager.initializeFlyControls({ showOverlay: false, moveSpeed: 10.89, sprintMultiplier: 2, lookSensitivity: 0.8 });
  }
  get camera() { return this.manager.activeCamera.camera; }
  private get host(): HostViewer { return this.renderer.viewer as unknown as HostViewer; }
  get locked(): boolean { return this.manager.isFlyControlsLocked(); }
  private get orbitControls() { return this.manager.activeControls; }

  target(): Vec3 {
    if (this.mode !== 'first' && this.orbitControls) return this.orbitControls.target.clone();
    return this.camera.position.clone().addScaledVector(this.camera.getWorldDirection(new Vec3()), this.distance);
  }

  setMode(mode: ViewMode, options: ModeOptions = {}): void {
    const host = mode === 'first' && options.input === 'host';
    if ((mode === this.mode && host === this.hostInput) || !['orbit', 'first', 'ortho'].includes(mode)) return;
    this.host.setInputEnabled?.(true);
    this.hostInput = false;
    const target = this.target();
    this.distance = Math.max(1, this.camera.position.distanceTo(target));
    this.manager.disableFlyControls();
    this.manager.stopAutoOrbit();
    this.manager.stopAnimation();
    const preset = mode === 'ortho' ? 'isometric' : 'perspective';
    if (this.manager.activeCameraPreset !== preset) this.manager.switchCameraPreset(preset, { preserveView: true, target });
    this.mode = mode;
    if (host) { this.hostInput = true; this.host.setInputEnabled?.(false); }
    else if (mode === 'first') this.manager.enableFlyControls();
    this.renderer.renderManager.updateCamera(this.camera);
    this.renderer.invalidate();
  }

  async fit(): Promise<void> {
    if (this.mode === 'first') this.setMode('orbit');
    this.manager.stopAnimation();
    if (this.camera.isOrthographicCamera) this.camera.zoom = 1;
    await this.manager.focusOnSchematics({ animationDuration: 0, preserveCamera: false, padding: 0.15 });
    this.renderer.invalidate();
  }

  toggleGrid(): boolean {
    const scene = this.renderer.sceneManager;
    scene.showGrid = !scene.showGrid;
    this.renderer.invalidate();
    return scene.showGrid;
  }

  /** View the structure from the `direction` side, e.g. `[0, 1, 0]` from above. */
  align(direction: Position): void {
    if (this.mode === 'first') this.setMode('orbit');
    this.manager.stopAnimation();
    const o = this.orbitControls;
    if (o) { o.minPolarAngle = 0; o.maxPolarAngle = Math.PI; }
    this.manager.snapToDirection(direction, true);
    this.renderer.invalidate();
  }

  focusBlock(schematic: LoadedStructure, position: Position): void {
    if (this.mode === 'first') this.setMode('orbit');
    this.manager.stopAnimation();
    // a block cell spans [x, x + 1]: aim at its centre
    const target = new Vec3(position[0] + 0.5, position[1] + 0.5, position[2] + 0.5);
    void schematic;
    const v = this.renderer.viewer;
    v.target = target.toArray();
    v.distance = 8;
    if (this.camera.isOrthographicCamera) this.camera.zoom = (this.camera.top - this.camera.bottom) / 7;
    v.invalidate();
  }

  /**
   * The camera pose in the three numbers a share link keeps: `yaw` and `pitch` in radians (pitch > 0 looks down at the
   * target) and `zoom`: the distance to the target in blocks in the perspective modes, the orthographic zoom factor in the
   * isometric one. The Java renderer's CameraControls needs the same two methods for a host to save and restore a view
   * with one piece of code (docs/UNIFIED_API.md has the three.js version).
   */
  getView(): { yaw: number; pitch: number; zoom: number } {
    const v = this.renderer.viewer;
    return { yaw: v.yaw, pitch: v.pitch, zoom: v.isOrthographic ? v.orthoZoom : v.distance };
  }

  /** Put the camera back where {@link getView} read it. Leaves first-person mode. */
  setView(view: { yaw: number; pitch: number; zoom: number }): void {
    if (this.mode === 'first') this.setMode('orbit');
    this.manager.stopAnimation();
    const v = this.renderer.viewer;
    v.yaw = view.yaw;
    v.pitch = Math.max(-1.55, Math.min(1.55, view.pitch));
    if (v.isOrthographic) v.orthoZoom = Math.max(0.05, view.zoom);
    else v.distance = Math.max(0.5, view.zoom);
    v.invalidate();
  }

  /**
   * Put the camera on a framing the host computed itself (the same picture in both renderers and in the host's own preview):
   * keeps the current target, sets the field of view (perspective) or the visible height (orthographic). Leaves first person.
   */
  setFrame(frame: CameraFrame): void {
    if (![frame.yaw, frame.pitch].every(Number.isFinite)) return;
    if (this.mode === 'first') this.setMode('orbit');
    this.manager.stopAnimation();
    const v = this.renderer.viewer, pitch = Math.max(-1.55, Math.min(1.55, frame.pitch));
    if (this.host.setFrame) this.host.setFrame(frame.yaw, pitch, frame.distance, v.isOrthographic ? undefined : frame.fov, v.isOrthographic ? frame.halfHeight : undefined);
    else this.setView({ yaw: frame.yaw, pitch, zoom: v.isOrthographic ? v.orthoZoom : frame.distance ?? v.distance });
  }

  /** The framing as setFrame takes it, plus the projection. */
  getFrame(): Required<CameraFrame> & { ortho: boolean } {
    const v = this.renderer.viewer;
    const ortho = v.isOrthographic;
    return { yaw: v.yaw, pitch: v.pitch, distance: v.distance, fov: ortho ? 0 : v.fov, halfHeight: ortho ? this.host.orthoHalfHeight ?? 0 : v.distance * Math.tan(v.fov / 2), ortho };
  }

  /** First person driven by the host (`setMode('first', { input: 'host' })`): put the eye at `pose`. */
  setPose(pose: CameraPose): void {
    if (![pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every(Number.isFinite)) return;
    const p = Math.max(-1.55, Math.min(1.55, pose.pitch));
    this.host.setEye?.([pose.x, pose.y, pose.z], [Math.sin(pose.yaw) * Math.cos(p), Math.sin(p), Math.cos(pose.yaw) * Math.cos(p)]);
    this.distance = 1;
  }

  /** The eye position and look direction (any mode). */
  getPose(): CameraPose {
    const b = this.renderer.viewer.cameraBasis();
    return { x: b.eye[0], y: b.eye[1], z: b.eye[2], yaw: Math.atan2(b.fwd[0], b.fwd[2]), pitch: Math.asin(Math.max(-1, Math.min(1, b.fwd[1]))) };
  }

  /** Must be called from a user gesture (browser Pointer Lock restriction). */
  lock(): void { this.manager.flyControls?.lock(); }
  unlock(): void { this.manager.flyControls?.unlock(); }
}

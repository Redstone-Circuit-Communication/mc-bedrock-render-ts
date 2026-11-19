import { BlockRegistry, createDefaultRegistry } from './blocks';
import { Box3, CameraManager, Vec3 } from './camera';
import { EventEmitter } from './events';
import { LoadedStructure } from './manager';
import { RecordingManager, type RecordingOptions, type ScreenshotOptions } from './recorder';
import { MeshOptions, StructureMesh, abortError, buildStructureMesh } from './mesher';
import { ResourcePack, ResourceStack } from './resources';
import { McStructure, loadMcStructure } from './structure';
import { StructureViewer, ViewerObject, ViewerOptions } from './viewer';
import { ThreeStructureViewer } from './three-viewer';

export interface FrameProfile {
  samples: number;
  mean: Record<'controlsMs' | 'highlightMs' | 'gizmoMs' | 'visibilityMs' | 'submitMs' | 'measuredMs', number>;
  p95: Record<'controlsMs' | 'highlightMs' | 'gizmoMs' | 'visibilityMs' | 'submitMs' | 'measuredMs', number>;
}

export type BinarySource = string | URL | ArrayBuffer | Uint8Array | Blob;

async function toBytes(src: BinarySource): Promise<Uint8Array> {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (typeof Blob !== 'undefined' && src instanceof Blob) return new Uint8Array(await src.arrayBuffer());
  const res = await fetch(src as string | URL);
  if (!res.ok) throw new Error(`Failed to fetch ${String(src)}: ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}

export interface RendererCallbacks {
  onRendererInitialized?(renderer: McStructureRenderer): void;
  onSchematicLoaded?(id: string): void;
  onSchematicRendered?(id: string): void;
  onResourcePackLoaded?(name: string): void;
  /** Called with `{ name }` and 0 when a structure starts loading, and 1 when it is on screen. */
  onLoadingProgress?(file: { name: string }, progress: number): void;
  /** With `chunkLoading`: one more 16³ chunk of structure `id` is on screen (`done` of `total`). Also the `schematicChunkProgress` event. */
  onChunkProgress?(id: string, done: number, total: number): void;
  /** Java renderer callbacks that have no counterpart here (no drag and drop, interaction manager or simulation); accepted, never called. */
  onInvalidFileType?(file: File): void;
  onSchematicDropped?(file: File): void;
  onObjectSelected?(object: unknown): void;
  onObjectDeselected?(object: unknown): void;
  onSimulationInitialized?(id: string): void;
  onSimulationTicked?(tick: number): void;
  onBlockInteracted?(x: number, y: number, z: number): void;
}

export interface RendererOptions extends ViewerOptions, Pick<MeshOptions, 'tints' | 'unknownBlocks' | 'liquidLayer' | 'entities'> {
  /** Custom block registry (defaults to {@link createDefaultRegistry}). */
  registry?: BlockRegistry;
  callbacks?: RendererCallbacks;
  /** Accepted for parity with the Java renderer's options; the Bedrock viewer has no chunking, so only `maxChunks`-style limits are ignored. */
  chunkRenderOptions?: { maxChunks?: number; renderDistance?: number; frustumCulling?: boolean };
  /**
   * Progressive loading, same option as the Java renderer: a structure is meshed and shown one 16³ chunk at a time (bottom
   * layer first) and every chunk takes at least `minIntervalMs` milliseconds, so slow devices get the main thread back
   * between chunks. Leave it out to build the whole structure first and show it at once (the old behaviour).
   * Rebuilds after the rendering bounds change are always built at once.
   */
  chunkLoading?: { minIntervalMs?: number };
  /** Block meshing: `ts` (default, shared TypeScript mesh core) or `legacy` (single pass). `wasm` is accepted and gives `ts` (removed in 1.6.0, see NOTICE.md). See docs/MESH.md. */
  meshBackend?: 'wasm' | 'ts' | 'legacy';
  /** Same key as the Java renderer's options (`background` is the older name). */
  backgroundColor?: string;
  /** Frame cap; 0 = draw whenever something changed. */
  targetFPS?: number;
  /** `position` sets the viewing direction of the first frame; `defaultCameraPreset` picks perspective or isometric. */
  cameraOptions?: { position?: [number, number, number]; defaultCameraPreset?: 'perspective' | 'isometric'; preserveCameraOnUpdate?: boolean; fov?: number };
  /** Accepted for parity (the viewer has no post-processing). */
  postProcessingOptions?: { enableSSAO?: boolean; enableSMAA?: boolean; multisampling?: number; [key: string]: unknown };
  /** Java renderer option names (`background` / `grid` / `axes` are the older Bedrock names for the first three). */
  showGrid?: boolean;
  showAxes?: boolean;
  /** Turn around the structure from the first frame; `autoOrbitDuration` is seconds per turn. */
  enableAutoOrbit?: boolean;
  autoOrbitDuration?: number;
  /** Frame rate when nothing moves. The Bedrock viewer draws only when something changed, so this is stored (`getIdleFPS`) and not used. */
  idleFPS?: number;
  /** Options that only exist in the Java renderer (`enableInteraction`, `enableDragAndDrop`, `sidebarOptions`, `wasmMeshBuilderOptions` …) are accepted and ignored, so one options object serves both renderers. */
  [key: string]: unknown;
}

/**
 * High-level facade: owns a WebGL viewer, a resource stack and the loaded structures.
 *
 * ```js
 * const r = new McStructureRenderer(canvas);
 * await r.loadResourcePack('/assets/vanilla.zip');   // zip, .mcpack, .brarchive, or a zip of several packs
 * await r.loadStructure('/builds/door.mcstructure');
 * ```
 *
 * The members below `canvas` mirror the Java renderer's `SchematicRenderer` (`schematicManager`, `cameraManager`,
 * `sceneManager`, `renderManager`, `eventEmitter`, `invalidate()`, `dispose()`), so host code can drive both.
 */
/**
 * The viewer: drawn by the Java package's stack (three.js, OrbitControls, postprocessing with N8AO + SMAA + its gamma pass, the same
 * lights and materials; three-viewer.ts). The dependency-free WebGL2 viewer is only the fallback where three.js cannot start
 * (no real WebGL, e.g. the Node test environment).
 */
function createViewer(canvas: HTMLCanvasElement, opts: ViewerOptions): StructureViewer {
  try { return new ThreeStructureViewer(canvas, opts) as unknown as StructureViewer; }
  catch (e) { console.warn('mcstructure-renderer: three.js could not start, using the WebGL2 fallback viewer', e); return new StructureViewer(canvas, opts); }
}

export class McStructureRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly viewer: StructureViewer;
  readonly resources = new ResourceStack();
  readonly registry: BlockRegistry;
  readonly options: RendererOptions;
  readonly eventEmitter = new EventEmitter();
  readonly cameraManager: CameraManager;
  readonly schematicManager: StructureManager;
  readonly sceneManager: { showGrid: boolean };
  readonly renderManager: {
    render(): void; updateCamera(camera?: unknown): void; setMaxPixelRatio(n: number): void; setSSAOEnabled(on: boolean): void;
    setFrameProfilingEnabled(on: boolean): void; getFrameProfile(): FrameProfile | null;
  };
  /** There are no chunks in this viewer: every structure counts as one. Present so `applyRenderSettings` and the settings panel can call it. */
  readonly chunkVisibility: {
    update(camera?: unknown): void; setOptions(o?: unknown): void;
    getStats(): { visibleChunks: number; totalChunks: number; triangles: number; drawCalls: number };
  };
  /** The Java renderer keeps its asset loader here; `ItemAssets` accepts what this returns. */
  readonly cubane: { getAssetLoader(): ResourceStack };
  /** The structure loaded through {@link loadStructure} (single-structure convenience). */
  structure?: McStructure;
  mesh?: StructureMesh;
  readonly meshOptions: MeshOptions;
  /** Screenshots and recordings; the camera manager owns it, like in the Java renderer. */
  get recordingManager(): RecordingManager { return this.cameraManager.recordingManager; }
  /** Camera position of the last {@link updateCameraPosition}. */
  readonly state = { cameraPosition: new Vec3() };
  /** Phase timings the host may fill in (kept for parity; nothing here writes to it). */
  readonly timings = new Map<string, number>();
  private disposed = false;
  private targetFPS: number;
  private idleFPS: number;
  private readonly continuousReasons = new Set<string>();
  private packRecords: { name: string; packs: ResourcePack[]; enabled: boolean }[] = [];
  private readonly ssaoPresets = { perspective: { aoRadius: 1, distanceFalloff: 0.4, intensity: 5 }, isometric: { aoRadius: 0.3, distanceFalloff: 0.1, intensity: 0.8 } };

  /** `(canvas, options?)`, or the Java renderer's `(canvas, schematicData?, defaultResourcePacks?, options?)`: packs are loaded first, then the structures, then `onRendererInitialized` fires. */
  constructor(canvas: HTMLCanvasElement, options?: RendererOptions);
  constructor(canvas: HTMLCanvasElement, schematicData?: Record<string, () => Promise<ArrayBuffer>>, defaultResourcePacks?: Record<string, () => Promise<Blob | ResourcePack>>, options?: RendererOptions);
  constructor(canvas: HTMLCanvasElement, a?: RendererOptions | Record<string, () => Promise<ArrayBuffer>>, b?: Record<string, () => Promise<Blob | ResourcePack>>, c?: RendererOptions) {
    const javaForm = arguments.length >= 3 || (arguments.length === 2 && !!a && Object.keys(a).length > 0 && Object.values(a).every((v) => typeof v === 'function'));
    const opts: RendererOptions = (javaForm ? c : (a as RendererOptions | undefined)) ?? {};
    const schematicData = javaForm ? (a as Record<string, () => Promise<ArrayBuffer>> | undefined) ?? {} : {};
    const packSources = javaForm ? b ?? {} : {};
    this.canvas = canvas;
    this.options = opts;
    const copt = opts.cameraOptions;
    this.targetFPS = Number.isFinite(opts.targetFPS) ? Math.max(0, opts.targetFPS as number) : 60;
    this.idleFPS = Number.isFinite(opts.idleFPS) ? Math.max(0, opts.idleFPS as number) : 1;
    this.viewer = createViewer(canvas, { ...opts, background: opts.backgroundColor ?? opts.background, grid: opts.showGrid ?? opts.grid, axes: opts.showAxes ?? opts.axes, orthographic: opts.orthographic ?? copt?.defaultCameraPreset === 'isometric', fov: copt?.fov ?? opts.fov, ssao: opts.postProcessingOptions?.enabled !== false && opts.postProcessingOptions?.enableSSAO !== false, smaa: opts.postProcessingOptions?.enableSMAA !== false, multisampling: opts.postProcessingOptions?.multisampling, autoRotate: opts.enableAutoOrbit ?? opts.autoRotate, autoRotateSpeed: opts.autoOrbitDuration ? 360 / Math.max(1, opts.autoOrbitDuration) : opts.autoRotateSpeed });
    this.viewer.setTargetFPS(this.targetFPS);
    if (copt?.position) {
      // the first frame looks at the structure from this side
      const [px, py, pz] = copt.position, l = Math.hypot(px, py, pz) || 1;
      this.viewer.yaw = Math.atan2(px, pz); this.viewer.pitch = Math.max(-1.55, Math.min(1.55, Math.asin(py / l)));
    }
    this.registry = opts.registry ?? createDefaultRegistry();
    this.meshOptions = { registry: this.registry, tints: opts.tints, unknownBlocks: opts.unknownBlocks, liquidLayer: opts.liquidLayer, entities: opts.entities, backend: opts.meshBackend };
    this.cameraManager = new CameraManager(this.viewer);
    if (copt) Object.assign(this.cameraManager.cameraOptions, copt);
    this.schematicManager = new StructureManager(this);
    const viewer = this.viewer;
    this.sceneManager = { get showGrid() { return viewer.showGrid; }, set showGrid(v: boolean) { viewer.showGrid = v; viewer.invalidate(); } };
    this.renderManager = {
      render: () => viewer.render(),
      updateCamera: () => viewer.invalidate(),
      setMaxPixelRatio: (n) => { this.options.maxPixelRatio = n; viewer.setMaxPixelRatio(n); },
      setSSAOEnabled: (on) => { viewer.ssaoEnabled = on; viewer.invalidate(); },
      setFrameProfilingEnabled: (on) => { viewer.profiling = on; viewer.frameTimes.length = 0; },
      getFrameProfile: () => {
        const t = [...viewer.frameTimes].sort((a, b) => a - b);
        if (!t.length) return null;
        const mean = t.reduce((a, b) => a + b, 0) / t.length, p95 = t[Math.min(t.length - 1, Math.floor(t.length * 0.95))];
        const zero = { controlsMs: 0, highlightMs: 0, gizmoMs: 0, visibilityMs: 0 };
        return { samples: t.length, mean: { ...zero, submitMs: mean, measuredMs: mean }, p95: { ...zero, submitMs: p95, measuredMs: p95 } };
      },
    };
    this.chunkVisibility = {
      update: () => {}, setOptions: () => {},
      getStats: () => ({ visibleChunks: viewer.stats.visibleObjects, totalChunks: viewer.meshCount, triangles: viewer.stats.triangles, drawCalls: viewer.stats.drawCalls }),
    };
    this.cubane = { getAssetLoader: () => this.resources };
    this.viewer.onFrame = (t) => this.eventEmitter.emit('frameRendered', { timestamp: t });
    this.viewer.onIdle = () => this.eventEmitter.emit('renderIdle');
    this.viewer.overlays = () => this.schematicManager.getAllSchematics().filter((s) => s.group.visible).flatMap((s) => [...s.group.overlays(), ...s.helperOverlays()]);
    const prevFrame = this.viewer.onFrame;
    this.viewer.onFrame = (t) => { prevFrame?.(t); if (this.continuousReasons.size) this.viewer.requestRender(); };
    (canvas as unknown as { schematicRenderer?: McStructureRenderer }).schematicRenderer = this;
    if (!javaForm) {
      queueMicrotask(() => { if (!this.disposed) { this.eventEmitter.emit('sceneReady'); opts.callbacks?.onRendererInitialized?.(this); } });
      return;
    }
    // the Java renderer's start-up: resource packs, then structures, then the ready callback. A failure goes to the canvas as `rendererError`.
    const manager = this.schematicManager;
    void (async () => {
      for (const [name, load] of Object.entries(packSources)) { await this.loadResourcePack(await load(), name); if (this.disposed) return; }
      for (const [id, load] of Object.entries(schematicData)) { await manager.loadSchematic(id, await load(), { focused: true }); if (this.disposed) return; }
      this.eventEmitter.emit('sceneReady');
      opts.callbacks?.onRendererInitialized?.(this);
    })().catch((error) => canvas.dispatchEvent(new CustomEvent('rendererError', { detail: error })));
  }

  // ------------------------------------------------------------------ view ---

  get fps(): number { return this.viewer.fps; }
  getFPS(): number { return this.viewer.fps; }
  getTargetFPS(): number { return this.targetFPS; }
  setTargetFPS(value: number): void {
    this.targetFPS = Number.isFinite(value) ? Math.max(0, value) : 60;
    this.options.targetFPS = this.targetFPS;
    this.viewer.setTargetFPS(this.targetFPS);
    this.invalidate();
  }
  getIdleFPS(): number { return this.idleFPS; }
  setIdleFPS(value: number): void { this.idleFPS = Number.isFinite(value) ? Math.max(0, value) : 1; this.options.idleFPS = this.idleFPS; }
  /** Keep drawing every frame while any reason is active (e.g. an animation the host runs). */
  setContinuous(reason: string, active: boolean): void {
    if (active) { this.continuousReasons.add(reason); this.invalidate(); } else this.continuousReasons.delete(reason);
  }
  /** Colour as a CSS string or a number like `0x1b1d23`. */
  setBackgroundColor(color: string | number): void {
    this.viewer.setBackground(typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color);
    this.invalidate();
  }
  setGridVisible(visible: boolean): void { this.viewer.showGrid = visible; this.invalidate(); }
  setAxesVisible(visible: boolean): void { this.viewer.showAxes = visible; this.invalidate(); }
  setCameraMode(mode: 'perspective' | 'isometric' | 'perspective_fpv'): void { this.cameraManager.switchCameraPreset(mode); }
  getCameraMode(): string { return this.cameraManager.activeCameraPreset; }
  updateCameraPosition(): void { this.state.cameraPosition.copy(this.cameraManager.activeCamera.camera.position); }
  setAutoOrbit(enabled: boolean): void { this.options.enableAutoOrbit = enabled; enabled ? this.cameraManager.startAutoOrbit() : this.cameraManager.stopAutoOrbit(); }
  setAutoOrbitDuration(duration: number): void { this.options.autoOrbitDuration = duration; this.cameraManager.setAutoOrbitDuration(duration); }
  toggleAutoOrbit(): boolean { const on = this.cameraManager.toggleAutoOrbit(); this.options.enableAutoOrbit = on; return on; }
  setIsometricAngles(pitchDegrees: number, yawDegrees = 45, refocus = true): void { this.cameraManager.setIsometricAngles(pitchDegrees, yawDegrees, refocus); }
  resetIsometricAngles(refocus = true): void { this.cameraManager.resetIsometricAngles(refocus); }
  getIsometricAngles(): { pitch: number; yaw: number } | null { return this.cameraManager.getIsometricAngles(); }

  /** Ambient occlusion (ssao.ts): the Java package's presets and switches. */
  isSSAOEnabled(): boolean { return this.viewer.ssaoEnabled; }
  setSSAOEnabled(enabled: boolean): void { this.viewer.ssaoEnabled = enabled; this.viewer.invalidate(); }
  setSSAOPreset(mode: 'perspective' | 'isometric', params: { aoRadius?: number; distanceFalloff?: number; intensity?: number }): void {
    Object.assign(this.ssaoPresets[mode], params); Object.assign(this.viewer.ssaoPresets[mode], params);
    (this.viewer as unknown as { applySSAOPreset?: () => void }).applySSAOPreset?.(); this.viewer.invalidate();
  }
  getSSAOPresets(): { perspective: { aoRadius: number; distanceFalloff: number; intensity: number }; isometric: { aoRadius: number; distanceFalloff: number; intensity: number } } {
    return { perspective: { ...this.ssaoPresets.perspective }, isometric: { ...this.ssaoPresets.isometric } };
  }
  setSSAOParameters(params: { aoRadius?: number; distanceFalloff?: number; intensity?: number; qualityMode?: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra' }): void {
    const { qualityMode: _q, ...p } = params;
    Object.assign(this.viewer.ssaoPresets[this.viewer.isOrthographic ? 'isometric' : 'perspective'], p);
    (this.viewer as unknown as { applySSAOPreset?: () => void }).applySSAOPreset?.(); this.viewer.invalidate();
  }

  // ------------------------------------------------------ rendering bounds ---

  private structureById(id: string): LoadedStructure | null {
    const s = this.schematicManager.getSchematic(id);
    if (!s) console.error(`Schematic with ID ${id} not found`);
    return s ?? null;
  }
  getRenderingBounds(schematicId: string, asArrays = true): { min: Vec3 | number[]; max: Vec3 | number[] } | null {
    const s = this.structureById(schematicId);
    if (!s) return null;
    const { min, max } = s.renderingBounds;
    return asArrays ? { min: min.toArray(), max: max.toArray() } : { min: min.clone(), max: max.clone() };
  }
  setRenderingBounds(schematicId: string, min: Vec3 | number[], max: Vec3 | number[], showHelper = true): void { this.structureById(schematicId)?.setRenderingBounds(min, max, showHelper); }
  setRenderingBoundsAxis(schematicId: string, axis: 'x' | 'y' | 'z', minValue: number, maxValue: number): void {
    const s = this.structureById(schematicId);
    if (!s) return;
    const min = s.renderingBounds.min.clone(), max = s.renderingBounds.max.clone();
    min[axis] = minValue; max[axis] = maxValue;
    s.setRenderingBounds(min, max);
  }
  /** Back to the full size; the bounds are switched off unless `disable` is false. */
  resetRenderingBounds(schematicId: string, disable = true): void {
    const s = this.structureById(schematicId);
    if (!s) return;
    s.resetRenderingBounds();
    s.renderingBounds.enabled = !disable;
    s.bounds.apply();
    if (disable) s.showRenderingBoundsHelper(false);
  }
  showRenderingBoundsHelper(schematicId: string, visible: boolean): void { this.structureById(schematicId)?.showRenderingBoundsHelper(visible); }
  getBounds(schematicId: string): LoadedStructure['bounds'] | null { return this.structureById(schematicId)?.bounds ?? null; }
  getSchematicDimensions(schematicId: string): number[] | null { const s = this.structureById(schematicId); return s ? [...s.structure.size] : null; }
  getLoadedSchematics(): string[] { return this.schematicManager.getAllSchematics().map((s) => s.id); }
  async rebuildAllSchematics(): Promise<void> { await this.schematicManager.rebuildAll(); }

  // -------------------------------------------------------- resource packs ---

  async getResourcePacks(): Promise<{ name: string; enabled: boolean; order: number }[]> {
    return this.packRecords.map((r, order) => ({ name: r.name, enabled: r.enabled, order }));
  }
  async addResourcePack(file: File): Promise<void> { await this.loadResourcePack(file, file.name); }
  async toggleResourcePackEnabled(name: string, enabled: boolean): Promise<void> {
    const r = this.packRecords.find((x) => x.name === name);
    if (!r || r.enabled === enabled) return;
    r.enabled = enabled;
    await this.packsChanged();
  }
  async removeResourcePack(name: string): Promise<void> {
    const i = this.packRecords.findIndex((x) => x.name === name);
    if (i < 0) return;
    this.packRecords.splice(i, 1);
    await this.packsChanged();
  }
  private async packsChanged(): Promise<void> {
    this.resources.setPacks(this.packRecords.filter((r) => r.enabled).flatMap((r) => r.packs));
    if (this.schematicManager.getAllSchematics().length) await this.schematicManager.rebuildAll();
    this.eventEmitter.emit('resourcePacksReloaded');
  }

  // ------------------------------------------------ screenshots, recording ---

  /** Save a screenshot through a download link (`<filename>.png` / `.jpg`). */
  async downloadScreenshot(filename = 'schematic_screenshot', options?: { width?: number; height?: number; quality?: number; format?: 'image/png' | 'image/jpeg' }): Promise<void> {
    const blob = await this.takeScreenshot(options);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${(options?.format ?? 'image/png') === 'image/png' ? 'png' : 'jpg'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  startRecording(duration: number, options?: RecordingOptions): Promise<void> { return this.recordingManager.startRecording(duration, options); }
  stopRecording(): void { this.recordingManager.stopRecording(); }
  isRecording(): boolean { return this.recordingManager.isRecording; }

  /** Add a resource pack (later packs override earlier ones). A zip holding several packs adds all of them. */
  async loadResourcePack(source: BinarySource | ResourcePack, name = 'pack'): Promise<void> {
    // a pack added under a name that is already there replaces it
    const old = this.packRecords.findIndex((r) => r.name === name);
    if (old >= 0) { this.packRecords.splice(old, 1); this.resources.setPacks(this.packRecords.filter((r) => r.enabled).flatMap((r) => r.packs)); }
    let added: ResourcePack[];
    if (source instanceof ResourcePack) { this.resources.push(source); added = [source]; }
    else added = await this.resources.addBytes(await toBytes(source));
    this.packRecords.push({ name, packs: added, enabled: true });
    this.options.callbacks?.onResourcePackLoaded?.(name);
    this.eventEmitter.emit('resourcePackLoaded', name);
    if (this.schematicManager.getAllSchematics().length) await this.rebuild();
  }

  /** Parse and display a `.mcstructure`, replacing the previously shown single structure. Returns its mesh. */
  async loadStructure(source: BinarySource | McStructure): Promise<StructureMesh> {
    for (const old of this.schematicManager.getAllSchematics()) await this.schematicManager.removeSchematic(old.id);
    const loaded = await this.schematicManager.loadSchematic('default', source, { focused: true });
    this.structure = loaded.structure;
    this.mesh = loaded.mesh;
    return loaded.mesh;
  }

  /** Regenerate every mesh, e.g. after adding a resource pack or changing the registry. */
  async rebuild(): Promise<StructureMesh> {
    await this.schematicManager.rebuildAll();
    const first = this.schematicManager.getAllSchematics()[0];
    this.mesh = first?.mesh;
    this.structure = first?.structure;
    if (!this.mesh) throw new Error('No structure loaded');
    return this.mesh;
  }

  invalidate(): void { this.viewer.invalidate(); }
  /** `true` while rendering is paused ({@link suspend}). */
  get suspended(): boolean { return this.viewer.suspendedState; }
  suspend(): void { this.viewer.suspend(); }
  resume(): void { this.viewer.resume(); }
  /** `width` / `height` render at that size (one of them keeps the canvas aspect); `transparent` clears with alpha 0. */
  takeScreenshot(options: ScreenshotOptions = {}): Promise<Blob> { return this.recordingManager.takeScreenshot(options); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cameraManager.dispose(); // also stops a running recording
    this.schematicManager.dispose(); // frees every structure's GPU buffers
    this.viewer.dispose();
    this.eventEmitter.removeAllListeners();
    delete (this.canvas as unknown as { schematicRenderer?: unknown }).schematicRenderer;
  }
}

export interface LoadingProgress { stage: string; progress: number; message: string }
/** The fourth argument of `loadSchematic`. */
export interface StructureLoadOptions {
  onProgress?: (p: LoadingProgress) => void;
  /** The structure is in the scene. With `chunkLoading` this is before its first chunk (the size is known, the camera can be aimed); otherwise when it is complete. */
  onStart?: (schematic: LoadedStructure) => void;
  /** With `chunkLoading`: abort to stop between two chunks (`AbortError`). */
  signal?: AbortSignal;
}
const emptyLayer = () => ({ positions: new Float32Array(0), uvs: new Float32Array(0), colors: new Float32Array(0), indices: new Uint32Array(0) });
export interface SchematicLoadProperties {
  /** Fit the camera to the structure when it is loaded (default true), and announce it with `schematicAdded`. */
  focused?: boolean;
  visible?: boolean;
  /** Accepted for the Java renderer's property bag; structures here always sit at the origin at full opacity, so these are ignored. */
  position?: number[]; rotation?: number[]; scale?: number[] | number; opacity?: number;
}

/** The Java renderer's `schematicManager`: loads, lists and removes structures. Same method names, arguments and events. */
export class StructureManager {
  /** Loaded structures by id, in load order. */
  readonly schematics = new Map<string, LoadedStructure>();
  readonly schematicRenderer: McStructureRenderer;
  readonly eventEmitter: EventEmitter;
  private sources = new Map<string, McStructure>();
  private disposed = false;
  constructor(r: McStructureRenderer) { this.schematicRenderer = r; this.eventEmitter = r.eventEmitter; }
  private get r(): McStructureRenderer { return this.schematicRenderer; }

  /**
   * Parse, mesh and show a structure. The Java renderer resolves with nothing and the caller looks the object up with
   * `getSchematic(id)`; this one also returns it, so both ways of writing it work.
   */
  async loadSchematic(id: string, source: BinarySource | McStructure, properties: SchematicLoadProperties = {}, options?: StructureLoadOptions): Promise<LoadedStructure> {
    if (this.disposed) throw new Error('the renderer has been disposed');
    if (this.r.options.singleSchematicMode) await this.removeAllSchematics();
    else if (this.schematics.has(id)) await this.removeSchematic(id);
    const progress = (stage: string, value: number, message: string) => options?.onProgress?.({ stage, progress: value, message });
    this.r.options.callbacks?.onLoadingProgress?.({ name: id }, 0);
    progress('parsing', 0, 'Parsing schematic data...');
    const structure = source instanceof McStructure ? source : await loadMcStructure(await toBytes(source));
    if (this.disposed) throw new Error('the renderer has been disposed');
    if (options?.signal?.aborted) throw abortError();
    progress('parsing', 20, 'Schematic parsed');
    this.r.options.callbacks?.onSchematicLoaded?.(id);
    progress('mesh_building', 20, 'Building meshes...');
    const chunked = this.r.options.chunkLoading;
    if (chunked && typeof chunked === 'object') return this.loadChunked(id, structure, properties, options, Math.max(0, Number(chunked.minIntervalMs) || 0), progress);
    await this.prepareResources(structure);
    const mesh = await buildStructureMesh(structure, this.r.resources, this.r.meshOptions);
    if (this.disposed) throw new Error('the renderer has been disposed');
    progress('mesh_building', 60, 'Meshes built');
    progress('scene_setup', 60, 'Setting up scene...');
    const loaded = this.register(id, structure, mesh, this.r.viewer.addMesh(mesh), properties);
    options?.onStart?.(loaded);
    progress('scene_setup', 100, 'Complete');
    this.r.options.callbacks?.onSchematicRendered?.(id);
    this.r.options.callbacks?.onLoadingProgress?.({ name: id }, 1);
    this.eventEmitter.emit('schematicRendered', id);
    this.r.viewer.invalidate();
    return loaded;
  }

  /**
   * With a pack that downloads on demand, build the mesh once without keeping it: that records every file the structure reads.
   * Download those and repeat until nothing new is asked for (definitions first, then the textures they point to).
   */
  private async prepareResources(structure: McStructure): Promise<void> {
    const stack = this.r.resources;
    if (!stack.hasRemote) return;
    for (let round = 0; round < 8; round++) {
      await buildStructureMesh(structure, stack, this.r.meshOptions);
      if (this.disposed || (await stack.fetchPending()) === 0) return;
    }
  }

  /** Put a structure into the scene: events, rebuild hook, visibility, camera. */
  private register(id: string, structure: McStructure, mesh: StructureMesh, handle: ViewerObject, properties: SchematicLoadProperties): LoadedStructure {
    const loaded = new LoadedStructure(id, structure, mesh, handle);
    loaded.onPropertyChanged = (property, value) => this.eventEmitter.emit('schematicPropertyChanged', { schematic: loaded, property, value });
    loaded.onRebuild = () => this.rebuildOne(id);
    if (properties.visible === false) loaded.visible = false;
    this.schematics.set(id, loaded);
    this.sources.set(id, structure);
    const focused = properties.focused;
    if (focused !== false) this.r.viewer.fitCamera();
    if (focused || focused === undefined) this.eventEmitter.emit('schematicAdded', { schematic: loaded });
    return loaded;
  }

  /**
   * `chunkLoading`: the structure joins the scene as soon as its texture atlas is ready (`onStart`), its chunks follow one by
   * one, at least `minChunkMs` apart; the promise resolves when the last chunk and the entities are on screen. Removing the
   * structure, disposing the renderer or aborting `options.signal` stops it between two chunks with an `AbortError`;
   * any failure after the structure joined the scene takes it out again.
   */
  private async loadChunked(id: string, structure: McStructure, properties: SchematicLoadProperties, options: StructureLoadOptions | undefined,
    minChunkMs: number, progress: (stage: string, value: number, message: string) => void): Promise<LoadedStructure> {
    let loaded: LoadedStructure | undefined;
    let handle: ViewerObject | undefined;
    const stop = new AbortController();
    const onAbort = () => stop.abort();
    if (options?.signal?.aborted) stop.abort();
    else options?.signal?.addEventListener('abort', onAbort, { once: true });
    const gone = () => this.disposed || stop.signal.aborted || (loaded ? loaded.isDisposed || this.schematics.get(id) !== loaded : false);
    try {
      await this.prepareResources(structure);
      if (gone()) throw abortError();
      const mesh = await buildStructureMesh(structure, this.r.resources, this.r.meshOptions, {
        minChunkMs,
        signal: stop.signal,
        onAtlas: (atlas, size) => {
          if (gone()) throw abortError();
          handle = this.r.viewer.beginMesh(size, atlas);
          const placeholder: StructureMesh = {
            solid: emptyLayer(), translucent: emptyLayer(), atlas, entityBatches: [], entityRecords: [], size,
            stats: { blocks: 0, faces: 0, unknownBlocks: [], missingTextures: [], entities: 0, unknownEntities: [], undrawnEntities: [], missingEntityTextures: [], meshBackend: 'ts', timings: {} },
          };
          progress('scene_setup', 60, 'Setting up scene...');
          loaded = this.register(id, structure, placeholder, handle, properties);
          options?.onStart?.(loaded);
        },
        onChunk: (chunk, done, total) => {
          if (gone() || !handle) throw abortError();
          handle.appendBlocks(chunk.solid, chunk.translucent);
          this.r.options.callbacks?.onChunkProgress?.(id, done, total);
          this.eventEmitter.emit('schematicChunkProgress', { id, done, total });
          progress('mesh_building', 20 + Math.round((done / total) * 75), `Chunk ${done}/${total}`);
        },
      });
      if (gone() || !loaded || !handle) throw abortError();
      handle.appendEntities(mesh.entityBatches);
      loaded.mesh = mesh;
      progress('scene_setup', 100, 'Complete');
      this.r.options.callbacks?.onSchematicRendered?.(id);
      this.r.options.callbacks?.onLoadingProgress?.({ name: id }, 1);
      this.eventEmitter.emit('schematicRendered', id);
      this.r.viewer.invalidate();
      return loaded;
    } catch (error) {
      if (loaded && this.schematics.get(id) === loaded) await this.removeSchematic(id);
      else if (!loaded) handle?.dispose();
      throw this.disposed ? new Error('the renderer has been disposed') : error;
    } finally {
      options?.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Several structures one after the other, `{ id: () => Promise<ArrayBuffer> }`. */
  async loadSchematics(map: { [id: string]: () => Promise<ArrayBuffer> }, propertiesMap?: { [id: string]: SchematicLoadProperties }): Promise<void> {
    for (const id of Object.keys(map)) {
      if (this.disposed) return;
      const data = await map[id]();
      if (this.disposed) return;
      await this.loadSchematic(id, data, propertiesMap?.[id]);
    }
  }

  /** The structure's id is the file name. */
  async loadSchematicFromFile(file: File, options?: { onProgress?: (p: LoadingProgress) => void }): Promise<void> {
    try {
      options?.onProgress?.({ stage: 'file_reading', progress: 0, message: 'Reading file...' });
      const buffer = await file.arrayBuffer();
      options?.onProgress?.({ stage: 'file_reading', progress: 100, message: 'Reading file...' });
      await this.loadSchematic(file.name, buffer, undefined, options);
      this.eventEmitter.emit('schematicLoaded', { id: file.name });
    } catch (error) {
      this.eventEmitter.emit('schematicLoadError', { error });
      throw error;
    }
  }

  async loadSchematicFromURL(url: string | URL, name?: string, properties?: SchematicLoadProperties, options?: { onProgress?: (p: LoadingProgress) => void }): Promise<LoadedStructure> {
    try {
      const id = name || String(url).split(/[?#]/)[0].split('/').pop() || 'schematic';
      options?.onProgress?.({ stage: 'file_reading', progress: 0, message: 'Fetching schematic from URL...' });
      const loaded = await this.loadSchematic(id, url, properties, options);
      this.eventEmitter.emit('schematicLoaded', { id });
      return loaded;
    } catch (error) {
      this.eventEmitter.emit('schematicLoadError', { error });
      throw error;
    }
  }

  getAllSchematics(): LoadedStructure[] { return [...this.schematics.values()]; }
  getSchematic(id: string): LoadedStructure | undefined { return this.schematics.get(id); }
  getFirstSchematic(): LoadedStructure | undefined { return this.getAllSchematics()[0]; }
  getSchematicAtPosition(position: { x: number; y: number; z: number } | number[]): LoadedStructure | null {
    for (const s of this.schematics.values()) if (s.containsPosition(position)) return s;
    return null;
  }
  isEmpty(): boolean { return this.schematics.size === 0; }
  schematicExists(id: string): boolean { return this.schematics.has(id); }
  /** The 3D objects a host can hit-test (here the structures' groups). */
  getSelectableObjects(): LoadedStructure['group'][] { return this.getAllSchematics().map((s) => s.group); }

  async removeSchematic(id: string): Promise<void> {
    const s = this.schematics.get(id);
    if (!s) return;
    this.schematics.delete(id);
    this.sources.delete(id);
    s.disposeGpu(); // frees its GPU buffers (synchronous body)
    this.r.viewer.invalidate();
    this.eventEmitter.emit('schematicRemoved', { id });
  }
  async removeAllSchematics(): Promise<void> { await Promise.all([...this.schematics.keys()].map((id) => this.removeSchematic(id))); }

  // ---- extents across all structures ----
  getGlobalTightWorldBox(): Box3 {
    const box = new Box3();
    for (const s of this.schematics.values()) box.union(s.getTightWorldBox());
    return box;
  }
  getSchematicsAveragePosition(): Vec3 { return this.isEmpty() ? new Vec3() : this.getGlobalTightWorldBox().getCenter(); }
  getMaxSchematicDimensions(): Vec3 {
    const out = new Vec3();
    for (const s of this.schematics.values()) { const d = s.getDimensions(); out.set(Math.max(out.x, d[0]), Math.max(out.y, d[1]), Math.max(out.z, d[2])); }
    return out;
  }
  /** Largest extent of the non-air blocks; a structure with no blocks counts with its allocated size. */
  getMaxSchematicTightDimensions(): Vec3 {
    const out = new Vec3();
    for (const s of this.schematics.values()) {
      const t = s.getTightDimensions(), d = t[0] === 0 && t[1] === 0 && t[2] === 0 ? s.getDimensions() : t;
      out.set(Math.max(out.x, d[0]), Math.max(out.y, d[1]), Math.max(out.z, d[2]));
    }
    return out;
  }
  getGlobalBoundingBox(): [number[], number[]] {
    const min = [0, 0, 0], max = [0, 0, 0];
    for (const s of this.schematics.values()) {
      const [a, b] = s.getBoundingBox();
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a[i]); max[i] = Math.max(max[i], b[i]); }
    }
    return [min, max];
  }

  /** @internal */
  async rebuildAll(): Promise<void> {
    for (const id of [...this.schematics.keys()]) await this.rebuildOne(id);
    this.r.viewer.invalidate();
  }
  /** @internal */
  async rebuildOne(id: string): Promise<void> {
    const s = this.schematics.get(id);
    if (!s || s.isDisposed) return;
    const version = ++s.buildVersion;
    await this.prepareResources(s.effectiveStructure());
    const mesh = await buildStructureMesh(s.effectiveStructure(), this.r.resources, this.r.meshOptions);
    if (s.isDisposed || version !== s.buildVersion || this.schematics.get(id) !== s) return; // a newer rebuild or a removal got there first
    s.replace(mesh, this.r.viewer.addMesh(mesh));
    this.r.viewer.invalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.schematics.keys()]) void this.removeSchematic(id);
  }
}

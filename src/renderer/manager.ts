import type { EntityRecord } from './entity';
import type { StructureMesh } from './mesher';
import type { NbtCompound, NbtValue } from './nbt';
import type { McStructure, PaletteEntry } from './structure';
import { restrictStructure } from './bounds';
import { Box3, Vec3 } from './camera';
import type { OverlayLines, ViewerObject } from './viewer';

// ------------------------------------------------------------------ helpers ---

const AIR = new Set(['air', 'cave_air', 'void_air', 'structure_void']);
export const isAirName = (name: string): boolean => AIR.has(name.replace(/^minecraft:/, ''));

/** `minecraft:stairs[weirdo_direction=1,upside_down_bit=false]` — states sorted by key, like the Java renderer prints them. */
export function blockString(entry: PaletteEntry): string {
  const keys = Object.keys(entry.states).sort();
  if (!keys.length) return entry.name;
  return `${entry.name}[${keys.map((k) => `${k.replace(/^minecraft:/, '')}=${entry.states[k]}`).join(',')}]`;
}

/** SNBT-like text of an NBT value (Bedrock NBT carries no width in this reader, so numbers have no suffix). */
export function toSnbt(v: NbtValue | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'bigint') return `${v}L`;
  if (typeof v === 'number') return String(v);
  if (ArrayBuffer.isView(v)) return `[${Array.from(v as unknown as ArrayLike<number | bigint>).join(',')}]`;
  if (Array.isArray(v)) return `[${v.map((x) => toSnbt(x)).join(',')}]`;
  return `{${Object.entries(v as NbtCompound).map(([k, x]) => `${/^[A-Za-z0-9_.+-]+$/.test(k) ? k : JSON.stringify(k)}:${toSnbt(x)}`).join(',')}}`;
}

// ------------------------------------------------------------ schematicWrapper ---

/** The block-access surface the Java renderer calls `schematicWrapper` (`get_block`, `get_block_string` …). */
export class StructureWrapper {
  private counts?: Record<string, number>;
  constructor(private s: McStructure) {}
  get_block(x: number, y: number, z: number): string | undefined {
    const b = this.s.blockAt(x, y, z);
    return b ? b.name : this.s.inBounds(x, y, z) ? 'minecraft:air' : undefined;
  }
  get_block_string(x: number, y: number, z: number): string | undefined {
    const b = this.s.blockAt(x, y, z);
    return b ? blockString(b) : this.s.inBounds(x, y, z) ? 'minecraft:air' : undefined;
  }
  /** Waterlogging (second layer) at a position. */
  get_liquid(x: number, y: number, z: number): string | undefined { return this.s.blockAt(x, y, z, 1)?.name; }
  getBlockEntitySnbt(x: number, y: number, z: number): string | undefined {
    const be = this.s.blockEntityAt(x, y, z);
    return be ? toSnbt(be) : undefined;
  }
  get_dimensions(): [number, number, number] { return [...this.s.size]; }
  readonly native = { countBlocksJson: (): string => JSON.stringify(this.countBlocks()) };
  /** Block id (with `minecraft:` prefix, no states) → count, air excluded. */
  countBlocks(): Record<string, number> {
    if (this.counts) return this.counts;
    const perPalette = new Int32Array(this.s.palette.length);
    const layer = this.s.layers[0];
    if (layer) for (let i = 0; i < layer.length; i++) { const p = layer[i]; if (p >= 0) perPalette[p]++; }
    const out: Record<string, number> = {};
    this.s.palette.forEach((p, i) => { if (perPalette[i] && !isAirName(p.name)) out[p.name] = (out[p.name] ?? 0) + perPalette[i]; });
    return (this.counts = out);
  }
}


// ------------------------------------------------------------------- group ---

type Obj3D = {
  name?: string; visible?: boolean; parent?: unknown; children?: Obj3D[];
  position?: { x: number; y: number; z: number }; scale?: { x: number; y: number; z: number };
  quaternion?: { x: number; y: number; z: number; w: number };
  geometry?: { attributes?: { position?: { array: ArrayLike<number> } }; getAttribute?: (n: string) => { array: ArrayLike<number> } | undefined; index?: { array: ArrayLike<number> } | null };
  material?: { color?: { r: number; g: number; b: number }; opacity?: number; transparent?: boolean; depthTest?: boolean } | { color?: { r: number; g: number; b: number }; opacity?: number; transparent?: boolean; depthTest?: boolean }[];
  isLineSegments?: boolean; isLine?: boolean; removeFromParent?: () => void;
};

const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/**
 * Stand-in for the Java renderer's `schematic.group` (a three.js Group). Objects with line geometry added to it
 * (`THREE.LineSegments`, e.g. the inspector's selection box) are drawn by the viewer; its local origin is the *centre* of
 * block (0, 0, 0) like in the Java renderer, so the same block coordinates select the same block in both editions.
 */
export class GroupShim {
  readonly isGroup = true;
  name = '';
  parent: unknown = null;
  readonly children: Obj3D[] = [];
  constructor(private owner: { visible: boolean }, private onChange: () => void) {}
  get visible(): boolean { return this.owner.visible; }
  set visible(v: boolean) { this.owner.visible = v; }
  add(...objects: Obj3D[]): this {
    for (const o of objects) {
      if (!o || o === (this as unknown)) continue;
      o.removeFromParent?.();
      o.parent = this;
      this.children.push(o);
    }
    this.onChange();
    return this;
  }
  remove(...objects: Obj3D[]): this {
    for (const o of objects) { const i = this.children.indexOf(o); if (i >= 0) { this.children.splice(i, 1); o.parent = null; } }
    this.onChange();
    return this;
  }
  clear(): this { return this.remove(...this.children); }
  getObjectByName(name: string): Obj3D | undefined {
    for (const c of this.children) { if (c.name === name) return c; const d = (c as unknown as GroupShim).getObjectByName?.(name); if (d) return d; }
    return undefined;
  }

  /** Line objects of this group as overlay data for the viewer. */
  overlays(): OverlayLines[] {
    const out: OverlayLines[] = [];
    for (const o of this.children) {
      if (o.visible === false || !(o.isLineSegments || o.isLine)) continue;
      const g = o.geometry, arr = g?.attributes?.position?.array ?? g?.getAttribute?.('position')?.array;
      if (!arr) continue;
      const positions = arr instanceof Float32Array ? arr : Float32Array.from(arr);
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const col = mat?.color ?? { r: 1, g: 1, b: 1 };
      const p = o.position ?? { x: 0, y: 0, z: 0 }, s = o.scale ?? { x: 1, y: 1, z: 1 }, q = o.quaternion ?? { x: 0, y: 0, z: 0, w: 1 };
      // column-major: T(0.5) · T(position) · R(quaternion) · S(scale)
      const { x, y, z, w } = q, x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
      const matrix = [
        (1 - (yy + zz)) * s.x, (xy + wz) * s.x, (xz - wy) * s.x, 0,
        (xy - wz) * s.y, (1 - (xx + zz)) * s.y, (yz + wx) * s.y, 0,
        (xz + wy) * s.z, (yz - wx) * s.z, (1 - (xx + yy)) * s.z, 0,
        p.x + 0.5, p.y + 0.5, p.z + 0.5, 1,
      ];
      const idx = g?.index?.array ?? null;
      out.push({
        positions, index: idx, matrix, color: [toSrgb(col.r), toSrgb(col.g), toSrgb(col.b)],
        opacity: mat?.transparent ? mat.opacity ?? 1 : 1, depthTest: mat?.depthTest !== false,
      });
    }
    return out;
  }
}

// ------------------------------------------------------------ LoadedStructure ---

export interface BlockEntityInfo { position: [number, number, number]; nbt: NbtCompound }
/** One block of {@link LoadedStructure.getAllBlocks}. */
export interface BlockListEntry { name: string; stateKey: string; x: number; y: number; z: number; properties: Record<string, string | number> }

/**
 * A structure shown in the viewer — the Bedrock counterpart of the Java renderer's loaded schematic object
 * (`id`, `group.visible`, `schematicWrapper`, `getBlockEntitiesMap()`, `getTightDimensions()`, `entityManager.records`).
 */
export class LoadedStructure {
  readonly schematicWrapper: StructureWrapper;
  readonly group: GroupShim;
  readonly entityManager: { records: EntityRecord[]; setVisible(visible: boolean): void; setShowDebug(show: boolean): void; readonly visible: boolean; readonly showDebug: boolean };
  private blockEntityCache?: Map<string, BlockEntityInfo>;
  private showEntities = true;
  private debugEntities = false;
  private disposed = false;
  private helperVisible = false;
  private helperLines: OverlayLines[] = [];
  /** Name shown in lists; defaults to the id. */
  name: string;
  /** @internal set by the manager: reports `schematicPropertyChanged`. */
  onPropertyChanged?: (property: string, value: unknown) => void;
  /** Rendering bounds, block coordinates, `min <= block < max`. Off until `enabled` (same shape as the Java renderer's). */
  readonly renderingBounds: { min: Vec3; max: Vec3; enabled?: boolean };
  /** The same bounds as plain numbers: `schematic.bounds.maxY = 10` hides everything from y = 10 up. */
  readonly bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; enabled: boolean; reset(): string; showHelper(visible?: boolean): string; apply(): string };

  constructor(readonly id: string, readonly structure: McStructure, public mesh: StructureMesh, private handle: ViewerObject) {
    this.schematicWrapper = new StructureWrapper(structure);
    this.name = id;
    const self = this;
    const [sx, sy, sz] = structure.size;
    this.renderingBounds = { min: new Vec3(0, 0, 0), max: new Vec3(sx, sy, sz), enabled: false };
    const rb = this.renderingBounds, axis = (k: 'x' | 'y' | 'z', end: 'min' | 'max') => ({
      get: () => rb[end][k],
      set: (v: number) => { rb[end][k] = v; self.applyBounds(); },
    });
    const b = {} as LoadedStructure['bounds'];
    for (const [name, k, end] of [['minX', 'x', 'min'], ['minY', 'y', 'min'], ['minZ', 'z', 'min'], ['maxX', 'x', 'max'], ['maxY', 'y', 'max'], ['maxZ', 'z', 'max']] as const)
      Object.defineProperty(b, name, { enumerable: true, ...axis(k, end) });
    Object.defineProperties(b, {
      enabled: { enumerable: true, get: () => !!rb.enabled, set: (v: boolean) => { rb.enabled = v; self.applyBounds(); self.showRenderingBoundsHelper(v); } },
      reset: { value: () => { self.resetRenderingBounds(); return 'Reset to full dimensions'; } },
      showHelper: { value: (visible = true) => { self.showRenderingBoundsHelper(visible); return `Helper ${visible ? 'shown' : 'hidden'}`; } },
      apply: { value: () => { self.applyBounds(); return 'Bounds applied'; } },
    });
    this.bounds = b;
    this.group = new GroupShim({ get visible() { return self.handle.visible; }, set visible(v: boolean) { self.handle.visible = v; } }, () => self.handle.invalidate());
    this.entityManager = {
      get records() { return self.mesh.entityRecords; },
      get visible() { return self.showEntities; },
      get showDebug() { return self.debugEntities; },
      /** Show or hide every entity / block entity of the structure. */
      setVisible(v: boolean) { self.showEntities = v; self.handle.entitiesVisible = v; },
      /** Accepted for parity with the Java renderer (it draws markers for entities the game does not render); nothing to show here. */
      setShowDebug(v: boolean) { self.debugEntities = v; self.handle.invalidate(); },
    };
  }

  /** @internal swap the GPU object after a rebuild */
  replace(mesh: StructureMesh, handle: ViewerObject): void { const vis = this.handle.visible; this.handle.dispose(); this.mesh = mesh; this.handle = handle; handle.visible = vis; handle.entitiesVisible = this.showEntities; this.blockEntityCache = undefined; }
  /** @internal */
  disposeGpu(): void { this.disposed = true; clearTimeout(this.boundsTimer); this.handle.dispose(); }

  get visible(): boolean { return this.handle.visible; }
  set visible(v: boolean) { this.handle.visible = v; this.onPropertyChanged?.('visible', v); }
  get isDisposed(): boolean { return this.disposed; }
  dispose(): void { if (!this.disposed) this.disposeGpu(); }
  /** `[min, max]` of the mesh in block coordinates. */
  get meshBoundingBox(): [number[], number[]] { return [[0, 0, 0], [...this.structure.size]]; }

  // ---- rendering bounds (slicing) ----
  /** Bumped by every rebuild request; a rebuild that finishes after a newer request started is dropped. */
  buildVersion = 0;
  private boundsTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * The structure the mesh is built from: the whole file, or — with the rendering bounds on — only the blocks inside them
   * (`min <= block < max`, like the Java renderer, which does not mesh the blocks outside; the cut then shows real faces).
   */
  effectiveStructure(): McStructure {
    const { min, max, enabled } = this.renderingBounds;
    return enabled ? restrictStructure(this.structure, [min.x, min.y, min.z], [max.x, max.y, max.z]) : this.structure;
  }
  /** Change the helper box now, rebuild the mesh a moment later (a slider moves the bounds many times a second). */
  private applyBounds(): void {
    const { min, max, enabled } = this.renderingBounds;
    this.refreshHelper();
    this.onPropertyChanged?.('renderingBounds', { min: min.toArray(), max: max.toArray(), enabled: !!enabled });
    clearTimeout(this.boundsTimer);
    this.boundsTimer = setTimeout(() => { this.boundsTimer = undefined; void this.onRebuild?.(); }, 40);
  }
  /** Set the bounds and turn them on. The helper box (wireframe of the visible region) shows unless `showHelper` is false. */
  setRenderingBounds(min: { x: number; y: number; z: number } | number[], max: { x: number; y: number; z: number } | number[], showHelper = true): void {
    const a = Array.isArray(min) ? min : [min.x, min.y, min.z], b = Array.isArray(max) ? max : [max.x, max.y, max.z];
    this.renderingBounds.min.set(a[0], a[1], a[2]);
    this.renderingBounds.max.set(b[0], b[1], b[2]);
    this.renderingBounds.enabled = true;
    this.applyBounds();
    if (showHelper) this.showRenderingBoundsHelper(true);
  }
  /** Full size again. The bounds stay on; the renderer's `resetRenderingBounds` turns them off. */
  resetRenderingBounds(): void {
    const [sx, sy, sz] = this.structure.size;
    this.renderingBounds.min.set(0, 0, 0);
    this.renderingBounds.max.set(sx, sy, sz);
    this.applyBounds();
  }
  showRenderingBoundsHelper(visible: boolean): void { this.helperVisible = visible; this.refreshHelper(); }
  private refreshHelper(): void {
    this.helperLines = [];
    if (this.helperVisible) {
      const { min, max } = this.renderingBounds, p: number[] = [];
      const c = (i: number) => [i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z];
      for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) p.push(...c(i), ...c(i | bit));
      this.helperLines = [{ positions: new Float32Array(p), matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], color: [1, 0.78, 0.2], opacity: 1, depthTest: false }];
    }
    this.handle.invalidate();
  }

  // ---- placement: structures sit at the origin, unrotated, at full size and opacity (read-only here) ----
  get position(): Vec3 { return new Vec3(0, 0, 0); }
  get rotation(): { x: number; y: number; z: number } { return { x: 0, y: 0, z: 0 }; }
  get scale(): Vec3 { return new Vec3(1, 1, 1); }
  get opacity(): number { return 1; }
  getWorldPosition(): Vec3 { return new Vec3(0, 0, 0); }

  /** Every non-air block with its states (what the Java renderer lists for a schematic); `filter` narrows it down. */
  getAllBlocks(filter?: (block: BlockListEntry) => boolean): BlockListEntry[] {
    const out: BlockListEntry[] = [];
    this.structure.forEachBlock((x, y, z, entry) => {
      if (isAirName(entry.name)) return;
      const block: BlockListEntry = { name: entry.name, stateKey: blockString(entry), x, y, z, properties: { ...entry.states } };
      if (!filter || filter(block)) out.push(block);
    });
    return out;
  }

  // ---- geometry questions the Java SchematicObject answers ----
  getDimensions(): [number, number, number] { return [...this.structure.size]; }
  getSchematicWrapper(): StructureWrapper { return this.schematicWrapper; }
  /** Minimum corner of the non-air blocks, or null when the structure is empty. */
  getTightBoundsMin(): [number, number, number] | null { return this.tight()?.[0] ?? null; }
  /** Maximum corner (the last non-air block, inclusive) or null. */
  getTightBoundsMax(): [number, number, number] | null { return this.tight()?.[1] ?? null; }
  private tight(): [[number, number, number], [number, number, number]] | null {
    const [sx, sy, sz] = this.structure.size, l = this.structure.layers[0];
    if (!l) return null;
    const air = this.structure.palette.map((p) => isAirName(p.name));
    const min: [number, number, number] = [sx, sy, sz], max: [number, number, number] = [-1, -1, -1];
    for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
      const p = l[(x * sy + y) * sz + z];
      if (p < 0 || air[p]) continue;
      if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
    }
    return max[0] < 0 ? null : [min, max];
  }
  /** Box around the non-air blocks (max is the far face of the last block). */
  getTightWorldBox(): Box3 {
    const t = this.tight();
    if (!t) return new Box3(new Vec3(0, 0, 0), new Vec3(...this.structure.size));
    return new Box3(new Vec3(...t[0]), new Vec3(t[1][0] + 1, t[1][1] + 1, t[1][2] + 1));
  }
  getSchematicCenter(): Vec3 { return this.getTightWorldBox().getCenter(); }
  getBoundingBox(): [number[], number[]] { const b = this.getTightWorldBox(); return [b.min.toArray(), b.max.toArray()]; }
  containsPosition(p: { x: number; y: number; z: number } | number[]): boolean {
    const [x, y, z] = Array.isArray(p) ? p : [p.x, p.y, p.z], [sx, sy, sz] = this.structure.size;
    return x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;
  }
  /** The block at a position as `name[states]`, or undefined outside the structure. */
  getBlock(position: { x: number; y: number; z: number } | number[]): string | undefined {
    const [x, y, z] = Array.isArray(position) ? position : [position.x, position.y, position.z];
    return this.schematicWrapper.get_block_string(x, y, z);
  }
  /** Rebuild the GPU mesh now (the renderer's `rebuildAllSchematics` does this for every structure), e.g. after the rendering bounds changed. */
  async rebuildMesh(): Promise<void> { clearTimeout(this.boundsTimer); this.boundsTimer = undefined; await this.onRebuild?.(); }
  /** @internal set by the manager */
  onRebuild?: () => Promise<void>;
  /** Wireframes the viewer draws on top of the structure (the rendering-bounds helper). */
  helperOverlays(): OverlayLines[] { return this.helperLines; }

  async getMeshes(): Promise<StructureMesh> { return this.mesh; }
  get size(): [number, number, number] { return [...this.structure.size]; }

  /** Key `"x,y,z"` → block entity (position + NBT). */
  getBlockEntitiesMap(): Map<string, BlockEntityInfo> {
    if (this.blockEntityCache) return this.blockEntityCache;
    const [, sy, sz] = this.structure.size;
    const map = new Map<string, BlockEntityInfo>();
    for (const [index, nbt] of this.structure.blockEntities) {
      const z = index % sz, y = Math.floor(index / sz) % sy, x = Math.floor(index / (sz * sy));
      map.set(`${x},${y},${z}`, { position: [x, y, z], nbt });
    }
    return (this.blockEntityCache = map);
  }

  /** Extent of the non-air blocks: `[sx, sy, sz]` of the tight bounding box (like the Java renderer). */
  getTightDimensions(): number[] {
    const [sx, sy, sz] = this.structure.size;
    let min = [sx, sy, sz], max = [-1, -1, -1];
    const air = this.structure.palette.map((p) => isAirName(p.name));
    const l = this.structure.layers[0];
    if (!l) return [0, 0, 0];
    for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
      const p = l[(x * sy + y) * sz + z];
      if (p < 0 || air[p]) continue;
      if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
    }
    return max[0] < 0 ? [0, 0, 0] : [max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1];
  }
}

import { DEFAULT_TINTS } from './face';
import { isBrarchive, readBrarchive } from './brarchive';
import { RawImage, decodeImage } from './image';
import { extractZipEntry, readZipDirectory } from './zip';

// ------------------------------------------------------------ JSON helper ---

/** Bedrock JSON files may contain comments and trailing commas. */
export function parseLooseJson(text: string): any {
  text = text.replace(/^\uFEFF/, '');
  try { return JSON.parse(text); } catch { /* fall through to the tolerant path */ }
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i];
      else if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; out += c; }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; }
    else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// ---------------------------------------------------------- ResourcePack ---

/** Which parts of a pack we care about. Everything else is skipped while loading. */
export const DEFAULT_ROOTS = [
  'textures/blocks/',
  'textures/terrain_texture.json',
  'textures/colormap/',
  'blocks.json',
  // entities & block entities
  'entity/',
  'models/',
  'render_controllers/',
  'animations/',
  'animation_controllers/',
  'textures/entity/',
  // textures used by entities that have no model of their own in the pack
  'textures/items/',
  'textures/item_texture.json',
  'textures/misc/',
  'textures/painting/',
  // HoloPrint's block shapes draw the candle flame from the particle sheet (`textures/particle/particles`)
  'textures/particle/',
  'textures/models/armor/',
  'textures/environment/',
  'textures/flipbook_textures.json',
];

/**
 * Ray-tracing / PBR companion files (`*_mers.tga`, `*_normal.tga`, `*_heightmap.tga`, `*.texture_set.json`). The viewer draws
 * flat colour, so they are skipped. `*_normal.png` is NOT in this list: `piston_top_normal.png` is a real block texture.
 */
export const PBR_EXTRAS = /(\.texture_set\.json|_(mers|heightmap)\.(tga|png)|_normal\.tga)$/i;

export interface LoadOptions {
  /** Path prefixes to keep. Pass `null` to keep every file. */
  roots?: string[] | null;
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.?\//, '');
/** The game keeps a pack's archives under `__brarchive/` (`__brarchive/textures/blocks.brarchive` holds `textures/blocks/*`). */
const unarchive = (p: string) => p.replace(/^__brarchive\//, '');

/**
 * A virtual file system holding the files of one Bedrock resource pack.
 *
 * Sources understood by the loaders:
 *  • a normal resource-pack zip / .mcpack (files at `textures/blocks/*.png` …)
 *  • a zip that contains `.brarchive` files, as found in the game's install
 *    folder — `textures/blocks.brarchive` is exposed as `textures/blocks/*`
 *  • a single `.brarchive`
 *  • a plain map of path → bytes
 */
export class ResourcePack {
  readonly files = new Map<string, Uint8Array>();
  /** Folder / file name the pack came from (diagnostics only). */
  name = '';

  add(path: string, data: Uint8Array): void { this.files.set(norm(path), data); }
  /** Every file path in the pack, whether or not its contents are in memory yet. */
  keys(): Iterable<string> { return this.files.keys(); }
  has(path: string): boolean { return this.files.has(norm(path)); }
  get(path: string): Uint8Array | undefined { return this.files.get(norm(path)); }
  json(path: string): any | undefined {
    const b = this.get(path);
    return b ? parseLooseJson(new TextDecoder().decode(b)) : undefined;
  }

  static fromFiles(files: Record<string, Uint8Array> | Map<string, Uint8Array>): ResourcePack {
    const p = new ResourcePack();
    for (const [k, v] of files instanceof Map ? files : Object.entries(files)) p.add(k, v);
    return p;
  }

  /** `prefix` is where the archive's entries live, e.g. `textures/blocks/`. */
  static fromBrarchive(data: Uint8Array | ArrayBuffer, prefix = '', opts: LoadOptions = {}): ResourcePack {
    const p = new ResourcePack();
    p.addBrarchive(data instanceof Uint8Array ? data : new Uint8Array(data), prefix, rootsOf(opts));
    return p;
  }

  private addBrarchive(bytes: Uint8Array, prefix: string, roots: string[] | null): void {
    if (prefix && !prefix.endsWith('/')) prefix += '/';
    for (const e of readBrarchive(bytes)) {
      const path = norm(prefix + e.name);
      if ((!roots || roots.some((r) => path.startsWith(r))) && !PBR_EXTRAS.test(path)) this.files.set(path, e.data);
    }
  }

  static async fromZip(data: Uint8Array | ArrayBuffer, opts: LoadOptions = {}): Promise<ResourcePack> {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    const roots = rootsOf(opts);
    const pack = new ResourcePack();
    const entries = readZipDirectory(buf).filter((e) => !e.name.endsWith('/'));

    // Packs are sometimes zipped with one extra top-level folder.
    const marker = entries.find((e) => /(^|\/)(manifest\.json|textures\/terrain_texture\.json|(__brarchive\/)?textures\.brarchive)$/.test(e.name));
    let root = '';
    if (marker) {
      const m = marker.name.match(/^(.*?)(manifest\.json|textures\/terrain_texture\.json|(?:__brarchive\/)?textures\.brarchive)$/);
      root = m ? m[1] : '';
    }

    for (const e of entries) {
      if (!e.name.startsWith(root)) continue;
      const rel = unarchive(norm(e.name.slice(root.length)));
      if (rel.endsWith('.brarchive')) {
        const prefix = rel.slice(0, -'.brarchive'.length) + '/';
        const relevant = !roots || roots.some((r) => r.startsWith(prefix) || prefix.startsWith(r));
        if (relevant) {
          const bytes = await extractZipEntry(buf, e);
          if (isBrarchive(bytes)) pack.addBrarchive(bytes, prefix, roots);
        }
      } else if ((!roots || roots.some((r) => rel.startsWith(r))) && !PBR_EXTRAS.test(rel)) {
        pack.files.set(rel, await extractZipEntry(buf, e));
      }
    }
    return pack;
  }


  /**
   * A zip that holds SEVERAL packs side by side (a copy of the game's whole `resource_packs` folder:
   * `vanilla/`, `vanilla_1.xx/` …). Every folder that looks like a pack root becomes its own pack, ordered so
   * that the base `vanilla` pack comes first and later versions override earlier ones.
   * A zip with a single pack root yields exactly what {@link fromZip} yields.
   */
  static async fromZipMulti(data: Uint8Array | ArrayBuffer, opts: LoadOptions = {}): Promise<ResourcePack[]> {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    const roots = rootsOf(opts);
    const entries = readZipDirectory(buf).filter((e) => !e.name.endsWith('/'));
    const MARK = /^(.*?)(manifest\.json|textures\/terrain_texture\.json|(?:__brarchive\/)?(?:textures\.brarchive|textures\/blocks\.brarchive|entity\.brarchive)|blocks\.json)$/;
    const found = new Set<string>();
    for (const e of entries) { const m = e.name.match(MARK); if (m) found.add(m[1]); }
    // keep the shallowest roots only (a pack's own subfolders can contain a `manifest.json` too)
    const packRoots = [...found].filter((r) => ![...found].some((o) => o !== r && o !== '' && r.startsWith(o)));
    if (packRoots.length <= 1) return [await ResourcePack.fromZip(buf, opts)];

    const packs: { root: string; order: number[]; pack: ResourcePack }[] = [];
    for (const root of packRoots) {
      const pack = new ResourcePack();
      pack.name = root.replace(/\/$/, '').split('/').pop() || root;
      for (const e of entries) {
        if (!e.name.startsWith(root)) continue;
        const rel = unarchive(norm(e.name.slice(root.length)));
        if (rel.endsWith('.brarchive')) {
          const prefix = rel.slice(0, -'.brarchive'.length) + '/';
          if (!roots || roots.some((r) => r.startsWith(prefix) || prefix.startsWith(r))) {
            const bytes = await extractZipEntry(buf, e);
            if (isBrarchive(bytes)) pack.addBrarchive(bytes, prefix, roots);
          }
        } else if ((!roots || roots.some((r) => rel.startsWith(r))) && !PBR_EXTRAS.test(rel)) pack.files.set(rel, await extractZipEntry(buf, e));
      }
      packs.push({ root, order: packOrder(pack.name, pack), pack });
    }
    packs.sort((a, b) => { for (let i = 0; i < 3; i++) if (a.order[i] !== b.order[i]) return a.order[i] - b.order[i]; return a.root < b.root ? -1 : 1; });
    return packs.map((p) => p.pack);
  }

  /** Auto-detect zip vs brarchive. */
  static async fromBytes(data: Uint8Array | ArrayBuffer, opts: LoadOptions = {}): Promise<ResourcePack> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (isBrarchive(bytes)) return ResourcePack.fromBrarchive(bytes, '', opts);
    return ResourcePack.fromZip(bytes, opts);
  }
}

/** Sort key of a pack folder: `vanilla` first, then `vanilla_1.14`, `vanilla_1.16.100` … by version, other packs last. */
export function packOrder(name: string, pack: ResourcePack): number[] {
  const m = name.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (/^vanilla$/i.test(name) || /^vanilla_?base$/i.test(name)) return [0, 0, 0];
  if (/vanilla/i.test(name) && m) return [parseInt(m[1], 10) || 0, parseInt(m[2] ?? '0', 10), parseInt(m[3] ?? '0', 10)];
  try {
    const v = pack.json('manifest.json')?.header?.version;
    if (Array.isArray(v)) return [1000 + (v[0] ?? 0), v[1] ?? 0, v[2] ?? 0];
  } catch { /* ignore */ }
  return [1000, 0, 0];
}

/** Where to find a pack whose files are downloaded on demand, see {@link RemoteResourcePack}. */
export interface RemotePackSource {
  /** URL that each listed path is appended to, or several mirrors tried in order. */
  baseUrl: string | string[];
  /** The pack's file paths, or the URL of a JSON file holding them (an array, or an object with a `files` array). */
  files: string[] | string;
}

/**
 * A resource pack whose file list is known up front but whose contents are downloaded on demand, for example the game's own
 * resources as Mojang publishes them (`https://cdn.jsdelivr.net/gh/Mojang/bedrock-samples@<tag>/resource_pack/`).
 *
 * Reading a listed file that has not been downloaded yet returns `undefined` and queues the file; {@link fetchPending}
 * downloads the queue. The renderer runs that loop before it builds a mesh, so a structure only downloads the files it
 * actually uses.
 */
export class RemoteResourcePack extends ResourcePack {
  private readonly listing: Set<string>;
  private readonly pending = new Set<string>();
  /** Files no mirror has (404), or that kept failing: never asked for again. */
  private readonly failed = new Set<string>();
  /** How many downloads of a file failed for a passing reason (rate limits, network): it is retried by a later fetch. */
  private readonly attempts = new Map<string, number>();
  /** Downloads under way, so a caller that needs a file another caller is already fetching waits for it. */
  private readonly inflight = new Map<string, Promise<boolean>>();
  /** Mirrors, each ending in `/`, tried in order for every file. */
  readonly baseUrls: string[];
  /** Called while files download: how many of the current batch have finished. */
  onProgress?: (done: number, total: number) => void;

  constructor(
    baseUrl: string | string[],
    paths: Iterable<string>,
    private readonly fetcher: (url: string) => Promise<Response> = (url) => fetch(url),
  ) {
    super();
    this.baseUrls = (Array.isArray(baseUrl) ? baseUrl : [baseUrl]).map((u) => (u.endsWith('/') ? u : u + '/'));
    this.listing = new Set([...paths].map(norm).filter((p) => !PBR_EXTRAS.test(p)));
    this.name = this.baseUrls[0] ?? '';
  }

  /** Reads the file list from `source.files` (an array, or the URL of a JSON listing). */
  static async from(source: RemotePackSource, fetcher?: (url: string) => Promise<Response>): Promise<RemoteResourcePack> {
    const get = fetcher ?? ((url: string) => fetch(url));
    let files = source.files;
    if (typeof files === 'string') {
      const response = await get(files);
      if (!response.ok) throw new Error(`resource pack listing request failed (HTTP ${response.status}): ${files}`);
      const listing = await response.json();
      files = Array.isArray(listing) ? listing : listing?.files;
      if (!Array.isArray(files)) throw new Error(`resource pack listing has no file list: ${source.files}`);
    }
    return new RemoteResourcePack(source.baseUrl, files as string[], get);
  }

  override keys(): Iterable<string> { return this.listing; }
  override has(path: string): boolean { return this.listing.has(norm(path)); }
  override get(path: string): Uint8Array | undefined {
    const p = norm(path);
    const bytes = this.files.get(p);
    if (!bytes && this.listing.has(p) && !this.failed.has(p)) this.pending.add(p);
    return bytes;
  }

  /** Files asked for and not downloaded yet. */
  get pendingCount(): number { return this.pending.size; }

  /** Queues every listed file that `filter` accepts and downloads the queue (e.g. all definition files up front). */
  async prefetch(filter: (path: string) => boolean, concurrency?: number): Promise<number> {
    for (const p of this.listing) if (!this.files.has(p) && !this.failed.has(p) && filter(p)) this.pending.add(p);
    return this.fetchPending(concurrency);
  }

  /**
   * Downloads the queued files, `concurrency` at a time, trying each mirror in turn (a CDN can refuse a request now and then,
   * so the first mirror gets a second attempt), and waits for downloads that other callers started. Returns how many files
   * arrived meanwhile; a file no mirror could deliver is not retried.
   */
  async fetchPending(concurrency = 16): Promise<number> {
    const others = [...this.inflight.values()];
    const queue = [...this.pending].filter((p) => !this.inflight.has(p));
    this.pending.clear();
    const total = queue.length;
    let arrived = 0;
    let done = 0;
    // CDNs refuse requests now and then (403 / 429 when many arrive at once): every mirror is tried, and the whole round is
    // repeated after a growing pause. A 404 means no mirror has the file.
    const PAUSES = [0, 400, 1200, 3000];
    const download = async (path: string): Promise<Uint8Array> => {
      const rel = path.split('/').map(encodeURIComponent).join('/');
      let last: unknown;
      for (const pause of PAUSES) {
        if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
        for (const base of this.baseUrls) {
          try {
            const response = await this.fetcher(base + rel);
            if (response.ok) return new Uint8Array(await response.arrayBuffer());
            last = new Error(`HTTP ${response.status}`);
            if (response.status === 404) throw Object.assign(last as Error, { missing: true });
          } catch (err) {
            if ((err as { missing?: boolean }).missing) throw err;
            last = err;
          }
        }
      }
      throw last;
    };
    // every queued file counts as under way from now on, including those still waiting for a free worker
    const settle = new Map<string, (ok: boolean) => void>();
    for (const path of queue) this.inflight.set(path, new Promise<boolean>((resolve) => settle.set(path, resolve)));
    const worker = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        let ok = false;
        try {
          this.files.set(path, await download(path));
          ok = true;
          arrived++;
        } catch (err) {
          // a missing file is never asked for again; a passing failure gets two more chances in later fetches
          const tries = (this.attempts.get(path) ?? 0) + 1;
          this.attempts.set(path, tries);
          if ((err as { missing?: boolean }).missing || tries >= 3) this.failed.add(path);
          console.warn(`mcstructure-renderer: cannot download ${path}:`, err);
        } finally {
          this.inflight.delete(path);
          settle.get(path)!(ok);
        }
        this.onProgress?.(++done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    for (const ok of await Promise.all(others)) if (ok) arrived++;
    return arrived;
  }
}

function rootsOf(o: LoadOptions): string[] | null {
  return o.roots === null ? null : o.roots ?? DEFAULT_ROOTS;
}

// -------------------------------------------------------- ResourceStack ---

export interface TerrainEntry {
  /** Variant paths (extension-less), index = block-data variant. */
  paths: string[];
}

export type BlocksJsonEntry = { textures?: string | Record<string, string> } & Record<string, unknown>;

/**
 * Memoizes a value derived from a stack. The value is rebuilt whenever the stack's packs change (its `version`), for example
 * after a pack is added or after a remote pack downloads more files.
 */
export function perStack<T>(build: (stack: ResourceStack) => T): (stack: ResourceStack) => T {
  const cache = new WeakMap<ResourceStack, { version: number; value: T }>();
  return (stack) => {
    const hit = cache.get(stack);
    if (hit && hit.version === stack.version) return hit.value;
    const value = build(stack);
    cache.set(stack, { version: stack.version, value });
    return value;
  };
}

/** An ordered list of packs; later packs override earlier ones. */
export class ResourceStack {
  readonly packs: ResourcePack[];
  private terrainCache?: Map<string, TerrainEntry>;
  private blocksCache?: Map<string, BlocksJsonEntry>;
  private imageCache = new Map<string, RawImage | null>();
  private nestedCache?: Map<string, string>;
  /** Bumped whenever the packs change; caches built on top of the stack (HoloPrint's terrain lookup …) compare it. */
  version = 0;

  constructor(packs: ResourcePack[] = []) { this.packs = packs; }

  /** Forget everything derived from the packs. Call after changing `packs` in place. */
  invalidate(): void {
    this.terrainCache = undefined;
    this.blocksCache = undefined;
    this.nestedCache = undefined;
    this.imageCache.clear();
    this.version++;
  }

  /** Replace the packs (override order = array order). */
  setPacks(packs: ResourcePack[]): void {
    this.packs.splice(0, this.packs.length, ...packs);
    this.invalidate();
  }

  /** Add a zip / .mcpack / .brarchive / multi-pack zip; every pack found is pushed in override order. */
  async addBytes(data: Uint8Array | ArrayBuffer, opts: LoadOptions = {}): Promise<ResourcePack[]> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const packs = isBrarchive(bytes) ? [ResourcePack.fromBrarchive(bytes, '', opts)] : await ResourcePack.fromZipMulti(bytes, opts);
    for (const p of packs) this.push(p);
    return packs;
  }

  push(pack: ResourcePack): void {
    this.packs.push(pack);
    this.invalidate();
  }

  /** Whether any pack downloads its files on demand. */
  get hasRemote(): boolean {
    return this.packs.some((p) => p instanceof RemoteResourcePack);
  }

  /**
   * Downloads every file that a remote pack was asked for but did not have yet. Returns how many files arrived; when any did,
   * everything derived from the packs is recomputed.
   */
  async fetchPending(): Promise<number> {
    let arrived = 0;
    for (const p of this.packs) if (p instanceof RemoteResourcePack) arrived += await p.fetchPending();
    if (arrived) this.invalidate();
    return arrived;
  }

  /** File name (no extension) → extension-less path for every image below `textures/blocks/` (`deepslate/deepslate_top` …). */
  private get nestedBlockTextures(): Map<string, string> {
    if (this.nestedCache) return this.nestedCache;
    const out = new Map<string, string>();
    for (const pack of this.packs) {
      for (const k of pack.keys()) {
        if (!k.startsWith('textures/blocks/') || !/\.(png|tga)$/.test(k)) continue;
        const noExt = k.replace(/\.(png|tga)$/, '');
        const base = noExt.slice(noExt.lastIndexOf('/') + 1);
        if (noExt.length > 'textures/blocks/'.length + base.length) out.set(base, noExt); // nested files only
      }
    }
    return (this.nestedCache = out);
  }

  /** All file paths starting with `prefix`, across every pack. */
  paths(prefix: string): string[] {
    const out = new Set<string>();
    for (const p of this.packs) for (const k of p.keys()) if (k.startsWith(prefix)) out.add(k);
    return [...out];
  }

  parseJson(bytes: Uint8Array): any {
    return parseLooseJson(new TextDecoder().decode(bytes));
  }

  /**
   * Every pack's version of a file, oldest pack first. Definition files (render controllers, animations, geometry …) are merged
   * by identifier across packs in the game, not replaced by file: a newer `iron_golem.render_controllers.json` may only hold
   * the crack overlay while the base controller still lives in an older pack's file of the same name.
   */
  getAll(path: string): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const p of this.packs) { const f = p.get(path); if (f) out.push(f); }
    return out;
  }

  get(path: string): Uint8Array | undefined {
    for (let i = this.packs.length - 1; i >= 0; i--) {
      const f = this.packs[i].get(path);
      if (f) return f;
    }
    return undefined;
  }

  get terrain(): Map<string, TerrainEntry> {
    if (this.terrainCache) return this.terrainCache;
    const out = new Map<string, TerrainEntry>();
    for (const pack of this.packs) {
      let j: any;
      try { j = pack.json('textures/terrain_texture.json'); } catch (err) { console.warn(`mcstructure-renderer: unreadable terrain_texture.json in ${pack.name || 'pack'}:`, err); continue; }
      const td = j?.texture_data;
      if (!td) continue;
      for (const [key, val] of Object.entries<any>(td)) out.set(key, { paths: flattenTexturePaths(val?.textures) });
    }
    return (this.terrainCache = out);
  }

  /** Optional modern `blocks.json` (block id → textures). */
  get blocksJson(): Map<string, BlocksJsonEntry> {
    if (this.blocksCache) return this.blocksCache;
    const out = new Map<string, BlocksJsonEntry>();
    for (const pack of this.packs) {
      let j: any;
      try { j = pack.json('blocks.json'); } catch (err) { console.warn(`mcstructure-renderer: unreadable blocks.json in ${pack.name || 'pack'}:`, err); continue; }
      if (!j) continue;
      for (const [k, v] of Object.entries<any>(j)) {
        if (k === 'format_version' || typeof v !== 'object' || v === null) continue;
        // merged field by field, as the game does: a pack on top that only sets `isotropic` keeps the textures from below
        const id = k.replace(/^minecraft:/, '');
        out.set(id, { ...out.get(id), ...v });
      }
    }
    return (this.blocksCache = out);
  }

  /** Resolve `key`, `key#variant` or `@textures/blocks/file` to an extension-less path. */
  resolveTexturePath(ref: string): string | undefined {
    ref = ref.replace(MASK_SUFFIX, ''); // `grass_side|mask:grass` is `grass_side` with the tint baked in by buildAtlas
    if (ref.startsWith('@')) return ref.slice(1);
    const hash = ref.indexOf('#');
    const key = hash < 0 ? ref : ref.slice(0, hash);
    const variant = hash < 0 ? 0 : parseInt(ref.slice(hash + 1), 10) || 0;
    const entry = this.terrain.get(key);
    if (entry && entry.paths.length) return entry.paths[Math.min(variant, entry.paths.length - 1)];
    // fall back to a file with the same name in textures/blocks (a pack that only replaces images has no terrain_texture.json)
    const direct = `textures/blocks/${key}`;
    if (this.hasImage(direct)) return direct;
    const nested = this.nestedBlockTextures.get(key);
    return nested && this.hasImage(nested) ? nested : undefined;
  }

  /** Does the pack contain the image behind this texture ref (`key`, `key#variant` or `@path`)? */
  hasTexture(ref: string): boolean {
    const p = this.resolveTexturePath(ref);
    return !!p && this.hasImage(p);
  }

  private hasImage(path: string): boolean {
    return !!(this.get(path + '.png') || this.get(path + '.tga'));
  }

  async loadImage(path: string): Promise<RawImage | null> {
    if (this.imageCache.has(path)) return this.imageCache.get(path)!;
    const bytes = this.get(path + '.png') ?? this.get(path + '.tga');
    let img: RawImage | null = null;
    if (bytes) {
      try { img = await decodeImage(bytes); } catch (err) { console.warn(`mcstructure-renderer: cannot decode ${path}:`, err); }
    }
    this.imageCache.set(path, img);
    return img;
  }
}

function flattenTexturePaths(t: any): string[] {
  if (t == null) return [];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.map((x) => flattenTexturePaths(x)[0]).filter((x): x is string => !!x);
  if (typeof t === 'object') {
    if (typeof t.path === 'string') return [t.path];
    if (Array.isArray(t.variations)) return flattenTexturePaths(t.variations);
  }
  return [];
}

// ----------------------------------------------------------------- Atlas ---

export interface Atlas {
  width: number;
  height: number;
  /** RGBA8, row 0 = top. */
  data: Uint8Array;
  /** Edge length (px) of the largest tile. Tiles keep their native size (non-square entity textures too), so 16 px, 32 px and 128 px textures can share an atlas. */
  tile: number;
  /** ref → normalised [u0, v0, u1, v1] of the *whole* tile (v = 0 at the image top). */
  rects: Map<string, [number, number, number, number]>;
  /** Texture refs that could not be found (a checkerboard is drawn instead). */
  missing: string[];
}

export const MISSING_TEXTURE = 'missing';

const nextPow2 = (n: number) => { let p = 1; while (p < n) p <<= 1; return p; };

/**
 * Pack the given texture refs into one power-of-two atlas (shelf packing, largest first).
 * Every texture keeps its native resolution — a 32x resource pack next to a 128 px chest texture does not blow the
 * small ones up. Animated (flip-book) strips are cropped to their first square frame.
 */
/**
 * A texture ref may end in `|mask:<tint>` (`grass`, `foliage`, `water` or a `0xRRGGBB` number): the texture's alpha channel is
 * a tint mask — the tint multiplies the RGB where alpha is set, and the result is opaque. Bedrock's `grass_side` is such a
 * texture (dirt colours under alpha 0, grey grass fringe at alpha 255); the same idea as `MaskedColorMul` in Flint.
 */
const MASK_SUFFIX = /\|mask:.*$/;

function bakeMaskedTint(img: RawImage, tint: number): RawImage {
  const out = new Uint8Array(img.data.length);
  const t = [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255];
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(img.data[i + c] * (1 - a + (a * t[c]) / 255));
    out[i + 3] = 255;
  }
  return { ...img, data: out };
}

export async function buildAtlas(stack: ResourceStack, refs: Iterable<string>, tints: { grass: number; foliage: number; water: number } = DEFAULT_TINTS): Promise<Atlas> {
  const wanted = [MISSING_TEXTURE, ...new Set([...refs].filter((r) => r !== MISSING_TEXTURE))];
  const missing: string[] = [];
  interface Item { ref: string; img: RawImage | null; w: number; h: number }
  const items: Item[] = [];
  let tile = 16;
  for (const ref of wanted) {
    let img: RawImage | null = null;
    if (ref !== MISSING_TEXTURE) {
      const mm = /^(.*)\|mask:(.+)$/.exec(ref);
      let path = stack.resolveTexturePath(ref);
      let mask = mm ? mm[2] : null;
      // a pack without the overlay texture: the item-form texture is already coloured
      if (!path && mask && /(^|\/)grass_side$/.test(mm![1])) { path = stack.resolveTexturePath('grass_side_carried'); mask = null; }
      img = path ? await stack.loadImage(path) : null;
      if (img && mask) img = bakeMaskedTint(img, mask === 'grass' ? tints.grass : mask === 'foliage' ? tints.foliage : mask === 'water' ? tints.water : Number(mask));
      if (!img) missing.push(ref);
    }
    // animated (flip-book) strips are taller than wide by a whole number of frames: keep the first square frame. Everything
    // else keeps its full size: entity textures used by block shapes are often 64×32 (signs, books) and their UVs cover it all
    let w = 16, h = 16;
    if (img) {
      w = Math.max(1, img.width); h = Math.max(1, img.height);
      if (h > w && h % w === 0) h = w;
      tile = Math.max(tile, w, h);
    }
    items.push({ ref, img, w, h });
  }

  const PAD = 1;
  const order = [...items].sort((a, b) => b.h - a.h || b.w - a.w || (a.ref < b.ref ? -1 : 1));
  const area = items.reduce((n, it) => n + (it.w + 2 * PAD) * (it.h + 2 * PAD), 0);
  const width = nextPow2(Math.max(...order.map((it) => it.w + 2 * PAD), Math.ceil(Math.sqrt(area * 1.1))));
  const place = new Map<string, [number, number]>();
  let x = 0, y = 0, rowH = 0;
  for (const it of order) {
    const cw = it.w + 2 * PAD, ch = it.h + 2 * PAD;
    if (x + cw > width) { x = 0; y += rowH; rowH = 0; }
    place.set(it.ref, [x, y]);
    x += cw; rowH = Math.max(rowH, ch);
  }
  const height = nextPow2(y + rowH);
  const data = new Uint8Array(width * height * 4);
  const rects = new Map<string, [number, number, number, number]>();

  for (const it of items) {
    const [tx, ty] = place.get(it.ref)!;
    const { w, h } = it;
    for (let yy = -PAD; yy < h + PAD; yy++) {
      for (let xx = -PAD; xx < w + PAD; xx++) {
        const sx = Math.min(w - 1, Math.max(0, xx)), sy = Math.min(h - 1, Math.max(0, yy));
        let r: number, g: number, b: number, a: number;
        if (it.img) {
          const o = (sy * it.img.width + sx) * 4;
          r = it.img.data[o]; g = it.img.data[o + 1]; b = it.img.data[o + 2]; a = it.img.data[o + 3];
        } else if ((sx < w >> 1) !== (sy < h >> 1)) { r = 0; g = 0; b = 0; a = 255; } else { r = 248; g = 0; b = 248; a = 255; }
        const o = ((ty + PAD + yy) * width + (tx + PAD + xx)) * 4;
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
      }
    }
    const u0 = (tx + PAD) / width, v0 = (ty + PAD) / height;
    rects.set(it.ref, [u0, v0, u0 + w / width, v0 + h / height]);
  }

  return { width, height, data, tile, rects, missing };
}

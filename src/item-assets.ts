import { ItemIconRenderer, NO_ICON, type IconImage } from './item-icons.js';
import { itemTexturePath } from './renderer/entity-builtin.js';
import type { ResourceStack } from './renderer/resources.js';

export interface ItemAssetsOptions {
  iconBaseUrl?: string;
  /** Edge length of block icons in pixels (default 64). */
  iconSize?: number;
}
type StackLike = ResourceStack | { resources: ResourceStack };

/**
 * Item and block icons from the resource pack(s) as object URLs (Bedrock counterpart of the Java renderer's ItemAssets).
 * Blocks get inventory-style icons (`ItemIconRenderer`): a 3D view of the block, or its flat item picture where the
 * inventory shows one; items get their item texture.
 */
export class ItemAssets {
  private cache = new Map<string, Promise<string | null>>();
  private urls = new Set<string>();
  private disposed = false;
  private stack: ResourceStack;
  private icons: ItemIconRenderer;
  /** Block ids asked for in the same tick, drawn together in one mesh build. */
  private batch?: { ids: Set<string>; done: Promise<Map<string, IconImage>> };

  constructor(source: StackLike, private options: ItemAssetsOptions = {}) {
    this.stack = 'resources' in source ? source.resources : source;
    this.icons = new ItemIconRenderer(this.stack, options.iconSize ?? 64);
  }

  private blockIcon(name: string): Promise<IconImage | undefined> {
    if (!this.batch) {
      const ids = new Set<string>();
      const done = new Promise<Map<string, IconImage>>((resolve, reject) =>
        setTimeout(() => { this.batch = undefined; this.icons.render([...ids]).then(resolve, reject); }, 0));
      this.batch = { ids, done };
    }
    this.batch.ids.add(name);
    return this.batch.done.then((icons) => icons.get(name));
  }

  texture(id: string): Promise<string | null> {
    if (this.disposed) return Promise.resolve(null);
    let pending = this.cache.get(id);
    if (!pending) { pending = this.load(id).catch(() => null); this.cache.set(id, pending); }
    return pending;
  }

  private async load(id: string): Promise<string | null> {
    if (!/^(minecraft:)?[a-z0-9_]+$/.test(id)) return null;
    const name = id.replace(/^minecraft:/, '');
    if (this.stack.blocksJson.has(name) && !NO_ICON.test(name)) {
      const icon = await this.blockIcon(name);
      if (icon) return this.url(await toPng(icon));
    }
    const find = () => this.iconPaths(name).map((p) => this.stack.get(p + '.png')).find(Boolean);
    let bytes = find();
    // a pack that downloads on demand has just queued the candidates: fetch them and look again
    if (!bytes && this.stack.hasRemote && (await this.stack.fetchPending())) bytes = find();
    if (!bytes) return null;
    return this.url(await firstFrame(bytes));
  }

  /** Candidate texture paths for an item or block id: item icon first, then what `blocks.json` / the terrain table say. */
  private iconPaths(name: string): string[] {
    const out: string[] = [];
    const add = (p?: string | null) => { if (p && !out.includes(p)) out.push(p); };
    // Bedrock icon files use the older naming (`apple_golden`, `beef_cooked`): try the word-reversed and de-prefixed names too
    for (const n of itemNameVariants(name)) add(itemTexturePath(this.stack, n));
    const entry = this.stack.blocksJson.get(name);
    const t = entry?.textures;
    const refs = typeof t === 'string' ? [t] : t ? ['up', 'side', 'north', 'south', 'east', 'west', 'down'].map((k) => (t as Record<string, string>)[k]).filter(Boolean) : [];
    for (const r of refs) add(this.stack.resolveTexturePath(r));
    add(this.stack.resolveTexturePath(name));
    // a few Bedrock block ids use another terrain key than their own name
    for (const alt of [`${name}_top`, `${name}_side`, name.replace(/^(.+)_(planks|log|wood)$/, '$2_$1')]) add(this.stack.resolveTexturePath(alt));
    return out;
  }

  private url(blob: Blob): string | null {
    if (this.disposed) return null;
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  decorate(element: HTMLElement, id: string): void {
    element.dataset.itemId = id;
    element.replaceChildren();
    const placeholder = document.createElement('span');
    placeholder.className = 'missing-item';
    placeholder.textContent = '?';
    element.append(placeholder);
    this.texture(id).then((url) => {
      if (this.disposed || !url || element.dataset.itemId !== id) return;
      const img = document.createElement('img');
      img.src = url; img.alt = ''; img.draggable = false;
      element.replaceChildren(img);
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    this.cache.clear();
  }
}

/** Items whose Bedrock icon key follows no naming pattern. */
const ITEM_ALIASES: Record<string, string> = {
  redstone: 'redstone_dust',
  book: 'book_normal', writable_book: 'book_writable', written_book: 'book_written', enchanted_book: 'book_enchanted',
  potion: 'potion_bottle_drinkable', splash_potion: 'potion_bottle_splash', lingering_potion: 'potion_bottle_lingering',
  glass_bottle: 'potion_bottle_empty',
};

/** `golden_apple` → `apple_golden`, `enchanted_golden_apple` → `apple_golden`, `cooked_beef` → `beef_cooked` … */
export function itemNameVariants(name: string): string[] {
  const out = [name];
  if (ITEM_ALIASES[name]) out.push(ITEM_ALIASES[name]);
  const base = name.replace(/^enchanted_/, '');
  if (base !== name) out.push(base);
  const parts = base.split('_');
  if (parts.length === 2) out.push(`${parts[1]}_${parts[0]}`);
  if (parts.length === 3) out.push(`${parts[2]}_${parts[0]}_${parts[1]}`, `${parts[1]}_${parts[2]}_${parts[0]}`, `${parts[2]}_${parts[1]}_${parts[0]}`);
  const m = /^(raw|cooked)_(.+)$/.exec(base);
  if (m) out.push(`${m[2]}_${m[1]}`);
  if (/^(beef|porkchop|chicken|mutton|rabbit|cod|salmon)$/.test(base)) out.push(`${base}_raw`);
  return out;
}

/** RGBA pixels as a PNG blob. */
async function toPng(icon: IconImage): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = icon.width;
  canvas.height = icon.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(icon.data), icon.width, icon.height), 0, 0);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

/** A flip-book strip (16 × 16n) is cropped to its first square frame; other images are returned as they are. */
async function firstFrame(png: Uint8Array): Promise<Blob> {
  const blob = new Blob([png as BlobPart], { type: 'image/png' });
  if (typeof createImageBitmap !== 'function') return blob;
  const bmp = await createImageBitmap(blob);
  if (bmp.height <= bmp.width) { bmp.close(); return blob; }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = bmp.width;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

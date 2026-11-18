import { MaterialsCounter } from './materials-client.js';
import { isBlueprintFile } from './materials.js';
import { abortError, isAbortError } from './renderer/mesher.js';
import type { LoadedStructure } from './renderer/manager.js';
import type { McStructureRenderer } from './renderer/renderer.js';
import type { MaterialsResult } from './types.js';

/** The structure object the loader hands back (the Bedrock counterpart of the Java renderer's loaded schematic). */
export type LoadedSchematic = LoadedStructure;

export interface BlueprintResult extends MaterialsResult {
  id: string;
  filename: string;
  schematic: LoadedSchematic;
  dimensions: number[];
  totalBlocks: number;
}
export interface MaterialCounter {
  count(buffer: ArrayBuffer): Promise<MaterialsResult>;
  dispose(): void;
}
export interface BlueprintLoaderOptions {
  counter?: MaterialCounter;
  /** Runs after the new scene is built and before the old scene is removed (with `chunkLoading`: before the new one streams in). */
  beforeReplace?: () => void;
}

/** Third argument of `load` (same in both libraries). */
export interface LoadHooks {
  /**
   * The new structure is in the scene. With the renderer's `chunkLoading` this comes before its first chunk (size known:
   * aim the camera here); without it, right before the load resolves.
   */
  onStart?(schematic: LoadedSchematic): void;
  /** With `chunkLoading`: `done` of `total` chunks are on screen. */
  onChunk?(done: number, total: number): void;
  /** Abort to cancel the load (it rejects with an `AbortError`). */
  signal?: AbortSignal;
}
export { isAbortError };

/**
 * Serializes loads; parse/build failures leave the previous blueprint intact. Bedrock edition: `.mcstructure` files.
 * With the renderer's `chunkLoading` the previous blueprint stays until the new one has parsed and starts streaming in, and a new
 * `load` cancels the one still streaming (it rejects with an `AbortError`), so switching quickly never waits for chunks
 * nobody looks at any more.
 */
export class BlueprintLoader {
  private counter: MaterialCounter;
  private serial = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private namespace = `workshop-${Math.random().toString(36).slice(2)}`;
  private streaming?: AbortController;

  constructor(private renderer: McStructureRenderer, private options: BlueprintLoaderOptions = {}) {
    this.counter = options.counter ?? new MaterialsCounter();
  }

  load(buffer: ArrayBuffer, filename: string, hooks: LoadHooks = {}): Promise<BlueprintResult> {
    if (this.disposed) return Promise.reject(new Error('蓝图加载器已关闭'));
    if (!isBlueprintFile(filename)) return Promise.reject(new Error('不支持的蓝图格式'));
    // Snapshot before queuing so caller mutations cannot corrupt an upcoming load.
    const copy = buffer.slice(0);
    const stop = new AbortController();
    if (this.chunked) { this.streaming?.abort(); this.streaming = stop; }
    const onAbort = () => stop.abort();
    if (hooks.signal?.aborted) stop.abort();
    else hooks.signal?.addEventListener('abort', onAbort, { once: true });
    const task = this.queue.then(() => this.loadOne(copy, filename, hooks, stop.signal)).finally(() => {
      hooks.signal?.removeEventListener('abort', onAbort);
      if (this.streaming === stop) this.streaming = undefined;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  private get chunked(): boolean { return !!this.renderer.options.chunkLoading; }

  async loadFile(file: File): Promise<BlueprintResult> { return this.load(await file.arrayBuffer(), file.name); }

  async loadUrl(url: string | URL, init?: RequestInit): Promise<BlueprintResult> {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`蓝图请求失败（HTTP ${response.status}）`);
    const pathname = String(url).split(/[?#]/)[0];
    const filename = decodeURIComponent(pathname.split('/').pop() || 'blueprint.mcstructure');
    return this.load(await response.arrayBuffer(), filename);
  }

  private assertOpen(): void { if (this.disposed) throw new Error('蓝图加载器已关闭'); }

  private async loadOne(buffer: ArrayBuffer, filename: string, hooks: LoadHooks, signal: AbortSignal): Promise<BlueprintResult> {
    this.assertOpen();
    if (signal.aborted) throw abortError();
    const manager = this.renderer.schematicManager;
    const id = `${this.namespace}-${++this.serial}`;
    const chunked = this.chunked;
    const onProgress = (e: { id: string; done: number; total: number }) => { if (e.id === id) hooks.onChunk?.(e.done, e.total); };
    try {
      const result = await this.counter.count(buffer);
      this.assertOpen();
      if (signal.aborted) throw abortError();
      // with chunkLoading the old one makes room once the new one has parsed and is about to stream in
      const onStart = (s: LoadedSchematic) => {
        this.options.beforeReplace?.();
        for (const old of manager.getAllSchematics()) if (old.id !== id) void manager.removeSchematic(old.id);
        hooks.onStart?.(s);
      };
      if (chunked) this.renderer.eventEmitter.on('schematicChunkProgress', onProgress);
      await manager.loadSchematic(id, buffer, { focused: false }, chunked ? { signal, onStart } : undefined);
      this.assertOpen();
      if (signal.aborted) throw abortError();
      const schematic = manager.getAllSchematics().find((s) => s.id === id);
      if (!schematic) throw new Error('蓝图加载后未找到场景');
      if (!chunked) {
        schematic.group.visible = false;
        await schematic.getMeshes();
        this.assertOpen();
        this.options.beforeReplace?.();
        for (const old of manager.getAllSchematics()) if (old.id !== id) await manager.removeSchematic(old.id);
        schematic.group.visible = true;
        hooks.onStart?.(schematic);
      }
      const dimensions = schematic.getTightDimensions();
      this.renderer.invalidate();
      return { ...result, id, filename, schematic, dimensions, totalBlocks: result.materials.reduce((n, m) => n + m.count, 0) };
    } catch (error) {
      try { await manager.removeSchematic(id); } catch { /* Preserve the original failure. */ }
      throw signal.aborted && !this.disposed ? abortError() : error;
    } finally {
      this.renderer.eventEmitter.off('schematicChunkProgress', onProgress);
    }
  }

  /** Stops counting immediately; await completion before disposing the renderer. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.streaming?.abort();
    this.counter.dispose();
    await this.queue;
  }
}

import { countMcstructureMaterials } from './materials.js';
import type { MaterialsResult } from './types.js';

/**
 * Counts blocks of a `.mcstructure`. The Java renderer does this in a Worker; counting a Bedrock structure is a single
 * pass over its palette indices, so here it runs on the calling thread (asynchronously) and never blocks for long.
 * The constructor keeps the Java signature; the first argument (a worker factory) is accepted and ignored.
 */
export class MaterialsCounter {
  private disposed = false;
  constructor(_createWorker?: unknown, private timeoutMs = 120000) {}
  async count(buffer: ArrayBuffer): Promise<MaterialsResult> {
    if (this.disposed) throw new Error('the material counter has been disposed');
    const copy = buffer.slice(0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('material counting timed out; try again')), this.timeoutMs); });
    try { return await Promise.race([countMcstructureMaterials(copy), timeout]); } finally { clearTimeout(timer); }
  }
  reset(_error?: unknown): void { /* no worker to restart */ }
  dispose(): void { this.disposed = true; }
}

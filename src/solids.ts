import type { McStructureRenderer } from './renderer/renderer.js';
import { collisionHeight } from './collision.js';

/**
 * The loaded structure as a collision grid for a host-driven first-person camera (docs/UNIFIED_API.md, "First person").
 * Cell `(i, j, k)` spans `origin + [i, i + 1] × [j, j + 1] × [k, k + 1]` in world space; `height` is 0 (walk through),
 * 0.5 (bottom half: slabs, stairs) or 1 (full block); cells outside `[min, max)` are empty. Same shape in both renderers.
 */
export interface Solids {
  origin: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  height(i: number, j: number, k: number): number;
}

/** The first structure as a collision grid (structures sit at the origin, one block per unit), or null when nothing is loaded. */
export function solidsOf(renderer: McStructureRenderer): Solids | null {
  const s = renderer.schematicManager?.getAllSchematics()[0];
  if (!s) return null;
  const size = s.size;
  const cache = new Map<number, number>();
  return {
    origin: [0, 0, 0],
    min: [0, 0, 0],
    max: [size[0], size[1], size[2]],
    height(i, j, k) {
      if (i < 0 || j < 0 || k < 0 || i >= size[0] || j >= size[1] || k >= size[2]) return 0;
      const key = (j * size[2] + k) * size[0] + i;
      let h = cache.get(key);
      if (h === undefined) {
        const state = s.schematicWrapper.get_block_string(i, j, k) ?? '';
        h = state ? collisionHeight(state) : 0;
        cache.set(key, h);
      }
      return h;
    },
  };
}

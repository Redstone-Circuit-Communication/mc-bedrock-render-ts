import { buildMcStructure } from '../../src/renderer/structure';

const hash = (x: number, y: number, z: number) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const height = (x: number, z: number) => 30 + 18 * Math.sin(x / 9) * Math.cos(z / 7) + 6 * hash(x, 0, z);

/** Deterministic terrain-like structure (stone, dirt, grass, glass, water, caves, stairs, fences, panes) used by the mesher tests and benchmark. */
export function benchStructure(size: [number, number, number] = [48, 64, 48]): Uint8Array {
  return buildMcStructure({
    size,
    blockAt: (x, y, z) => {
      const h = height(x, z);
      if (y > h) {
        if (y !== Math.floor(h) + 1) return null;
        if (hash(x, y, z) < 0.03) return { name: 'minecraft:oak_fence' };
        if (hash(x, 1, z) < 0.05) return { name: 'minecraft:oak_stairs', states: { weirdo_direction: Math.floor(hash(x, 2, z) * 4), upside_down_bit: 0 } };
        if (hash(x, 3, z) < 0.03) return { name: 'minecraft:glass_pane' };
        return null;
      }
      if (hash((x / 6) | 0, (y / 6) | 0, (z / 6) | 0) < 0.16 && y < h - 3) return null;
      if (y > h - 1) return { name: 'minecraft:gravel' };
      if (y > h - 4) return { name: 'minecraft:dirt' };
      return hash(x, y, z) < 0.03 ? { name: 'minecraft:glass' } : hash(x, y, z) < 0.06 ? { name: 'minecraft:water', states: { liquid_depth: 0 } } : { name: 'minecraft:stone' };
    },
  });
}

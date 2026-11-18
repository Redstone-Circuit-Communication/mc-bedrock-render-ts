import { entityInstancesFromStructure } from './entity';
import type { NbtCompound } from './nbt';
import { McStructure } from './structure';

type V3 = [number, number, number];

/**
 * A copy of `structure` in which everything outside `[min, max)` (block coordinates, `max` exclusive) is gone: blocks, liquid
 * layers, block entities and entities. Meshing the copy gives the rendering bounds of the Java renderer, where blocks outside
 * are not meshed at all, so the faces the cut uncovers are drawn (hiding triangles of the full mesh would leave the cut open).
 * The size and origin stay the same, so coordinates do not move.
 */
export function restrictStructure(structure: McStructure, min: V3, max: V3): McStructure {
  const [sx, sy, sz] = structure.size;
  const layers = structure.layers.map((layer) => {
    const out = new Int32Array(layer);
    for (let x = 0; x < sx; x++) {
      const xin = x >= min[0] && x < max[0];
      for (let y = 0; y < sy; y++) {
        const yin = xin && y >= min[1] && y < max[1];
        const base = (x * sy + y) * sz;
        for (let z = 0; z < sz; z++) if (!(yin && z >= min[2] && z < max[2])) out[base + z] = -1;
      }
    }
    return out;
  });
  const blockEntities = new Map<number, NbtCompound>();
  for (const [index, nbt] of structure.blockEntities) {
    const z = index % sz, y = Math.floor(index / sz) % sy, x = Math.floor(index / (sz * sy));
    if (x >= min[0] && x < max[0] && y >= min[1] && y < max[1] && z >= min[2] && z < max[2]) blockEntities.set(index, nbt);
  }
  // an entity counts for the block it stands in; the instances know how this file stores positions (world or structure-relative)
  const keep = new Set<NbtCompound>();
  for (const inst of entityInstancesFromStructure(structure)) {
    const [x, y, z] = inst.pos.map(Math.floor);
    if (x >= min[0] && x < max[0] && y >= min[1] && y < max[1] && z >= min[2] && z < max[2]) if (inst.nbt) keep.add(inst.nbt);
  }
  const entities = structure.entities.filter((e) => keep.has(e));
  return new McStructure(structure.size, structure.origin, structure.formatVersion, structure.palette, layers, blockEntities, entities);
}

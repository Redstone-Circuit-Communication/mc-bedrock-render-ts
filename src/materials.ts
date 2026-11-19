import type { Material, MaterialsResult } from './types.js';
import { isAirName } from './renderer/manager.js';
import { loadMcStructure } from './renderer/structure.js';
import type { McStructure } from './renderer/structure.js';

const AIR_LIKE = /^(minecraft:)?(air|cave_air|void_air|structure_void|light_block|barrier|allow|deny|border_block)$/;

/** Block id → count of a parsed structure (layer 0, air excluded), sorted by count then id. */
export function countStructureMaterials(structure: McStructure): MaterialsResult {
  const perPalette = new Int32Array(structure.palette.length);
  const layer = structure.layers[0];
  if (layer) for (let i = 0; i < layer.length; i++) { const p = layer[i]; if (p >= 0) perPalette[p]++; }
  const counts = new Map<string, number>();
  structure.palette.forEach((p, i) => {
    if (!perPalette[i] || isAirName(p.name) || AIR_LIKE.test(p.name)) return;
    counts.set(p.name, (counts.get(p.name) ?? 0) + perPalette[i]);
  });
  const materials: Material[] = [...counts].map(([id, count]) => ({ id, count, stacks: Math.floor(count / 64), remainder: count % 64 }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return { regionCount: 1, materials };
}

/** Bedrock counterpart of the Java renderer's `countLitematicMaterials`. */
export async function countMcstructureMaterials(input: ArrayBuffer | Uint8Array): Promise<MaterialsResult> {
  return countStructureMaterials(await loadMcStructure(input));
}

/**
 * Count the blocks of a blueprint without caring which edition it is for: host code that serves both renderers calls this
 * (the same name and arguments exist in `@rsw/mc-java-render-ts`'s `countMaterials`) instead of `countLitematicMaterials` /
 * `countMcstructureMaterials`. Here only `.mcstructure` files are blueprints.
 */
export async function countMaterials(input: ArrayBuffer | Uint8Array, filename: string): Promise<MaterialsResult> {
  if (!/\.mcstructure$/i.test(filename)) throw new Error('the material preview supports .mcstructure files');
  return countMcstructureMaterials(input);
}

/** File extensions this renderer takes as blueprints (the Java renderer's list is `.litematic .schem .schematic .nbt`). */
export const BLUEPRINT_EXTENSIONS = ['.mcstructure'] as const;
/** Is `filename` a blueprint this renderer can load? */
export const isBlueprintFile = (filename: string): boolean => /\.mcstructure$/i.test(filename);

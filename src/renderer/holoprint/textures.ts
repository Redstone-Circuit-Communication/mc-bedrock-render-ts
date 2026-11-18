/**
 * Texture references of HoloPrint faces → the renderer's texture refs (`key#variant` or `@textures/…`) and tints.
 *
 * The lookup follows HoloPrint's TextureAtlas (`#getTerrainTextureKeyFromTextureReference`, `#getTexturePathAndTint`) and the
 * blocks.json patches of neoHoloprintDB, reading blocks.json / terrain_texture.json from the renderer's resource stack, so
 * texture packs stacked on top still win. Differences on purpose:
 *   - biome-tinted textures keep the renderer's tints (configurable through `MeshOptions.tints`) instead of HoloPrint's
 *     pre-coloured "carried" (inventory) textures: grass, ferns, leaves, vines, lily pads, sugar cane;
 *   - `grass_side` keeps its alpha channel as a tint mask (`grass_side|mask:grass`, see FLINT.md).
 */
import type { Tint } from '../models';
import type { ResourceStack } from '../resources';
import type { HpTextureRef } from './geo';

const SIDE_FACES = ['west', 'east', 'north', 'south'];

/** Blocks missing from blocks.json under their flattened name (from neoHoloprintDB / HoloPrint's textureAtlasMappings). */
export const BLOCKS_DOT_JSON_PATCHES: Record<string, string> = {
  grass_block: 'grass', trip_wire: 'tripWire', sea_lantern: 'seaLantern',
  oak_planks: 'planks.0', spruce_planks: 'planks.1', birch_planks: 'planks.2', jungle_planks: 'planks.3', acacia_planks: 'planks.4', dark_oak_planks: 'planks.5',
  unknown: 'info_update',
  normal_stone_double_slab: 'normal_stone_slab', smooth_quartz_double_slab: 'smooth_quartz_slab', mossy_stone_brick_double_slab: 'mossy_stone_brick_slab',
  cut_sandstone_double_slab: 'cut_sandstone_slab', cut_red_sandstone_double_slab: 'cut_red_sandstone_slab',
};

/**
 * Blocks drawn with their "carried" textures (as HoloPrint does). Leaves, grass, ferns, vines and lily pads are *not* here:
 * the renderer tints their world textures itself.
 */
export const CARRIED_TEXTURE_BLOCKS = new Set(['bush', 'firefly_bush', 'open_eyeblossom', 'light_block', ...Array.from({ length: 16 }, (_, i) => `light_block_${i}`)]);

export interface ResolvedTexture {
  tex: string;
  tint: Tint;
}

/** Biome tints by texture file name (the world textures are grey; the game colours them by biome). */
function biomeTint(path: string, blockName: string): { tint: Tint; mask?: string } {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (base === 'grass_side') return { tint: null, mask: 'grass' };
  if (/^(grass_top|tallgrass|fern|reeds|double_plant_(grass|fern)_(top|bottom)|tall_grass_(top|bottom)|large_fern_(top|bottom)|grass_block_top)$/.test(base)) return { tint: 'grass' };
  if (/^(vine|vines)$/.test(base)) return { tint: 'foliage' };
  if (base === 'waterlily' || base === 'lily_pad') return { tint: 0x208030 };
  if (/^(leaves_(oak|jungle|acacia|big_oak|spruce|birch)(_opaque)?|mangrove_leaves|(oak|jungle|acacia|dark_oak|spruce|birch)_leaves(_opaque)?)$/.test(base)) {
    const wood = /spruce/.test(base) ? 'spruce' : /birch/.test(base) ? 'birch' : '';
    return { tint: wood === 'spruce' ? 0x619961 : wood === 'birch' ? 0x80a755 : 'foliage' };
  }
  if (/^(melon_stem|pumpkin_stem)(_disconnected|_connected)?$/.test(base) && !/_carried$/.test(blockName)) return { tint: 0xe0c71c };
  return { tint: null };
}

export class HoloTextures {
  private terrainRaw?: Map<string, any>;
  private terrainVersion = -1;

  constructor(private stack: ResourceStack) {}

  /** terrain_texture.json entries merged across the stack (later packs win), unflattened (overlay/tint colours kept). */
  private get terrain(): Map<string, any> {
    if (this.terrainRaw && this.terrainVersion === this.stack.version) return this.terrainRaw;
    this.terrainVersion = this.stack.version;
    const out = new Map<string, any>();
    for (const pack of this.stack.packs) {
      let j: any;
      try { j = pack.json('textures/terrain_texture.json'); } catch { continue; }
      for (const [k, v] of Object.entries<any>(j?.texture_data ?? {})) out.set(k, v);
    }
    return (this.terrainRaw = out);
  }

  /** The terrain_texture.json key for a block face, as HoloPrint looks it up in blocks.json. */
  terrainKey(blockName: string, textureFace: string): { key: string; variant?: number } | null {
    const blocks = this.stack.blocksJson;
    let name = blockName;
    let variant: number | undefined;
    if (!blocks.has(name) && name in BLOCKS_DOT_JSON_PATCHES) {
      const p = BLOCKS_DOT_JSON_PATCHES[name];
      if (p.includes('.')) { variant = +p.split('.')[1]; name = p.split('.')[0]; } else name = p;
    }
    const entry: any = blocks.get(name);
    if (!entry) return null;
    if (textureFace.startsWith('carried') && entry.carried_textures) {
      const ct = entry.carried_textures;
      if (textureFace === 'carried') return typeof ct === 'string' ? { key: ct, variant } : null;
      const face = textureFace.slice(8);
      const key = ct[face] ?? (SIDE_FACES.includes(face) ? ct.side : undefined);
      return key ? { key, variant } : null;
    }
    let keys = CARRIED_TEXTURE_BLOCKS.has(name) ? entry.carried_textures : undefined;
    keys ??= entry.textures ?? entry.carried_textures;
    if (!keys) return null;
    if (typeof keys === 'string') return { key: keys, variant };
    const key = keys[textureFace] ?? (SIDE_FACES.includes(textureFace) ? keys.side : undefined) ?? keys[Object.keys(keys)[0]];
    return key ? { key, variant } : null;
  }

  /** Extension-less path and tint colour of a terrain key + variant (`overlay_color` / `tint_color`), like HoloPrint. */
  private terrainPath(key: string, variant: number): { path?: string; color?: string } {
    let t = this.terrain.get(key)?.textures;
    if (t == null) return {};
    if (Array.isArray(t)) t = t.length === 1 ? t[0] : t[variant in t ? variant : 0];
    if (t && typeof t === 'object' && Array.isArray(t.variations)) t = t.variations[0];
    if (typeof t === 'string') return { path: t };
    if (t && typeof t === 'object') return { path: t.path, color: t.overlay_color ?? t.tint_color };
    return {};
  }

  resolve(ref: HpTextureRef): ResolvedTexture | null {
    let tint: Tint = ref.tint ? ((Math.round(ref.tint[0] * 255) << 16) | (Math.round(ref.tint[1] * 255) << 8) | Math.round(ref.tint[2] * 255)) : null;
    let path: string | undefined;
    let colour: string | undefined;
    if (ref.texture_path_override) {
      path = ref.texture_path_override.replace(/\.(png|tga)$/i, '');
    } else {
      let key: string | undefined, variant = ref.variant ?? -1;
      if (ref.terrain_texture_override) key = ref.terrain_texture_override;
      else if (ref.block_name && ref.texture_face) {
        const k = this.terrainKey(ref.block_name, ref.texture_face);
        if (!k) return null;
        key = k.key;
        if (k.variant !== undefined) variant = k.variant;
      }
      if (!key) return null;
      const r = this.terrainPath(key, variant < 0 ? 0 : variant);
      path = r.path?.replace(/\.(png|tga)$/i, '');
      colour = r.color;
      // a key that terrain_texture.json does not know: let the stack try `textures/blocks/<key>` (image-only packs)
      if (!path) path = this.stack.resolveTexturePath(key);
      if (!path) return null;
    }
    const bt = biomeTint(path, ref.block_name ?? '');
    if (tint == null && colour && /^#[0-9a-f]{6}/i.test(colour)) tint = parseInt(colour.slice(1, 7), 16);
    if (tint == null) tint = bt.tint;
    return { tex: `@${path}${bt.mask ? `|mask:${bt.mask}` : ''}`, tint: bt.mask ? null : tint };
  }
}

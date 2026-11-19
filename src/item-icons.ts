/**
 * Inventory-style item icons, drawn without WebGL so they work in a browser and in Node alike.
 *
 * Every block id gets one of two kinds of icon, as in the game's inventory:
 *  - flat: blocks that have an item texture of their own (doors, signs, repeaters, redstone dust …) use it; thin and
 *    cross-shaped blocks (plants, rails, ladders, torches, panes …) use their block texture;
 *  - solid: everything else is meshed with this package's mesher (slabs are half a block, pistons have their head, chests use
 *    their entity model) and drawn the way the inventory shows it: orthographic, turned 45° about the vertical axis and
 *    tilted 30° forward, so the top, the south face (left) and the east face (right) are visible. Blocks with a facing are
 *    turned the way the inventory shows them (pistons up, furnaces facing south …).
 *
 * Icons are rendered at twice their size and halved, weighting by alpha, so edges are smooth without darkening.
 * `tools/item-icons.mts` writes the whole set as PNG files; `ItemAssets` draws them one by one on demand.
 */
import { HoloTextures } from './renderer/holoprint/textures.js';
import { holoGeometry } from './renderer/holoprint/model.js';
import { buildStructureMesh } from './renderer/mesher.js';
import type { ResourceStack } from './renderer/resources.js';
import { buildMcStructure, parseMcStructure } from './renderer/structure.js';

/** RGBA pixels, row 0 at the top. */
export interface IconImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
type Img = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

/** Ids that have no icon at all (technical blocks, fluids, fire, portals …). */
export const NO_ICON = /^(air|structure_void|light_block(_\d+)?|moving_block|piston_arm_collision|sticky_piston_arm_collision|unknown|info_update2?|reserved6|client_request_placeholder_block|border_block|allow|deny|camera|chemical_heat|portal|end_gateway|end_portal|fire|soul_fire|water|flowing_water|lava|flowing_lava|bubble_column)$/;
/** Blocks with an item texture of their own whose name differs from the block id. */
const ITEM_TEXTURE: Record<string, string[]> = {
  redstone_wire: ['textures/items/redstone_dust'],
  unpowered_repeater: ['textures/items/repeater'], powered_repeater: ['textures/items/repeater'],
  unpowered_comparator: ['textures/items/comparator'], powered_comparator: ['textures/items/comparator'],
  wooden_door: ['textures/items/door_wood'], iron_door: ['textures/items/door_iron'], dark_oak_door: ['textures/items/door_dark_oak'],
  trip_wire: ['textures/items/string'], reeds: ['textures/items/reeds'], frame: ['textures/items/item_frame'], glow_frame: ['textures/items/glow_item_frame'],
  bed: ['textures/items/bed_red'], standing_sign: ['textures/items/sign'], wall_sign: ['textures/items/sign'],
  cake: ['textures/items/cake'], candle_cake: ['textures/items/cake'],
};
/** Thin, cross-shaped blocks: a flat picture in the inventory, using the block's own texture. */
const FLAT_SHAPES = new Set(['cross_texture', 'double_plant', 'sunflower']);
const FLAT_NAMES = /(^rail$|_rail$|ladder|vine|torch$|tripwire_hook|iron_bars|_pane$|^glass_pane$|^web$|lily_pad|waterlily|sapling|dead_bush|^fern$|large_fern|tall_grass|short_grass|^tallgrass$|seagrass|sea_pickle|kelp|hanging_roots|spore_blossom|glow_lichen|sculk_vein|pointed_dripstone|sulfur_spike|nether_sprouts|crimson_roots|warped_roots|twisting_vines|weeping_vines|cave_vines|chain$|lantern$|bell$)/;
/** Turned the way the inventory shows them. */
const ICON_STATES: Record<string, Record<string, string | number>> = {
  piston: { facing_direction: 1 }, sticky_piston: { facing_direction: 1 },
  observer: { 'minecraft:facing_direction': 'south' },
  dispenser: { facing_direction: 3 }, dropper: { facing_direction: 3 }, crafter: { orientation: 'south_up' },
  barrel: { facing_direction: 1 },
};
const SOUTH = /^(lit_)?(furnace|blast_furnace|smoker)$|chest$|^lectern$|carved_pumpkin|lit_pumpkin|^loom$|beehive|bee_nest|^stonecutter_block$|^grindstone$|^anvil$|chipped_anvil|damaged_anvil|^decorated_pot$|^chiseled_bookshelf$|^vault$|^trial_spawner$|^campfire$/;
export const iconStates = (id: string): Record<string, string | number> => ICON_STATES[id] ?? (SOUTH.test(id) ? { 'minecraft:cardinal_direction': 'south' } : {});
/**
 * Blocks that give off light are drawn without face shading, so a lit redstone lamp stays clearly different from an unlit one
 * at small sizes.
 */
const GLOWING = /^(lit_redstone_lamp|glowstone|sea_lantern|shroomlight|(ochre|verdant|pearlescent)_froglight|lit_pumpkin|lit_redstone_ore|lit_deepslate_redstone_ore|beacon|magma|crying_obsidian|respawn_anchor)$/;

interface Tri { x: number[]; y: number[]; z: number[]; u: number[]; v: number[]; c: number[][]; img: Img | null; blend: boolean }
type Layer = { positions: Float32Array; uvs: Float32Array; colors: Float32Array; indices: Uint32Array };

/** Renders icons from a resource stack. `size` is the edge length of an icon in pixels. */
export class ItemIconRenderer {
  private readonly geo = holoGeometry();
  private readonly ss = 2;
  private textures?: HoloTextures;
  private texturesVersion = -1;

  constructor(private readonly stack: ResourceStack, readonly size = 64) {}

  private get tex(): HoloTextures {
    if (!this.textures || this.texturesVersion !== this.stack.version) {
      this.textures = new HoloTextures(this.stack);
      this.texturesVersion = this.stack.version;
    }
    return this.textures;
  }

  /** The flat picture for a block id, or `null` when the block is drawn solid. */
  async flatImage(id: string): Promise<Img | null> {
    const candidates = [
      ...(ITEM_TEXTURE[id] ?? []),
      `textures/items/${id}`,
      ...(/_door$/.test(id) ? [`textures/items/door_${id.replace(/_door$/, '')}`] : []),
      ...(/_(standing|wall|hanging)_sign$/.test(id) ? [`textures/items/sign_${id.replace(/_(standing|wall|hanging)_sign$/, '').replace('dark_oak', 'darkoak')}`] : []),
      ...(/candle$/.test(id) ? [`textures/items/candles/${id}`] : []),
    ];
    for (const path of candidates) {
      const img = await this.stack.loadImage(path);
      if (img) return img as Img;
    }
    if (FLAT_SHAPES.has(this.geo.shapeOf(id)) || FLAT_NAMES.test(id)) {
      for (const face of ['north', 'up', 'south']) {
        const r = this.tex.resolve({ uv: [0, 0], uv_size: [1, 1], block_name: id, texture_face: face, variant: -1 } as never) as { tex?: string } | null;
        const path = r?.tex?.replace(/^@/, '').split('|')[0];
        const img = path ? await this.stack.loadImage(path) : null;
        if (img) return img as Img;
      }
    }
    return null;
  }

  /**
   * Icons for several block ids at once (solid blocks share one mesh build). Ids without an icon are left out of the result.
   * With a resource pack that downloads on demand, the files the icons need are fetched first.
   */
  async render(ids: string[]): Promise<Map<string, IconImage>> {
    const wanted = [...new Set(ids.map((id) => id.replace(/^minecraft:/, '')))].filter((id) => !NO_ICON.test(id));
    for (let round = 0; round < 8; round++) {
      const out = await this.renderOnce(wanted);
      if (!this.stack.hasRemote || (await this.stack.fetchPending()) === 0) return out;
    }
    return this.renderOnce(wanted);
  }

  private async renderOnce(ids: string[]): Promise<Map<string, IconImage>> {
    const out = new Map<string, IconImage>();
    const solid: string[] = [];
    for (const id of ids) {
      const flat = await this.flatImage(id);
      if (flat) out.set(id, this.sprite(flat));
      else solid.push(id);
    }
    if (!solid.length) return out;
    // the solid blocks stand two cells apart in one structure, meshed once and split by cell
    const cols = Math.ceil(Math.sqrt(solid.length));
    const cell = new Map<string, string>();
    solid.forEach((id, i) => cell.set(`${(i % cols) * 2},${Math.floor(i / cols) * 2}`, id));
    const structure = parseMcStructure(buildMcStructure({
      size: [cols * 2, 2, Math.ceil(solid.length / cols) * 2],
      blockAt: (x, y, z) => {
        const id = y === 0 ? cell.get(`${x},${z}`) : undefined;
        return id ? ({ name: `minecraft:${id}`, states: iconStates(id) } as never) : null;
      },
    }));
    const mesh = await buildStructureMesh(structure, this.stack, { backend: 'ts', entities: true } as never);
    const tris = new Map<string, Tri[]>();
    const collect = (layer: Layer, img: Img, blend: boolean) => {
      const P = layer.positions, U = layer.uvs, C = layer.colors, I = layer.indices;
      for (let k = 0; k < I.length; k += 3) {
        const vs = [I[k], I[k + 1], I[k + 2]];
        const cx = (P[vs[0] * 3] + P[vs[1] * 3] + P[vs[2] * 3]) / 3, cz = (P[vs[0] * 3 + 2] + P[vs[1] * 3 + 2] + P[vs[2] * 3 + 2]) / 3;
        const gx = Math.floor((cx + 0.5) / 2) * 2, gz = Math.floor((cz + 0.5) / 2) * 2;
        const id = cell.get(`${gx},${gz}`);
        if (!id) continue;
        const pr = vs.map((v) => this.project([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], gx, gz));
        const glow = GLOWING.test(id);
        (tris.get(id) ?? tris.set(id, []).get(id)!).push({
          x: pr.map((p) => p[0]), y: pr.map((p) => p[1]), z: pr.map((p) => p[2]),
          u: vs.map((v) => U[v * 2]), v: vs.map((v) => U[v * 2 + 1]),
          c: vs.map((v) => (glow ? [1, 1, 1, C[v * 4 + 3]] : [C[v * 4], C[v * 4 + 1], C[v * 4 + 2], C[v * 4 + 3]])),
          img, blend,
        });
      }
    };
    const atlas = mesh.atlas as unknown as Img;
    collect(mesh.solid as unknown as Layer, atlas, false);
    collect(mesh.translucent as unknown as Layer, atlas, true);
    for (const b of mesh.entityBatches) {
      collect(b.solid as unknown as Layer, b.image as unknown as Img, false);
      collect(b.translucent as unknown as Layer, b.image as unknown as Img, true);
    }
    for (const id of solid) {
      const t = tris.get(id);
      if (!t?.length) continue;
      const icon = this.rasterize(t);
      if (icon.data.some((v, i) => i % 4 === 3 && v > 8)) out.set(id, icon);
    }
    return out;
  }

  /** A grey block without texture, for ids that have no icon. */
  unknownIcon(): IconImage {
    const quad = (a: number[], b: number[], c: number[], d: number[], shade: number): Tri[] => [[a, b, c], [a, c, d]].map((tri) => {
      const pr = tri.map((p) => this.project(p, 0, 0));
      return { x: pr.map((p) => p[0]), y: pr.map((p) => p[1]), z: pr.map((p) => p[2]), u: [0, 0, 0], v: [0, 0, 0], c: tri.map(() => [0.62 * shade, 0.64 * shade, 0.68 * shade, 1]), img: null, blend: false };
    });
    return this.rasterize([
      ...quad([0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0], 1),
      ...quad([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], 0.8),
      ...quad([1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1], 0.62),
    ]);
  }

  // ------------------------------------------------------------------------------------------------- drawing ---

  /** One block is about 1.57 tall seen at this angle; it fills 90 % of the icon. */
  private project(p: number[], cx: number, cz: number): [number, number, number] {
    const S = this.size * this.ss, K = (S * 0.9) / 1.62, YAW = -Math.PI / 4, PITCH = Math.PI / 6;
    const x = p[0] - cx - 0.5, y = p[1] - 0.5, z = p[2] - cz - 0.5;
    const x1 = x * Math.cos(YAW) + z * Math.sin(YAW), z1 = -x * Math.sin(YAW) + z * Math.cos(YAW);
    const y2 = y * Math.cos(PITCH) - z1 * Math.sin(PITCH), z2 = y * Math.sin(PITCH) + z1 * Math.cos(PITCH);
    return [S / 2 + x1 * K, S / 2 - y2 * K + K * 0.04, z2];
  }

  private rasterize(tris: Tri[]): IconImage {
    const S = this.size * this.ss;
    const out = new Uint8ClampedArray(S * S * 4);
    const zb = new Float32Array(S * S).fill(-Infinity);
    const order = [...tris.filter((t) => !t.blend), ...tris.filter((t) => t.blend).sort((a, b) => (a.z[0] + a.z[1] + a.z[2]) - (b.z[0] + b.z[1] + b.z[2]))];
    for (const t of order) {
      const [x0, x1, x2] = t.x, [y0, y1, y2] = t.y;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(S - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(S - 1, Math.ceil(Math.max(y0, y1, y2)));
      for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
        const sx = px + 0.5, sy = py + 0.5;
        const w0 = ((x1 - sx) * (y2 - sy) - (x2 - sx) * (y1 - sy)) / area;
        const w1 = ((x2 - sx) * (y0 - sy) - (x0 - sx) * (y2 - sy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * t.z[0] + w1 * t.z[1] + w2 * t.z[2];
        const i = py * S + px;
        if (z <= zb[i]) continue;
        let r = 1, g = 1, b = 1, a = 1;
        if (t.img) {
          const u = w0 * t.u[0] + w1 * t.u[1] + w2 * t.u[2], v = w0 * t.v[0] + w1 * t.v[1] + w2 * t.v[2];
          const tx = Math.min(t.img.width - 1, Math.max(0, Math.floor(u * t.img.width))), ty = Math.min(t.img.height - 1, Math.max(0, Math.floor(v * t.img.height)));
          const o = (ty * t.img.width + tx) * 4;
          r = t.img.data[o] / 255; g = t.img.data[o + 1] / 255; b = t.img.data[o + 2] / 255; a = t.img.data[o + 3] / 255;
        }
        const c = [0, 1, 2, 3].map((k) => w0 * t.c[0][k] + w1 * t.c[1][k] + w2 * t.c[2][k]);
        r *= c[0]; g *= c[1]; b *= c[2]; a *= c[3];
        const o = i * 4;
        if (!t.blend) {
          if (a < 0.5) continue;
          out[o] = r * 255; out[o + 1] = g * 255; out[o + 2] = b * 255; out[o + 3] = 255;
          zb[i] = z;
        } else {
          if (a <= 0.004) continue;
          const da = out[o + 3] / 255, oa = a + da * (1 - a);
          out[o] = ((r * a + (out[o] / 255) * da * (1 - a)) / oa) * 255;
          out[o + 1] = ((g * a + (out[o + 1] / 255) * da * (1 - a)) / oa) * 255;
          out[o + 2] = ((b * a + (out[o + 2] / 255) * da * (1 - a)) / oa) * 255;
          out[o + 3] = oa * 255;
        }
      }
    }
    return this.downsample(out);
  }

  /** Halves a picture drawn at twice the size, averaging by alpha so edges are smooth and do not turn grey. */
  private downsample(src: Uint8ClampedArray): IconImage {
    const OUT = this.size, SS = this.ss, S = OUT * SS;
    const data = new Uint8ClampedArray(OUT * OUT * 4);
    for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
        const o = ((y * SS + dy) * S + (x * SS + dx)) * 4, w = src[o + 3] / 255;
        r += src[o] * w; g += src[o + 1] * w; b += src[o + 2] * w; a += w;
      }
      const o = (y * OUT + x) * 4;
      if (a > 0) { data[o] = r / a; data[o + 1] = g / a; data[o + 2] = b / a; }
      data[o + 3] = (a / (SS * SS)) * 255;
    }
    return { width: OUT, height: OUT, data };
  }

  /** A flat item: the first frame (animated textures are a vertical strip), scaled up by whole pixels and centred. */
  private sprite(img: Img): IconImage {
    const OUT = this.size;
    const side = Math.min(img.width, img.height);
    const data = new Uint8ClampedArray(OUT * OUT * 4);
    const scale = Math.max(1, Math.floor(OUT / side)), size = side * scale, off = Math.floor((OUT - size) / 2);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const s = (Math.floor(y / scale) * img.width + Math.floor(x / scale)) * 4, d = ((y + off) * OUT + (x + off)) * 4;
      for (let k = 0; k < 4; k++) data[d + k] = img.data[s + k];
    }
    return { width: OUT, height: OUT, data };
  }
}

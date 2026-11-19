import { Geometry, GeoCube, M, emitGeometry, mulM, rotYM } from './geometry';
import { LayerBuilder } from './layer';
import type { BlockContext } from './blockutil';
import type { BlockModel, Quad, V3 } from './models';
import { perStack, type ResourceStack } from './resources';

/**
 * Blocks the pack describes with their own geometry (`models/blocks/<id>.geo.json`, format 1.2x: per-face uv, cube rotation with
 * a pivot, positions x −8 … 8 / y 0 … 16 / z −8 … 8). They used to fall back to a cube textured with the block's sprite.
 *
 * The cubes are emitted by the entity code (the same box-uv / face-uv rules); a quad hook collects the faces, which are then placed
 * in the cell: geometry +x points west, so x is mirrored (the same convention as the HoloPrint shapes).
 */
const MIRROR_X: M = [-1, 0, 0, 8, 0, 1, 0, 0, 0, 0, 1, 8];

const v3 = (a: unknown, d: V3 = [0, 0, 0]): V3 => (Array.isArray(a) && a.length >= 3 ? [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0] : d);
const geometriesOf = perStack((): Map<string, Geometry | null> => new Map());

function loadGeometry(stack: ResourceStack, id: string): Geometry | null {
  const per = geometriesOf(stack);
  if (per.has(id)) return per.get(id)!;
  let geo: Geometry | null = null;
  const bytes = stack.get(`models/blocks/${id}.geo.json`);
  if (bytes) {
    try {
      const g = (stack.parseJson(bytes) as any)['minecraft:geometry']?.[0];
      if (g) geo = {
        id, texW: g.description?.texture_width ?? 16, texH: g.description?.texture_height ?? 16,
        bones: (g.bones ?? []).map((b: any) => ({
          name: String(b.name).toLowerCase(), parent: b.parent ? String(b.parent).toLowerCase() : undefined, pivot: v3(b.pivot), rotation: v3(b.rotation),
          bindPose: [0, 0, 0] as V3, neverRender: false,
          cubes: (b.cubes ?? []).map((c: any): GeoCube => ({
            origin: v3(c.origin), size: v3(c.size), uv: c.uv ?? [0, 0], inflate: Number(c.inflate ?? 0) || 0, mirror: !!c.mirror,
            rotation: Array.isArray(c.rotation) && c.rotation.some((x: number) => Math.abs(x) > 1e-6) ? v3(c.rotation) : undefined, pivot: c.pivot ? v3(c.pivot) : undefined,
          })),
        })),
      };
    } catch { geo = null; }
  }
  per.set(id, geo);
  return geo;
}

/** Quads of a block geometry, turned `yDeg` about the cell's vertical axis in geometry space (before the mirror). */
export function blockGeometryQuads(geo: Geometry, texture: string, yDeg = 0): Quad[] {
  const quads: Quad[] = [];
  const world = mulM(MIRROR_X, rotYM(yDeg));
  emitGeometry(geo, {
    poses: new Map(), isVisible: () => true, world, color: [1, 1, 1], alpha: 1, emissive: false, texW: geo.texW ?? 16, texH: geo.texH ?? 16,
    onQuad: (pts, uvs, normal, flat) => quads.push({
      pos: pts.map((p) => [...p] as V3) as Quad['pos'], uv: uvs.map(([u, v]) => [u * 16, v * 16]) as Quad['uv'], tex: texture, normal, cull: false, ...(flat ? { flat: true } : {}),
    }),
  }, new LayerBuilder());
  return quads;
}

const CARDINAL_Y: Record<string, number> = { north: 0, south: 180, east: 90, west: -90 };
const LEGACY_DIRECTION = ['south', 'west', 'north', 'east'];

/**
 * `straw_bed`: the head or the foot half (`head_piece_bit`), turned by `minecraft:cardinal_direction`.
 * `shelf_mushroom` (26.x): the pack's small or large model on its own texture, turned the same way. UNVERIFIED: no sample
 * structure carries its states; a state whose name or value says "large" picks the large model, otherwise the small one.
 */
export function blockGeometryModel(ctx: BlockContext): BlockModel | undefined {
  if (ctx.name === 'shelf_mushroom' && ctx.resources) {
    const large = Object.entries(ctx.states).some(([k, v]) => /large/.test(`${k}=${v}`) && !/=(0|false)$/.test(`${k}=${v}`));
    const which = large ? 'shelf_mushroom_large' : 'shelf_mushroom_small';
    const geo = loadGeometry(ctx.resources, which);
    if (!geo) return undefined;
    const raw = ctx.states['minecraft:cardinal_direction'] ?? LEGACY_DIRECTION[Number(ctx.states.direction ?? 0) & 3];
    const quads = blockGeometryQuads(geo, `@textures/blocks/${which}`, CARDINAL_Y[String(raw)] ?? 0);
    return quads.length ? { elements: [], quads, static: true } : undefined;
  }
  if (ctx.name !== 'straw_bed' || !ctx.resources) return undefined;
  const geo = loadGeometry(ctx.resources, Number(ctx.states.head_piece_bit ?? 0) === 1 ? 'straw_bed_head' : 'straw_bed_foot');
  if (!geo) return undefined;
  const raw = ctx.states['minecraft:cardinal_direction'] ?? LEGACY_DIRECTION[Number(ctx.states.direction ?? 0) & 3];
  const quads = blockGeometryQuads(geo, '@textures/blocks/straw_bed', CARDINAL_Y[String(raw)] ?? 0);
  return quads.length ? { elements: [], quads, static: true } : undefined;
}

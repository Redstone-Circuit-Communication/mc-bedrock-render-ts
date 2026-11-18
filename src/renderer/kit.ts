import { BlockContext, cardinal, num, st } from './blockutil';
import { BlockModel, Dir, Element, FaceSpec, HORIZONTAL, V3, box } from './models';

/** A double-sided / non-culled face that shows the whole texture (or the `[v0, v1]` rows of it). */
export const full = (tex: string, extra: Partial<FaceSpec> = {}): FaceSpec => ({ tex, uv: [0, 0, 16, 16], cull: false, ...extra });

/** Face showing the texture rows that belong to a plane which spans y0..y1 (texture bottom at y = 0). */
const rows = (tex: string, y0: number, y1: number, extra: Partial<FaceSpec>): FaceSpec =>
  ({ tex, uv: [0, 16 - y1, 16, 16 - y0], cull: false, ...extra });

/** Vertical double-sided plane spanning x0..x1 at depth `z` (visible from north and south). */
export function planeX(x0: number, x1: number, y0: number, y1: number, z: number, tex: string, extra: Partial<FaceSpec> = {}): Element {
  return box([x0, y0, z], [x1, y1, z], { north: rows(tex, y0, y1, extra), south: rows(tex, y0, y1, extra) }, { shade: false });
}
/** Vertical double-sided plane spanning z0..z1 at `x` (visible from west and east). */
export function planeZ(z0: number, z1: number, y0: number, y1: number, x: number, tex: string, extra: Partial<FaceSpec> = {}): Element {
  return box([x, y0, z0], [x, y1, z1], { west: rows(tex, y0, y1, extra), east: rows(tex, y0, y1, extra) }, { shade: false });
}

/** Two crossing diagonal planes (flowers, saplings, grass …). `h` = height in 1/16 blocks. */
export function crossModel(tex: string, tint: FaceSpec['tint'] = null, h = 16, extra: Partial<BlockModel> = {}): BlockModel {
  const plane = (angle: number): Element =>
    box([0.8, 0, 8], [15.2, h, 8], { north: rows(tex, 0, h, { tint }), south: rows(tex, 0, h, { tint }) },
      { rotation: { origin: [8, 8, 8], axis: 'y', angle, rescale: true }, shade: false });
  return { elements: [plane(45), plane(-45)], static: true, ...extra };
}

/** Farm-crop shape: two plane pairs at 4 and 12 (`#`), `h` = height. */
export function hashModel(tex: string, h = 16, tint: FaceSpec['tint'] = null): BlockModel {
  return {
    elements: [
      planeZ(0, 16, 0, h, 4, tex, { tint }), planeZ(0, 16, 0, h, 12, tex, { tint }),
      planeX(0, 16, 0, h, 4, tex, { tint }), planeX(0, 16, 0, h, 12, tex, { tint }),
    ],
    static: true,
  };
}

const LEGACY_DIRECTION: Dir[] = ['south', 'west', 'north', 'east'];

/** `minecraft:cardinal_direction` or the legacy integer `direction` (0 south, 1 west, 2 north, 3 east). */
export function horizontalFacing(c: Pick<BlockContext, 'states'>, fallback: Dir = 'north'): Dir {
  const card = cardinal(c.states);
  if (card) return card;
  const d = st(c.states, 'direction');
  if (typeof d === 'number') return LEGACY_DIRECTION[d & 3];
  return fallback;
}

/** Is `n` one of the given block names (without the `minecraft:` prefix)? */
export const isBlock = (n: { name: string } | null | undefined, ...names: string[]): boolean => !!n && names.includes(n.name);

/** Integer state helper: `num(st(states, key))`. */
export const stateNum = (c: Pick<BlockContext, 'states'>, key: string, d = 0): number => num(st(c.states, key), d);

export const H4 = HORIZONTAL;
export type { V3 };

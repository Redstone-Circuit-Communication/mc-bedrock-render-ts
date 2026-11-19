import type { BlockContext } from './renderer/blockutil.js';
import type { LoadedStructure } from './renderer/manager.js';
import { isAirName } from './renderer/manager.js';
import type { McStructureRenderer } from './renderer/renderer.js';
import { stripNamespace } from './renderer/blockutil.js';
import { rotX, rotY } from './renderer/models.js';
import type { BlockModel, V3 } from './renderer/models.js';
import { blockState, containerDefinition } from './inventory.js';
import { toSnbt } from './renderer/manager.js';
import type { EntitySummary, Position } from './types.js';

export type PickResult =
  | { kind: 'block'; schematic: LoadedStructure; position: Position; id: string }
  | { kind: 'entity'; schematic: LoadedStructure; entity: EntitySummary };

type Box = [V3, V3];

/** Slab test: distance along the ray to a box, or `null`. */
function rayBox(o: V3, d: V3, b: Box): number | null {
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < b[0][a] || o[a] > b[1][a]) return null; continue; }
    let u = (b[0][a] - o[a]) / d[a], v = (b[1][a] - o[a]) / d[a];
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Element boxes of a model, in cell units (0..1), after the whole-model rotation. Thin planes get a little thickness. */
function modelBoxes(model: BlockModel | null | undefined): Box[] {
  if (model === null) return [];
  if (!model || (!model.elements.length && !model.quads?.length)) return [[[0, 0, 0], [1, 1, 1]]];
  const out: Box[] = [];
  const rx = model.rotX ?? 0, ry = model.rotY ?? 0;
  for (const q of model.quads ?? []) {
    const rot = q.pos.map((p) => { const r = rotY(rotX([p[0] - 8, p[1] - 8, p[2] - 8], rx), ry); return [(r[0] + 8) / 16, (r[1] + 8) / 16, (r[2] + 8) / 16] as V3; });
    const lo = [0, 1, 2].map((a) => Math.min(...rot.map((p) => p[a]))) as V3, hi = [0, 1, 2].map((a) => Math.max(...rot.map((p) => p[a]))) as V3;
    for (let a = 0; a < 3; a++) if (hi[a] - lo[a] < 1 / 16) { lo[a] -= 1 / 32; hi[a] += 1 / 32; } // flat quads get a little thickness
    out.push([lo, hi]);
  }
  for (const el of model.elements) {
    let from = [...el.from] as V3, to = [...el.to] as V3;
    if (el.rotation) { from = from.map((v) => Math.max(0, v - 4)) as V3; to = to.map((v) => Math.min(16, v + 4)) as V3; }
    for (let a = 0; a < 3; a++) if (to[a] - from[a] < 1) { from[a] -= 0.5; to[a] += 0.5; }
    const c = [from, to].flatMap((p) => [0, 1].flatMap((i) => [0, 1].flatMap((j) => [0, 1].map((k) => [i ? p[0] : from[0], j ? p[1] : from[1], k ? p[2] : from[2]] as V3))));
    const rot = c.map((p) => { const q = rotY(rotX([p[0] - 8, p[1] - 8, p[2] - 8], rx), ry); return [(q[0] + 8) / 16, (q[1] + 8) / 16, (q[2] + 8) / 16] as V3; });
    out.push([[0, 1, 2].map((a) => Math.min(...rot.map((p) => p[a]))) as V3, [0, 1, 2].map((a) => Math.max(...rot.map((p) => p[a]))) as V3]);
  }
  return out;
}

function resolveModel(renderer: McStructureRenderer, s: LoadedStructure, x: number, y: number, z: number): BlockModel | null | undefined {
  const st = s.structure, reg = renderer.registry, stack = renderer.resources;
  const refAt = (px: number, py: number, pz: number) => { const e = st.blockAt(px, py, pz); return e ? { name: stripNamespace(e.name), states: e.states } : null; };
  const here = refAt(x, y, z);
  if (!here) return null;
  const ctx: BlockContext = {
    ...here, x, y, z,
    neighbor: (dx, dy, dz) => refAt(x + dx, y + dy, z + dz),
    isOpaque: (dx, dy, dz) => { const n = refAt(x + dx, y + dy, z + dz); return !!n && reg.traits(n, stack).opaque; },
    blockEntity: st.blockEntityAt(x, y, z), resources: stack,
  };
  try { return reg.resolve(ctx); } catch { return undefined; }
}

/** Bedrock's `facing_direction` of pistons: 0 down, 1 up, 2 south, 3 north, 4 east, 5 west. */
const PISTON_STEP: V3[] = [[0, -1, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];
/** For a piston arm block, the offset from its base to it; undefined for anything else. */
function pistonBaseOf(e: { name: string; states?: Record<string, unknown> }): V3 | undefined {
  if (!/(^|:)(sticky_)?piston_arm_collision$/.test(e.name)) return undefined;
  const raw = e.states?.facing_direction ?? e.states?.['minecraft:facing_direction'];
  const named = ['down', 'up', 'south', 'north', 'east', 'west'].indexOf(String(raw));
  return PISTON_STEP[named >= 0 ? named : Number(raw)];
}

/** First visible block along a ray (cell walk, then the model's boxes inside each cell). */
function pickBlock(renderer: McStructureRenderer, s: LoadedStructure, o: V3, d: V3): { t: number; pos: Position } | null {
  const [sx, sy, sz] = s.structure.size;
  const whole = rayBox(o, d, [[0, 0, 0], [sx, sy, sz]]);
  if (whole === null) return null;
  const start = Math.max(0, whole) + 1e-6;
  const p: V3 = [o[0] + d[0] * start, o[1] + d[1] * start, o[2] + d[2] * start];
  const cell = [0, 1, 2].map((a) => Math.min([sx, sy, sz][a] - 1, Math.max(0, Math.floor(p[a])))) as V3;
  const step = d.map((v) => (v > 0 ? 1 : -1)), tMax: number[] = [], tDelta: number[] = [];
  for (let a = 0; a < 3; a++) {
    const next = cell[a] + (step[a] > 0 ? 1 : 0);
    tMax[a] = Math.abs(d[a]) < 1e-12 ? Infinity : (next - o[a]) / d[a];
    tDelta[a] = Math.abs(d[a]) < 1e-12 ? Infinity : Math.abs(1 / d[a]);
  }
  const size = [sx, sy, sz];
  for (let guard = 0; guard < sx + sy + sz + 4; guard++) {
    const [cx, cy, cz] = cell;
    const e = s.structure.blockAt(cx, cy, cz);
    if (e && !isAirName(e.name)) {
      // A piston arm has no model of its own: the base draws the arm into this cell, so test the base's shape here (a ray
      // from the side passes through the arm cell without ever reaching the base cell).
      const arm = pistonBaseOf(e);
      const base = arm ?? [0, 0, 0];
      const boxes = modelBoxes(resolveModel(renderer, s, cx - base[0], cy - base[1], cz - base[2]));
      let best: number | null = null;
      for (const b of boxes) {
        const lo: V3 = [cx - base[0] + b[0][0], cy - base[1] + b[0][1], cz - base[2] + b[0][2]];
        const hi: V3 = [cx - base[0] + b[1][0], cy - base[1] + b[1][1], cz - base[2] + b[1][2]];
        // for an arm, only the part of the base's shape inside this cell; other models are tested whole (a door's lower half
        // draws the upper one, a large chest's leading half draws both)
        const box: [V3, V3] = arm ? [lo.map((v, i) => Math.max(v, [cx, cy, cz][i])) as V3, hi.map((v, i) => Math.min(v, [cx, cy, cz][i] + 1)) as V3] : [lo, hi];
        if (box[0].some((v, i) => v > box[1][i])) continue;
        const t = rayBox(o, d, box);
        if (t !== null && (best === null || t < best)) best = t;
      }
      if (best !== null) return { t: best, pos: [cx, cy, cz] };
    }
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    cell[a] += step[a];
    if (cell[a] < 0 || cell[a] >= size[a]) return null;
    tMax[a] += tDelta[a];
  }
  return null;
}

/** ndc: normalised device coordinates (−1..1, y up), or (0, 0) for a crosshair. `camera` is accepted for signature parity and unused. */
export function pickScene(renderer: McStructureRenderer, _camera: unknown, ndc: { x: number; y: number }, _raycaster?: unknown): PickResult | null {
  const { origin, dir } = renderer.viewer.rayFromNdc(ndc.x, ndc.y);
  let best: { t: number; result: PickResult } | null = null;
  for (const s of renderer.schematicManager.getAllSchematics()) {
    if (!s.group.visible) continue;
    const hit = pickBlock(renderer, s, origin, dir);
    if (hit) {
      const id = s.schematicWrapper.get_block(...hit.pos);
      if (id && !isAirName(id) && (!best || hit.t < best.t)) best = { t: hit.t, result: { kind: 'block', schematic: s, position: hit.pos, id } };
    }
    for (const r of s.entityManager.records) {
      if (!r.bounds) continue;
      const t = rayBox(origin, dir, [r.bounds.min, r.bounds.max]);
      if (t !== null && (!best || t < best.t)) best = { t, result: { kind: 'entity', schematic: s, entity: entitySummary(r) } };
    }
  }
  return best?.result ?? null;
}

export function entitySummary(r: LoadedStructure['entityManager']['records'][number]): EntitySummary {
  return { id: r.id, nbt: r.nbt, position: [...r.position], rotation: [...r.rotation], status: r.status === 'unsupported' ? 'unsupported' : 'model', rawNbt: r.nbt, snbt: toSnbt(r.nbt) };
}

export function listContainers(schematics: readonly LoadedStructure[]) {
  const targets: { schematic: LoadedStructure; position: Position; id: string }[] = [];
  for (const schematic of schematics) {
    for (const entity of schematic.getBlockEntitiesMap().values()) {
      const position: Position = [entity.position[0], entity.position[1], entity.position[2]];
      const state = schematic.schematicWrapper.get_block_string(...position) ?? '';
      if (containerDefinition(state)) targets.push({ schematic, position, id: blockState(state).id });
    }
  }
  return targets.sort((a, b) => a.position[1] - b.position[1] || a.position[0] - b.position[0] || a.position[2] - b.position[2]);
}

export function listEntities(schematics: readonly LoadedStructure[]) {
  return schematics.flatMap((schematic) => (schematic.entityManager?.records ?? []).map((record) => ({ schematic, entity: entitySummary(record) })));
}

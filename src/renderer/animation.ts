import { BonePose } from './geometry';
import { MolangEnv, evalMolang, molangNumber, molangTruthy } from './molang';
import { V3 } from './models';
import { ResourceStack } from './resources';

/** Animation + animation-controller definitions of a resource stack. */
export class AnimationLibrary {
  readonly animations = new Map<string, any>();
  readonly controllers = new Map<string, any>();

  constructor(stack: ResourceStack) {
    for (const path of stack.paths('animations/')) this.read(stack, path, 'animations', this.animations);
    for (const path of stack.paths('animation_controllers/')) this.read(stack, path, 'animation_controllers', this.controllers);
  }

  private read(stack: ResourceStack, path: string, key: string, into: Map<string, any>): void {
    if (!path.endsWith('.json')) return;
    for (const bytes of stack.getAll(path)) {   // every pack's version: definitions are merged by identifier
      try {
        const j = stack.parseJson(bytes);
        for (const [id, v] of Object.entries<any>(j[key] ?? {})) into.set(id.toLowerCase(), v);
      } catch { /* ignore unreadable files */ }
    }
  }
}

export interface AnimContext {
  lib: AnimationLibrary;
  /** the entity's `animations` map: short name → animation / controller id (lower-case keys) */
  shortNames: Map<string, string>;
  env: MolangEnv;
  poses: Map<string, BonePose>;
  /**
   * The rest value of each bone's channels (lower-case bone name): `pos` = its pivot relative to its parent's pivot, `rot` =
   * its geometry rotation. Molang's `this` is the channel's current value, rest included, so `"X - this"` sets X outright:
   * the guardian's spikes are written as absolute positions (`24 - 8 * … - this`); with `this` starting at 0 they ended up
   * 24 px too high, a cluster floating above the body. Without `rest` the channels start at 0 (the old behaviour).
   */
  rest?: Map<string, { pos: V3; rot: V3 }>;
}

const poseFor = (poses: Map<string, BonePose>, bone: string): BonePose => {
  let p = poses.get(bone);
  if (!p) { p = { rot: [0, 0, 0], pos: [0, 0, 0], scale: [1, 1, 1] }; poses.set(bone, p); }
  return p;
};

function channel(raw: any, env: MolangEnv, current: V3, t = 0): V3 | null {
  let v = raw;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    // keyframes: pick the key at / before t (first key if none)
    const keys = Object.keys(v).filter((k) => !isNaN(Number(k))).sort((a, b) => Number(a) - Number(b));
    if (!keys.length) return null;
    let pick = keys[0];
    for (const k of keys) if (Number(k) <= t) pick = k;
    v = v[pick];
    if (v && typeof v === 'object' && !Array.isArray(v)) v = v.post ?? v.pre ?? null;
  }
  if (v == null) return null;
  const comps: any[] = Array.isArray(v) ? v : [v, v, v];
  if (comps.length < 3) return null;
  const out: V3 = [0, 0, 0];
  const saved = env.thisValue;
  for (let i = 0; i < 3; i++) {
    env.thisValue = current[i];
    out[i] = molangNumber(evalMolang(comps[i], env));
  }
  env.thisValue = saved;
  return out;
}

function sample(ctx: AnimContext, anim: any, weight: number): void {
  for (const [boneName, ch] of Object.entries<any>(anim.bones ?? {})) {
    const pose = poseFor(ctx.poses, boneName.toLowerCase());
    const rest = ctx.rest?.get(boneName.toLowerCase());
    const withRest = (acc: V3, base?: V3): V3 => (base ? [acc[0] + base[0], acc[1] + base[1], acc[2] + base[2]] : acc);
    if (ch.rotation != null) {
      const r = channel(ch.rotation, ctx.env, withRest(pose.rot, rest?.rot));
      if (r) for (let i = 0; i < 3; i++) pose.rot[i] += weight * r[i];
    }
    if (ch.position != null) {
      const r = channel(ch.position, ctx.env, withRest(pose.pos, rest?.pos));
      if (r) for (let i = 0; i < 3; i++) pose.pos[i] += weight * r[i];
    }
    if (ch.scale != null) {
      const r = channel(ch.scale, ctx.env, pose.scale);
      if (r) for (let i = 0; i < 3; i++) pose.scale[i] += weight * (r[i] - 1);
    }
  }
}

function runController(ctx: AnimContext, id: string, weight: number, depth: number): void {
  const c = ctx.lib.controllers.get(id);
  if (!c || depth > 4) return;
  const states = c.states ?? {};
  let state: string = c.initial_state ?? 'default';
  const enter = (name: string) => {
    for (const s of states[name]?.on_entry ?? []) evalMolang(s, ctx.env);
  };
  enter(state);
  // A frozen entity has "settled": follow transitions until the state machine is stable.
  for (let i = 0; i < 8; i++) {
    let next: string | undefined;
    for (const tr of states[state]?.transitions ?? []) {
      const [target, expr] = Object.entries<any>(tr)[0] ?? [];
      if (target && molangTruthy(evalMolang(expr, ctx.env))) { next = target; break; }
    }
    if (!next || next === state || !states[next]) break;
    state = next;
    enter(state);
  }
  for (const a of states[state]?.animations ?? []) {
    if (typeof a === 'string') applyAnimation(ctx, a, undefined, weight, depth + 1);
    else for (const [short, expr] of Object.entries<any>(a)) applyAnimation(ctx, short, expr, weight, depth + 1);
  }
}

/** Apply an animation or controller referenced by its short name from the entity definition. */
export function applyAnimation(ctx: AnimContext, short: string, weightExpr: string | number | undefined, parentWeight = 1, depth = 0): void {
  const id = ctx.shortNames.get(short.toLowerCase());
  if (!id) return;
  const w = parentWeight * (weightExpr == null ? 1 : molangNumber(evalMolang(weightExpr, ctx.env)));
  if (w === 0) return;
  if (id.startsWith('controller.')) { runController(ctx, id, w, depth); return; }
  const anim = ctx.lib.animations.get(id);
  if (anim) sample(ctx, anim, w);
}

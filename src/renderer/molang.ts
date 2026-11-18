/**
 * A compact Molang interpreter — enough for Bedrock render controllers,
 * animation channels, animation-controller transitions and `pre_animation`
 * scripts: arithmetic, comparisons, `?:`, `??`, assignments, `return`,
 * `math.*`, `query.*`, `variable.*`, `temp.*`, resource handles
 * (`Texture.x`, `Geometry.x`, `Material.x`) and `Array.x[index]`.
 *
 * Loops, structs and function definitions are not supported.
 */

export interface ArrayHandle { array: string }
export type MolangValue = number | string | ArrayHandle;

export interface MolangEnv {
  /** `variable.*` storage, keys lower-case without the prefix. */
  vars: Map<string, MolangValue>;
  temps: Map<string, MolangValue>;
  /** Called for every `query.name(args)`; return 0 for anything unknown. */
  query(name: string, args: MolangValue[]): MolangValue;
  /** `array.name` → resource handles, keys lower-case without the prefix. */
  arrays: Map<string, string[]>;
  /** Value of `this` (the channel being animated). */
  thisValue: number;
}

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; name: string }
  | { t: 'un'; op: string; e: Node }
  | { t: 'bin'; op: string; l: Node; r: Node }
  | { t: 'tern'; c: Node; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] }
  | { t: 'idx'; e: Node; i: Node }
  | { t: 'assign'; name: string; e: Node }
  | { t: 'ret'; e: Node }
  | { t: 'seq'; items: Node[] };

// ---------------------------------------------------------------- lexer ---

type Tok = { k: 'num' | 'str' | 'id' | 'op'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|'([^']*)'|([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)|(<=|>=|==|!=|&&|\|\||\?\?|[-+*/%<>!?:=;,()\[\]{}]))/y;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) { if (/^\s*$/.test(src.slice(pos))) break; throw new Error(`Molang: unexpected character at ${pos} in "${src}"`); }
    pos = re.lastIndex;
    if (m[1] !== undefined) out.push({ k: 'num', v: m[1] });
    else if (m[2] !== undefined) out.push({ k: 'str', v: m[2] });
    else if (m[3] !== undefined) out.push({ k: 'id', v: m[3].toLowerCase() });
    else out.push({ k: 'op', v: m[4] });
  }
  return out;
}

// --------------------------------------------------------------- parser ---

const PREC: Record<string, number> = {
  '??': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '>': 5, '<=': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7,
};

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  private peek() { return this.toks[this.i]; }
  private isOp(v: string) { const t = this.peek(); return !!t && t.k === 'op' && t.v === v; }
  private eat(v: string) { if (!this.isOp(v)) throw new Error(`Molang: expected "${v}"`); this.i++; }

  program(): Node {
    const items: Node[] = [];
    while (this.i < this.toks.length) {
      if (this.isOp(';')) { this.i++; continue; }
      items.push(this.statement());
    }
    return items.length === 1 ? items[0] : { t: 'seq', items };
  }

  private statement(): Node {
    const t = this.peek();
    if (t.k === 'id' && t.v === 'return') { this.i++; return { t: 'ret', e: this.expr() }; }
    if (t.k === 'id' && this.toks[this.i + 1]?.k === 'op' && this.toks[this.i + 1].v === '=') {
      this.i += 2;
      return { t: 'assign', name: t.v, e: this.expr() };
    }
    return this.expr();
  }

  expr(): Node {
    const c = this.bin(1);
    if (this.isOp('?')) {
      this.i++;
      const a = this.expr();
      let b: Node = { t: 'num', v: 0 };
      if (this.isOp(':')) { this.i++; b = this.expr(); }
      return { t: 'tern', c, a, b };
    }
    return c;
  }

  private bin(min: number): Node {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.k !== 'op' || !(t.v in PREC) || PREC[t.v] < min) return l;
      this.i++;
      const r = this.bin(PREC[t.v] + 1);
      l = { t: 'bin', op: t.v, l, r };
    }
  }

  private unary(): Node {
    const t = this.peek();
    if (t && t.k === 'op' && (t.v === '!' || t.v === '-' || t.v === '+')) {
      this.i++;
      return { t: 'un', op: t.v, e: this.unary() };
    }
    return this.postfix();
  }

  private postfix(): Node {
    let n = this.primary();
    while (this.isOp('[')) {
      this.i++;
      const idx = this.expr();
      this.eat(']');
      n = { t: 'idx', e: n, i: idx };
    }
    return n;
  }

  private primary(): Node {
    const t = this.toks[this.i++];
    if (!t) throw new Error('Molang: unexpected end');
    if (t.k === 'num') return { t: 'num', v: parseFloat(t.v) };
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'id') {
      if (this.isOp('(')) {
        this.i++;
        const args: Node[] = [];
        while (!this.isOp(')')) {
          args.push(this.expr());
          if (this.isOp(',')) this.i++;
          else break;
        }
        this.eat(')');
        return { t: 'call', name: t.v, args };
      }
      return { t: 'id', name: t.v };
    }
    if (t.v === '(') { const e = this.expr(); this.eat(')'); return e; }
    if (t.v === '{') {
      const items: Node[] = [];
      while (!this.isOp('}')) { if (this.isOp(';')) { this.i++; continue; } items.push(this.statement()); }
      this.eat('}');
      return { t: 'seq', items };
    }
    throw new Error(`Molang: unexpected token "${t.v}"`);
  }
}

const cache = new Map<string, Node | null>();
function compile(src: string): Node | null {
  let n = cache.get(src);
  if (n === undefined) {
    try { n = new Parser(lex(src)).program(); } catch (e) { n = null; }
    cache.set(src, n);
  }
  return n;
}

// ------------------------------------------------------------ evaluator ---

const isHandle = (v: MolangValue): v is ArrayHandle => typeof v === 'object';
const num = (v: MolangValue): number => (typeof v === 'number' ? v : typeof v === 'string' ? (v === '' ? 0 : 1) : 1);
const truthy = (v: MolangValue): boolean => num(v) !== 0;

const RAD = Math.PI / 180;
const MATH: Record<string, (...a: number[]) => number> = {
  abs: Math.abs, sin: (x) => Math.sin(x * RAD), cos: (x) => Math.cos(x * RAD),
  asin: (x) => Math.asin(x) / RAD, acos: (x) => Math.acos(x) / RAD, atan: (x) => Math.atan(x) / RAD,
  atan2: (y, x) => Math.atan2(y, x) / RAD, exp: Math.exp, ln: Math.log, sqrt: Math.sqrt,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  pow: Math.pow, min: Math.min, max: Math.max,
  clamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi),
  lerp: (a, b, t) => a + (b - a) * t,
  mod: (a, b) => (b === 0 ? 0 : a % b),
  sign: Math.sign,
  random: () => 0.5, random_integer: (lo, hi) => Math.floor((lo + hi) / 2), die_roll: (n, lo, hi) => n * ((lo + hi) / 2),
  die_roll_integer: (n, lo, hi) => n * Math.floor((lo + hi) / 2),
  hermite_blend: (t) => 3 * t * t - 2 * t * t * t,
  min_angle: (a) => a, max_angle: (a) => a,
};

class Ret { constructor(public v: MolangValue) {} }

function run(n: Node, env: MolangEnv): MolangValue {
  switch (n.t) {
    case 'num': return n.v;
    case 'str': return n.v;
    case 'id': return resolveId(n.name, env);
    case 'un': {
      const v = num(run(n.e, env));
      return n.op === '!' ? (v === 0 ? 1 : 0) : n.op === '-' ? -v : v;
    }
    case 'bin': {
      if (n.op === '&&') { const l = run(n.l, env); return truthy(l) ? (truthy(run(n.r, env)) ? 1 : 0) : 0; }
      if (n.op === '||') { const l = run(n.l, env); return truthy(l) ? 1 : truthy(run(n.r, env)) ? 1 : 0; }
      if (n.op === '??') { const l = run(n.l, env); return l === 0 ? run(n.r, env) : l; }
      const l = run(n.l, env), r = run(n.r, env);
      if (n.op === '==') return (typeof l === 'string' || typeof r === 'string' ? l === r : num(l) === num(r)) ? 1 : 0;
      if (n.op === '!=') return (typeof l === 'string' || typeof r === 'string' ? l !== r : num(l) !== num(r)) ? 1 : 0;
      const a = num(l), b = num(r);
      switch (n.op) {
        case '+': return a + b; case '-': return a - b; case '*': return a * b;
        case '/': return b === 0 ? 0 : a / b; case '%': return b === 0 ? 0 : a % b;
        case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
      }
      return 0;
    }
    case 'tern': return truthy(run(n.c, env)) ? run(n.a, env) : run(n.b, env);
    case 'idx': {
      const base = run(n.e, env);
      const i = Math.floor(num(run(n.i, env)));
      if (isHandle(base)) {
        const arr = env.arrays.get(base.array) ?? [];
        if (!arr.length) return 0;
        return arr[((i % arr.length) + arr.length) % arr.length];
      }
      return 0;
    }
    case 'call': {
      const args = n.args.map((a) => run(a, env));
      if (n.name.startsWith('math.')) {
        const f = MATH[n.name.slice(5)];
        return f ? f(...args.map(num)) : 0;
      }
      if (n.name.startsWith('query.') || n.name.startsWith('q.')) return env.query(n.name.slice(n.name.indexOf('.') + 1), args);
      return 0;
    }
    case 'assign': {
      const v = run(n.e, env);
      const dot = n.name.indexOf('.');
      const scope = n.name.slice(0, dot), key = n.name.slice(dot + 1);
      if (scope === 'variable' || scope === 'v') env.vars.set(key, v);
      else if (scope === 'temp' || scope === 't') env.temps.set(key, v);
      return v;
    }
    case 'ret': throw new Ret(run(n.e, env));
    case 'seq': {
      let last: MolangValue = 0;
      for (const it of n.items) last = run(it, env);
      return last;
    }
  }
}

function resolveId(name: string, env: MolangEnv): MolangValue {
  if (name === 'this') return env.thisValue;
  if (name === 'true') return 1;
  if (name === 'false') return 0;
  const dot = name.indexOf('.');
  if (dot < 0) return 0;
  const scope = name.slice(0, dot), key = name.slice(dot + 1);
  switch (scope) {
    case 'variable': case 'v': return env.vars.get(key) ?? 0;
    case 'temp': case 't': return env.temps.get(key) ?? 0;
    case 'query': case 'q': return env.query(key, []);
    case 'math': return key === 'pi' ? Math.PI : 0;
    case 'texture': case 'geometry': case 'material': return name;
    case 'array': return { array: name };
    default: return 0;
  }
}

/** Evaluate an expression. Never throws; errors evaluate to 0. */
export function evalMolang(src: string | number | undefined | null, env: MolangEnv): MolangValue {
  if (typeof src === 'number') return src;
  if (src == null) return 0;
  const node = compile(src);
  if (!node) return 0;
  try { return run(node, env); }
  catch (e) { if (e instanceof Ret) return e.v; return 0; }
}

export const molangNumber = (v: MolangValue): number => num(v);
export const molangTruthy = (v: MolangValue): boolean => truthy(v);

export function createMolangEnv(query: MolangEnv['query'] = () => 0): MolangEnv {
  return { vars: new Map(), temps: new Map(), query, arrays: new Map(), thisValue: 0 };
}

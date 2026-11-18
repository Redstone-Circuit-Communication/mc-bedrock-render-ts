/**
 * Just enough browser for `McStructureRenderer` to run in Node: a canvas whose WebGL2 context accepts every call and records
 * the draw calls, and the few globals the viewer touches. The frame loop never runs (requestAnimationFrame does nothing);
 * tests call `renderer.viewer.render()` themselves.
 */
export interface GlLog { drawElements: number[]; bufferData: number }

export function fakeGl(): { gl: WebGL2RenderingContext; log: GlLog } {
  const log: GlLog = { drawElements: [], bufferData: 0 };
  let next = 1;
  const constants = new Map<string, number>();
  const target: Record<string, unknown> = {
    drawElements: (_mode: number, count: number) => void log.drawElements.push(count),
    bufferData: () => void log.bufferData++,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getContextAttributes: () => ({ alpha: true }),
  };
  const gl = new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      if (/^[A-Z][A-Z0-9_]*$/.test(key)) { if (!constants.has(key)) constants.set(key, 0x1000 + constants.size); return constants.get(key); }
      return (..._args: unknown[]) => (/^(create|get(Uniform|Attrib)Location)/.test(key) ? { id: next++ } : undefined);
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, log };
}

export function fakeCanvas(width = 640, height = 480) {
  const { gl, log } = fakeGl();
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const canvas = {
    width, height, clientWidth: width, clientHeight: height, style: {} as Record<string, string>,
    getContext: () => gl,
    addEventListener: (type: string, fn: (e: unknown) => void) => { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn); },
    removeEventListener: (type: string, fn: (e: unknown) => void) => void listeners.get(type)?.delete(fn),
    dispatchEvent: (e: { type: string }) => { listeners.get(e.type)?.forEach((fn) => fn(e)); return true; },
    setPointerCapture() {}, releasePointerCapture() {}, requestPointerLock() {},
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['x'], { type: 'image/png' })),
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
  } as unknown as HTMLCanvasElement;
  return { canvas, gl, log };
}

/** Install the globals once; returns a function that removes them. */
export function installFakeDom(): () => void {
  const g = globalThis as Record<string, unknown>;
  const keep = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'CustomEvent'].map((k) => [k, g[k]] as const);
  const doc = { pointerLockElement: null, addEventListener() {}, removeEventListener() {}, exitPointerLock() {}, visibilityState: 'visible', createElement: () => ({ click() {}, set href(_v: string) {}, set download(_v: string) {} }), body: { appendChild() {}, removeChild() {} } };
  g.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  g.document = doc;
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  g.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  g.CustomEvent = class { type: string; detail: unknown; constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail; } };
  return () => { for (const [k, v] of keep) { if (v === undefined) delete g[k]; else g[k] = v; } };
}

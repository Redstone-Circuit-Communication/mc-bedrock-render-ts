/**
 * Screen-space ambient occlusion for the WebGL2 viewer: the counterpart of the Java package's N8AO pass (same presets: perspective
 * radius 1 block, distance falloff 0.4, intensity 5; orthographic 0.3 / 0.1 / 0.8). Without it the blocks were lit by flat face
 * shading only and looked like plastic next to the Java renderer.
 *
 * Frame: the solid geometry goes into a multisampled framebuffer, which is resolved into a colour and a depth texture. The AO pass
 * reconstructs view-space positions and normals from depth, tests a 16-sample hemisphere, the result is blurred (depth-aware) and
 * multiplied into the colour. The translucent layers, the grid and overlays are then drawn on top with the scene's depth attached,
 * and the frame is copied to the canvas.
 */

export interface SSAOParams { aoRadius: number; distanceFalloff: number; intensity: number }

const FULLSCREEN = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const AO_FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uDepth; uniform mat4 uProj; uniform mat4 uInvProj; uniform vec2 uTexel;
uniform float uRadius; uniform float uFalloff; uniform float uIntensity; uniform vec3 uKernel[16];
vec3 viewPos(vec2 uv, float d) { vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
vec3 viewAt(vec2 uv) { return viewPos(uv, texture(uDepth, uv).r); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float d = texture(uDepth, vUv).r;
  if (d >= 1.0) { outColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv, d);
  vec3 pr = viewAt(vUv + vec2(uTexel.x, 0.0)), pl = viewAt(vUv - vec2(uTexel.x, 0.0));
  vec3 pu = viewAt(vUv + vec2(0.0, uTexel.y)), pd = viewAt(vUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 N = normalize(cross(dx, dy));
  float a = hash(gl_FragCoord.xy) * 6.2831853;
  vec3 r = vec3(cos(a), sin(a), 0.0);
  vec3 T = normalize(r - N * dot(r, N)); vec3 B = cross(N, T); mat3 tbn = mat3(T, B, N);
  float occ = 0.0, bias = 0.025 * uRadius;
  for (int i = 0; i < 16; i++) {
    vec3 S = P + tbn * uKernel[i] * uRadius;
    vec4 c = uProj * vec4(S, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
    float sd = texture(uDepth, suv).r;
    if (sd >= 1.0) continue;
    float sz = viewPos(suv, sd).z;
    // farther than the falloff distance the occluder counts less (N8AO's distanceFalloff), past the radius not at all
    float dist = abs(P.z - sz);
    float range = 1.0 - smoothstep(uFalloff * uRadius, uRadius * (1.0 + uFalloff), dist);
    occ += (sz >= S.z + bias ? 1.0 : 0.0) * range;
  }
  float ao = clamp(1.0 - occ / 16.0, 0.0, 1.0);
  outColor = vec4(vec3(pow(ao, uIntensity)), 1.0);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uAo; uniform sampler2D uDepth; uniform vec2 uTexel; uniform mat4 uInvProj;
float viewZ(vec2 uv) { vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, texture(uDepth, uv).r * 2.0 - 1.0, 1.0); return v.z / v.w; }
void main() {
  float z0 = viewZ(vUv), sum = 0.0, wsum = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 uv = vUv + vec2(float(x), float(y)) * uTexel;
    float w = 1.0 / (1.0 + 40.0 * abs(viewZ(uv) - z0));
    sum += texture(uAo, uv).r * w; wsum += w;
  }
  outColor = vec4(vec3(sum / max(wsum, 1e-5)), 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uColor; uniform sampler2D uAo; uniform float uGamma;
void main() { vec4 c = texture(uColor, vUv); float ao = texture(uAo, vUv).r; outColor = vec4(c.rgb * pow(ao, uGamma), c.a); }`;

const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor; uniform sampler2D uColor;
void main() { outColor = texture(uColor, vUv); }`;

/** 16 hemisphere samples (z ≥ 0), denser near the centre; fixed so frames are stable. */
function kernel(): Float32Array {
  const out = new Float32Array(48);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 16; i++) {
    let x = 0, y = 0, z = 0, l = 0;
    do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd(); l = Math.hypot(x, y, z); } while (l > 1 || l < 0.1);
    const s = 0.1 + 0.9 * ((i + 1) / 16) ** 2;
    out.set([(x / l) * s * rnd(), (y / l) * s * rnd(), (z / l) * s * Math.max(0.2, rnd())], i * 3);
  }
  return out;
}

export function invert4(m: Float32Array): Float32Array {
  const a = m, inv = new Float32Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  det = det ? 1 / det : 0;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

export class SSAOPass {
  private w = 0;
  private h = 0;
  private samples: number;
  private ms: { fbo: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer } | null = null;
  private scene!: { fbo: WebGLFramebuffer; color: WebGLTexture; depth: WebGLTexture };
  private out!: { fbo: WebGLFramebuffer; color: WebGLTexture };
  private aoT!: { fbo: WebGLFramebuffer; color: WebGLTexture };
  private blurT!: { fbo: WebGLFramebuffer; color: WebGLTexture };
  private vao: WebGLVertexArrayObject;
  private progs: Record<'ao' | 'blur' | 'composite' | 'copy', Prog>;
  private kernel = kernel();

  constructor(private gl: WebGL2RenderingContext, compile: (vs: string, fs: string) => WebGLProgram) {
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number || 0);
    this.vao = gl.createVertexArray()!;
    const mk = (fs: string, names: string[]): Prog => {
      const p = compile(FULLSCREEN, fs);
      return { p, u: Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)])) };
    };
    this.progs = {
      ao: mk(AO_FRAG, ['uDepth', 'uProj', 'uInvProj', 'uTexel', 'uRadius', 'uFalloff', 'uIntensity', 'uKernel']),
      blur: mk(BLUR_FRAG, ['uAo', 'uDepth', 'uTexel', 'uInvProj']),
      composite: mk(COMPOSITE_FRAG, ['uColor', 'uAo', 'uGamma']),
      copy: mk(COPY_FRAG, ['uColor']),
    };
  }

  private tex(w: number, h: number, depth = false): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (depth) gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }

  private target(color: WebGLTexture, depth?: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl, f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    return f;
  }

  private resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.free();
    const gl = this.gl;
    this.w = w; this.h = h;
    const color = this.tex(w, h), depth = this.tex(w, h, true);
    this.scene = { fbo: this.target(color, depth), color, depth };
    const oc = this.tex(w, h); this.out = { fbo: this.target(oc, depth), color: oc };
    const a = this.tex(w, h); this.aoT = { fbo: this.target(a), color: a };
    const b = this.tex(w, h); this.blurT = { fbo: this.target(b), color: b };
    if (this.samples > 0) {
      const fbo = gl.createFramebuffer()!, c = gl.createRenderbuffer()!, d = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, c); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
      this.ms = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE ? { fbo, color: c, depth: d } : null;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Bind the framebuffer the solid geometry is drawn into (cleared to the background). */
  begin(w: number, h: number, clear: [number, number, number, number]): void {
    const gl = this.gl;
    this.resize(Math.max(1, w), Math.max(1, h));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ms?.fbo ?? this.scene.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /** Resolve, compute and blur the occlusion, darken the colour, and leave the composite target bound (scene depth attached). */
  occlude(proj: Float32Array, p: SSAOParams): void {
    const gl = this.gl;
    if (this.ms) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.ms.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.scene.fbo);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    }
    const inv = invert4(proj);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.depthMask(false);
    gl.bindVertexArray(this.vao);
    const bindTex = (unit: number, t: WebGLTexture) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
    // occlusion
    let pr = this.progs.ao;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.aoT.fbo); gl.useProgram(pr.p);
    bindTex(0, this.scene.depth); gl.uniform1i(pr.u.uDepth, 0);
    gl.uniformMatrix4fv(pr.u.uProj, false, proj); gl.uniformMatrix4fv(pr.u.uInvProj, false, inv);
    gl.uniform2f(pr.u.uTexel, 1 / this.w, 1 / this.h);
    gl.uniform1f(pr.u.uRadius, p.aoRadius); gl.uniform1f(pr.u.uFalloff, p.distanceFalloff); gl.uniform1f(pr.u.uIntensity, p.intensity);
    gl.uniform3fv(pr.u.uKernel, this.kernel);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // blur
    pr = this.progs.blur;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurT.fbo); gl.useProgram(pr.p);
    bindTex(0, this.aoT.color); bindTex(1, this.scene.depth);
    gl.uniform1i(pr.u.uAo, 0); gl.uniform1i(pr.u.uDepth, 1); gl.uniform2f(pr.u.uTexel, 1 / this.w, 1 / this.h); gl.uniformMatrix4fv(pr.u.uInvProj, false, inv);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // composite into the output target (which shares the scene's depth for what is drawn next)
    pr = this.progs.composite;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out.fbo); gl.useProgram(pr.p);
    bindTex(0, this.scene.color); bindTex(1, this.blurT.color);
    gl.uniform1i(pr.u.uColor, 0); gl.uniform1i(pr.u.uAo, 1); gl.uniform1f(pr.u.uGamma, 1 / 1.1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  }

  /** Copy the finished frame to the canvas. */
  present(): void {
    const gl = this.gl, pr = this.progs.copy;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(pr.p); gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.out.color); gl.uniform1i(pr.u.uColor, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
  }

  private free(): void {
    const gl = this.gl;
    if (!this.w) return;
    for (const t of [this.scene.color, this.scene.depth, this.out.color, this.aoT.color, this.blurT.color]) gl.deleteTexture(t);
    for (const f of [this.scene.fbo, this.out.fbo, this.aoT.fbo, this.blurT.fbo]) gl.deleteFramebuffer(f);
    if (this.ms) { gl.deleteFramebuffer(this.ms.fbo); gl.deleteRenderbuffer(this.ms.color); gl.deleteRenderbuffer(this.ms.depth); this.ms = null; }
    this.w = this.h = 0;
  }

  dispose(): void {
    this.free();
    for (const k of ['ao', 'blur', 'composite', 'copy'] as const) this.gl.deleteProgram(this.progs[k].p);
    this.gl.deleteVertexArray(this.vao);
  }
}

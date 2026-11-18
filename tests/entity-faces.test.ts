import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENT, emitGeometry, type Geometry } from '../src/renderer/geometry';
import { LayerBuilder } from '../src/renderer/layer';

const geo = (size: [number, number, number], origin: [number, number, number] = [0, 0, 0]): Geometry => ({
  id: 't', bones: [{ name: 'b', pivot: [0, 0, 0], rotation: [0, 0, 0], bindPose: [0, 0, 0], neverRender: false, cubes: [{ origin, size, uv: [0, 0], inflate: 0, mirror: false }] }],
});
function emit(g: Geometry) {
  const sink = new LayerBuilder();
  emitGeometry(g, { poses: new Map(), isVisible: () => true, world: IDENT, color: [1, 1, 1], alpha: 1, emissive: false, texW: 32, texH: 32 }, sink);
  return sink.finish();
}
/** For every quad: the axis-aligned plane it lies in (axis, coordinate) and the sign of its outward normal. */
function planes(l: ReturnType<typeof emit>) {
  const out: { axis: number; at: number }[] = [];
  for (let q = 0; q < l.indices.length / 6; q++) {
    const vs = [0, 1, 2, 3].map((k) => l.indices[q * 6 + (k === 3 ? 5 : k)]);
    for (let a = 0; a < 3; a++) {
      const c = vs.map((i) => l.positions[i * 3 + a]);
      if (c.every((v) => Math.abs(v - c[0]) < 1e-6)) out.push({ axis: a, at: c[0] });
    }
  }
  return out;
}

// The game draws entities without back-face culling (a rib cage shows its inside through the holes), so cubes stay double-sided …
test('a closed cube emits six faces on the cube itself, with no normals (never culled by the viewer)', () => {
  const l = emit(geo([2, 2, 2]));
  assert.equal(l.indices.length / 6, 6);
  assert.equal(l.normals, undefined);
  assert.deepEqual(planes(l).map((p) => p.at).sort(), [0, 0, 0, 2, 2, 2]);
});

// … but a flat plane carries its two sides as two coincident faces (own uv each), which z-fought: the splash potion showed a
// grey plate. They are pushed apart along their normals so the nearer one wins from either side.
test('a flat plane\'s two faces are separated, not left coincident', () => {
  const l = emit(geo([0, 5, 8]));
  assert.equal(l.indices.length / 6, 2, 'east and west only (the faces with no area are skipped)');
  const xs = planes(l).filter((p) => p.axis === 0).map((p) => p.at).sort((a, b) => a - b);
  assert.equal(xs.length, 2);
  const gap = xs[1] - xs[0];
  assert.ok(gap > 0.001 && gap < 0.0625 / 2, `gap ${gap}: above the depth precision, far below a texel`);
  assert.equal(l.normals, undefined, 'still double-sided: an allay\'s wing has art on one side only and must show from both');
});
test('a plane with a single face is left alone', () => {
  const g = geo([0, 5, 8]);
  g.bones[0].cubes[0].uv = { east: { uv: [0, 0], uv_size: [8, 5] } } as never;
  const xs = planes(emit(g)).filter((p) => p.axis === 0).map((p) => p.at);
  assert.deepEqual(xs, [0], 'one face, exactly on the plane');
});

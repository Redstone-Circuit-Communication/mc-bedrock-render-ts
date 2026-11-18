import assert from 'node:assert/strict';
import test from 'node:test';
import { emitGeometry } from '../src/renderer/geometry';
import { LayerBuilder } from '../src/renderer/layer';
import { shadeOf } from '../src/renderer/face';

test('a zero-height plane shows the same picture on its top and bottom faces (the dragon\'s wings were rhombi)', () => {
  const geo = { id: 't', texW: 64, texH: 64, bones: [{ name: 'b', pivot: [0, 0, 0], rotation: [0, 0, 0], bindPose: [0, 0, 0], neverRender: false,
    cubes: [{ origin: [0, 0, 0], size: [8, 0, 8], uv: [0, 0], inflate: 0, mirror: false }] }] } as any;
  const faces: { n: number[]; corner: (u: number, v: number) => number[] }[] = [];
  emitGeometry(geo, { poses: new Map(), isVisible: () => true, world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], color: [1, 1, 1], alpha: 1, emissive: false, texW: 64, texH: 64,
    onQuad: (pts, uvs, n) => {
      const us = uvs.map((t) => t[0]), vs = uvs.map((t) => t[1]);
      faces.push({ n, corner: (u, v) => pts[uvs.findIndex((t) => t[0] === (u ? Math.max(...us) : Math.min(...us)) && t[1] === (v ? Math.max(...vs) : Math.min(...vs)))] });
    } }, new LayerBuilder());
  const up = faces.find((f) => f.n[1] > 0.5)!, down = faces.find((f) => f.n[1] < -0.5)!;
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const a = up.corner(u, v), b = down.corner(u, v);
    assert.deepEqual([a[0], a[2]], [b[0], b[2]], `texture corner (${u}, ${v}) lands on the same spot from above and from below`);
  }
});

test('meshes carry tints only: the light is three.js\'s, as in the Java package (no face shade baked in)', () => {
  for (const n of [[0, 1, 0], [1, 0, 0], [0, 0, -1], [0, -1, 0], [-1, 0, 0], [0, 0, 1]] as const) assert.equal(shadeOf(n as any), 1, JSON.stringify(n));
});

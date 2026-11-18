import { MeshLayerData, StructureMesh } from './mesher';

/**
 * Build three.js objects from a {@link StructureMesh}.
 *
 * The library does not import three.js; pass the namespace in:
 *
 * ```js
 * import * as THREE from 'three';
 * const { group, dispose } = createThreeObject(THREE, mesh);
 * scene.add(group);
 * ```
 *
 * Coordinates are in blocks with +y up, the structure's minimum corner at the origin.
 */
export function createThreeObject(THREE: any, mesh: StructureMesh, opts: { linearVertexColors?: boolean } = {}) {
  // Shading is baked in sRGB space (like the game). three.js treats vertex colours as linear.
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const convert = opts.linearVertexColors ?? true;

  const makeTexture = (w: number, h: number, data: Uint8Array) => {
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.flipY = false; // our uv origin is the top of the image, which is DataTexture row 0
    if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  };

  const makeGeometry = (l: MeshLayerData) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(l.positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(l.uvs, 2));
    let colors = l.colors;
    if (convert) {
      colors = new Float32Array(l.colors.length);
      for (let i = 0; i < colors.length; i += 4) {
        colors[i] = toLinear(l.colors[i]); colors[i + 1] = toLinear(l.colors[i + 1]);
        colors[i + 2] = toLinear(l.colors[i + 2]); colors[i + 3] = l.colors[i + 3];
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    g.setIndex(new THREE.BufferAttribute(l.indices, 1));
    g.computeBoundingSphere();
    return g;
  };

  const group = new THREE.Group();
  group.name = 'mcstructure';
  const disposables: { dispose(): void }[] = [];

  const addSet = (tex: any, solid: MeshLayerData, translucent: MeshLayerData) => {
    disposables.push(tex);
    if (solid.indices.length) {
      const mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
      const geo = makeGeometry(solid);
      group.add(new THREE.Mesh(geo, mat));
      disposables.push(geo, mat);
    }
    if (translucent.indices.length) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, vertexColors: true, transparent: true, depthWrite: false, alphaTest: 0.01, side: THREE.DoubleSide,
      });
      const geo = makeGeometry(translucent);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 1;
      group.add(m);
      disposables.push(geo, mat);
    }
  };

  addSet(makeTexture(mesh.atlas.width, mesh.atlas.height, mesh.atlas.data), mesh.solid, mesh.translucent);
  for (const b of mesh.entityBatches) addSet(makeTexture(b.image.width, b.image.height, b.image.data), b.solid, b.translucent);
  return { group, dispose: () => disposables.forEach((d) => d.dispose()) };
}

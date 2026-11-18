// Minimal stand-in for the parts of three.js the example app touches (used by the end-to-end test only; the real
// example resolves `three` from node_modules). Semantics follow three r186: Color stores linear values, Quaternion
// exposes `_x … _w`, EdgesGeometry has a `position` attribute of line-segment pairs and no index.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
export class Vector3 {
	constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
	set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
	copy(v) { return this.set(v.x, v.y, v.z); }
	clone() { return new Vector3(this.x, this.y, this.z); }
	fromArray(a, o = 0) { return this.set(a[o], a[o + 1], a[o + 2]); }
	setComponent(i, v) { if (i === 0) this.x = v; else if (i === 1) this.y = v; else this.z = v; return this; }
	applyQuaternion(q) {
		const { x, y, z } = this, tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
		this.x = x + q.w * tx + q.y * tz - q.z * ty; this.y = y + q.w * ty + q.z * tx - q.x * tz; this.z = z + q.w * tz + q.x * ty - q.y * tx;
		return this;
	}
}
export class Quaternion {
	constructor(x = 0, y = 0, z = 0, w = 1) { this._x = x; this._y = y; this._z = z; this._w = w; }
	get x() { return this._x; } get y() { return this._y; } get z() { return this._z; } get w() { return this._w; }
	copy(q) { this._x = q.x; this._y = q.y; this._z = q.z; this._w = q.w; return this; }
	invert() { this._x *= -1; this._y *= -1; this._z *= -1; return this; }
	equals(q) { return q._x === this._x && q._y === this._y && q._z === this._z && q._w === this._w; }
}
export class Raycaster {}
class Color { constructor(hex) { this.set(hex); } set(hex) { this.r = toLinear(((hex >> 16) & 255) / 255); this.g = toLinear(((hex >> 8) & 255) / 255); this.b = toLinear((hex & 255) / 255); return this; } }
class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; } }
class BufferGeometry { constructor() { this.attributes = {}; this.index = null; } setAttribute(n, a) { this.attributes[n] = a; return this; } getAttribute(n) { return this.attributes[n]; } dispose() {} }
export class BoxGeometry extends BufferGeometry { constructor(w = 1, h = 1, d = 1) { super(); this.parameters = { width: w, height: h, depth: d }; } }
export class EdgesGeometry extends BufferGeometry {
	constructor(g) {
		super();
		const { width: w, height: h, depth: d } = g.parameters, x = w / 2, y = h / 2, z = d / 2, c = [];
		const v = (i, j, k) => [i ? x : -x, j ? y : -y, k ? z : -z];
		for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { c.push(...v(0, i, j), ...v(1, i, j)); c.push(...v(i, 0, j), ...v(i, 1, j)); c.push(...v(i, j, 0), ...v(i, j, 1)); }
		this.setAttribute('position', new BufferAttribute(new Float32Array(c), 3));
	}
}
export class LineBasicMaterial { constructor(o = {}) { this.color = new Color(o.color ?? 0xffffff); this.opacity = o.opacity ?? 1; this.transparent = o.transparent ?? false; this.depthTest = o.depthTest ?? true; } }
export class LineSegments {
	constructor(geometry, material) { this.isLineSegments = true; this.geometry = geometry; this.material = material; this.position = new Vector3(); this.scale = new Vector3(1, 1, 1); this.quaternion = new Quaternion(); this.visible = true; this.name = ''; this.parent = null; this.children = []; this.raycast = () => {}; }
	removeFromParent() { if (this.parent) this.parent.remove(this); }
}

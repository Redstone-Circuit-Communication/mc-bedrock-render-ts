/**
 * 物品图标：给站点用的、像游戏物品栏里那样的图标（redstone-web/public/assets/item/{id}.png）。
 *
 *   tsx tools/item-icons.mts <资源包.zip> <输出目录> <清单.ts>
 *
 * 资源包 blocks.json 里的每一个方块：
 *   - 本来就是平面物品的（textures/items/ 里有同名贴图，或者门、告示牌、中继器、红石粉这些有专门的物品贴图），用物品贴图，按像素放大；
 *   - 交叉形的植物、铁轨、梯子、火把、栅栏这类薄的，也是平面的，用方块自己的贴图；
 *   - 其余的用本库的网格生成器建出模型（台阶是半格、活塞带推杆头、箱子是实体模型），按物品栏的角度画：
 *     正交，绕竖轴转 45°、往前倾 30°，看到顶面、南面（左）和东面（右）；先按两倍大小画再缩小，边缘平滑。
 * 有朝向的方块摆成物品栏里的样子（活塞朝上、炉子正面朝南…）。画不出来的（空气、结构空位之类）不出图，站点显示通用图标。
 * 清单是一个 TS 文件，列出所有生成了图标的 id，站点据此决定用哪张图，不会去请求不存在的文件。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { HoloTextures } from "../src/renderer/holoprint/textures.ts";
import { holoGeometry } from "../src/renderer/holoprint/model.ts";
import { buildStructureMesh } from "../src/renderer/mesher.ts";
import { ResourcePack, ResourceStack } from "../src/renderer/resources.ts";
import { buildMcStructure, parseMcStructure } from "../src/renderer/structure.ts";

const [packPath, outDir, manifestPath] = process.argv.slice(2);
if (!packPath || !outDir || !manifestPath) throw new Error("用法：tsx tools/item-icons.mts <资源包.zip> <输出目录> <清单.ts>");
const OUT = 64; // 输出的边长
const SS = 2; // 超采样倍数
const S = OUT * SS;

const stack = new ResourceStack([await ResourcePack.fromBytes(new Uint8Array(readFileSync(packPath)))]);
const geo = holoGeometry();
const tex = new HoloTextures(stack);
type Img = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
const imageCache = new Map<string, Img | null>();
async function image(path: string): Promise<Img | null> {
	if (!imageCache.has(path)) imageCache.set(path, ((await stack.loadImage(path)) as Img | null) ?? null);
	return imageCache.get(path)!;
}

// ---------- 哪些方块画成什么 ----------
const SKIP = /^(air|structure_void|light_block(_\d+)?|moving_block|piston_arm_collision|sticky_piston_arm_collision|unknown|info_update2?|reserved6|client_request_placeholder_block|border_block|allow|deny|camera|chemical_heat|portal|end_gateway|end_portal|fire|soul_fire|water|flowing_water|lava|flowing_lava|bubble_column)$/;
/** 有专门物品贴图、但名字和方块 id 对不上的 */
const ITEM_TEXTURE: Record<string, string[]> = {
	redstone_wire: ["textures/items/redstone_dust"],
	unpowered_repeater: ["textures/items/repeater"], powered_repeater: ["textures/items/repeater"],
	unpowered_comparator: ["textures/items/comparator"], powered_comparator: ["textures/items/comparator"],
	wooden_door: ["textures/items/door_wood"], iron_door: ["textures/items/door_iron"], dark_oak_door: ["textures/items/door_dark_oak"],
	trip_wire: ["textures/items/string"], reeds: ["textures/items/reeds"], frame: ["textures/items/item_frame"], glow_frame: ["textures/items/glow_item_frame"],
	bed: ["textures/items/bed_red"], standing_sign: ["textures/items/sign"], wall_sign: ["textures/items/sign"],
	cake: ["textures/items/cake"], candle_cake: ["textures/items/cake"],
};
/** 薄的、交叉形的：物品栏里是一张平面图，用方块自己的贴图 */
const FLAT_SHAPES = new Set(["cross_texture", "double_plant", "sunflower"]);
const FLAT_NAMES = /(^rail$|_rail$|ladder|vine|torch$|tripwire_hook|iron_bars|_pane$|^glass_pane$|^web$|lily_pad|waterlily|sapling|dead_bush|^fern$|large_fern|tall_grass|short_grass|^tallgrass$|seagrass|sea_pickle|kelp|hanging_roots|spore_blossom|glow_lichen|sculk_vein|pointed_dripstone|sulfur_spike|nether_sprouts|crimson_roots|warped_roots|twisting_vines|weeping_vines|cave_vines|chain$|lantern$|bell$)/;
/** 摆成物品栏里的样子 */
const ICON_STATES: Record<string, Record<string, string | number>> = {
	piston: { facing_direction: 1 }, sticky_piston: { facing_direction: 1 },
	observer: { "minecraft:facing_direction": "south" },
	dispenser: { facing_direction: 3 }, dropper: { facing_direction: 3 }, crafter: { orientation: "south_up" },
	barrel: { facing_direction: 1 },
};
const SOUTH = /^(lit_)?(furnace|blast_furnace|smoker)$|chest$|^lectern$|carved_pumpkin|lit_pumpkin|^loom$|beehive|bee_nest|^stonecutter_block$|^grindstone$|^anvil$|chipped_anvil|damaged_anvil|^decorated_pot$|^chiseled_bookshelf$|^vault$|^trial_spawner$|^campfire$/;
const iconStates = (id: string): Record<string, string | number> => ICON_STATES[id] ?? (SOUTH.test(id) ? { "minecraft:cardinal_direction": "south" } : {});
/** 自己发光的方块不画面的明暗（亮着的红石灯在小尺寸下要和灭着的分得开：站点用它表示「亮着 = 完成 / 当前页」） */
const GLOWING = /^(lit_redstone_lamp|glowstone|sea_lantern|shroomlight|(ochre|verdant|pearlescent)_froglight|lit_pumpkin|lit_redstone_ore|lit_deepslate_redstone_ore|beacon|magma|crying_obsidian|respawn_anchor)$/;

// ---------- PNG ----------
const CRC = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32(buf: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function png(rgba: Uint8ClampedArray, w: number, h: number): Buffer {
	const chunk = (type: string, data: Uint8Array) => {
		const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
		const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
		return Buffer.concat([len, td, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
	const raw = Buffer.alloc((w * 4 + 1) * h);
	for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}

// ---------- 光栅化 ----------
interface Tri { x: number[]; y: number[]; z: number[]; u: number[]; v: number[]; c: number[][]; img: Img | null; blend: boolean }
const YAW = -Math.PI / 4, PITCH = Math.PI / 6;
const K = (S * 0.9) / 1.62; // 一格方块的像素：立方体斜着看高约 1.57
function project(p: number[], cx: number, cz: number): [number, number, number] {
	const x = p[0] - cx - 0.5, y = p[1] - 0.5, z = p[2] - cz - 0.5;
	const x1 = x * Math.cos(YAW) + z * Math.sin(YAW), z1 = -x * Math.sin(YAW) + z * Math.cos(YAW);
	const y2 = y * Math.cos(PITCH) - z1 * Math.sin(PITCH), z2 = y * Math.sin(PITCH) + z1 * Math.cos(PITCH);
	return [S / 2 + x1 * K, S / 2 - y2 * K + K * 0.04, z2];
}
function rasterize(tris: Tri[]): Uint8ClampedArray {
	const out = new Uint8ClampedArray(S * S * 4);
	const zb = new Float32Array(S * S).fill(-Infinity);
	const order = [...tris.filter((t) => !t.blend), ...tris.filter((t) => t.blend).sort((a, b) => (a.z[0] + a.z[1] + a.z[2]) - (b.z[0] + b.z[1] + b.z[2]))];
	for (const t of order) {
		const [x0, x1, x2] = t.x, [y0, y1, y2] = t.y;
		const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
		if (Math.abs(area) < 1e-9) continue;
		const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(S - 1, Math.ceil(Math.max(x0, x1, x2)));
		const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(S - 1, Math.ceil(Math.max(y0, y1, y2)));
		for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
			const sx = px + 0.5, sy = py + 0.5;
			const w0 = ((x1 - sx) * (y2 - sy) - (x2 - sx) * (y1 - sy)) / area;
			const w1 = ((x2 - sx) * (y0 - sy) - (x0 - sx) * (y2 - sy)) / area;
			const w2 = 1 - w0 - w1;
			if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
			const z = w0 * t.z[0] + w1 * t.z[1] + w2 * t.z[2];
			const i = py * S + px;
			if (z <= zb[i]) continue;
			let r = 1, g = 1, b = 1, a = 1;
			if (t.img) {
				const u = w0 * t.u[0] + w1 * t.u[1] + w2 * t.u[2], v = w0 * t.v[0] + w1 * t.v[1] + w2 * t.v[2];
				const tx = Math.min(t.img.width - 1, Math.max(0, Math.floor(u * t.img.width))), ty = Math.min(t.img.height - 1, Math.max(0, Math.floor(v * t.img.height)));
				const o = (ty * t.img.width + tx) * 4;
				r = t.img.data[o] / 255; g = t.img.data[o + 1] / 255; b = t.img.data[o + 2] / 255; a = t.img.data[o + 3] / 255;
			}
			const c = [0, 1, 2, 3].map((k) => w0 * t.c[0][k] + w1 * t.c[1][k] + w2 * t.c[2][k]);
			r *= c[0]; g *= c[1]; b *= c[2]; a *= c[3];
			const o = i * 4;
			if (!t.blend) {
				if (a < 0.5) continue;
				out[o] = r * 255; out[o + 1] = g * 255; out[o + 2] = b * 255; out[o + 3] = 255;
				zb[i] = z;
			} else {
				if (a <= 0.004) continue;
				const da = out[o + 3] / 255, oa = a + da * (1 - a);
				out[o] = ((r * a + (out[o] / 255) * da * (1 - a)) / oa) * 255;
				out[o + 1] = ((g * a + (out[o + 1] / 255) * da * (1 - a)) / oa) * 255;
				out[o + 2] = ((b * a + (out[o + 2] / 255) * da * (1 - a)) / oa) * 255;
				out[o + 3] = oa * 255;
			}
		}
	}
	return downsample(out);
}
/** 两倍大小画完缩小一半：按透明度加权平均，边缘平滑、不发灰 */
function downsample(src: Uint8ClampedArray): Uint8ClampedArray {
	const out = new Uint8ClampedArray(OUT * OUT * 4);
	for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
		let r = 0, g = 0, b = 0, a = 0;
		for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
			const o = ((y * SS + dy) * S + (x * SS + dx)) * 4, w = src[o + 3] / 255;
			r += src[o] * w; g += src[o + 1] * w; b += src[o + 2] * w; a += w;
		}
		const o = (y * OUT + x) * 4;
		if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
		out[o + 3] = (a / (SS * SS)) * 255;
	}
	return out;
}
/** 平面物品：取第一帧（动画贴图是竖着排的一列）、按像素放大到输出尺寸，居中 */
function sprite(img: Img): Uint8ClampedArray {
	const side = Math.min(img.width, img.height);
	const out = new Uint8ClampedArray(OUT * OUT * 4);
	const scale = Math.max(1, Math.floor(OUT / side)), size = side * scale, off = Math.floor((OUT - size) / 2);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const s = (Math.floor(y / scale) * img.width + Math.floor(x / scale)) * 4, d = ((y + off) * OUT + (x + off)) * 4;
		for (let k = 0; k < 4; k++) out[d + k] = img.data[s + k];
	}
	return out;
}
const blank = (a: Uint8ClampedArray) => !a.some((_, i) => i % 4 === 3 && a[i] > 8);

// ---------- 分类 ----------
const ids = [...stack.blocksJson.keys()].filter((id) => !SKIP.test(id)).sort();
const flat = new Map<string, Img>();
const solid: string[] = [];
for (const id of ids) {
	const cands = [...(ITEM_TEXTURE[id] ?? []), `textures/items/${id}`, ...(/_door$/.test(id) ? [`textures/items/door_${id.replace(/_door$/, "")}`] : []),
		...(/_(standing|wall|hanging)_sign$/.test(id) ? [`textures/items/sign_${id.replace(/_(standing|wall|hanging)_sign$/, "").replace("dark_oak", "darkoak")}`] : []),
		...(/candle$/.test(id) ? [`textures/items/candles/${id}`] : [])];
	let img: Img | null = null;
	for (const c of cands) if ((img = await image(c))) break;
	if (!img && (FLAT_SHAPES.has(geo.shapeOf(id)) || FLAT_NAMES.test(id))) {
		for (const face of ["north", "up", "south"]) {
			const r = tex.resolve({ uv: [0, 0], uv_size: [1, 1], block_name: id, texture_face: face, variant: -1 } as never) as { tex?: string } | null;
			const path = r?.tex?.replace(/^@/, "").split("|")[0];
			if (path && (img = await image(path))) break;
		}
	}
	if (img) flat.set(id, img);
	else solid.push(id);
}

// ---------- 立体的：一个结构里摆开，建一次网格，按格子分 ----------
const COLS = Math.ceil(Math.sqrt(solid.length));
const cell = new Map<string, string>();
solid.forEach((id, i) => cell.set(`${(i % COLS) * 2},${Math.floor(i / COLS) * 2}`, id));
const W = COLS * 2, D = Math.ceil(solid.length / COLS) * 2;
const structure = parseMcStructure(buildMcStructure({
	size: [W, 2, D],
	blockAt: (x, y, z) => { const id = y === 0 ? cell.get(`${x},${z}`) : undefined; return id ? ({ name: `minecraft:${id}`, states: iconStates(id) } as never) : null; },
}));
const t0 = performance.now();
const mesh = await buildStructureMesh(structure, stack, { backend: "ts", entities: true });
console.log(`网格：${solid.length} 个立体方块，${mesh.stats.faces} 个面，${Math.round(performance.now() - t0)} ms`);
const tris = new Map<string, Tri[]>();
function collect(layer: { positions: Float32Array; uvs: Float32Array; colors: Float32Array; indices: Uint32Array }, img: Img, blend: boolean) {
	const P = layer.positions, U = layer.uvs, C = layer.colors, I = layer.indices;
	for (let k = 0; k < I.length; k += 3) {
		const vs = [I[k], I[k + 1], I[k + 2]];
		const cx = (P[vs[0] * 3] + P[vs[1] * 3] + P[vs[2] * 3]) / 3, cz = (P[vs[0] * 3 + 2] + P[vs[1] * 3 + 2] + P[vs[2] * 3 + 2]) / 3;
		const gx = Math.floor((cx + 0.5) / 2) * 2, gz = Math.floor((cz + 0.5) / 2) * 2;
		const id = cell.get(`${gx},${gz}`);
		if (!id) continue;
		const pr = vs.map((v) => project([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], gx, gz));
		const glow = GLOWING.test(id);
		const t: Tri = { x: pr.map((p) => p[0]), y: pr.map((p) => p[1]), z: pr.map((p) => p[2]), u: vs.map((v) => U[v * 2]), v: vs.map((v) => U[v * 2 + 1]), c: vs.map((v) => (glow ? [1, 1, 1, C[v * 4 + 3]] : [C[v * 4], C[v * 4 + 1], C[v * 4 + 2], C[v * 4 + 3]])), img, blend };
		(tris.get(id) ?? tris.set(id, []).get(id)!).push(t);
	}
}
const atlas = mesh.atlas as unknown as Img;
collect(mesh.solid, atlas, false);
collect(mesh.translucent, atlas, true);
for (const b of mesh.entityBatches) {
	collect(b.solid, b.image as unknown as Img, false);
	collect(b.translucent, b.image as unknown as Img, true);
}

// ---------- 写文件 ----------
mkdirSync(outDir, { recursive: true });
const made: string[] = [];
for (const [id, img] of flat) { writeFileSync(join(outDir, `${id}.png`), png(sprite(img), OUT, OUT)); made.push(id); }
let empty = 0;
for (const id of solid) {
	const t = tris.get(id);
	if (!t?.length) { empty++; continue; }
	const px = rasterize(t);
	if (blank(px)) { empty++; continue; }
	writeFileSync(join(outDir, `${id}.png`), png(px, OUT, OUT));
	made.push(id);
}
// 通用图标：一块不带贴图的灰色方块（站点认不出 id 时用它）
{
	const quad = (a: number[], b: number[], c: number[], d: number[], shade: number): Tri[] => [[a, b, c], [a, c, d]].map((tri) => {
		const pr = tri.map((p) => project(p, 0, 0));
		return { x: pr.map((p) => p[0]), y: pr.map((p) => p[1]), z: pr.map((p) => p[2]), u: [0, 0, 0], v: [0, 0, 0], c: tri.map(() => [0.62 * shade, 0.64 * shade, 0.68 * shade, 1]), img: null, blend: false };
	});
	const g = [...quad([0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0], 1), ...quad([0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], 0.8), ...quad([1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1], 0.62)];
	writeFileSync(join(outDir, `_unknown.png`), png(rasterize(g), OUT, OUT));
}
made.sort();
writeFileSync(manifestPath, `/**
 * 有物品图标的方块 id（public/assets/item/{id}.png）。由 mc-bedrock-render-ts 的 tools/item-icons.mts 按资源包生成，不要手改。
 * 认不出的 id 用 _unknown.png（app/utils/item-icon.ts）。共 ${made.length} 个。
 */
export const ITEM_ICON_IDS: ReadonlySet<string> = new Set(${JSON.stringify(made.join(" "))}.split(" "))
`);
console.log(`图标：平面 ${flat.size}，立体 ${made.length - flat.size}，画不出来的 ${empty}；清单 ${made.length} 个`);

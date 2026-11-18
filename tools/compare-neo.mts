/**
 * 对照 neoHoloprintDB：同一个方块（名字 + 状态）交给 neo 的 NeoBlockGeoMaker.makePolyMeshTemplates（HoloPrint 原来的面级接口）
 * 和本库的 HoloGeometry.faces（它的 TypeScript 移植），逐面比较法线、顶点、贴图引用。
 *
 *   tsx tools/compare-neo.mts <neoHoloprintDB 目录> [结构文件…]      默认对照 example/public/schematics/*.mcstructure
 *
 * 输出：完全一致的方块数，不一致的按原因分组（面数不同、顶点不同、贴图不同）各列几个例子；退出码 1 表示有不一致。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { holoBlock, holoGeometry } from "../src/renderer/holoprint/model.ts";
import { hpName } from "../src/renderer/holoprint/geo.ts";
import { parseMcStructure } from "../src/renderer/structure.ts";

const neoDir = process.argv[2];
if (!neoDir) throw new Error("用法：tsx tools/compare-neo.mts <neoHoloprintDB 目录> [结构文件…]");
const files = process.argv.slice(3).length
	? process.argv.slice(3)
	: readdirSync("example/public/schematics").filter((f) => f.endsWith(".mcstructure")).map((f) => join("example/public/schematics", f));

function jsonc(path: string): any {
	const s = readFileSync(path, "utf8");
	let out = "", inStr = false;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (inStr) { out += c; if (c === "\\") out += s[++i]; else if (c === '"') inStr = false; continue; }
		if (c === '"') { inStr = true; out += c; continue; }
		if (s.startsWith("//", i)) { i = s.indexOf("\n", i) - 1; if (i < 0) break; continue; }
		if (s.startsWith("/*", i)) { i = s.indexOf("*/", i) + 1; continue; }
		out += c;
	}
	const v = JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
	if (v && typeof v === "object") delete v.$schema;
	return v;
}

const sandbox: any = { window: {}, console: { log() {}, debug() {}, warn() {}, error() {}, info() {} }, structuredClone, Math, JSON };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(neoDir, "core/NeoBlockGeoMaker.js"), "utf8"), sandbox);
const NeoMaker = sandbox.window.neoHoloprintDB_NeoBlockGeoMaker;
const data = (f: string) => jsonc(join(neoDir, "file", f + ".jsonc"));
const neo = new NeoMaker({ SCALE: 1, IGNORED_BLOCKS: [] }, data("blockShapes"), data("blockShapeGeos"), data("blockStateDefinitions"), data("blockEigenvariants"), sandbox.console);
const ours = holoGeometry();

const r = (n: number) => Math.round(n * 1000) / 1000 + 0;
/** 顶点（排好序）；平面（零厚度的方块）的法线 HoloPrint 会故意翻成朝上，只比实心面的法线 */
const key = (f: any, flat: boolean) => {
	const v = f.vertices.map((x: any) => x.pos.map(r).join(",")).sort().join(" ");
	return flat ? v : `${f.normal.map(r).join(",")}|${v}`;
};
const isFlat = (f: any) => new Set(f.vertices.map((x: any) => x.pos.map(r).join(","))).size === 4 && (() => {
	const p = f.vertices.map((x: any) => x.pos); const d = (i: number) => p[i].map((c: number, k: number) => c - p[0][k]);
	const a = d(1), b = d(2), c = d(3); const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	return Math.abs(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]) < 1e-6; })();
const texOf = (f: any, refs?: any[]) => {
	const t = typeof f.textureRefI === "number" && refs ? refs[f.textureRefI] : f.tex ?? f.textureRef;
	return t ? `${t.block_name ?? ""}:${t.texture_face ?? ""}:${t.variant ?? ""}:${t.terrain_texture_override ?? ""}:${t.texture_path_override ?? ""}` : "?";
};

const groups = new Map<string, string[]>();
const add = (g: string, s: string) => { const l = groups.get(g) ?? []; l.push(s); groups.set(g, l); };
let same = 0, total = 0;
const seen = new Set<string>();
for (const file of files) {
	const s: any = parseMcStructure(new Uint8Array(readFileSync(file)));
	for (const p of s.palette) {
		const block = holoBlock(hpName(p.name), p.states ?? {}, ours);
		const id = JSON.stringify(block);
		if (seen.has(id)) continue;
		seen.add(id);
		total++;
		let a: any[], b: any[];
		try { a = neo.makePolyMeshTemplates([structuredClone(block)])[0] ?? []; } catch (e) { add("neo 抛错", `${id} ${(e as Error).message}`); continue; }
		try { b = ours.faces(structuredClone(block) as any) ?? []; } catch (e) { add("本库抛错", `${id} ${(e as Error).message}`); continue; }
		// 平面：本库标 flat；neo 的看顶点是否共面且属于零厚度方块——两边都按「本库是平面的那些面」处理
		const flatB = new Set(b.filter((f) => f.flat).map((f) => key(f, true)));
		const k = (f: any) => key(f, flatB.has(key(f, true)));
		const ka = a.map(k).sort(), kb = b.map(k).sort();
		if (a.length !== b.length) {
			const inA = new Set(ka), inB = new Set(kb);
			const onlyA = ka.filter((x) => !inB.has(x)), onlyB = kb.filter((x) => !inA.has(x));
			// 本库少的面都被别的面挡住了：同一平面上有一个朝向相反、范围盖住它的面（方块内部两个部件贴在一起的那一面）
			const hidden = (x: string) => {
				const f = a.find((g) => k(g) === x)!;
				const plane = (g: any) => { const n = g.normal.map(r); const d = r(n[0] * g.vertices[0].pos[0] + n[1] * g.vertices[0].pos[1] + n[2] * g.vertices[0].pos[2]); return { n, d }; };
				const box = (g: any) => [0, 1, 2].map((i) => [Math.min(...g.vertices.map((v: any) => v.pos[i])), Math.max(...g.vertices.map((v: any) => v.pos[i]))]);
				const pf = plane(f), bf = box(f);
				return a.some((g) => g !== f && (() => { const pg = plane(g); const bg = box(g);
					return pg.n.every((c: number, i: number) => c === -pf.n[i]) && pg.d === -pf.d && bf.every(([lo, hi], i) => bg[i][0] <= lo + 1e-3 && bg[i][1] >= hi - 1e-3); })());
			};
			if (!onlyB.length && onlyA.every(hidden)) { add("本库只少画了被挡住的内部面（正常）", `${id}  neo ${a.length} / 本库 ${b.length}`); same++; continue; }
			if (!onlyA.length) { add("本库多画了面", `${id}  neo ${a.length} / 本库 ${b.length}  多出 ${onlyB[0]}`); continue; }
			add("面数不同", `${id}  neo ${a.length} / 本库 ${b.length}  neo 有本库没有 ${onlyA.length}（被挡住的 ${onlyA.filter(hidden).length}）；本库有 neo 没有 ${onlyB.length}  例 ${onlyA.find((x) => !hidden(x)) ?? onlyB[0]}`);
			continue;
		}
		if (ka.join(";") !== kb.join(";")) { add("顶点不同", `${id}  例：neo ${ka.find((k) => !kb.includes(k))}  本库 ${kb.find((k) => !ka.includes(k))}`); continue; }
		const refs = [...neo.textureRefs];
		const ta = a.map((f) => k(f) + "#" + texOf(f, refs)).sort(), tb = b.map((f) => k(f) + "#" + texOf(f)).sort();
		if (ta.join(";") !== tb.join(";")) { add("贴图引用不同", `${id}  例：neo ${ta.find((k) => !tb.includes(k))?.split("#")[1]}  本库 ${tb.find((k) => !ta.includes(k))?.split("#")[1]}`); continue; }
		same++;
	}
}
console.log(`对照 ${total} 个方块（名字 + 状态），完全一致 ${same}`);
for (const [g, l] of groups) {
	console.log(`\n${g}：${l.length}`);
	for (const x of l.slice(0, Number(process.env.SHOW ?? 12))) console.log("   ", x.slice(0, 260));
}
process.exit(groups.size ? 1 : 0);

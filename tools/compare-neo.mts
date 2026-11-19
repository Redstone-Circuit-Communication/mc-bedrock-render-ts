/**
 * Compares with neoHoloprintDB: the same block (name + states) goes to neo's NeoBlockGeoMaker.makePolyMeshTemplates (HoloPrint's
 * original per-face interface)
 * and to this package's HoloGeometry.faces (its TypeScript port); normals, vertices and texture references are compared face
 * by face.
 *
 *   tsx tools/compare-neo.mts <neoHoloprintDB folder> [structure files…]      default: example/public/schematics/*.mcstructure
 *
 * Output: how many blocks match exactly, and the mismatches grouped by cause (face count, vertices, textures) with a few
 * examples each; exit code 1 means there were mismatches.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { holoBlock, holoGeometry } from "../src/renderer/holoprint/model.ts";
import { hpName } from "../src/renderer/holoprint/geo.ts";
import { parseMcStructure } from "../src/renderer/structure.ts";

const neoDir = process.argv[2];
if (!neoDir) throw new Error("usage: tsx tools/compare-neo.mts <neoHoloprintDB folder> [structure files…]");
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
/** Vertices (sorted); HoloPrint deliberately turns the normals of flat (zero-thickness) faces upward, so only solid faces compare normals */
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
		try { a = neo.makePolyMeshTemplates([structuredClone(block)])[0] ?? []; } catch (e) { add("neo threw", `${id} ${(e as Error).message}`); continue; }
		try { b = ours.faces(structuredClone(block) as any) ?? []; } catch (e) { add("this package threw", `${id} ${(e as Error).message}`); continue; }
		// flat faces: this package marks them flat; for neo, coplanar vertices of a zero-thickness box. Both sides use this package's flat faces
		const flatB = new Set(b.filter((f) => f.flat).map((f) => key(f, true)));
		const k = (f: any) => key(f, flatB.has(key(f, true)));
		const ka = a.map(k).sort(), kb = b.map(k).sort();
		if (a.length !== b.length) {
			const inA = new Set(ka), inB = new Set(kb);
			const onlyA = ka.filter((x) => !inB.has(x)), onlyB = kb.filter((x) => !inA.has(x));
			// faces this package lacks are all hidden by another face: an opposite face on the same plane that covers it (where two parts of a block touch)
			const hidden = (x: string) => {
				const f = a.find((g) => k(g) === x)!;
				const plane = (g: any) => { const n = g.normal.map(r); const d = r(n[0] * g.vertices[0].pos[0] + n[1] * g.vertices[0].pos[1] + n[2] * g.vertices[0].pos[2]); return { n, d }; };
				const box = (g: any) => [0, 1, 2].map((i) => [Math.min(...g.vertices.map((v: any) => v.pos[i])), Math.max(...g.vertices.map((v: any) => v.pos[i]))]);
				const pf = plane(f), bf = box(f);
				return a.some((g) => g !== f && (() => { const pg = plane(g); const bg = box(g);
					return pg.n.every((c: number, i: number) => c === -pf.n[i]) && pg.d === -pf.d && bf.every(([lo, hi], i) => bg[i][0] <= lo + 1e-3 && bg[i][1] >= hi - 1e-3); })());
			};
			if (!onlyB.length && onlyA.every(hidden)) { add("this package only skips hidden inner faces (expected)", `${id}  neo ${a.length} / ours ${b.length}`); same++; continue; }
			if (!onlyA.length) { add("this package draws extra faces", `${id}  neo ${a.length} / ours ${b.length}  extra ${onlyB[0]}`); continue; }
			add("face count differs", `${id}  neo ${a.length} / ours ${b.length}  only in neo ${onlyA.length} (hidden ${onlyA.filter(hidden).length}); only in ours ${onlyB.length}  e.g. ${onlyA.find((x) => !hidden(x)) ?? onlyB[0]}`);
			continue;
		}
		if (ka.join(";") !== kb.join(";")) { add("vertices differ", `${id}  e.g. neo ${ka.find((k) => !kb.includes(k))}  ours ${kb.find((k) => !ka.includes(k))}`); continue; }
		const refs = [...neo.textureRefs];
		const ta = a.map((f) => k(f) + "#" + texOf(f, refs)).sort(), tb = b.map((f) => k(f) + "#" + texOf(f)).sort();
		if (ta.join(";") !== tb.join(";")) { add("texture references differ", `${id}  e.g. neo ${ta.find((k) => !tb.includes(k))?.split("#")[1]}  ours ${tb.find((k) => !ta.includes(k))?.split("#")[1]}`); continue; }
		same++;
	}
}
console.log(`compared ${total} blocks (name + states), ${same} match exactly`);
for (const [g, l] of groups) {
	console.log(`\n${g}: ${l.length}`);
	for (const x of l.slice(0, Number(process.env.SHOW ?? 12))) console.log("   ", x.slice(0, 260));
}
process.exit(groups.size ? 1 : 0);

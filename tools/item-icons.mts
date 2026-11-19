/**
 * Writes inventory-style item icons for every block of a resource pack as PNG files, plus a TypeScript manifest listing the
 * ids that got one (a site uses it to decide which picture to request). The drawing itself lives in `src/item-icons.ts`,
 * which `ItemAssets` also uses in the browser, so both produce the same icons.
 *
 *   tsx tools/item-icons.mts <resource pack .zip> <output folder> <manifest.ts>
 *
 * Ids that cannot be drawn (air, structure voids …) get no file; `_unknown.png` is a grey block for ids a site does not know.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { ItemIconRenderer, NO_ICON, type IconImage } from "../src/item-icons.ts";
import { ResourcePack, ResourceStack } from "../src/renderer/resources.ts";

const [packPath, outDir, manifestPath] = process.argv.slice(2);
if (!packPath || !outDir || !manifestPath) throw new Error("usage: tsx tools/item-icons.mts <resource pack .zip> <output folder> <manifest.ts>");

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
function png({ data, width: w, height: h }: IconImage): Buffer {
	const chunk = (type: string, body: Uint8Array) => {
		const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
		const td = Buffer.concat([Buffer.from(type, "latin1"), body]);
		const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
		return Buffer.concat([len, td, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
	const raw = Buffer.alloc((w * 4 + 1) * h);
	for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}

const stack = new ResourceStack([await ResourcePack.fromBytes(new Uint8Array(readFileSync(packPath)))]);
const renderer = new ItemIconRenderer(stack);
const ids = [...stack.blocksJson.keys()].filter((id) => !NO_ICON.test(id)).sort();
const t0 = performance.now();
const icons = await renderer.render(ids);
mkdirSync(outDir, { recursive: true });
for (const [id, icon] of icons) writeFileSync(join(outDir, `${id}.png`), png(icon));
writeFileSync(join(outDir, "_unknown.png"), png(renderer.unknownIcon()));
const made = [...icons.keys()].sort();
writeFileSync(manifestPath, `/**
 * Block ids that have an item icon (public/assets/item/{id}.png), generated from a resource pack by mc-bedrock-render-ts's
 * tools/item-icons.mts; do not edit. Unknown ids use _unknown.png. ${made.length} ids.
 */
export const ITEM_ICON_IDS: ReadonlySet<string> = new Set(${JSON.stringify(made.join(" "))}.split(" "))
`);
console.log(`icons: ${made.length} of ${ids.length} block ids in ${Math.round(performance.now() - t0)} ms; ${ids.length - made.length} cannot be drawn`);

/**
 * Builds ONE compact resource pack for the web from the game's `resource_packs` folder (or a zip of it).
 *
 *   tsx scripts/pack-resources.ts <resource_packs folder | .zip> <out.zip>
 *
 * Every `vanilla*` pack is read (loose files and `__brarchive/**.brarchive`), later versions override earlier ones, only
 * what the renderer draws is kept (block / entity / item / painting / armor textures, entity + model + animation
 * definitions, render controllers) and the key-merged JSON files (`terrain_texture.json`, `blocks.json`,
 * `item_texture.json`) are merged. The result is a few tens of MB instead of ~400 MB and loads as a single pack.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { crc32, deflateRawSync } from 'zlib';
import { DEFAULT_ROOTS, PBR_EXTRAS, ResourcePack, ResourceStack, isBrarchive, packOrder } from '../src/renderer/index';

const [input, output] = process.argv.slice(2);
if (!input || !output) { console.error('usage: tsx scripts/pack-resources.ts <resource_packs folder | .zip> <out.zip>'); process.exit(1); }

const keep = (p: string) => DEFAULT_ROOTS.some((r) => p.startsWith(r)) && !PBR_EXTRAS.test(p);

function* walk(dir: string, base = ''): Generator<[string, string]> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name), rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) yield* walk(full, rel); else yield [rel, full];
  }
}

function loadFolderPack(dir: string, name: string): ResourcePack {
  const pack = new ResourcePack();
  pack.name = name;
  for (const [rel0, full] of walk(dir)) {
    const rel = rel0.replace(/^__brarchive\//, '');
    if (rel.endsWith('.brarchive')) {
      const bytes = new Uint8Array(readFileSync(full));
      if (!isBrarchive(bytes)) continue;
      const prefix = rel.slice(0, -'.brarchive'.length) + '/';
      if (!DEFAULT_ROOTS.some((r) => r.startsWith(prefix) || prefix.startsWith(r))) continue;
      for (const [k, v] of ResourcePack.fromBrarchive(bytes, prefix, { roots: DEFAULT_ROOTS }).files) pack.files.set(k, v);
    } else if (keep(rel)) pack.add(rel, new Uint8Array(readFileSync(full)));
  }
  return pack;
}

async function load(): Promise<ResourceStack> {
  const stack = new ResourceStack();
  if (input.toLowerCase().endsWith('.zip')) { await stack.addBytes(new Uint8Array(readFileSync(input))); return stack; }
  const dirs = existsSync(join(input, 'manifest.json')) ? [input] : readdirSync(input).map((n) => join(input, n)).filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'manifest.json')));
  const packs = dirs.map((d) => loadFolderPack(d, d.split(/[\\/]/).pop()!));
  packs.sort((a, b) => { const x = packOrder(a.name, a), y = packOrder(b.name, b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return a.name < b.name ? -1 : 1; });
  packs.forEach((p) => stack.push(p));
  return stack;
}

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

(async () => {
  const stack = await load();
  console.log(`read ${stack.packs.length} packs`);
  const files = new Map<string, Uint8Array>();
  for (const p of stack.paths('')) { const b = stack.get(p); if (b) files.set(p, b); }

  // Definition files are merged BY IDENTIFIER across packs in the game, not replaced by file: a newer
  // `iron_golem.render_controllers.json` may hold only the crack overlay while the base controller sits in an older pack.
  const DEFINITIONS = /^(render_controllers|animations|animation_controllers|models)\/.+\.json$/;
  let merged = 0;
  for (const p of [...files.keys()].filter((k) => DEFINITIONS.test(k))) {
    const versions = stack.getAll(p);
    if (versions.length < 2) continue;
    const out: Record<string, any> = {};
    for (const bytes of versions) {
      let v: Record<string, any>;
      try { v = stack.parseJson(bytes); } catch { continue; }
      for (const [k, val] of Object.entries(v)) {
        if (/^(render_controllers|animations|animation_controllers)$/.test(k) && val && typeof val === 'object') out[k] = { ...(out[k] ?? {}), ...val };
        else if (k === 'minecraft:geometry' && Array.isArray(val)) {
          const cur: any[] = out[k] ?? (out[k] = []);
          for (const g of val) { const i = cur.findIndex((x) => x?.description?.identifier === g?.description?.identifier); if (i >= 0) cur[i] = g; else cur.push(g); }
        } else out[k] = val;
      }
    }
    files.set(p, enc(out)); merged++;
  }
  console.log(`merged ${merged} definition files that exist in several packs`);

  // key-merged JSON files
  const terrain: Record<string, unknown> = {};
  for (const [k, v] of stack.terrain) terrain[k] = { textures: v.paths.length === 1 ? v.paths[0] : v.paths };
  files.set('textures/terrain_texture.json', enc({ resource_pack_name: 'merged', texture_name: 'atlas.terrain', padding: 8, num_mip_levels: 4, texture_data: terrain }));
  const blocks: Record<string, unknown> = { format_version: '1.21.40' };
  for (const [k, v] of stack.blocksJson) blocks[k] = v;
  files.set('blocks.json', enc(blocks));
  const items: Record<string, unknown> = {};
  for (const p of stack.packs) { try { Object.assign(items, p.json('textures/item_texture.json')?.texture_data ?? {}); } catch { /* skip unreadable */ } }
  files.set('textures/item_texture.json', enc({ resource_pack_name: 'merged', texture_name: 'atlas.items', texture_data: items }));
  files.delete('textures/flipbook_textures.json');
  files.set('manifest.json', enc({ format_version: 2, header: { name: 'merged render pack', uuid: '00000000-0000-4000-8000-000000000000', version: [1, 0, 0], min_engine_version: [1, 21, 0] }, modules: [{ type: 'resources', uuid: '00000000-0000-4000-8000-000000000001', version: [1, 0, 0] }] }));

  // zip (png/jpg stored, everything else deflated)
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0, raw = 0;
  for (const [name, data] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const n = Buffer.from(name), d = Buffer.from(data), store = /\.(png|jpg)$/i.test(name);
    const body = store ? d : deflateRawSync(d, { level: 9 }), method = store ? 0 : 8, crc = crc32(d) >>> 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    parts.push(lh, n, body); central.push(ch, n);
    offset += 30 + n.length + body.length; raw += d.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(output, Buffer.concat([...parts, cd, end]));
  const top = new Map<string, number>(); for (const k of files.keys()) { const t = k.split('/').slice(0, 2).join('/'); top.set(t, (top.get(t) ?? 0) + 1); }
  console.log(`${files.size} files, ${(raw / 1e6).toFixed(1)} MB raw → ${(statSync(output).size / 1e6).toFixed(1)} MB zip: ${output}`);
  console.log([...top].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join('  '));
})();

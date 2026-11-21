/**
 * Writes `scripts/data/bedrock-entity-spawn.json` from Mojang's behaviour pack: for every entity the sample structures may
 * hold, the component groups its spawn event adds, the attributes it then has, its entity properties and variants (see
 * `scripts/lib/entity-defaults.ts`). The structure generator writes entities from that file.
 *
 *   tsx scripts/extract-entity-data.ts                      # downloads behavior_pack/entities of the tag below into .cache/
 *   tsx scripts/extract-entity-data.ts <behaviour pack dir>  # a local copy: the folder that holds entities/
 *
 * Afterwards: `pnpm schematics:coverage` regenerates the sample structures with the new data.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parseLenientJson, spawnDefaults, SpawnDefaults } from './lib/entity-defaults';

type Entry = SpawnDefaults & { young?: SpawnDefaults };

const TAG = 'v1.26.60.5';
const OUT = join('scripts', 'data', 'bedrock-entity-spawn.json');
const KINDS: Record<string, { summonable: boolean; living: boolean }> =
  JSON.parse(readFileSync(join('scripts', 'data', 'bedrock-entity-kinds.json'), 'utf8')).entities;
/** Kept in every world although `/summon` does not take these names. */
const SAVED_IN_WORLDS = new Set(['minecraft:villager_v2', 'minecraft:zombie_villager_v2']);

async function get(urls: string[]): Promise<Response> {
  let last = '';
  for (const url of urls) for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r;
      last = `${url}: HTTP ${r.status}`;
      if (r.status === 404) break;
    } catch (err) { last = `${url}: ${(err as Error).message}`; }
    await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
  }
  throw new Error(`download failed (${last})`);
}

/** Every `behavior_pack/entities/**.json` of the tag, downloaded once into .cache/. Returns the folder holding entities/. */
async function download(): Promise<string> {
  const dir = join('.cache', `bedrock-samples-${TAG}-behavior`);
  if (existsSync(join(dir, '.complete'))) return dir;
  console.error(`downloading the entity files of Mojang's behaviour pack ${TAG}…`);
  let paths: string[];
  try {
    const listing = await (await get([`https://data.jsdelivr.com/v1/packages/gh/Mojang/bedrock-samples@${TAG}?structure=flat`])).json() as { files: { name: string }[] };
    paths = listing.files.map((f) => f.name.replace(/^\//, ''));
  } catch {
    const tree = await (await get([`https://api.github.com/repos/Mojang/bedrock-samples/git/trees/${TAG}?recursive=1`])).json() as { tree: { path: string }[] };
    paths = tree.tree.map((t) => t.path);
  }
  paths = paths.filter((p) => /^behavior_pack\/entities\/.+\.json$/.test(p));
  if (!paths.length) throw new Error('the listing has no behavior_pack/entities files');
  let done = 0;
  const queue = [...paths];
  await Promise.all(Array.from({ length: 16 }, async () => {
    for (let p; (p = queue.shift());) {
      const r = await get([`https://cdn.jsdelivr.net/gh/Mojang/bedrock-samples@${TAG}/${p}`, `https://raw.githubusercontent.com/Mojang/bedrock-samples/${TAG}/${p}`]);
      const file = join(dir, p.replace(/^behavior_pack\//, ''));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      if (++done % 25 === 0) console.error(`  ${done} / ${paths.length}`);
    }
  }));
  writeFileSync(join(dir, '.complete'), `${paths.length}\n`);
  return dir;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : [];
  });
}

(async () => {
  const root = process.argv[2] ?? (await download());
  const entitiesDir = existsSync(join(root, 'entities')) ? join(root, 'entities') : root;
  const files = new Map<string, { file: string; json: any }>();
  for (const f of walk(entitiesDir)) {
    let json: any;
    try { json = parseLenientJson(readFileSync(f, 'utf8')); } catch (err) { console.warn(`${f}: unreadable (${(err as Error).message})`); continue; }
    const id = json?.['minecraft:entity']?.description?.identifier;
    if (typeof id === 'string') files.set(id.toLowerCase(), { file: relative(root, f), json });
  }
  console.error(`${files.size} entity files in ${entitiesDir}`);

  const entities: Record<string, Entry> = {};
  const report: string[] = [];
  for (const id of Object.keys(KINDS).sort()) {
    if (!KINDS[id].summonable && !SAVED_IN_WORLDS.has(id)) continue;
    const f = files.get(id);
    if (!f) { report.push(`${id}: no file in the behaviour pack`); continue; }
    const { defaults, warnings } = spawnDefaults(f.json, { living: KINDS[id].living });
    entities[id] = defaults;
    // the state of a baby, for entities whose spawn event can make one (the generator's ghastling)
    const young = spawnDefaults(f.json, { living: KINDS[id].living, young: true }).defaults;
    if (young.baby && JSON.stringify(young) !== JSON.stringify(defaults)) entities[id] = { ...defaults, young };
    for (const w of warnings) report.push(`${id}: ${w}`);
  }

  const before = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).entities ?? {} : {};
  const changed = Object.keys({ ...before, ...entities }).sort().filter((id) => JSON.stringify(before[id]) !== JSON.stringify(entities[id]));
  writeFileSync(OUT, JSON.stringify({
    source: `Mojang/bedrock-samples ${TAG} behavior_pack/entities, by scripts/extract-entity-data.ts: the state right after `
      + `the spawn event (randomize: largest weight; ranges: the middle; filters: normal difficulty, plains, day)`,
    official: true,
    entities,
  }, null, 1) + '\n');
  console.log(`wrote ${OUT}: ${Object.keys(entities).length} entities, ${changed.length} changed${changed.length ? ': ' + changed.join(', ') : ''}`);
  if (report.length) console.log('notes:\n  ' + report.join('\n  '));
  if (changed.length) console.log('next: pnpm schematics:coverage');
})().catch((err) => { console.error(err); process.exit(1); });

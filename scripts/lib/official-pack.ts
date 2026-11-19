/**
 * Mojang's official Bedrock resources (github.com/Mojang/bedrock-samples) for the tests and development scripts, layered the
 * way the example loads them: the entity geometry of an older release first, the current release on top (see README,
 * "Loading the official resources on demand"). The files listed in `example/public/packs/bedrock-samples-*.json` are
 * downloaded once into `.cache/` (not committed) and read from there afterwards. Nothing from Minecraft is kept in the
 * repository.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteResourcePack, ResourcePack } from '../../src/renderer/resources.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** Listings in override order, as the example uses them. */
export const OFFICIAL_LISTINGS = ['bedrock-samples-v1.21.50.7-entity-models.json', 'bedrock-samples-v1.26.60.5.json'];

let cached: Promise<ResourcePack[]> | undefined;

/** The official packs in override order (later ones override earlier ones), downloading them into `.cache/` the first time. */
export function officialPacks(): Promise<ResourcePack[]> {
  return (cached ??= Promise.all(OFFICIAL_LISTINGS.map(load)));
}

async function load(name: string): Promise<ResourcePack> {
  const listing = JSON.parse(readFileSync(join(root, 'example/public/packs', name), 'utf8')) as { tag: string; baseUrl: string | string[]; files: string[] };
  const dir = join(root, '.cache', name.replace(/\.json$/, ''));
  const complete = join(dir, '.complete');
  if (!existsSync(complete)) {
    console.error(`downloading Mojang's official Bedrock resources ${listing.tag} (${listing.files.length} files)…`);
    const remote = new RemoteResourcePack(listing.baseUrl, listing.files);
    await remote.prefetch(() => true, 64);
    const missing = listing.files.filter((f) => !remote.files.has(f));
    if (missing.length) throw new Error(`could not download ${missing.length} files, e.g. ${missing.slice(0, 3).join(', ')}`);
    for (const [path, bytes] of remote.files) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), bytes);
    }
    writeFileSync(complete, `${listing.files.length}\n`);
  }
  const files = new Map<string, Uint8Array>();
  for (const f of listing.files) files.set(f, new Uint8Array(readFileSync(join(dir, f))));
  const pack = ResourcePack.fromFiles(files);
  pack.name = `bedrock-samples ${listing.tag}`;
  return pack;
}

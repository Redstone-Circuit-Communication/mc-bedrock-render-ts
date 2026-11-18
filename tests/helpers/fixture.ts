import { ResourcePack, ResourceStack } from '../../src/renderer/resources';
import { createDefaultRegistry } from '../../src/renderer/blocks';
import { DIRS } from '../../src/renderer/models';
import { encodePng, swatch } from './png';

/**
 * A synthetic "newer vanilla packs" stand-in: flat-colour textures for every texture reference the block handlers
 * ask for that the real base pack lacks. It only exists so shapes of post-1.14 blocks can be tested and photographed
 * without Mojang's textures; the real textures come from the user's additional resource packs.
 */
export function buildFixturePack(base: ResourceStack, names: string[]): { pack: ResourcePack; refs: string[] } {
  // a stack that claims to have every texture, so handlers pick their first candidate and we can record it
  const permissive = Object.create(base) as ResourceStack;
  (permissive as any).hasTexture = () => true;
  (permissive as any).resolveTexturePath = (r: string) => (r.startsWith('@') ? r.slice(1) : 'textures/blocks/' + r.replace(/#.*/, ''));
  const reg = createDefaultRegistry();
  const need = new Set<string>();
  const states: Record<string, any>[] = [{}, { 'minecraft:cardinal_direction': 'north', open_bit: 0, upper_block_bit: 0, growth: 3, weirdo_direction: 0, books_stored: 5 }];
  for (const name of names) for (const s of states) {
    // both the HoloPrint model and the registry's own model (used when HoloPrint finds no texture for a block)
    for (const resolve of [reg.resolve.bind(reg), reg.resolveOwn.bind(reg)]) {
      let m: any;
      try { m = resolve({ name, states: s, x: 0, y: 0, z: 0, neighbor: () => null, isOpaque: () => false, resources: permissive } as any); } catch { continue; }
      if (!m) continue;
      for (const el of m.elements) for (const d of DIRS) { const f = el.faces[d]; if (f) need.add(f.tex); }
      for (const q of m.quads ?? []) need.add(q.tex.replace(/\|mask:.*$/, ''));
    }
  }
  const pack = new ResourcePack();
  pack.name = 'fixture';
  const terrain: Record<string, any> = {};
  const refs: string[] = [];
  for (const ref of need) {
    if (ref === 'missing' || base.hasTexture(ref)) continue;
    refs.push(ref);
    const key = ref.startsWith('@') ? ref.slice(1) : ref.replace(/#.*/, '');
    const file = ref.startsWith('@') ? key : `textures/blocks/${key}`;
    if (!pack.has(file + '.png')) pack.add(file + '.png', encodePng(16, 16, swatch(key, 16, /leaves|vine|lichen|petal|litter|grass|flower|bud|cluster|roots|fungus|sprout|crop/.test(key))));
    if (!ref.startsWith('@')) terrain[key] = { textures: file };
  }
  pack.add('textures/terrain_texture.json', new TextEncoder().encode(JSON.stringify({ resource_pack_name: 'fixture', texture_name: 'atlas.terrain', texture_data: terrain })));
  return { pack, refs };
}

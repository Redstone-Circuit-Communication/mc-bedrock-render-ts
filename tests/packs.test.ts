import test from 'node:test';
import assert from 'node:assert/strict';
import { isBrarchive, readBrarchive } from '../src/renderer/brarchive';
import { ResourcePack, ResourceStack } from '../src/renderer/resources';
import { encodePng, swatch } from './helpers/png';
import { writeZip } from './helpers/zipwriter';
import { hasPack, loadBasePack } from './helpers/pack';

const enc = (s: string) => new TextEncoder().encode(s);
const terrain = (key: string, path: string) => enc(JSON.stringify({ texture_data: { [key]: { textures: path } } }));

test('a zip holding several packs yields one pack per root, base pack first, later versions override', async () => {
  const files = new Map<string, Uint8Array>([
    ['resource_packs/vanilla_1.20/manifest.json', enc('{"header":{"version":[1,20,0]}}')],
    ['resource_packs/vanilla_1.20/textures/terrain_texture.json', terrain('copper_block', 'textures/blocks/copper_new')],
    ['resource_packs/vanilla_1.20/textures/blocks/copper_new.png', encodePng(16, 16, swatch('new'))],
    ['resource_packs/vanilla/manifest.json', enc('{"header":{"version":[1,0,0]}}')],
    ['resource_packs/vanilla/textures/terrain_texture.json', terrain('copper_block', 'textures/blocks/copper_old')],
    ['resource_packs/vanilla/textures/blocks/copper_old.png', encodePng(16, 16, swatch('old'))],
    ['resource_packs/vanilla/textures/blocks/stone.png', encodePng(16, 16, swatch('stone'))],
  ]);
  const packs = await ResourcePack.fromZipMulti(writeZip(files));
  assert.equal(packs.length, 2);
  assert.deepEqual(packs.map((p) => p.name), ['vanilla', 'vanilla_1.20']);
  const stack = new ResourceStack();
  await stack.addBytes(writeZip(files));
  assert.equal(stack.packs.length, 2);
  assert.equal(stack.resolveTexturePath('copper_block'), 'textures/blocks/copper_new', 'the later pack wins');
  assert.ok(stack.hasTexture('stone'), 'files of the earlier pack stay visible');
});

test('a zip with a single pack root loads exactly like fromZip', async () => {
  const files = new Map([['textures/blocks/stone.png', encodePng(16, 16, swatch('s'))], ['textures/terrain_texture.json', terrain('stone', 'textures/blocks/stone')]]);
  assert.equal((await ResourcePack.fromZipMulti(writeZip(files))).length, 1);
});

test('the real vanilla folder: brarchives are unpacked into pack paths', { skip: !hasPack }, async () => {
  const stack = await loadBasePack();
  assert.equal(stack.packs.length, 1);
  for (const p of ['entity/creeper.entity.json', 'textures/blocks/stone.png', 'textures/entity/boat/boat_oak.png', 'textures/items/apple.png', 'textures/painting/kz.png', 'textures/terrain_texture.json', 'models/entity/creeper.geo.json'])
    assert.ok(stack.get(p), `${p} should be present`);
});

test('brarchive layout', () => {
  const name = new TextEncoder().encode('a.txt');
  const bytes = new Uint8Array(16 + 256 + 3);
  bytes.set([0x7d, 0x27, 0x25, 0xb1, 0xa0, 0x52, 0x70, 0x26]); bytes[8] = 1; bytes[12] = 1;
  bytes[16] = name.length; bytes.set(name, 17);
  new DataView(bytes.buffer).setUint32(16 + 252, 3, true); bytes.set([1, 2, 3], 272);
  assert.ok(isBrarchive(bytes));
  const [e] = readBrarchive(bytes);
  assert.equal(e.name, 'a.txt'); assert.deepEqual([...e.data], [1, 2, 3]);
});

test('PBR companion files are skipped, real *_normal.png block textures (piston) are not', async () => {
  const { PBR_EXTRAS } = await import('../src/renderer/resources');
  assert.ok(PBR_EXTRAS.test('textures/blocks/stone_mers.tga'));
  assert.ok(PBR_EXTRAS.test('textures/entity/boat/boat_oak.texture_set.json'));
  assert.ok(PBR_EXTRAS.test('textures/blocks/stone_normal.tga'));
  assert.ok(!PBR_EXTRAS.test('textures/blocks/piston_top_normal.png'));
});

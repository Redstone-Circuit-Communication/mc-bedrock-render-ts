/**
 * Copper chests are drawn as chests (body, lid, latch; two side by side as a large chest) with the entity textures
 * Mojang's pack names them by: `copper_default` for the unoxidised one, `copper_<stage>` for the others, `_double` for a
 * large chest. They were drawn as plain copper cubes: the renderer looked for `copper`, which Bedrock does not have.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultRegistry } from '../src/renderer/blocks';
import { ResourceStack } from '../src/renderer/resources';
import { encodePng } from './helpers/png';
import { writeZip } from './helpers/zipwriter';

const enc = (s: string) => new TextEncoder().encode(s);

async function stackWith(paths: [string, number, number][]): Promise<ResourceStack> {
  const files = new Map<string, Uint8Array>([['manifest.json', enc('{"header":{"version":[1,0,0]}}')]]);
  for (const [path, w, h] of paths) files.set(path + '.png', encodePng(w, h, new Uint8Array(w * h * 4).fill(200)));
  const stack = new ResourceStack();
  await stack.addBytes(writeZip(files));
  return stack;
}
const south = { 'minecraft:cardinal_direction': 'south' };
function model(stack: ResourceStack, name: string, neighbor: (dx: number, dy: number, dz: number) => unknown = () => null) {
  return createDefaultRegistry().resolve({ name, states: south, x: 0, y: 0, z: 0, neighbor, isOpaque: () => false, resources: stack } as never)!;
}
const textures = (m: { elements: { faces: Record<string, { tex: string } | undefined> }[] }) =>
  [...new Set(m.elements.flatMap((e) => Object.values(e.faces).filter(Boolean).map((f) => f!.tex)))];

test('a copper chest is a chest with its copper texture, for every oxidation stage and waxed', async () => {
  const stack = await stackWith([
    ['textures/entity/chest/copper_default', 64, 64], ['textures/entity/chest/copper_oxidized', 64, 64],
  ]);
  for (const [name, tex] of [['copper_chest', 'copper_default'], ['waxed_copper_chest', 'copper_default'], ['oxidized_copper_chest', 'copper_oxidized'], ['waxed_oxidized_copper_chest', 'copper_oxidized']]) {
    const m = model(stack, name);
    assert.equal(m.elements.length, 3, `${name}: body, lid and latch`);
    assert.deepEqual(textures(m), [`@textures/entity/chest/${tex}`], name);
  }
});

test('two copper chests side by side are one large chest with the double texture', async () => {
  const stack = await stackWith([['textures/entity/chest/copper_default', 64, 64], ['textures/entity/chest/copper_default_double', 128, 64]]);
  const same = { name: 'copper_chest', states: south }; // the mesher strips the namespace from neighbours
  // facing south, the second half is on the +x side: this one leads, the other draws nothing
  const lead = model(stack, 'copper_chest', (dx, dy, dz) => (dx === 1 && dy === 0 && dz === 0 ? same : null));
  assert.deepEqual(textures(lead), ['@textures/entity/chest/copper_default_double']);
  const rest = model(stack, 'copper_chest', (dx, dy, dz) => (dx === -1 && dy === 0 && dz === 0 ? same : null));
  assert.equal(rest.elements.length, 0);
});

test('without the entity texture, a copper chest uses its own inventory textures, not copper blocks', async () => {
  const stack = await stackWith([
    ['textures/blocks/exposed_copper_chest_inventory_front', 16, 16], ['textures/blocks/exposed_copper_chest_inventory_side', 16, 16],
    ['textures/blocks/exposed_copper_chest_inventory_top', 16, 16],
  ]);
  const tex = textures(model(stack, 'exposed_copper_chest')).join();
  assert.match(tex, /exposed_copper_chest_inventory_front/);
  assert.doesNotMatch(tex, /copper_block/);
});

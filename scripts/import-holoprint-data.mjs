#!/usr/bin/env node
/**
 * Turns the four data files of neoHoloprintDB (`file/*.jsonc`) into the JSON the renderer bundles
 * (src/renderer/holoprint/data/*.json): comments and trailing commas out, then the corrections in `CORRECTIONS` below.
 *
 *   node scripts/import-holoprint-data.mjs <neoHoloprintDB folder>      # the folder that holds `file/`
 *
 * Afterwards run `pnpm test`: tests/holoprint-equivalence.test.ts runs the original geometry maker over the new data and
 * compares it with the TypeScript port block state by block state.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FILES = ['blockShapes', 'blockShapeGeos', 'blockStateDefinitions', 'blockEigenvariants'];

/**
 * Where the data is wrong for Bedrock's own block states (each one measured on real structures, see docs/HOLOPRINT.md).
 * Applied after every import, so updating the data cannot bring the mistakes back; tests/orientation.test.ts fails if one is lost.
 */
const CORRECTIONS = {
  /** `golden_dandelion` has no shape in the data: it fell back to a cube textured with the sprite. It is a cross, like the dandelion. */
  blockShapes(value) {
    value.individual_blocks.golden_dandelion ??= 'cross_texture';
    // `sulfur_spike` (26.x) is not in the data at all and fell back to a cube. Its blocks.json entry is laid out exactly like
    // pointed dripstone's (one face key per segment, terrain arrays [down, up]), so it gets the same cross shape.
    // UNVERIFIED: the state name is assumed to be `dripstone_thickness` like the dripstone's; without it the tip is drawn.
    value.individual_blocks.sulfur_spike ??= 'sulfur_spike';
  },
  blockShapeGeos(value) {
    value.sulfur_spike ??= [{ copy: 'cross_texture', terrain_texture: 'sulfur_spike_${#block_states.dripstone_thickness}' }];
    // The hopper's top is a zero-height plane meant to show its up face (the `hopper_top` ring), but a flat cube only keeps
    // its down face (drawn from both sides) and the data sets that face to `none`, so the top vanished. The kept face takes
    // the up texture instead.
    const top = value.hopper?.find((cube) => cube.size?.[1] === 0 && cube.textures?.down === 'none');
    if (top) top.textures.down = 'up';
  },
  /**
   * `torch_facing_direction` names the side the SUPPORTING block is on (every wall torch of the sample structures has a solid
   * block there), but the torch template puts the base on the opposite side: turn it 180°.
   */
  blockStateDefinitions(value) {
    value.rotations.block_shapes['torch,redstone_torch'] = { torch_facing_direction: { west: [0, 180, 0], east: [0, 0, 0], north: [0, -90, 0], south: [0, 90, 0], top: [0, 0, 0] } };
  },
};
const root = resolve(process.argv[2] ?? '.');
const out = new URL('../src/renderer/holoprint/data/', import.meta.url).pathname;

/** JSONC → value. Comments are only recognised outside strings. */
export function parseJsonc(text) {
  let s = '', i = 0, inString = false;
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      s += c;
      if (c === '\\') { s += text[i + 1]; i += 2; continue; }
      if (c === '"') inString = false;
    } else if (c === '"') { inString = true; s += c; }
    else if (text.startsWith('//', i)) { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j; continue; }
    else if (text.startsWith('/*', i)) { i = text.indexOf('*/', i) + 2; continue; }
    else s += c;
    i++;
  }
  return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1'));
}

for (const name of FILES) {
  const file = join(root, 'file', `${name}.jsonc`);
  if (!existsSync(file)) throw new Error(`${file} not found: pass the neoHoloprintDB folder`);
  const value = parseJsonc(readFileSync(file, 'utf8'));
  CORRECTIONS[name]?.(value);
  writeFileSync(join(out, `${name}.json`), JSON.stringify(value));
  console.log(`${name}: ${Object.keys(value).length} top-level entries`);
}
const license = join(root, 'file', 'LICENSE');
if (existsSync(license)) copyFileSync(license, join(out, 'LICENSE-HoloPrint.txt'));

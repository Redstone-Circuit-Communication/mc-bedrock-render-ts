import { BlockRegistry } from './blockutil';
import { RedstoneOptions, registerRedstone } from './redstone';
import { registerShapes } from './shapes';
import { registerModern } from './modern';
import { registerModern2, genericFallback } from './modern2';
import { registerPlants } from './plants';
import { registerSpecial } from './special';
import { registerUtility } from './utility';
import { HoloOptions, holoprintHandler } from './holoprint/model';

export * from './blockutil';
export { wireColor } from './redstone';
export type { RedstoneOptions } from './redstone';
export { holoprintHandler, holoprintModel, holoprintShapeOf, holoGeometry } from './holoprint/model';
export type { HoloOptions } from './holoprint/model';

/**
 * Registry with every built-in block shape. Extend it with
 * `registry.register('my_block', ctx => ...)` and pass it via `MeshOptions.registry`.
 */
export interface DefaultRegistryOptions extends RedstoneOptions {
  /**
   * Take block shapes from HoloPrint's block shape data (default true). The built-in handlers then only cover what HoloPrint
   * leaves out (neighbour-dependent connections, liquids, entity-drawn blocks) and supply material flags. `false` = the
   * built-in handlers alone (the shapes of versions ≤ 1.2).
   */
  holoprint?: boolean | HoloOptions;
}

export function createDefaultRegistry(opts: DefaultRegistryOptions = {}): BlockRegistry {
  const reg = new BlockRegistry();
  registerShapes(reg);      // generic shapes + cube fallback
  registerRedstone(reg, opts);
  registerSpecial(reg);     // trapdoors, hopper, target, bell, cauldron, scaffolding, lectern, chests
  registerPlants(reg);      // crops, double plants, corals, kelp, vines, mushroom blocks …
  registerUtility(reg);     // doors, gates, signs, banners, anvil, barrel, campfire, command blocks …
  registerModern(reg);      // copper bulbs, respawn anchors, honey, soul torches … (post-1.14 blocks)
  registerModern2(reg);     // sculk, amethyst, dripstone, dripleaves, vines, petals, candle cakes, shelves, hanging signs …
  const base = reg.fallback;
  reg.fallback = (c) => base?.(c) ?? genericFallback(c);
  if (opts.holoprint !== false) reg.primary = holoprintHandler(typeof opts.holoprint === 'object' ? opts.holoprint : {});
  return reg;
}

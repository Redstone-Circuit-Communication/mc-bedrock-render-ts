# mc-bedrock-render-ts

English | [简体中文](README.zh-CN.md)

A browser renderer for Minecraft **Bedrock Edition** structures (`.mcstructure`), drawn with three.js from Bedrock resource
packs. It powers the Bedrock half of the 3D view on [Redstone Archive](https://redstonearchive.top).

**Live example:** <https://redstone-circuit-communication.github.io/mc-bedrock-render-ts/> (English, with a switch to Chinese)

> **License: CC BY-NC-SA 4.0.** Block geometry data and `src/renderer/holoprint/geo.ts` come from
> [HoloPrint](https://github.com/SuperLlama88888/holoprint) by SuperLlama88888, as prepared in neoHoloprintDB by Purple Rain.
> The built SDK bundles that data with the code, so **the whole package is under that license**: give credit, no commercial
> use, and share adaptations under the same license. See [License](#license).

The API and module layout match its Java Edition sibling,
[mc-java-render-ts](https://github.com/Redstone-Circuit-Communication/mc-java-render-ts), so a site can pick the engine by
edition and call it the same way.

## Usage

```ts
import { createWorkshop } from "@rsw/mc-bedrock-render-ts";

const workshop = await createWorkshop({
	canvas,
	// one pack, or several layered in order: later packs override earlier ones
	resourcePackUrl: ["/packs/minecraft-data.zip", "/packs/my-textures.zip"],
});
const result = await workshop.loadUrl("/builds/door.mcstructure"); // or load(buffer, filename) / loadFile(file)
await workshop.camera.fit();
console.log(result.dimensions, result.materials, result.totalBlocks);
workshop.camera.setMode("ortho"); // "orbit" | "first" | "ortho"
const png = await workshop.screenshot();
await workshop.dispose();
```

Choosing the engine by edition:

```ts
import { createWorkshop as createBedrock } from "@rsw/mc-bedrock-render-ts";
import { createWorkshop as createJava } from "@rsw/mc-java-render-ts";
const createWorkshop = edition === "bedrock" ? createBedrock : createJava;
```

Without a bundler, `<script src="dist/mcstructure-renderer.browser.js">` exposes the package as `window.McStructureRenderer`.

### Chunk-by-chunk loading

```ts
const workshop = await createWorkshop({ canvas, resourcePackUrl, rendererOptions: { chunkLoading: { minIntervalMs: 50 } } });
await workshop.load(buffer, "door.mcstructure", {
	onStart: () => workshop.camera.fit(), // before the first chunk: the structure is in the scene and its size is known
	onChunk: (done, total) => progress(done, total),
	signal, // abort between two chunks with an AbortError
});
```

### Text and icons

The text the library produces (block and entity names, container titles, redstone readouts, CSV headers) is English by
default; `setLocale("zh-CN")` switches it to Simplified Chinese. `ItemAssets` gives icons as object URLs: blocks are drawn
the way the inventory shows them by `ItemIconRenderer`, which needs no WebGL and also runs in Node (`tools/item-icons.mts`
writes a whole set as PNG files); items use their `item_texture.json` icon.

```ts
import { setLocale, ItemAssets } from "@rsw/mc-bedrock-render-ts";

setLocale("zh-CN");
const assets = new ItemAssets(workshop.renderer);
assets.decorate(element, "minecraft:furnace");
```

### Streaming and the SDK build

A new `load` cancels one that is still streaming (`isAbortError(e)` is true); the previous structure stays visible until
the new one starts to appear. `pnpm build:sdk` produces `sdk/mc-bedrock-render/<version>/index.js`, a dependency-free ES
module that a site can load at runtime; `SDK_API` in `src/sdk.ts` changes only when the host has to adapt.

## Differences from the Java package

Members with the same name, parameters and return types are not listed. `docs/UNIFIED_API.md` has the full comparison.

| Java package | Bedrock package |
|---|---|
| `BlueprintLoader.load(buffer, filename)` accepts litematic / schem / schematic / nbt | Accepts `.mcstructure` only; returns the same `BlueprintResult` |
| `readBlockInventory(schematic, position)` | Optional third parameter `origin`; large chests pair through `pairx` / `pairz` / `pairlead` |
| `readRedstone(state, nbt)` | Same output, reading Bedrock state names (`redstone_signal`, `powered_bit`, `repeater_delay`, …) |
| `countLitematicMaterials(buffer)` | `countMcstructureMaterials(buffer)`, plus `countMaterials(buffer, filename)` |
| `ItemAssets(assetLoader, { renderer })`: 3D block icons drawn with WebGL | `ItemAssets(renderer or ResourceStack)`: block icons drawn by `ItemIconRenderer` without WebGL, item icons from `item_texture.json` |
| Recording through ffmpeg.wasm | Recording through the browser's `MediaRecorder`: `h264` (MP4 where available, otherwise WebM) and `vp9_alpha` |
| Sidebar, OBJ/STL/GLTF export, schematic diff, redstone simulation, region highlights | Not available |

## Resource packs

The library draws no textures of its own. Load the game's resource packs, optionally with a texture pack on top:

- Supported inputs: zip, `.mcpack`, a single `.brarchive`, the game's resource pack folder as a zip, or a zip of several packs.
- The game's `resource_packs` folder holds dozens of packs (`vanilla`, `vanilla_1.14` … `vanilla_base`), each with its
  `.brarchive` files in a `__brarchive/` subfolder. `pnpm run pack:resources -- <folder or zip> <out.zip>` combines them into
  one small pack with only what rendering needs (about 3 MB instead of 369 MB).
- Packs are layered: later packs override earlier ones, and `blocks.json` is merged field by field as in the game, so a
  texture pack that only changes a few properties keeps the rest.
- After loading, `mesh.stats` lists `unknownBlocks`, `missingTextures`, `unknownEntities` and `missingEntityTextures`.

### Loading the official resources on demand

Mojang publishes the game's resource pack in [bedrock-samples](https://github.com/Mojang/bedrock-samples). A
`RemotePackSource` loads it straight from there, file by file, without bundling anything:

```ts
const listings = await Promise.all(
	["bedrock-samples-v1.21.50.7-entity-models.json", "bedrock-samples-v1.26.60.5.json"].map(async (name) => (await fetch(`/packs/${name}`)).json()),
); // each { baseUrl, files }
const workshop = await createWorkshop({ canvas, resourcePackUrl: listings });
```

A listing holds file names only and is produced by `pnpm pack:list-official` from a clone of that repository at a release
tag. Two releases are layered, like the packs of different game versions in an installed game: the published pack of a
recent release no longer contains the legacy entity geometry whose bind poses lay quadrupeds down (polar bear, cat, fox,
llama …), so the entity models of v1.21.50.7 go underneath the current release. The workshop downloads every definition file up front (about 900 small JSON files); each structure then
downloads only the textures it uses, through jsDelivr with raw GitHub as the fallback, and the browser caches them. In
code, `RemoteResourcePack` can also be pushed onto a renderer's stack with `loadResourcePack(pack)`.

The example works this way: nothing from Minecraft is bundled with it or published with it.

## Blocks

- **Shapes come from HoloPrint's block geometry data** (`src/renderer/holoprint/`, 205 shapes): boxes, state-dependent
  rotations, texture variants and per-face UVs are all data-driven. Sources and porting details are in `docs/HOLOPRINT.md`.
  `createDefaultRegistry({ holoprint: false })` falls back to the earlier hand-written shapes.
- **Handled by the library itself**: anything that depends on neighbours (fences, glass panes and iron bars connecting,
  redstone wire, water and lava, large chest pairing), and beds, heads and shulker boxes, which go through entity rendering.
- When none of a block's faces has a texture (the pack's `blocks.json` does not list it), the hand-written shape is used;
  failing that, plant names with a matching texture become crosses, other names with a matching texture become cubes, and
  anything else is a placeholder cube.
- Checked against HoloPrint's own geometry face by face (1368 block states in the sample structures agree).
- Corners next to solid blocks are darkened the way the game's smooth lighting does (`MeshOptions.ambientOcclusion`, on by
  default); grass and leaves use the plains biome colours.

## Entities

- Mobs with client definitions use the pack's geometry, textures, render controllers and animations (resting pose, Molang
  evaluated with defaults).
- Hard-coded in the game and rebuilt here: boats (six woods), paintings (all vanilla paintings), dropped items, falling
  blocks and primed TNT. Client definitions without geometry that only lend textures to a block (decorated pot, trial
  spawner) are drawn as that block.
- Entities the game hides early in their life (evocation fangs, wind charges) are drawn at a moment when they are
  visible.
- Not drawn: worn and held items, armor stand poses, banner patterns, sign text, items in item frames, custom player skins.
- Every entity gets an `EntityRecord` (`mesh.entityRecords`) with a `status` of `model` / `builtin` / `unsupported` and its
  bounds.

## Known limitations

- Animations show the resting pose only: water, lava, fire and portals show their first frame.
- Format 1.8.0 entities play the `animation_controllers` from their definitions; the poses are derived from pack data and
  have not been compared against the game one by one.
- Data that only exists in behaviour packs is unavailable: properties such as `minecraft:climate_variant` use their defaults
  unless the structure saved a value.
- Large chests: each half stores 27 slots and the half with `pairlead = 1` comes first, following the Java convention.

## Development

```bash
pnpm install
pnpm build              # dist/ (ES module entry, browser bundle, type declarations)
pnpm test               # unit and integration tests
pnpm test:all           # build, consumer type check against the built package, tests
pnpm test:e2e           # the workshop flow and the example in a real browser (Playwright)
pnpm dev:example        # example at http://localhost:5173
pnpm build:example      # example/dist, as deployed to GitHub Pages
pnpm build:sdk          # sdk/mc-bedrock-render/<version>/ for runtime loading
pnpm pack:resources <resource_packs folder or zip> <out.zip>
pnpm data:import-holoprint <neoHoloprintDB folder>
pnpm schematics:coverage   # regenerate the every-block / every-entity example structures
```

The tests and development scripts render with Mojang's official resources, downloaded into `.cache/` (not committed) the
first time they are needed (`scripts/lib/official-pack.ts`), so the first test run needs network access. The example page
is English by default and follows a Chinese browser language; its strings are in `example/src/i18n.js`.

## License

[CC BY-NC-SA 4.0](LICENSE). The block geometry data in `src/renderer/holoprint/data/` and the geometry builder in
`src/renderer/holoprint/geo.ts` (a TypeScript port of HoloPrint's `BlockGeoMaker.js`) are licensed by their authors under
CC BY-NC-SA 4.0 (full text in `src/renderer/holoprint/data/LICENSE-HoloPrint.txt`, details in the `NOTICE.md` next to
it). Because the SDK bundles them with the rest of the code, the package as a whole is distributed under the same license:

- **Attribution**: credit HoloPrint and neoHoloprintDB in products that use the package;
- **NonCommercial**: no selling, and no placement behind ads or paywalls;
- **ShareAlike**: adaptations must be shared under the same license.

Third-party notices are in [NOTICE.md](NOTICE.md).

## Acknowledgements

- [HoloPrint](https://github.com/SuperLlama88888/holoprint) by SuperLlama88888 (CC BY-NC-SA 4.0): the block geometry data
  and the geometry builder.
- neoHoloprintDB by Purple Rain (CC BY-NC-SA 4.0): the curated edition of that data used here.
- [three.js](https://github.com/mrdoob/three.js) (MIT), [postprocessing](https://github.com/pmndrs/postprocessing) (Zlib)
  and [N8AO](https://github.com/N8python/n8ao) (ISC): rendering and post-processing.

Minecraft is a trademark of Mojang AB. This project is not an official Minecraft product and is not associated with
Mojang or Microsoft.

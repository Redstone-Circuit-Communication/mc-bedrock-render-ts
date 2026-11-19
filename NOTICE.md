# Notices

mc-bedrock-render-ts is licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (see
`LICENSE`), because it bundles the HoloPrint block geometry data described below.

## HoloPrint block geometry

The block geometry data in `src/renderer/holoprint/data/` and the geometry builder in `src/renderer/holoprint/geo.ts` come
from [HoloPrint](https://github.com/SuperLlama88888/holoprint) by SuperLlama88888, in the edition prepared by Purple Rain in
neoHoloprintDB. They are licensed under CC BY-NC-SA 4.0; the full license text is in
`src/renderer/holoprint/data/LICENSE-HoloPrint.txt` and the list of changes in `src/renderer/holoprint/data/NOTICE.md`.
The SDK build bundles them with the rest of the code, so the package as a whole is distributed under that license.

## Relation to mc-java-render-ts

This package mirrors the API of [mc-java-render-ts](https://github.com/Redstone-Circuit-Communication/mc-java-render-ts),
an AGPL-3.0-only fork of schematic-renderer. Code from that upstream project cannot be combined with CC BY-NC-SA material:
the gamma correction effect here is an independent implementation, and the WebAssembly mesh builder compiled from the
upstream Rust code was removed in 1.6.0 (the `wasm` backend option now uses the TypeScript mesh core). Lighting, camera and
ambient occlusion settings use the same parameter values as the Java package; no code is shared for them.

## Bundled dependencies

| Package | License |
| --- | --- |
| [three.js](https://github.com/mrdoob/three.js) | MIT |
| [postprocessing](https://github.com/pmndrs/postprocessing) | Zlib |
| [N8AO](https://github.com/N8python/n8ao) | ISC |

## Example assets

- `example/public/packs/bedrock-samples-*.json`: lists of file names in Mojang's official resource pack
  (github.com/Mojang/bedrock-samples, tags v1.26.60.5 and v1.21.50.7). The example downloads those files in the visitor's
  browser at runtime, and the tests and development scripts download them into `.cache/` (not committed); no Minecraft
  assets are kept in the repository or published with the example.

Minecraft is a trademark of Mojang AB. Minecraft assets are © Mojang AB. This project is not an official Minecraft product
and is not associated with Mojang or Microsoft.

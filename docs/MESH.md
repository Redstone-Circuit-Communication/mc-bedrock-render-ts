# Meshing

> **There is no wasm backend since 1.6.0.** It was compiled from the Java package's `mesh_builder_wasm`, whose Rust source is
> line-by-line similar (0.978) to the file of the same name in upstream schematic-renderer (AGPL-3.0), so it cannot ship in
> this package (CC BY-NC-SA 4.0); see `NOTICE.md`. The measurements below show it was not faster than the TS core anyway, so
> defaulting to `ts` costs no speed. Paragraphs below that mention wasm record 1.5 and earlier.

Blocks are meshed by one of two backends, chosen with `meshBackend` (`RendererOptions`) / `backend` (`MeshOptions`):

| Backend | How |
|---|---|
| `ts` (default) | block models → palette → 16³ chunks → the shared TypeScript mesh core (`./mesh`) culls hidden faces and merges |
| `legacy` | the original single-pass mesher, culling face by face per cell |

`wasm` is still accepted (so one set of options works with both renderers) and gives `ts`, without touching WebAssembly, so
a page's CSP needs no `wasm-unsafe-eval`. `mesh.stats.meshBackend` is the backend actually used and `mesh.stats.timings` the
time of each stage.

## Pipeline (`wasm` / `ts`)

1. Resolve each cell's block model (shared with `legacy`) and build the texture atlas.
2. **Palette**: one entry per distinct model, one geometry per colour. Colour = directional shade × biome tint × opacity,
   kept in the material and written as vertex colour per material group after building, so the viewer gets the same format
   as from `legacy`. Static models are shared objects (one Map lookup); dynamic ones (fences, stairs, fluid levels) are
   deduplicated per structure.
3. **Chunks**: 16 cells per chunk, two passes each (solid, translucent). A ring of cells around the chunk and opaque blocks
   take part in culling as "neighbours" without being output (the faces of translucent water are hidden by opaque blocks,
   glass culls glass).
4. The builder returns vertices / indices per material; the wasm output did not compress vertices, so merging compressed
   them by index.

wasm coordinates were Int16 × 1/1024, so a chunk could not exceed 31 cells (it is 16).

## Verified

- `tests/mesh-backends.test.ts`: on four structures (every block, containers, redstone, terrain) `wasm` and `ts` agreed quad
  by quad. The differences from `legacy` are of two kinds: the old mesher also drew pane / bar end faces against solid
  blocks and water faces inside water (all on planes between blocks, never visible); the new one also draws the floor face
  under translucent blocks such as honey blocks and frosted ice (the old one culled it, but the game lets you see through).
- 300 random chunks (blocks, slabs, glass cull groups, water, cross plants, multi-geometry entries, neighbours) compared
  wasm with the TS core directly: identical triangles, UVs, normals and materials, apart from ±1 quantization.
- `tests/mesh-fallback.test.ts`: when wasm is blocked, `ts` is used.
- In a real browser the same every-block mesh looked the same with `wasm` and `legacy`.
- The `legacy` path's output is byte-identical to the first-generation mesher (golden hashes).

## Speed: wasm was not faster

`pnpm bench:mesh` (Node 22, same machine, median of 3 runs after warm-up; terrain with slabs, fences, panes, water and
caves):

| Structure | legacy | ts | wasm |
|---|---|---|---|
| 48×64×48 (147 k cells) | 191 ms | 287 ms | 299 ms |
| 64×96×64 (390 k cells) | 328 ms | 270 ms | 323 ms |
| 64×384×64 (1.57 M cells) | 360 ms | 363 ms | 369 ms |

All three are in the same range. Where the time goes (64×96×64, milliseconds):

| Stage | legacy | ts | wasm |
|---|---|---|---|
| Resolving block models per cell | 69 | 78 | 80 |
| Palette + chunk lists | — | 56 + 49 | 78 + 18 |
| Builder (cull + merge) | within 344 | 168 | 176 |
| Decode + merge | — | 10 + 4 | 26 + 18 |

Culling and merging take only about half the time, and on that half wasm was slightly slower than the TS core (moving data
between JS and wasm), so it could not be faster overall. On small structures `legacy` skips the palette and is the fastest:
for the quickest small loads use `meshBackend: 'legacy'`.

The Java package is in the same situation: its worker runs the TS core (`mesh/core` of `LegacyMeshBuilder`),
`mesh_builder_wasm` only appears in two tests, and greedy merging is switched off there (UVs cannot repeat in an atlas).

## What could still be done

The largest costs are per-cell model resolution and the palette, not the builder: model resolution can run in parallel (Web
Workers; the Java package's `./mesh/worker` is already here), and parallelising the builder pays more than wasm would. Not
done yet.

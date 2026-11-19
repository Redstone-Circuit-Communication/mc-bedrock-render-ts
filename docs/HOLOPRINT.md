# Block shapes: HoloPrint's data

Block shapes (boxes, facing per state, texture variants, per-face texture coordinates) come from HoloPrint's block
geometry data, in the version curated by neoHoloprintDB 0.2.4. Shapes used to be hand-written, incomplete and often
inaccurate; now 205 shapes are described by data, and only what the data cannot express is still handled by hand.

Source, attribution and licence of the data (**CC BY-NC-SA 4.0: non-commercial, attribution required, adaptations shared
alike**) are in `src/renderer/holoprint/data/NOTICE.md`.

## How a block becomes a model

```
block name + states ──shapeOf──▶ shape name ──geo.ts──▶ faces (vertices, texture corners, texture references) ──textures.ts──▶ textures ──model.ts──▶ BlockModel (free quads)
```

- `src/renderer/holoprint/geo.ts`: a port of HoloPrint's `BlockGeoMaker.js`. Conditions (`if`), copies (`copy`,
  `copy_block`), per-state overrides (`block_states`), `${…}` interpolation, box merging and inner face culling, texture
  coordinates (`uv_rot`, `flip_textures_*`, `box_uv`, top and bottom turned 180°), per-box rotation, whole-block rotation per
  state and texture variants all follow the original step by step.
- `src/renderer/holoprint/textures.ts`: texture reference → renderer texture. `blocks.json` gives the `terrain_texture.json`
  key, then the variant is picked; texture packs layered on top still take priority.
- `src/renderer/holoprint/model.ts`: turns faces into `BlockModel.quads` and plugs in as the `BlockRegistry.primary`
  handler.
- Meshing: both mesh builders (`legacy` single pass and the palette one) read `quads`, and so does picking.

## Coordinates: the x axis is mirrored

HoloPrint's geometry is in pixels (0–16 per block) with **+x pointing west**: the face called `west` is at x = 16. The
renderer's world has +x east, so `model.ts` replaces each vertex's x with `16 - x` and negates the normal's x. Without the
flip every block is mirrored east–west. Two facts settle it: an east-facing stair (`weirdo_direction=0`) ends up with its
step on the side of smaller data x after rotation, and the per-face texture coordinates only match the game once mirrored.
neoHoloprintDB's own notes describe this differently from what was measured; the original HoloPrint code is taken as
authoritative.

## How the work is split with the library's own handling

HoloPrint's data looks at one block at a time, so the library still handles these itself (`KEEP_SHAPES` / `KEEP_BLOCKS`):

- Anything that depends on neighbours: connections of fences, bamboo fences, panes and iron bars, the four directions of
  redstone wire, water and lava (surface height, faces between the same fluid), pairing of large chests.
- Blocks the library never draws as block models: air and other invisible blocks such as light blocks, plus beds, heads,
  shulker boxes and moving blocks (drawn as entities, from the resource pack's definitions).

Material properties that HoloPrint's data lacks (render layer for stained glass and ice, translucency, culling between
identical neighbours `cullSame`, emissive light) come from the library's own model of the same block; `opaque` is kept only
when HoloPrint's shape is exactly one full block. When none of a block's faces finds a texture (the pack's `blocks.json`
does not list it), the whole block falls back to the library's own model; when only some faces miss, only the found faces
are drawn.

`createDefaultRegistry({ holoprint: false })` turns all of it off and falls back to the hand-written shapes of 1.2.

## Textures

- Grass, ferns, leaves, vines, lily pads, sugar cane and other biome-tinted textures keep the renderer's tinting
  (`MeshOptions.tints` adjusts it) rather than HoloPrint's pre-tinted inventory textures; the alpha of the grass block's
  side is used as a tint mask (see `docs/FLINT.md`).
- `bush`, `firefly_bush`, `open_eyeblossom` and `light_block*` use the `carried_textures` from `blocks.json`, as HoloPrint
  does.
- A few names missing from `blocks.json` come from a patch table (`BLOCKS_DOT_JSON_PATCHES`: `grass_block`, oak planks …).
- Candle flames need `textures/particle/particles`, so `textures/particle/` is among the pack folders kept
  (`DEFAULT_ROOTS`); the official pack listing includes it.
- Sign texture names use Bedrock's real block ids: the oak wall sign is `wall_sign` (texture `textures/entity/sign`), other
  woods are `spruce_wall_sign` and so on. There is no `oak_wall_sign` block.

## Differences from the original port

- No hologram scaling (`config.SCALE`) and no texture atlas of HoloPrint's own: faces keep texture references only.
- Nested rotations (`extra_rots`) are applied to each vertex innermost first (the original reverses the array once per
  vertex, which only matters for two or more levels).
- Errors are not logged but collected in `HoloGeometry.warnings`.
- Vertex coordinates snap to 1/64 pixel (1/1024 block), the quantization of the mesh core: floating-point noise such as
  28.999999 left by rotations would otherwise land in different cells in different builders.

## One place where neoHoloprintDB differs from the original HoloPrint

The `conditionallyGroup` inlined in neoHoloprintDB's `core/NeoBlockGeoMaker.js` returns its two groups in the opposite order
from the original HoloPrint's `utils.js`. `#optimizeGeometry` treats the first group as "boxes that must not be merged"
(those with `rot`), so with the order as shipped it is the **rotated** boxes that get merged and lose faces, while unrotated
ones stay. In practice the two planes of a cross plant are two rotated zero-thickness boxes, and one of them is merged away
(`tall_grass` has one plane fewer than in the original). The port follows the original order. The reference copy used by
the comparison test (`tests/holoprint/NeoBlockGeoMaker.reference.js`) changes only that line, which is marked in the file.
This is worth reporting to the neoHoloprintDB maintainers.

## Verification

- `tests/holoprint-equivalence.test.ts`: runs the original core (the reference copy) and the port in Node and compares all
  block states of the example structures (1368) one by one: every face's vertex positions, texture corners and texture
  references must agree. Negating any single rotation sign makes 56 states differ at once.
- Rendered in Chromium: a comparison scene of about 50 blocks with facings or states, and the "every block" example. Overall
  outlines and missing textures were checked (the comparison scene misses none); **blocks were not compared one by one
  with the game**.

## Known limitations

- Not compared with the game block by block, beyond the set above.
- The walls (`*_wall`) in the example structures saved no block states, so HoloPrint draws every branch and they look like
  crosses; real structures save the states and are not affected.
- Shapes were verified against one resource pack; with another pack, blocks whose texture file names differ fall back to
  the library's own model.
- Shapes that depend on block entity data (a lectern's book, a potted plant, a cauldron's colour, banners, pots) need the
  block entity saved in the structure; without it the data's defaults apply, and a condition on a missing field counts as
  true (some extra geometry is drawn).

## Changes to the data

The data itself (`src/renderer/holoprint/data/*.json`) has three changes; the rest matches neoHoloprintDB (the licence asks
for changes to be stated; see also `NOTICE.md` in that folder):

- **Torch rotation table**: `rotations.block_shapes` in `blockStateDefinitions.json` gains `torch,redstone_torch`, with the
  four horizontal directions of `torch_facing_direction` each turned 180° (`west:[0,180,0]`, `east:[0,0,0]`,
  `north:[0,-90,0]`, `south:[0,90,0]`). Reason: Bedrock's state names the side of the supporting block, and in real
  structures every wall torch has a solid block on the named side, while the data's torch template puts its base on the
  opposite side. `CORRECTIONS` in `scripts/import-holoprint-data.mjs` reapplies this after every import, and
  `tests/orientation.test.ts` checks it.
- **Hopper top**: the top of `hopper` in `blockShapeGeos.json` is a zero-height plane meant to show its up face (the
  `hopper_top` ring), but a flat cube only keeps its down face (drawn from both sides) and the data set that face to `none`,
  so the hopper had no top, in HoloPrint as well. The kept face takes the up texture (`textures.down: "up"`); also
  reapplied by `CORRECTIONS`.
- **Shape of `golden_dandelion`**: `individual_blocks` in `blockShapes.json` gains `golden_dandelion: cross_texture` (the data
  lacked it, so it became a cube named after its texture). Also reapplied by `CORRECTIONS`.

Facings checked and found **correct** (no change): the `minecraft:cardinal_direction` of repeaters and comparators is the
input side, with the output opposite (the data already has a 180° override). Evidence: the `OutputSignal` of four comparators
in a structure matches exactly how full the container on their `cardinal_direction` side is, and in the original Java model
the input end carries the double / adjustable torches while the arrow on top points to the output. Pistons'
`facing_direction` (0 down, 1 up, 2 south, 3 north, 4 east, 5 west, which differs from the standard mapping of other blocks)
is also right.

## Updating the data

```bash
pnpm data:import-holoprint <neoHoloprintDB folder>   # strips comments, writes src/renderer/holoprint/data/
pnpm test                                            # holoprint-equivalence compares the new data with the original core
```

Before swapping a new version's core JS into `tests/holoprint/NeoBlockGeoMaker.reference.js`, check whether the
`conditionallyGroup` line is still reversed from the original.

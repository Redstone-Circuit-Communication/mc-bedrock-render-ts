# Changelog

## Open-source release (unreleased)

- **Official resources only**: the example, the tests and the development scripts load Mojang's official resource pack
  (github.com/Mojang/bedrock-samples) instead of a pack kept in the repository. `RemoteResourcePack` downloads the files a
  structure needs from a CDN, with mirrors and retries, and waits for downloads that another caller already started.
  Two releases are layered like the packs of an installed game: the entity models of v1.21.50.7 under v1.26.60.5, because
  recent published packs no longer contain the legacy geometry whose bind poses lay quadrupeds down. Tests and scripts
  cache the files in `.cache/` (`scripts/lib/official-pack.ts`).
- **Geometry merges across packs**: a `minecraft:geometry` block inherits the bind pose of a legacy `geometry.x` block of
  the same identifier from any pack, not only from the same file, as the game does.
- **Undefined render controllers** fall back to the default controller (default geometry, material and texture): the
  published pack references `controller.render.iron_golem` without defining it, and the iron golem lost its body.
- **Entities that drew nothing**: evocation fangs and wind charges are hidden by their render controllers early in their
  life and are now drawn at a moment when they are visible; client definitions without geometry that only lend textures to
  a block (decorated pot, trial spawner) are drawn as that block. With the official resources all 131 entities of the
  every-entity example are drawn and match the game's own pack.
- **Inventory-style item icons**: `ItemIconRenderer` (`src/item-icons.ts`, moved out of `tools/item-icons.mts`, which now
  uses it and produces byte-identical icons) draws icons without WebGL; `ItemAssets` uses it for blocks, batching the
  icons asked for in the same tick. Bedrock icon names that follow no pattern (redstone, books, potions) are aliased.
- **`setLocale('en' | 'zh-CN')`**: the text this package produces (block and entity names, container titles and slot
  labels, inventory warnings, redstone readouts, CSV headers) is English by default and Simplified Chinese on request.
  Error messages are in English.
- The example page is English by default with a Chinese switch; comments and documentation are in English.
- **Smooth-lighting ambient occlusion**, as the game shades corners: the shared mesh core darkens each vertex of an
  axis-aligned face by the full opaque cubes next to its corner (two sides and the diagonal; brightness 1, 0.8, 0.6 and
  0.4, the game's values), and each quad is split along its brighter diagonal so the shading does not streak across the
  face (as in prismarine-viewer and other voxel renderers). On by default; `MeshOptions.ambientOcclusion: false` turns it
  off (the `legacy` backend draws without it).
- **Molang numbers may end in `f`** (`3.975f / 4.0f`): they evaluated to 0, which scaled the happy ghast to nothing and
  zeroed expressions of zombies, drowned, husks, piglins, ravagers, bats, striders and creakings.
- **Ghastlings**: a baby happy ghast is drawn at 0.2375 of the adult (the size lives in the behaviour pack); the
  every-entity example shows one next to the adult.
- **Shading on another structure**: meshes added while shading is on (another structure, chunks streaming in) now cast
  and receive shadows; before, only the meshes present when shading was switched on did.
- `pistonParts(schematic, position)`: an extended piston's base and arm, which the game treats as one piston; the example
  selects the piston from either part and boxes both, like a large chest. Picking hits a piston arm from any side (the arm
  cell has no model of its own; the base's shape is tested there).
- **Entities were dark with shading on**: the entity transform mirrors z, which reversed the winding of every entity quad,
  so normals computed from it pointed into the body and the shadow lookup, pushed along them, landed inside the entity.
  Quads are now wound around their outward normal.
- Screen-space AO is a light touch now (radius 1, intensity 2; orthographic 0.6 / 1.5): the corners are darkened by the
  mesh's smooth-lighting occlusion, and the old numbers turned a whole structure seen from afar into dark smudges.
- The every-entity example has no grass floor; the entities stand on the viewer's grid.
- The example's Vite base comes from `EXAMPLE_BASE` (relative by default), and the example looks up its structures, packs
  and icons under it.
- **Hoppers had no top**: HoloPrint's hopper top is a zero-height plane, of which only the down face is kept, and the data
  set that face to `none`. A data correction gives it the top texture (see `docs/HOLOPRINT.md`).
- **The ender dragon faced backwards**: its saved yaw points half a turn from the way its model faces; it now faces like
  every other mob, as in Java Edition.
- **Grass and leaves were too green and dark**: the default tints are the plains colours (0x91bd59 and 0x77ab2f instead of
  the item-icon defaults 0x79c05a and 0x48b518), and tints multiply the texture as sRGB values, matching the Java renderer.
- **Downloads retry**: every mirror is tried again after a growing pause (CDNs refuse requests now and then), fewer run at
  once (16), and a file that failed for a passing reason is retried by later loads; only a 404 gives up for good.
- Render settings gain `shading` and `chunkMs` (chunk-by-chunk loading), applied only when given; the presets match a
  typical host's (power saving 400 ms, balanced 200 ms, quality 5 ms with shading).
- The every-entity example leaves out client definitions that are not actors (decorated pot, trial spawner) and gives the
  ender dragon and the ghasts their own row.

## 1.6.1 (2026-11-18)

- Shading: every model casts shadows and the shadow map draws both faces (with single-sided materials only back faces were
  drawn, so block meshes without hidden faces left many surfaces without shadow); shadows use PCFShadowMap (recent three.js
  removed PCFSoftShadowMap and warns about it).
- The SDK build drops `console.log / info / debug` and no longer ships source maps.
- **A new build gets a new version number**: SDK version folders are cached for a long time, so files replaced under the
  same version keep being served from browsers' caches.

## 1.6.0 (2026-11-18)

Licence clean-up (see "Code shared with the Java renderer" in `NOTICE.md`):

- **The embedded wasm mesh builder is gone** (`src/wasm/`, `src/mesh/wasm.ts`, `scripts/embed-wasm.mjs`). It was compiled
  from the Java package's `mesh_builder_wasm`, whose Rust source is line-by-line similar (0.978) to the file of the same
  name in upstream schematic-renderer (AGPL-3.0), so it cannot ship in a CC BY-NC-SA package. The default backend is now
  `ts`; `backend: 'wasm'` is still accepted and gives `ts` without touching WebAssembly. `docs/MESH.md` measured that wasm
  was not faster than the TS core anyway. The SDK is about 185 KB smaller (base64 binary), and pages no longer need
  `wasm-unsafe-eval` in their CSP.
- **The gamma step is rewritten** (`src/renderer/gamma-effect.ts`): the previous file was 0.98 similar to upstream's
  `GammaCorrectionEffect.ts`. The new one is written from scratch on postprocessing's Effect interface with the same
  c^(1/γ) curve; it does nothing for γ ≤ 0 (before, only for γ = 0).
- Added `LICENSE` at the root (the full CC BY-NC-SA 4.0 text from creativecommons.org).
- The same release added `camera.setFrame / getFrame`, `setPose / getPose`, `setMode('first', { input: 'host' })` and
  `workshop.solids()` for host-driven framing and first person, lightweight shading (`shading` in `applyRenderSettings`,
  `setShading` in the three viewer), an anti-aliasing switch and multisampling, and stronger ambient occlusion;
  `applyRenderSettings` now also switches ambient occlusion. See the last section of `docs/UNIFIED_API.md`.
- The version went from 1.5.0 straight to 1.6.0; 1.5.1 was skipped.

## 1.5.0 (2026-11-18)

**The picture now comes from the Java package's rendering stack** (`src/renderer/three-viewer.ts`) instead of home-made
shading, occlusion and camera:

- Renderer: three.js `WebGLRenderer({ alpha, antialias, powerPreference: 'high-performance', preserveDrawingBuffer })`
  (Java's RenderManager).
- Lights: `AmbientLight(0xffffff, 2.2)` + `DirectionalLight(0xffffff, 1)` at (20, 20, −20) (Java's SceneManager).
- Materials: blocks use `MeshStandardMaterial`, `FrontSide`, nearest filtering and textures without a colour space;
  translucent faces follow its liquids (`transparent`, no depth writes). Tints multiply as linear colours like Java's
  `material.color` (here in the vertex colour). Entities use `MeshStandardMaterial` with `LinearSRGBColorSpace` textures,
  double-sided, and glowing entity textures double as emissive maps (as in Java).
- Camera: `PerspectiveCamera(60, aspect, 0.1, 1000)` with three's own `OrbitControls`, using Java's perspective preset
  (damping 0.08, distance 1–1000, pan 1.0, rotate 0.8, zoom 1.2); the orthographic camera uses its isometric preset.
- Post-processing: postprocessing's `EffectComposer` → `RenderPass` → n8ao's `N8AOPostPass` (radius 1, falloff 0.4,
  intensity 5, Medium; isometric 0.3 / 0.1 / 0.8) → `EffectPass(GammaCorrectionEffect(0.5), SMAAEffect())`.
- Dependencies: three 0.186.1, postprocessing 6.39.6, n8ao 1.10.3 (the same versions as the Java package), bundled into
  `dist` and the SDK; the SDK grew from about 570 KB to about 1.4 MB.
- Meshes no longer bake face brightness into vertex colours (`shadeOf` is always 1); three.js computes all lighting.
- Face culling follows Java's `FrontSide`: each triangle's winding follows its normal. Faces that must be visible from both
  sides (zero-thickness planes, faces of open boxes, since the inner wall of a hopper bowl is the back of its outer wall) are
  marked by material; the mesh core still culls them against neighbours, outputs them with zero normals, and the viewer
  adds a reversed copy of each.
- The home-made ambient occlusion, lighting curve and mouse handling of 1.4.4 were removed (`ssao.ts` stays only for the
  fallback viewer).
- Fallback: only environments where three.js cannot start (no real WebGL, such as tests in Node) use the old WebGL2 viewer.
- Tests: solid-layer normals in `occlusion.test.ts` and face brightness in `fixes-1.4.4.test.ts` follow the new rules.
  119 tests, 113 pass, 6 skipped as before.

## 1.4.4 (2026-11-18)

- **The ender dragon's wing membranes were diamonds**: the down face of entity cubes had its texture flipped along z. Both
  sides of zero-thickness planes are drawn, so seen from above the down face showed through the transparent parts of the
  up face, mirrored, and the triangular membranes added up to diamonds ("an extra pair of mirrored wings"). The down face
  now runs the same way as the up face, as in Java's ModelPart.Cube (`FACE_TABLE.down` in `geometry.ts`).
- **Lighting matches the Java package**: Java lights rough (Lambertian) materials with three.js ambient 2.2 + directional
  1.0 (from (20, 20, −20)), then applies its gamma (x²) and sRGB output. This package used Minecraft's fixed face
  brightness (top 1, bottom 0.5, sides 0.8 / 0.6), with harder contrast and no light direction. Blocks and entities now use
  the same lights (linear 0.70 … 1.02), and the shader ends with x^(1/1.1).
- **Ambient occlusion** (`src/renderer/ssao.ts`): the Java package enables N8AO by default; this package had none, and with
  only flat face brightness the picture looked like plastic. The solid layer is now drawn into a multisampled off-screen
  buffer, positions and normals are rebuilt from depth, 16 hemisphere samples with a depth-aware blur are multiplied into
  the colour, and the translucent layer, grid and labels are drawn on top. The presets match Java (perspective radius 1 /
  falloff 0.4 / intensity 5, isometric 0.3 / 0.1 / 0.8); `isSSAOEnabled` / `setSSAOEnabled` / `setSSAOPreset` /
  `setSSAOParameters` now take effect, and `postProcessingOptions.enableSSAO: false` turns it off. The algorithm is its own
  implementation, not N8AO, tuned by eye.
- **Mouse handling matches Java's OrbitControls**: right-drag pans along the camera's right and **up** directions
  (screenSpacePanning, the three.js default); before, vertical drags raised the target along world y, so with the camera
  looking down the structure slid the wrong way. Middle-drag zooms (dragging down zooms out); camera distance is limited to
  1–1000; the perspective field of view defaults to 60° (Java's perspective preset) instead of 45°.
- Tests: `tests/fixes-1.4.4.test.ts` (down-face texture direction, lighting), SSAO and panning in `renderer-api.test.ts`.
  119 tests, 113 pass, 6 skipped as before.
- **Not done**: single-sided rendering (back-face culling). See "Known issues" in the README.

## 1.4.3 (2026-11-18)

Checked by rendering each case in a browser; the bounding boxes of the example's 126 entities were compared one by one with
1.4.2, and all 22 that changed were looked at.

Entities:

- **Material alpha is not always transparency** (the pack has no `materials/entity.material`, so materials are classified by
  the names of the vanilla definitions and checked against the textures).
  - Glow markers: spider, cave spider (20 eye pixels with alpha 3), enderman (6, alpha 3), phantom (4, alpha 18). The 0.5
    alpha test used to drop the eyes.
  - Whole-body glow: glow squid (alpha 90 throughout), magma cube (29 / 126), unaffected by lighting like the blaze; before,
    the whole mob was dropped.
  - Tint masks: sheep (593 skin pixels with alpha 3 = untinted, wool at 255 tinted by `Color`), the collars of tamed wolves
    and cats. The sheep's skin, face and legs are back, and the wool is tinted. Tinting only happens when the texture really
    carries a mask (a wild wolf's texture is all 255, so it is not tinted collar-coloured all over).
- **A render controller's `textures` are the material's texture slots**, not several pictures: each controller draws once,
  enchantment glint slots (`textures/misc/enchanted_*`) are skipped, and the other slots are layered over the first by
  alpha (llama decor, horse markings, villager profession clothes). Before, each texture drew the model again: splash
  potions, lingering potions and experience bottles were covered with a grey gradient (the glint texture).
- **Experience orbs**: entities that face the camera through `query.camera_rotation` in their animation are drawn as 2D
  sprites; `overlay_color` is baked into the texture at its resting value (yellow-green), and `ignore_lighting` skips
  lighting.
- **`animation_controllers` from the definition of 1.8.0-format entities** are played (the game plays them; before,
  controllers were guessed by name and enabled for 5 entities). Controller short names and animation short names are two
  separate sets (a wolf's controller and the animation it plays are both called `wolf_setup`), so controllers are registered
  under their own aliases.
- **`this` of a root bone's position channel = pivot − (0, 24, 0)** (the rotation point of old Java models: a child bone is
  relative to its parent's pivot, a root bone to the model origin 24 pixels above the feet). Evidence: the wolf's setup
  animation spells out the rotation points of the Java wolf model one by one (body `-14` / `2`, legs `-16`, tail `-12`); only
  this way do body, legs and tail stay where the geometry puts them, with the mane moving to z = −3. The enderman's head is
  back above its body (it had stayed inside, with the jaw layer sticking out like two horns) and its feet touch the ground;
  the wolf's body is level. With 0 the wolf sank 14–16 pixels, the tripod camera sank 1.6 blocks into the ground, and
  axolotls and turtles were below ground; all of them stand on the ground now. Fish out of water lie on their side (the
  game's flopping animation), and fish in water in a structure swim upright (new `query.is_in_water`).
- **Boat paddles**: both kinds of boat have them, following the Java boat model (18-pixel shaft, 6×7 blade, tilted
  11.25°), at their resting angle.
- **The chest of a chest boat**: placed as in Java (4 pixels toward the stern), turned −90° so its front and latch face the
  passenger, with the lid texture starting at row 59 (it read 58 before) and the latch added.
- **The gap at the root of the ender dragon's wings is unchanged**: in the vanilla `dragon.tga` the corner of the inner
  membrane next to the body is transparent, and the geometry matches Java; Bedrock's animation does not sweep the wings
  back 14° as Java does, so the gap looks larger at rest.

Blocks:

- **Doors**: HoloPrint draws the whole door from the lower half (the model spans two cells) and gives the upper half no
  faces, so the upper half fell back to the library's hand-written door, adding a second door turned by other rules in the
  same cell (an "L" shape). An upper half standing on its own lower half is no longer drawn; the whole door uses the lower
  half's facing and open state and the upper half's hinge side (the game only updates the open state on the lower half; an
  open door's upper half still says `open_bit` 0). Door (and two-block plant) models are no longer cached per palette
  entry: two halves with the same state that belong to different doors used to get the same model.
- **Hoppers**: recent game versions write the string `minecraft:facing_direction` (`"down"`), and through the generic string
  rotation table `down` turned 90° about x, laying the hopper on its side. For the 19 shapes whose HoloPrint rotation table
  uses integers (hoppers, buttons, dispensers, barrels, item frames …) the string is converted to the integer first (0 down,
  1 up, 2 north, 3 south, 4 west, 5 east).
- **Large chests**: there was no large chest model, and each half was drawn as a small chest. Halves are now paired by the
  block entity's `pairx` / `pairz` (compared with its own `x` / `z`); without pairing data, adjacent chests of the same kind
  and facing are paired two by two along a row. The leading half draws a 30-pixel-wide large chest (`double_normal` /
  `trapped_double`, 128×64) and the other half draws nothing. Chests with an integer facing (`facing_direction`) all faced
  south before. Chest models are no longer cached per palette entry.
- **Brewing stands**: the three arms are planes, each showing half of `brewing_stand.png` (the front view of the whole stand).
  HoloPrint's template had the halves swapped left and right: the dark stripe next to the blaze rod ended up at the outer
  end of the arm, hanging down to the base, and an arm with a bottle looked right from one side and wrong from the other.
  Each face now keeps the side of the picture nearest the blaze rod against the rod, the same from both sides.

Tests: new `tests/fixes-1.4.3.test.ts` (8 tests); boats in `entities.test.ts` gain paddles and the chest boat's chest
position, and doors in `legacy-blocks.test.ts` follow the new rules. 116 tests, 110 pass, 6 skipped as before.

## 1.4.2 (2026-11-17)

Mobs (each checked by rendering in a browser):

- **The spikes of guardians and elder guardians floated above the body**: Molang's `this` is the channel's current value
  (including the rest value). The animations write `"target - this"` (setting the target), but `this` always started from 0,
  so the spikes were pushed 24 pixels too high. `this` now starts from the rest value (`AnimContext.rest`): a child bone
  takes "its pivot − its parent's pivot", a root bone 0, and rotations the geometry's rest rotation (the "rotation point"
  convention of old Java models, which matches the guardian's spikes and tail and the ender dragon). The spikes sit on the
  body's 12 edges again.
- **The ender dragon had only a body and one upright wing**: the geometry has no neck or tail, only a single `neck`
  template, which the game's dragon renderer repeats at the poses of `neck1`…`neck5` and `tail1`…`tail12`. All parts hang
  under `root` (whose pose raises and turns the dragon); wing tips, leg tips and feet are relative to the previous segment;
  the right limbs mirror the left. `dragonSegments` in `geometry.ts` rebuilds it that way, and `planEntity` mirrors the
  poses of the right limbs as well (components the pack already negates are not negated again). **This is derived from the
  data and the way the game draws it, and only applies to `geometry.dragon`.**
- **Sulfur cubes (`minecraft:sulfur_cube`) were always see-through and empty**: only a cube that has swallowed a block
  (`minecraft:sulfur_cube_archetype` ≠ `none`) has a see-through shell with the block inside; by default the core is
  opaque. That property is defined in the behaviour pack, not the resource pack, so `query.property` gave 0, and
  `0 != 'none'` was true, making every cube look like it had swallowed a block. The default is now `none`; a cube that has
  swallowed a block draws the block in its main hand inside the shell (`heldBlockDraws`, 10 pixels wide in the middle;
  **size and position are approximate**).
- Tests: `tests/mobs.test.ts`. 107 tests, 101 pass, 6 skipped as before.

## 1.4.1 (2026-11-17)

Fixes after a face-by-face comparison with neoHoloprintDB 0.2.4. **The geometry port itself matches neo**:
`tools/compare-neo.mts` runs neo's own `NeoBlockGeoMaker` in Node and compares all 1399 "block + states" of the example
structures face by face with this package; the only differences left are hidden inner faces (culled here, invisible), cross
plants (neo merges the two planes of the X into one; this package keeps both, as the game does), chests (not on this path)
and data this package adds itself. The problems seen in screenshots were all where the data does not reach:

- **Legacy block ids** (`holoprint/legacy.ts`, `modernBlock`): `yellow_flower`, `red_flower` + `flower_type`, `double_plant` +
  `double_plant_type`, `tallgrass` + `tall_grass_type`, `sapling` + `sapling_type`, `coral` / `coral_block` / `coral_fan*`,
  `tripWire` and `grass_path` are mapped to today's ids before looking up the shape. Before, they matched no shape and were
  drawn as full cubes with the flower texture on all six faces ("a ring of flowers"). The former `modernCoral` is merged in
  and still exported.
- **Upper halves missing states** (doors, two-block plants): filled in from the lower half of the same block below
  (`upperHalfStates`). Hand-made and generated structures often give the upper half only `upper_block_bit`, and the door's
  upper half turned elsewhere.
- **States read through interpolation get defaults too**: `requirements()` now also collects `${#block_states.X}`. The three
  arms of a brewing stand depend on `brewing_stand_slot_a/b/c_bit`, and without those states the arms vanished entirely.
- **New blocks**: `sulfur_spike` gets a cross shape like pointed dripstone (the data correction lives in
  `scripts/import-holoprint-data.mjs`); `shelf_mushroom` uses the pack's `models/blocks/shelf_mushroom_*.geo.json`. **The real
  state names of both have not been checked against samples** (the demo has no states); without states they draw the tip /
  small size.
- `dripstone_thickness` defaults to `tip` (before, pointed dripstone without states found no texture).
- Tests: `tests/legacy-blocks.test.ts`; the "blocks without textures" in `tests/blocks.test.ts` went from `shelf_mushroom` to
  none. 104 tests, 98 pass, 6 skipped as before.

## 1.4.0 (2026-11-16)

Runtime-loaded SDK builds: the renderer can be published as versioned SDK folders that a host page imports at runtime:

- **Chunk-by-chunk loading**: renderer option `chunkLoading: { minIntervalMs }` (same name as in the Java package). The
  structure is meshed one 16³ chunk at a time, bottom up, and each chunk shows as soon as it is built; each chunk takes at
  least `minIntervalMs` milliseconds including meshing, with the rest left idle (`setTimeout`), so slow devices get the main
  thread back between chunks. Empty chunks are skipped. Without the option the whole structure is built at once; rebuilds
  after changing the rendering bounds are always built at once.
  - Meshing: the chunk loop of `emitPalette` can hand out each chunk (`stream`), and `buildStructureMesh(…, progress)` calls
    `onAtlas`, then `onChunk(chunk, done, total)`, and still returns the whole mesh (stats, entities) at the end. The legacy
    backend has no chunks and hands out its whole result as one chunk.
  - Viewer: `StructureViewer.beginMesh(size, atlas)` first creates an object with only the texture,
    `ViewerObject.appendBlocks(solid, translucent)` adds one set of GPU buffers per chunk (sharing that texture, released
    with the first set only), and `appendEntities(batches)` adds the entities last; with entities hidden only the block
    sets are drawn.
  - Manager: `loadSchematic(id, source, props, { onProgress, onStart, signal })`. With chunk-by-chunk loading the structure
    enters the scene once its texture is ready (`onStart`), then each chunk fires `callbacks.onChunkProgress(id, done,
    total)` and the `schematicChunkProgress` event. Removing the structure, `dispose` or aborting through `signal` stops
    between chunks with an `AbortError`, and whatever is already in the scene is removed.
- **`BlueprintLoader.load(buffer, filename, { onStart, onChunk, signal })`** (and `Workshop.load`): `onStart` comes before
  the first chunk (the size is known, so the camera can be framed), `onChunk(done, total)` reports progress. With
  chunk-by-chunk loading the old structure stays until the new one has been parsed and starts to appear; a new `load`
  aborts one still in progress (which ends with an `AbortError`), so quick switches do not wait for chunks nobody looks at.
  `isAbortError(e)` recognizes that error.
- **SDK build**: `pnpm build:sdk` → `sdk/mc-bedrock-render/<version>/index.js` (one ES module with all dependencies, about
  550 KB) + `release.json` + HoloPrint's licence and notes. `src/sdk.ts` exports `SDK_API` (the contract version between
  hosts and the renderers, currently 1), `SDK_EDITION` and `SDK_VERSION`, and the build checks that `SDK_VERSION` matches
  package.json.
- Tests: `tests/chunk-loading.test.ts` (7 tests: chunk count and order, same face count as building at once, minimum
  interval per chunk, aborting, the renderer's progress and GPU groups, stopping on removal, the loader's abort and
  replacement). 100 tests, 94 pass, 6 skipped as before.

## 1.3.x (between 1.3.0 and 1.4.0)

Blocks:

- **Redstone torches faced the wrong way**: `torch_facing_direction` names **the side of the supporting block** (in real
  structures every wall torch has a solid block on the named side), but HoloPrint's torch template puts the base on the
  opposite side. `block_shapes` in `blockStateDefinitions.json` gains a 180° rotation table for `torch,redstone_torch` (the
  same mechanism as the existing `repeater,comparator`). `unlit_redstone_torch`, `soul_torch` and others with the same shape
  are fixed too.
- **Pistons (and beds, banners, lecterns) "overlapping"**: HoloPrint evaluates conditions on **missing block entity fields
  as `true`**, so a piston without a `PistonArm` block entity (hand-made or tool-generated structures) drew the retracted,
  extended and moving arms at once (46 faces). Missing fields are now inferred from the block's surroundings: a
  `*_piston_arm_collision` in front means extended, otherwise retracted (18 / 21 faces); banners' `Type`/`Base`, lecterns'
  `hasBook` and others get safe defaults. `tests/orientation.test.ts`.
- **Pistons in motion**: with `State` 1 / 3 the arm is placed continuously by `Progress` (the thick rod moves half a block,
  the thin rod and head a whole block), and `Progress = 0.5` matches HoloPrint's half-extended template face by face.
- **String facings of pistons**: `minecraft:facing_direction: "up"` in hand-made structures is converted to the integer the
  game writes before it goes to HoloPrint (the string table assumes models face north, while the piston model faces up,
  and turned it wrongly).
- **Translucent blocks only draw faces toward the camera**: the viewer had back-face culling off, so all six faces of a glass
  block were drawn and the alpha added up to bright white. The per-vertex normals from the mesh core are now passed to the
  translucent layer (`MeshLayerData.normals`), and the shader drops faces turned away from the camera; a zero normal marks a
  double-sided plane (cross planes and the like) and is kept. The solid layer carries no normals.
- **Face culling works per face direction** (the same rule as the Java package's `getBlockOcclusionFlags`): a direction is
  occluded only when fully opaque faces cover the whole 16 × 16 boundary. Slabs, piston bottoms and others now occlude the
  matching faces of their neighbours; **blocks whose textures have transparent holes (copper grates, old leaves,
  `stained_glass`, `tripWire` …) no longer occlude**: before, they culled their neighbours' faces and the void showed
  through the holes. About 2 % fewer faces across all structures, and pixel comparisons from six angles show no holes.
  `tests/occlusion.test.ts`.
- **Missing block states get their defaults**: structures written by the game carry all states, but hand-made ones and the
  generated examples do not (in `all-blocks.mcstructure` repeaters, comparators, droppers, dispensers, pistons, trapdoors
  and golden dandelions have `{}`, and doors only `upper_block_bit`). HoloPrint evaluates conditions on missing states as
  true, so **every branch was drawn at once**: repeaters with the torches of all four delays, doors in every open and hinge
  combination, droppers with the front texture on every side, all on top of each other. The adapter now fills in defaults
  for the states a shape reads (0 for numbers and bits, the game's default for strings: `attachment: standing`,
  `cauldron_liquid: water` …), only for real states on an allow list; variables the adapter computes itself (`Nbias`,
  `isJunction` …) are left alone. Trapdoors 60→6 faces, droppers/dispensers 12→6, repeaters 25→16, doors 20→10, pistons
  46→18. The port itself is unchanged, and the face-by-face equivalence test with the original HoloPrint is unaffected.
  `tests/states-sprites.test.ts`.
- **Extended piston arms were wrongly culled**: the boundary-face check only looked at whether a face lies on the cell's
  **plane**, not its **extent**. The extended head lies on the `x = 16` plane but reaches up to `y = 32` (the next cell), so
  it was treated as an east face of the piston's own cell and culled against **the piston cell's** neighbours (the arm
  cell's neighbours are the right ones). Now ① the `cull` of a HoloPrint face requires the whole face to be inside the cell;
  ② the palette mesher gives faces that leave their cell a zero normal (the core decides boundary faces by normal, and zero
  normals are never culled, in the wasm and TS cores alike); ③ pistons are not face-culled at all (`BlockModel.noCull`). With
  stone around a piston cell the arm has 11 faces instead of 7 (the old v1 ate 4), the same in both backends. A real
  structure went from 4889 to 5246 faces.
- **Golden dandelions were cubes**: the data has no shape for it, so it fell through to "a cube named after its texture",
  with the flower sprite on six faces. It is now a cross like the dandelion (`golden_dandelion → cross_texture` in
  `CORRECTIONS`). `tripWire`, `sulfur_spike` and `straw_bed` hit the same fallback and were not changed then.
- **Coral was cubes**: the legacy ids (`coral` + `coral_color` / `dead_bit`, `coral_fan`, `coral_fan_dead`, `coral_fan_hang` /
  `2` / `3`) did not match shape patterns such as `_coral$` and `_coral_fan$`, so they fell through to the cube fallback with a
  coral sprite on each face. They are now normalized to modern ids (`tube_coral`, `bubble_coral_fan`,
  `dead_fire_coral_wall_fan` …) and use the existing shapes and textures. `tests/blockgeo.test.ts`.
- **Straw beds (`straw_bed`)**: the pack has `models/blocks/straw_bed_head.geo.json` and `straw_bed_foot.geo.json`, which the
  renderer did not read, using the cube fallback instead. New `src/renderer/blockgeo.ts` reads `models/blocks/*.geo.json`
  (per-face UVs, cube rotation + pivot, mirrored because the geometry's +x points west), reusing the entity cube emitter with
  a new `onQuad` callback that collects faces; `head_piece_bit` picks head / foot. **The turning by
  `minecraft:cardinal_direction` has not been checked against a reference** and uses the same table as HoloPrint.
  `shelf_mushroom_*` has the same kind of geometry in the pack and was not hooked up then.
- **Viewer interaction matches Java** (the three.js OrbitControls values in `CameraManager`): rotate speed 0.8
  (`2π · 0.8 / canvas height` radians per pixel instead of a fixed 0.008), zoom speed 1.2 (`0.95^1.2` per wheel step instead of
  about 10.5 %), damping 0.08 (rotation and panning apply 8 % per frame and keep 92 %, gliding after release). Only user drags
  and the wheel are affected; programmatic `setView` is unchanged. Checked with real mouse events: the final yaw after a
  100-pixel drag matches the formula, and one wheel step zooms by 1.0635, Java's `1/0.95^1.2`. `tests/entity-poses.test.ts`.
- **Solid blocks stay double-sided rather than Java's `FrontSide`**: tried and reverted. HoloPrint's Bedrock geometry is
  designed for double-sided materials and has no inward-facing inner surfaces (the inner wall of a hopper bowl is really the
  back of the outer cube), while Java's JSON models spell out inner surfaces. Single-sided, the inner walls of hoppers in a
  real test structure disappeared (726 pixels). The translucent layer (glass and the like), pistons, faces leaving their
  cell and zero-thickness planes already follow Java's approach.

Entities:

- **Upright polar bears; wrong poses for cats, ocelots, foxes, parrots, rabbits, snow golems and villager hat brims**: one
  model file often holds both a legacy `geometry.x` (bones with a `bind_pose_rotation` that lays the upright-modelled body
  down) and a `minecraft:geometry` with the same identifier (the same cubes, but **no rotation at all**). The loader let the
  latter override the former and the pose was lost. New-style bones now inherit the `bind_pose_rotation` of the legacy bone
  with the same name (only when the new bone has no bone rotation, no bind pose and no cube rotation), and what the new
  format adds (the polar bear's ears) stays. 17 geometries have this double format.
- **Pigs lying flat, chickens as a flat slab, minecarts without walls**: a cube with a `rotation` but no `pivot` rotates about
  **the cube's centre**, not `[0,0,0]`. Evidence: rotating the four cubes of `minecart.v1.8` about their centres reproduces
  exactly the bone pivots written in its old v1.0 version, and pigs and chickens agree as well.
- **Sheep without heads, with white stubs for legs**: with geometry inheritance (`geometry.a:geometry.b`) Bedrock **merges
  the cubes** of bones with the same name and drops the inherited ones only when a bone says `reset: true` (all 60 `reset`s in
  the pack are true, and every bone that replaces its cubes, 6 in the enderman and 4 in the zombie villager, has one). The
  sheep's wool bones have no `reset`: the 6-high wool sleeves wrap the 12-high skin legs, and the wool cap wraps the head
  that sticks out further, both needing the skin underneath. The witch's warty nose works the same way. A child cube at the
  same position with the same size **replaces** the parent cube (the player's `leftArm` only changes the uv); one with a
  different position or size is **added**; the bone's own fields (`mirror`, `pivot` …) still come from the child.
  `tests/geometry-inheritance.test.ts`.
- **Spider legs as straight poles, a blaze with only a head**: client entities in the 1.8.0 format have no
  `scripts.animate`; the game plays the `controller.animation.<name>.move` next to them (spider: `default_leg_pose` + `walk`
  (weighted by `query.modified_move_speed`, 0 at rest) + `look_at_target`; blaze: `move` + `look_at_target`). The renderer
  never hooked them up. New `legacyControllers` finds the controller by entity name (or the owner name in the animation id;
  the cave spider declares `animation.spider.*`), keeps only controllers whose referenced animations are all in the
  entity's `animations`, and picks one among those with the same set. **Only enabled for verified entities** (spider, cave
  spider, blaze, cat, ocelot): enabling all of them sank the wolf by a block, the polar bear by 0.7 and the parrot by 0.4,
  and stretched the enderman to 3.5 (their controllers need `query` / `variable` values the renderer lacks). The lowest point
  of spider legs went from 0.31 to 0.02, cave spiders from 0.22 to 0.01. `tests/entity-poses.test.ts` (guards that no entity
  is pushed underground).
- **The two coinciding faces of zero-thickness planes fought over depth**: allay wings, bat wings, potions, experience
  bottles and other planes store front and back as two coinciding faces with their own uvs, and the depth test picked one at
  random (a splash potion showed a grey slab instead of the bottle). The two faces are now pushed 0.004 blocks apart along
  their normals, so the one nearer the camera wins; where the nearer face is transparent (an allay wing only has a picture on
  one side) the alpha test lets the face behind show. **Not made single-sided**: vanilla entity rendering does not cull back
  faces (Java's `entityCutoutNoCull`), and the gaps between a skeleton's ribs or the cut-outs of sulfur blocks need back
  faces to show the inside; with single-sided faces everywhere, skeletons, skeleton horses and guardians showed the
  background. `tests/entity-faces.test.ts`.
- **Fireballs and the like are 2D sprites, not 3D slabs**: `geometry.fireball` (fireballs, small fireballs, dragon fireballs)
  and `geometry.item_sprite` (snowballs, eggs, ender pearls, potions) are now drawn as **sprites that always face the camera**,
  like Java's `faceCamera`. All four vertices of a sprite sit at its centre, `MeshLayerData.billboards` gives each vertex an
  offset along the camera's right / up directions, and the vertex shader expands them with `uRight` / `uUp` (ordinary
  vertices have zero offsets); of a front/back pair only one is kept, and a fireball's single south face is kept as is.
  Fireballs are 2 blocks wide, small fireballs 0.5.
- **Slimes were a single plain-coloured block**: the shell (`slime_outer`, `sulfur_cube_outer`) was treated as solid and
  covered the core opaquely. Materials whose names end in `_outer` are treated as translucent, so the core's eyes and mouth
  show through.
- All 126 entities were rendered and compared before and after: only the bodies of sheep and witches changed; the body area
  of every other entity was pixel-identical (this was before the zero-thickness plane change; after it, 40 entities rendered
  on their own were compared: 26 pixel-identical, the rest being entities with planes).

## 1.3.0

- **Block shapes come from HoloPrint's data** (`src/renderer/holoprint/`, the 205 shapes of neoHoloprintDB 0.2.4): geometry
  generation is a TypeScript port of HoloPrint's `BlockGeoMaker.js`, compared face by face with the original (1368 block
  states of the example structures agree, `tests/holoprint-equivalence.test.ts`). Models gain "free quads"
  (`BlockModel.quads`), supported by both mesh builders and by picking. Blocks that depend on neighbours, water and lava, and
  blocks drawn as entities keep their existing handling; `createDefaultRegistry({ holoprint: false })` falls back to the
  shapes of 1.2. **The data is CC BY-NC-SA 4.0**; see `docs/HOLOPRINT.md` and `src/renderer/holoprint/data/NOTICE.md`.
- **x axis**: HoloPrint's geometry has +x pointing west and is mirrored into world coordinates when rendered.
- **One difference from neoHoloprintDB**: the two groups of its inlined `conditionallyGroup` are in the opposite order from
  the original HoloPrint, which merges rotated boxes (one plane fewer on cross plants); the port follows the original, and
  the reference copy used by the tests changes that one line (`docs/HOLOPRINT.md`).
- **API aligned with the Java package** (`docs/UNIFIED_API.md`): the public members of the Java renderer (`SchematicRenderer`
  107, `CameraManager` 53, `SchematicManager` 26, `SchematicObject` 78) are all provided apart from Java-only subsystems,
  with the same names and parameters; events use Java's names and payloads. The list is read from the Java sources by
  `scripts/extract-java-api.mjs` and checked by `tests/unified-api.test.ts`.
  - The constructor supports Java's four-argument form (resource packs → structures → `onRendererInitialized`, failures as
    `rendererError` on the canvas), and `createWorkshop` constructs the Java way.
  - Rendering bounds (slicing): `min <= block < max`; blocks outside are left out of the mesh; `schematic.bounds`,
    `setRenderingBounds`, `resetRenderingBounds`, a wireframe helper box.
  - Frame rate (`getFPS`, `getTargetFPS` (60 by default), `setIdleFPS`), background colour, grid, axes, camera modes, auto
    orbit, isometric angles, listing / adding / disabling / removing resource packs, `downloadScreenshot`, `takeScreenshot`
    with width, height and transparent background, recording (`MediaRecorder`: `h264`, `vp9_alpha`).
  - `schematicManager`: `schematics`, `loadSchematicFromFile` / `FromURL`, `removeAllSchematics`, the global extents,
    `dispose`; structure objects: `name`, `visible`, `bounds`, `getTightBoundsMin/Max`, `getAllBlocks` and more.
  - Options and callbacks accept Java's names (`showGrid`, `showAxes`, `enableAutoOrbit`, `autoOrbitDuration`, `idleFPS`,
    `onLoadingProgress` …); Java-only options are accepted and ignored.
  - The SSAO methods exist without effect (`isSSAOEnabled()` is always false).
- **For hosts**: `CameraControls.getView()` / `setView()` (`{ yaw, pitch, zoom }`, for share links),
  `countMaterials(buffer, filename)`, `isBlueprintFile`, `BLUEPRINT_EXTENSIONS`. See `docs/UNIFIED_API.md` for the Java side.
- **Resource packs**: `textures/particle/` is among the folders kept (candle flames need `textures/particle/particles`);
  `ResourceStack` invalidates the caches that depend on it when its packs change (`version`, `invalidate()`, `setPacks()`).
- **Screenshots**: a screenshot at a given size restores the canvas size and background and redraws right after `toBlob`, so
  no frame is drawn at the wrong size.
- 57 tests (29 new: Java API comparison, rendering bounds, renderer API, face-by-face comparison with the original
  HoloPrint), and `tests/public-api.ts` as a consumer type check; new scripts `scripts/extract-java-api.mjs` and
  `scripts/import-holoprint-data.mjs`.

## 1.2.1

- **Definition files merge by identifier**: in the game, render controllers, animations, animation controllers and
  geometry merge by identifier; this package used to let newer files replace older ones, losing the definitions of 151
  files (the iron golem's base render controller was lost, leaving only the translucent crack layer).
  `ResourceStack.getAll(path)` returns every pack's version; `scripts/pack-resources.ts` merges these files.
- **Grass block sides**: the alpha of `grass_side` is a tint mask, baked into the atlas with the biome colour
  (`|mask:grass`), instead of the untinted `grass_side_carried`.
- **Leaves**: spruce / birch use fixed colours, mangrove leaves are tinted, cherry / azalea / pale oak are not tinted.
- **Entity defaults**: `query.property('minecraft:climate_variant')` defaults to temperate (chickens / cows / pigs no longer
  pick the cold variant), plus `health` / `max_health` (iron golem 100, so the crack layer is no longer wrong).
- **Blocks**: double copper slabs, legacy wooden slabs; `water` models are shared per height.
- Added `docs/FLINT.md`; 28 tests (grass block mask, leaf colours, merging, entity defaults).

## 1.2.0

- **Resource packs**: the game's `__brarchive/` layout is recognized (before, such packs could not be read at all, the main
  reason new blocks had no textures); ray-tracing extras (`*_mers.tga`, `*_normal.tga`, `*.texture_set.json`) are skipped,
  `*_normal.png` (pistons) is kept; a broken `blocks.json` / `terrain_texture.json` only skips that pack.
- **`scripts/pack-resources.ts`**: merges a whole `resource_packs` folder into one resource pack of about 3.3 MB.
- **Blocks**: new blocks fixed to the texture names of the real pack (vines, dried ghasts), double copper slabs, legacy
  wooden slabs; coloured bed ids (`white_bed` …), `light_block_N` and `unknown` no longer draw placeholder blocks. Every id in
  `blocks.json` has a regression test.
- **Entities**: texture keys of the new boats, chest boat geometry, coloured beds, entity positions (world or relative
  coordinates detected automatically); `stats.entities` only counts entities that actually drew faces, plus a new
  `stats.undrawnEntities`.
- **Mesh backends**: a new palette + chunk meshing pipeline whose builder can be the Java package's wasm (default, falling
  back to the TS core) or the shared TS core; `legacy` is kept. Output agrees quad by quad, and speeds are in the same range
  (see `docs/MESH.md`). `mesh.stats.meshBackend` / `timings`.
- **Example**: the Java package's whole example (workbench, inspector, view controls, render settings, performance panel,
  minimal example) was moved into `example/` as is, changing only the package name, file format, resource pack and
  structure names; `scripts/generate-coverage-structures.ts` generates the every-block / every-entity / container / redstone /
  entity example structures.
- **Engine members** (used by the example, with the same names as in the Java package): `cameraManager` events,
  `flyControls`, `camera.quaternion`, `renderManager.setFrameProfilingEnabled/getFrameProfile`, `chunkVisibility.getStats`,
  `frameRendered` / `renderIdle`, `suspended`, `cubane.getAssetLoader()`, `schematic.group.add()` (line selection boxes),
  `entityManager.setVisible/setShowDebug`, `entity.snbt`, and the options `backgroundColor` / `targetFPS` /
  `cameraOptions` / `postProcessingOptions`.

## 1.1.0

An extension of the original `dist` (mcstructure-renderer); the original API (`McStructureRenderer`, `buildStructureMesh`,
`ResourcePack` …) is kept in full.

- **API aligned with `@rsw/mc-java-render-ts`**: `createWorkshop` / `BlueprintLoader` / `CameraControls` /
  `captureScreenshot` / `pickScene` / `listContainers` / `listEntities` / `ItemAssets` / `MaterialsCounter` /
  `readBlockInventory` / `readRedstone` / `nameFor` / `materialsToCsv` / `FrameStats` / `applyRenderSettings`, with the same
  names, parameters and return types as the Java package; subpaths `. / core / renderer / mesh / mesh/worker`.
- **Viewer**: several structures, orthographic view, first person (pointer lock + WASD), block grid, raycasting, frame rate
  limit, `suspend/resume`.
- **Resource packs**: several packs in one zip (`vanilla/`, `vanilla_1.xx/` …) layered by version; the default folders now
  include `textures/items`, `misc`, `painting`, armour and `environment`.
- **Blocks**: models for about 45 newer blocks (sculk, amethyst, pointed dripstone, big dripleaf, candle cakes, chiseled
  bookshelves, decorated pots, hanging signs, copper chests, vines, petals …) and a generic fallback by texture name.
- **Entities**: boats, paintings, dropped items, falling blocks, primed TNT; every entity has a bounding box and an
  `EntityRecord` (for picking and `listEntities`).
- **Meshing**: the layer buffers became growable typed arrays, empty blocks are resolved once, and culling no longer
  allocates objects per face; output is byte-identical to the original (golden hash test), and a large 64×384×64 structure
  went from 1545 ms to 544 ms.

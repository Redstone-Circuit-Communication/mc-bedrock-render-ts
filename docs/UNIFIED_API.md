# One API with the Java renderer

A host page that shows structures of both editions picks `@rsw/mc-java-render-ts` or `@rsw/mc-bedrock-render-ts` by edition
and keeps a single copy of its viewer code. So the public API of the two packages has to match. **The Java package is the
reference**: the Bedrock package only adds to its API and never changes its names, parameters or return values.

## How it stays the same

- `scripts/extract-java-api.mjs` reads every public member of `SchematicRenderer`, `CameraManager`, `SchematicManager` and
  `SchematicObject`, plus the events they emit, from the Java package's sources and writes `tests/fixtures/java-api.json`
  (currently matching `@rsw/mc-java-render-ts 1.0.3`).
- `tests/unified-api.test.ts` checks each one: every Java member either exists here or is on the test's "not applicable"
  list with a reason. The list must match what is actually missing: implementing a member means removing it from the list,
  and listing a member that exists fails too.
- `tests/public-api.ts` is a compile-only check (modelled on the Java package's `tests/public-api.ts`), including the
  methods a host viewer calls. `pnpm typecheck:consumer` compiles it against the built package.
- After the Java package changes:

```bash
pnpm api:extract-java <path to mc-java-render-ts>   # regenerates tests/fixtures/java-api.json
pnpm test                                          # new members: implement them, or list them as not applicable with a reason
```

## Using both from a host

```ts
type Edition = "java" | "bedrock";

async function openViewer(edition: Edition, canvas: HTMLCanvasElement, packUrl: string | string[]) {
	const lib =
		edition === "java"
			? await import("@rsw/mc-java-render-ts")
			: await import("@rsw/mc-bedrock-render-ts");
	const workshop = await lib.createWorkshop({ canvas, resourcePackUrl: packUrl as never });
	const result = await workshop.loadUrl(structureUrl); // .litematic and friends / .mcstructure
	await workshop.camera.fit();
	return { workshop, result };
}
```

Typical viewer controls and how they map onto both packages:

| The host needs | Call | Packages |
|---|---|---|
| Reset the view | `workshop.camera.fit()` | same |
| Screenshot | `workshop.screenshot()` or `workshop.renderer.takeScreenshot({ width, height, format, transparent })` | same |
| Download a screenshot | `workshop.renderer.downloadScreenshot(name, options)` | same |
| Orthographic / perspective / first person | `workshop.camera.setMode("ortho" \| "orbit" \| "first")`, or `renderer.setCameraMode("isometric" \| "perspective" \| "perspective_fpv")` | same |
| Grid, axes, background | `renderer.setGridVisible` / `setAxesVisible` / `setBackgroundColor` | same |
| Auto orbit | `renderer.setAutoOrbit` / `toggleAutoOrbit` / `setAutoOrbitDuration` | same |
| Slicing (look inside) | `renderer.setRenderingBounds(id, min, max)`, `getBounds(id).maxY = n`, `resetRenderingBounds(id)` | same |
| Share the current view (`ViewParams = { yaw, pitch, zoom }`) | `workshop.camera.getView()` / `setView(view)` | same (Java since 1.1.0) |
| Material list | per edition: `countLitematicMaterials` / `countMcstructureMaterials`, or `countMaterials(buffer, filename)` | **only Bedrock has `countMaterials`**, see below |
| Full screen, view toggles | done by the host | — |

## What is the same

| Area | Details |
|---|---|
| `createWorkshop` / `Workshop` | identical keys (`renderer`, `blueprints`, `camera`, `load`, `loadFile`, `loadUrl`, `screenshot`, `dispose`); initialized the same way: resource packs go into the constructor, it resolves only after `onRendererInitialized`, failures arrive as `rendererError` on the canvas, and there is a timeout |
| Constructor | `new Renderer(canvas, schematicData, defaultResourcePacks, options)`: resource packs load first, then structures, then `onRendererInitialized`. Bedrock's `McStructureRenderer` also keeps the older two-argument form `(canvas, options)` |
| Options | `showGrid`, `showAxes`, `backgroundColor`, `enableAutoOrbit`, `autoOrbitDuration`, `targetFPS`, `idleFPS`, `cameraOptions`, `callbacks`; Java-only options (`enableInteraction`, `sidebarOptions`, `wasmMeshBuilderOptions` …) are accepted and ignored, so one options object works with both packages |
| Callbacks | `onRendererInitialized`, `onSchematicLoaded`, `onSchematicRendered`, `onResourcePackLoaded`, `onLoadingProgress`; the other Java callbacks exist in the types but Bedrock never calls them |
| Renderer | frame rate (`getFPS`, `getTargetFPS`, `setTargetFPS`, `getIdleFPS`, `setIdleFPS`, `setContinuous`), appearance, camera modes, auto orbit, isometric angles, `suspend` / `resume` / `invalidate`, rendering bounds, resource packs (`getResourcePacks`, `addResourcePack`, `toggleResourcePackEnabled`, `removeResourcePack`), screenshots and recording, `rebuildAllSchematics`, `dispose` |
| `cameraManager` | presets and fly controls, auto orbit, `lookAt`, `lookAtSchematicsCenter`, isometric angles, `recordingManager`, `CAMERA_PRESETS` and more |
| `schematicManager` | `schematics`, `loadSchematic`, `loadSchematics`, `loadSchematicFromFile` (the structure id is the file name), `loadSchematicFromURL(url, name?, properties?, options?)`, `getSchematic`, `getAllSchematics`, `getFirstSchematic`, `getSchematicAtPosition`, `isEmpty`, `schematicExists`, `removeSchematic`, `removeAllSchematics`, the global extents (`getGlobalTightWorldBox`, `getMaxSchematicDimensions` …), `dispose` |
| Structure objects | `id`, `name`, `visible`, `bounds` (`minX`…`maxZ`, `enabled`, `reset()`, `showHelper()`, `apply()`), `renderingBounds`, `getDimensions`, `getTightDimensions`, `getTightBoundsMin/Max`, `getTightWorldBox`, `getSchematicCenter`, `getBoundingBox`, `containsPosition`, `getBlock`, `getAllBlocks`, `rebuildMesh`, `schematicWrapper`, `getBlockEntitiesMap`, `dispose` |
| Rendering bounds | `min <= block coordinate < max` (upper bound excluded); blocks outside are left out of the mesh, so a cut shows real faces; rebuilding the mesh after a change is asynchronous (debounced by 40 ms in Bedrock) |
| Events | `sceneReady`, `schematicAdded` (only for `focused` loads, as in Java), `schematicLoaded` (when loading from a file or URL), `schematicLoadError`, `schematicRemoved`, `schematicPropertyChanged`, `resourcePacksReloaded`, `frameRendered`, `renderIdle`, with the same payloads as in Java; Bedrock also emits `schematicRendered` (structure id) and `resourcePackLoaded` (pack name) |
| Core modules | `types`, `inventory`, `redstone`, `names`, `entities`, `locale`, `frame-stats`, `material-export`, `settings` and `CameraControls` have the same names and types (each reads its own edition's block states); the small differences of `pickScene`, `ItemAssets` and `applyRenderSettings` are in the README's comparison table |

## What differs

| Aspect | Java | Bedrock |
|---|---|---|
| Structure formats | `.litematic .schem .schematic .nbt` | `.mcstructure` (`BLUEPRINT_EXTENSIONS`, `isBlueprintFile`) |
| Material counting | `countLitematicMaterials`, in a worker | `countMcstructureMaterials`, asynchronous on the calling thread; also `countMaterials(buffer, filename)` |
| Return value of `loadSchematic` | none; look it up with `getSchematic(id)` | the structure object (an addition; both styles work) |
| Structure placement | position, rotation, scale and opacity can be set | fixed at the origin: `position`, `rotation`, `scale` and `opacity` are read-only, and structure coordinates are block coordinates |
| Camera animation | yes (zoom-in on load, paths, orbit animation) | the camera moves instantly; `isCurrentlyAnimating()` is always false |
| Post-processing | SSAO, SMAA, gamma | the same (the same postprocessing + N8AO + SMAA + the Java GammaCorrectionEffect, with the same parameters) |
| Recording | ffmpeg.wasm: `h264`, `dnxhr_444`, `prores_4444`, `vp9_alpha`, `png_zip` | the browser's `MediaRecorder`: `h264` (MP4 where the browser can produce it, otherwise WebM) and `vp9_alpha` (WebM, transparent background); other codecs throw |
| Default recording shot | an orbit path | one turn around the structure; pass `onFrame` to drive the camera yourself |
| Default target frame rate | 60 (`idleFPS` defaults to 1; the idle frame rate path is disabled in Java) | 60 (since 1.3.0; unlimited before); `idleFPS` is only remembered, since the viewer draws nothing while nothing changes |
| Block shapes | Cubane, from the resource pack's block models | HoloPrint's data (`docs/HOLOPRINT.md`) |
| Item icons | `ItemAssets` with `renderer`: 3D block icons from the block's mesh | `ItemAssets`: inventory-style icons drawn by `ItemIconRenderer` without WebGL |

## Not applicable

Java members without a Bedrock counterpart (`tests/unified-api.test.ts` has the same list, with a reason for each):

- three.js internals: `timer`, `materialMap`, `controls`, `activeControlKey`, `switchControls`, `snapToAngle`, `getSnapAngles`,
  `calculateFramingDistance`.
- Built-in UI (left to the host): `uiManager`, `sidebar`, `slicerOverlay`, `resourcePackNotice`, the sidebar, performance
  panel, slicing overlay and bounds drag handles.
- Editing and selection tools: `interactionManager`, `dragAndDropManager`, `highlightManager`, `gizmoManager`,
  `blockInteractionHandler`, `keyboardControls`, `overlayManager`, `inspectorManager` and the inspector, keyboard shortcuts.
  Use `pickScene` to pick blocks.
- Redstone simulation (Nucleation / mchprs): `simulationManager` and every `*Simulation` and `*AutoTick`.
- Insign, regions, circuits and block editing (`setBlock` and others): the Bedrock package is a read-only viewer.
- Chunked meshing (`worldMeshBuilder`, the `buildSchematicMeshes*` family, `*Chunk*`) and GLB / glTF export.
- Camera paths and intro animations (`animateCameraAlongPath`, `startAutoOrbitSmooth` …).
- Placement: `setPosition`, `setRotation`, `setScale`, `centerInScene`.
- `packs` (the resource pack manager proxy): use the four `getResourcePacks`-style methods.

## Added to both packages in 1.4.0 (runtime-loaded SDK builds)

| Member | Packages |
|---|---|
| Renderer option `chunkLoading: { minIntervalMs }` | same: one 16³ chunk at a time, each taking at least this long; Java builds `incremental`ly, one chunk per batch |
| `callbacks.onChunkProgress(id, done, total)`, event `schematicChunkProgress` `{ id, done, total }` | same |
| `BlueprintLoader.load(buffer, filename, { onStart, onChunk, signal })`, and `Workshop.load` | same; with chunk-by-chunk loading a new `load` aborts the previous one, recognized by `isAbortError` |
| `SDK_API`, `SDK_EDITION`, `SDK_VERSION` | same (`SDK_EDITION` is `java` / `bedrock`) |
| `CameraControls.getView()` / `setView()` | same (added to the Java package in 1.1.0) |

## Added to both packages on 2026-11-18 (framing, first person, shading)

All are new optional members, so `SDK_API` stays 1: a host checks that a member exists before using it, and older renderer
builds keep working without the feature.

| Member | Purpose |
| --- | --- |
| `camera.setFrame({ yaw, pitch, distance?, fov?, halfHeight? })` | A framing computed by the host: the target stays (the structure's centre after `fit()`); perspective sets the field of view (radians) and distance, orthographic sets the half height of the view (blocks). Lets several views of one structure use exactly the same camera. |
| `camera.getFrame()` | The current framing (plus `ortho`); the inverse of `setFrame`. |
| `camera.setMode('first', { input: 'host' })` | First person driven by the host: the built-in flight controls (pointer lock, WASD) stay off, and so does drag rotation. |
| `camera.setPose({ x, y, z, yaw, pitch })` / `getPose()` | The first-person eye: world position and direction (yaw 0 faces +z and grows toward +x; pitch above 0 looks up). The orbit controls' target sits one block in front of the eye, so their updates do not turn the view. |
| `workshop.solids()` | The structure's collision cells `{ origin, min, max, height(i, j, k) }`: cell (i, j, k) covers `origin + [i, i+1]×[j, j+1]×[k, k+1]`, with a height of 0 (passable), 0.5 (lower half: slabs, stairs, beds) or 1 (full). The block rules live in `src/collision.ts`, shared by both packages, and read Java `[props]` as well as Bedrock states. |
| `postProcessingOptions.enableSMAA` / `multisampling` | Anti-aliasing: SMAA (on by default); multisampling sample count (0 is off, 4 is "high"). |
| `applyRenderSettings(renderer, { shading, shadingQuality })` | Lightweight shading: a warm sun with soft shadows (the shadow box fitted to the structure) and a sky / ground hemisphere light in place of most of the flat ambient light. `shadingQuality: 'high'` uses a 4096 shadow map, otherwise 2048. Call it again when the structure changes (the Bedrock package refits by itself). |

The same change moved the perspective near plane from 1 block to 0.05 (the camera can get right up to a block) and
strengthened ambient occlusion to a radius of 2 blocks (1.2 orthographic); before, it was barely visible, and the Java
package had hard-coded old values instead of using the preset.

## Still missing from the Java package

Two helpers exist only in the Bedrock package; with them in the Java package as well, a host would not need to branch by
edition for these calls. They can be pasted into the Java package as they are.

**1. Material counting without naming the format**:

```ts
// src/materials.ts (Java package)
export async function countMaterials(input: ArrayBuffer, filename: string): Promise<MaterialsResult> {
	if (!/\.litematic$/i.test(filename)) throw new Error("the material preview supports .litematic files");
	return countLitematicMaterials(input);
}
```

**2. Whether a file can be opened as a structure** (optional, for upload forms):

```ts
export const BLUEPRINT_EXTENSIONS = [".litematic", ".schem", ".schematic", ".nbt"] as const;
export const isBlueprintFile = (filename: string): boolean => /\.(litematic|schem|schematic|nbt)$/i.test(filename);
```

## Not verified

- Verification here is the package's own tests (including real renderer instances in a simulated browser environment) and
  runs in Chromium (loading the official resources, slicing, screenshots, axes, isometric views).
- Recording (`MediaRecorder`) has not actually been recorded in headless Chromium; only the argument checks are tested.

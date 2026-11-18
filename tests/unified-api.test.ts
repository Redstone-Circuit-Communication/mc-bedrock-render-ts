import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CameraManager } from '../src/renderer/camera';
import { McStructureRenderer } from '../src/renderer/renderer';
import { buildMcStructure } from '../src/renderer/structure';
import { fakeCanvas, installFakeDom } from './helpers/fake-dom';
import { writeZip } from './helpers/zipwriter';

/**
 * The Bedrock renderer keeps the interface of the Java renderer (docs/UNIFIED_API.md), so the site's viewer is written once.
 * tests/fixtures/java-api.json is read from the Java source by scripts/extract-java-api.mjs: every public member of
 * SchematicRenderer, CameraManager, SchematicManager and SchematicObject is either here or listed below with the reason it
 * has no counterpart. The list has to be exact: a member that gets implemented must come off it.
 */
const api = JSON.parse(readFileSync(new URL('./fixtures/java-api.json', import.meta.url), 'utf8')) as {
  classes: Record<string, Record<string, 'method' | 'property' | 'static'>>;
  events: string[];
};

const group = (reason: string, names: string) => Object.fromEntries(names.split(/[\s,]+/).filter(Boolean).map((n) => [n, reason]));
const NOT_APPLICABLE: Record<string, Record<string, string>> = {
  SchematicRenderer: {
    ...group('three.js objects (this viewer is plain WebGL2)', 'timer materialMap'),
    ...group('built-in UI (the host builds its own: docs/UNIFIED_API.md)', 'uiManager sidebar slicerOverlay resourcePackNotice updateMissingPackNotice showSlicerOverlay hideSlicerOverlay toggleSlicerOverlay showSidebar hideSidebar toggleSidebar showSidebarTab getSidebarState showPerformanceDashboard hidePerformanceDashboard togglePerformanceDashboard createBoundsControls'),
    ...group('editing and selection tools (no interaction manager here; picking.ts picks blocks)', 'interactionManager dragAndDropManager highlightManager gizmoManager blockInteractionHandler keyboardControls overlayManager inspectorManager enableInspector disableInspector toggleInspector enableKeyboardShortcuts disableKeyboardShortcuts'),
    ...group('redstone simulation (nucleation / mchprs)', 'simulationManager initializeSimulation tickSimulation syncSimulation startAutoTick stopAutoTick resetSimulation getSimulationState'),
    ...group('Insign / regions (nucleation)', 'insignManager insignIoManager regionManager regionInteractionHandler'),
    ...group('chunked mesh builder (the mesh core here builds one mesh per structure)', 'worldMeshBuilder'),
    ...group('camera path animation (the camera moves instantly)', 'setCameraPathVisible fitCameraPath animateCameraAlongPath'),
    ...group('resource pack manager proxy (use getResourcePacks / addResourcePack / toggleResourcePackEnabled / removeResourcePack)', 'packs'),
  },
  CameraManager: {
    ...group('three.js controls objects', 'controls activeControlKey switchControls'),
    ...group('camera path animation and zoom-in-on-load animation (the camera moves instantly)', 'cameraPathManager animateCameraAlongPath updatePathParameters showPathVisualization hidePathVisualization getCameraPath startAutoOrbitWithZoomIn setZoomInOnLoad setAutoOrbitAfterZoom handleSchematicLoaded startAutoOrbitSmooth zoomInToSchematics zoomToOrbitPosition'),
    ...group('three.js framing helpers', 'snapToAngle getSnapAngles calculateFramingDistance'),
  },
  SchematicManager: {
    ...group('three.js scene housekeeping and layout tools', 'performDeepCleanup addSchematic arrangeInGrid createEmptySchematic'),
  },
  SchematicObject: {
    ...group('placement is fixed: structures sit at the origin (position / rotation / scale / opacity are read-only getters)', 'syncTransformFromGroup setPosition setRotation setScale centerInScene centerInScenePlane'),
    ...group('GLB / glTF export', 'export exportAsGLB exportAsGLTF'),
    ...group('chunked meshing', 'buildSchematicMeshes buildSchematicMeshesImmediate buildSchematicMeshesIncremental buildSchematicMeshesBatched buildSchematicMeshesInstanced getChunkObjectsAt setChunkObjectsAt getChunkMeshAt setChunkMeshAt updateMesh rebuildChunkAtPosition rebuildAllChunks rebuildChunk'),
    ...group('regions, circuits and Insign (nucleation)', 'getRegions getRegion createRegion definitionRegionsVisible loadDefinitionRegions showDefinitionRegions hideDefinitionRegions toggleDefinitionRegions hasDefinitionRegions getDefinitionRegionNames getDefinitionRegion removeDefinitionRegions createCircuitFunction compileInsign'),
    ...group('editing blocks (nucleation)', 'setBlock setBlocks setBlockNoRebuild setBlockWithNbt copyRegionFromSchematic replaceBlock addCube debugBlock'),
    ...group('bounds drag handles (UI)', 'createBoundsControls'),
  },
};

installFakeDom();
const cube = buildMcStructure({ size: [3, 3, 3], blockAt: () => ({ name: 'minecraft:stone' }) });
const options = { meshBackend: 'ts', entities: false } as const;

async function make() {
  const { canvas } = fakeCanvas();
  const renderer = new McStructureRenderer(canvas, options);
  const loaded = await renderer.schematicManager.loadSchematic('a', cube);
  return { canvas, renderer, loaded };
}

test('every public member of the Java renderer is here, or listed with the reason it has no counterpart', async () => {
  const { renderer, loaded } = await make();
  const objects: Record<string, unknown> = { SchematicRenderer: renderer, CameraManager: renderer.cameraManager, SchematicManager: renderer.schematicManager, SchematicObject: loaded };
  const statics: Record<string, unknown> = { CameraManager };
  for (const [cls, members] of Object.entries(api.classes)) {
    const missing = Object.entries(members)
      .filter(([name, kind]) => !(name in (kind === 'static' ? (statics[cls] as object) : (objects[cls] as object))))
      .map(([name]) => name).sort();
    assert.deepEqual(missing, Object.keys(NOT_APPLICABLE[cls]).sort(), `${cls}: members missing here ≠ the not-applicable list (implemented something? take it off the list)`);
  }
  renderer.dispose();
});

test('the not-applicable list only names Java members, each with a reason', () => {
  for (const [cls, list] of Object.entries(NOT_APPLICABLE)) for (const [name, reason] of Object.entries(list)) {
    assert.ok(name in api.classes[cls], `${cls}.${name} is not a member of the Java class`);
    assert.ok(reason.length > 10, `${cls}.${name} needs a reason`);
  }
});

test('events: the ones that apply are emitted with the Java payload shapes', async () => {
  const { canvas } = fakeCanvas();
  const r = new McStructureRenderer(canvas, options);
  const seen: [string, unknown][] = [];
  for (const name of ['sceneReady', 'schematicAdded', 'schematicLoaded', 'schematicLoadError', 'schematicRemoved', 'schematicPropertyChanged', 'resourcePacksReloaded', 'frameRendered', 'renderIdle'])
    r.eventEmitter.on(name, (payload: unknown) => seen.push([name, payload]));
  await new Promise<void>((res) => queueMicrotask(res));
  assert.equal(seen.filter(([n]) => n === 'sceneReady').length, 1);

  const loaded = await r.schematicManager.loadSchematic('x', cube, { focused: true });
  const added = seen.find(([n]) => n === 'schematicAdded')![1] as { schematic: unknown };
  assert.equal(added.schematic, loaded);
  // not focused: the Java manager does not announce it with schematicAdded
  await r.schematicManager.loadSchematic('y', cube, { focused: false });
  assert.equal(seen.filter(([n]) => n === 'schematicAdded').length, 1);

  loaded.visible = false;
  assert.deepEqual(seen.find(([n]) => n === 'schematicPropertyChanged')![1], { schematic: loaded, property: 'visible', value: false });

  const file = { name: 'z.mcstructure', arrayBuffer: async () => cube.buffer.slice(cube.byteOffset, cube.byteOffset + cube.byteLength) } as unknown as File;
  await r.schematicManager.loadSchematicFromFile(file);
  assert.deepEqual(seen.find(([n]) => n === 'schematicLoaded')![1], { id: 'z.mcstructure' });
  await assert.rejects(r.schematicManager.loadSchematicFromFile({ name: 'bad', arrayBuffer: async () => new ArrayBuffer(4) } as unknown as File));
  assert.ok((seen.find(([n]) => n === 'schematicLoadError')![1] as { error: unknown }).error instanceof Error);

  await r.schematicManager.removeSchematic('x');
  assert.deepEqual(seen.find(([n]) => n === 'schematicRemoved')![1], { id: 'x' });
  await r.schematicManager.removeAllSchematics();
  assert.ok(r.schematicManager.isEmpty());
  r.dispose();
  // every event this renderer emits is one the Java renderer emits too (plus the Bedrock-only `schematicRendered` / `resourcePackLoaded`)
  for (const [n] of seen) assert.ok(api.events.includes(n), `${n} is not a Java event`);
});

test('construction: both forms. The Java form loads packs, then structures, then calls onRendererInitialized', async () => {
  const order: string[] = [];
  const pack = writeZip(new Map([['manifest.json', new TextEncoder().encode('{"format_version":2,"header":{"name":"t","uuid":"u","version":[1,0,0]},"modules":[]}')]]));
  const { canvas } = fakeCanvas();
  const ready = new Promise<McStructureRenderer>((resolve) => {
    const r = new McStructureRenderer(
      canvas,
      { door: async () => { order.push('structure'); return cube.buffer.slice(cube.byteOffset, cube.byteOffset + cube.byteLength) as ArrayBuffer; } },
      { first: async () => { order.push('pack first'); return new Blob([pack as BlobPart]); }, second: async () => { order.push('pack second'); return new Blob([pack as BlobPart]); } },
      { ...options, callbacks: { onRendererInitialized: (x) => { order.push('ready'); resolve(x); } } },
    );
    void r;
  });
  const r = await ready;
  assert.deepEqual(order, ['pack first', 'pack second', 'structure', 'ready']);
  assert.deepEqual(r.getLoadedSchematics(), ['door']);
  assert.deepEqual((await r.getResourcePacks()).map((p) => p.name), ['first', 'second']);
  r.dispose();

  // the old form still works
  const { canvas: c2 } = fakeCanvas();
  const r2 = new McStructureRenderer(c2, options);
  assert.equal(r2.getLoadedSchematics().length, 0);
  r2.dispose();
});

test('construction: a failing pack is reported on the canvas as rendererError (what createWorkshop waits for)', async () => {
  const { canvas } = fakeCanvas();
  const failed = new Promise<unknown>((resolve) => canvas.addEventListener('rendererError', (e) => resolve((e as CustomEvent).detail)));
  const r = new McStructureRenderer(canvas, {}, { bad: async () => new Blob(['not a zip']) }, options);
  assert.ok((await failed) instanceof Error);
  r.dispose();
});

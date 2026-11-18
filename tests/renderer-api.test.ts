import assert from 'node:assert/strict';
import test from 'node:test';
import { CameraControls } from '../src/camera-controls';
import { BLUEPRINT_EXTENSIONS, countMaterials, isBlueprintFile } from '../src/materials';
import { ResourcePack } from '../src/renderer/resources';
import { McStructureRenderer } from '../src/renderer/renderer';
import { buildMcStructure } from '../src/renderer/structure';
import { fakeCanvas, installFakeDom } from './helpers/fake-dom';

/** The renderer methods the site's viewer calls on both editions: same names, arguments and results as the Java renderer. */
installFakeDom();
const cube = buildMcStructure({ size: [2, 2, 2], blockAt: (x) => ({ name: x ? 'minecraft:stone' : 'minecraft:dirt' }) });
const options = { meshBackend: 'ts', entities: false } as const;
async function make(extra: object = {}) {
  const { canvas, log } = fakeCanvas();
  const r = new McStructureRenderer(canvas, { ...options, ...extra });
  await r.schematicManager.loadSchematic('a', cube);
  return { canvas, log, r };
}

test('frame rate: target defaults to 60 like the Java renderer, idle is stored, fps reads 0 while nothing is drawn', async () => {
  const { r } = await make();
  assert.equal(r.getTargetFPS(), 60);
  r.setTargetFPS(30);
  assert.equal(r.getTargetFPS(), 30);
  assert.equal(r.options.targetFPS, 30);
  r.setTargetFPS(Number.NaN);
  assert.equal(r.getTargetFPS(), 60, 'a bad value falls back to 60');
  r.setIdleFPS(2);
  assert.equal(r.getIdleFPS(), 2);
  assert.equal(r.getFPS(), 0);
  assert.equal(r.fps, 0);
  r.dispose();
});

test('look: background (string or number), grid, axes, camera mode', async () => {
  const { r } = await make();
  r.setBackgroundColor(0x112233);
  assert.deepEqual(r.viewer.backgroundColor.map((v) => Math.round(v * 255)), [0x11, 0x22, 0x33, 255]);
  r.setBackgroundColor('#ffffff');
  assert.deepEqual(r.viewer.backgroundColor, [1, 1, 1, 1]);
  r.setGridVisible(true); assert.equal(r.viewer.showGrid, true); assert.equal(r.sceneManager.showGrid, true);
  r.setAxesVisible(true); assert.equal(r.viewer.showAxes, true);
  assert.equal(r.getCameraMode(), 'perspective');
  r.setCameraMode('isometric');
  assert.equal(r.getCameraMode(), 'isometric');
  assert.equal(r.viewer.isOrthographic, true);
  r.setCameraMode('perspective');
  assert.equal(r.viewer.isOrthographic, false);
  r.dispose();
});

test('the Java option names reach the viewer: showGrid, showAxes, enableAutoOrbit, autoOrbitDuration, backgroundColor; unknown Java options are accepted', async () => {
  const { r } = await make({ showGrid: true, showAxes: true, enableAutoOrbit: true, autoOrbitDuration: 10, backgroundColor: '#102030', enableInteraction: false, sidebarOptions: { enabled: false }, wasmMeshBuilderOptions: { enabled: true } });
  assert.equal(r.viewer.showGrid, true);
  assert.equal(r.viewer.showAxes, true);
  assert.equal(r.viewer.autoRotate, true);
  assert.equal(r.viewer.autoRotateSpeed, 36);
  assert.equal(r.cameraManager.isAutoOrbitEnabled(), true);
  assert.deepEqual(r.viewer.backgroundColor.slice(0, 3).map((v) => Math.round(v * 255)), [0x10, 0x20, 0x30]);
  r.dispose();
});

test('auto orbit: toggle returns the new state, duration is seconds per turn (at least 1), options follow', async () => {
  const { r } = await make();
  assert.equal(r.cameraManager.isAutoOrbitEnabled(), false);
  assert.equal(r.toggleAutoOrbit(), true);
  assert.equal(r.options.enableAutoOrbit, true);
  r.setAutoOrbitDuration(20);
  assert.equal(r.viewer.autoRotateSpeed, 18);
  assert.equal(r.cameraManager.getAutoOrbitDuration(), 20);
  r.setAutoOrbitDuration(0);
  assert.equal(r.cameraManager.getAutoOrbitDuration(), 1);
  r.setAutoOrbit(false);
  assert.equal(r.viewer.autoRotate, false);
  assert.equal(r.toggleAutoOrbit(), true);
  assert.equal(r.toggleAutoOrbit(), false);
  r.dispose();
});

test('isometric angles: pitch is clamped to 0–89°, yaw defaults to 45°, null outside isometric mode', async () => {
  const { r } = await make();
  assert.equal(r.getIsometricAngles(), null);
  r.setIsometricAngles(120, 30, false);
  assert.equal(r.getCameraMode(), 'isometric');
  const a = r.getIsometricAngles()!;
  assert.ok(Math.abs(a.pitch - 89) < 1e-9 && Math.abs(a.yaw - 30) < 1e-9);
  r.resetIsometricAngles(false);
  const b = r.getIsometricAngles()!;
  assert.ok(Math.abs(b.pitch - 35.264) < 0.001 && Math.abs(b.yaw - 45) < 1e-9);
  r.dispose();
});

test('camera: lookAt takes a vector or an array; updateCameraPosition copies the camera position into state', async () => {
  const { r } = await make();
  r.cameraManager.lookAt([1, 2, 3]);
  assert.deepEqual(r.viewer.target, [1, 2, 3]);
  r.cameraManager.lookAt({ x: 4, y: 5, z: 6 });
  assert.deepEqual(r.viewer.target, [4, 5, 6]);
  r.cameraManager.lookAtSchematicsCenter();
  assert.deepEqual(r.viewer.target, [1, 1, 1]);
  r.updateCameraPosition();
  assert.ok(r.state.cameraPosition.length() > 0);
  assert.equal(r.cameraManager.isCurrentlyAnimating(), false);
  r.dispose();
});

test('resource packs: added packs are listed in order; disabling or removing rebuilds and says so; a name that is already there is replaced', async () => {
  const { r } = await make();
  const events: string[] = [];
  r.eventEmitter.on('resourcePacksReloaded', () => events.push('reloaded'));
  const mk = (name: string) => { const p = new ResourcePack(); p.name = name; return p; };
  await r.loadResourcePack(mk('one'), 'one');
  await r.loadResourcePack(mk('two'), 'two');
  assert.deepEqual(await r.getResourcePacks(), [{ name: 'one', enabled: true, order: 0 }, { name: 'two', enabled: true, order: 1 }]);
  assert.equal(r.resources.packs.length, 2);
  await r.toggleResourcePackEnabled('one', false);
  assert.deepEqual((await r.getResourcePacks()).map((p) => p.enabled), [false, true]);
  assert.equal(r.resources.packs.length, 1);
  assert.equal(r.resources.packs[0].name, 'two');
  const version = r.resources.version;
  await r.toggleResourcePackEnabled('one', true);
  assert.ok(r.resources.version > version, 'caches built on the stack see the change');
  await r.loadResourcePack(mk('two-again'), 'two');
  assert.deepEqual((await r.getResourcePacks()).map((p) => p.name), ['one', 'two']);
  assert.equal(r.resources.packs.length, 2);
  await r.removeResourcePack('one');
  assert.deepEqual((await r.getResourcePacks()).map((p) => p.name), ['two']);
  assert.equal(events.length, 3, 'one reload per toggle / remove');
  await r.removeResourcePack('nope'); // quietly nothing
  r.dispose();
});

test('screenshots: width and height render at that size and the canvas goes back afterwards; transparent clears with alpha 0; JPEG stays JPEG', async () => {
  const { canvas, r } = await make();
  const seen: { w: number; h: number; alpha: number }[] = [];
  (canvas as unknown as { toBlob: (cb: (b: Blob) => void, type: string) => void }).toBlob = (cb, type) => {
    seen.push({ w: canvas.width, h: canvas.height, alpha: r.viewer.backgroundColor[3] });
    cb(new Blob(['x'], { type }));
  };
  const before = [canvas.width, canvas.height];
  const png = await r.takeScreenshot({ width: 1280 });
  assert.equal(png.type, 'image/png');
  assert.deepEqual([seen[0].w, seen[0].h], [1280, 960], 'one side given: the canvas aspect is kept');
  assert.deepEqual([canvas.width, canvas.height], before);
  await r.takeScreenshot({ width: 200, height: 100, transparent: true });
  assert.deepEqual([seen[1].w, seen[1].h, seen[1].alpha], [200, 100, 0]);
  assert.equal(r.viewer.backgroundColor[3], 1, 'the background is back');
  const jpg = await r.takeScreenshot({ format: 'image/jpeg', quality: 0.8 });
  assert.equal(jpg.type, 'image/jpeg');
  const forced = await r.takeScreenshot({ format: 'image/jpeg', transparent: true });
  assert.equal(forced.type, 'image/png', 'JPEG has no alpha: a transparent shot is PNG');
  r.dispose();
});

test('recording: not recording by default; the ffmpeg-only codecs say so; stopRecording is harmless', async () => {
  const { r } = await make();
  assert.equal(r.isRecording(), false);
  await assert.rejects(r.startRecording(1, { codec: 'png_zip' }), /png_zip/);
  await assert.rejects(r.startRecording(1, { codec: 'dnxhr_444' }), /dnxhr_444/);
  r.stopRecording();
  assert.equal(r.isRecording(), false);
  assert.equal(r.recordingManager, r.cameraManager.recordingManager);
  r.dispose();
});

test('SSAO: on by default like the Java package, switchable, presets reach the viewer', async () => {
  const { r } = await make();
  assert.equal(r.isSSAOEnabled(), true);
  r.setSSAOEnabled(false);
  assert.equal(r.isSSAOEnabled(), false);
  r.setSSAOPreset('isometric', { intensity: 2 });
  assert.equal(r.getSSAOPresets().isometric.intensity, 2);
  assert.equal((r as any).viewer.ssaoPresets.isometric.intensity, 2);
  assert.equal(r.getSSAOPresets().perspective.aoRadius, 1);
  r.dispose();
});

test('right-drag pans in the screen plane (OrbitControls screenSpacePanning), not straight up in the world', async () => {
  const { r } = await make();
  const v = (r as any).viewer;
  v.target = [0, 0, 0]; v.yaw = 0; v.pitch = 0.8; v.distance = 10;
  v.pan(0, 10);
  const up = v.cameraBasis().up;
  const t = v.target as number[], len = Math.hypot(...t);
  assert.ok(len > 0 && Math.abs((t[0] * up[0] + t[1] * up[1] + t[2] * up[2]) / len - 1) < 1e-6, 'moved along the camera up vector');
  assert.ok(Math.abs(t[2]) > 1e-3, 'looking down, a vertical drag also moves the target forward / back');
  r.dispose();
});

test('loaded structure: queries match the Java SchematicObject (dimensions, tight box, centre, block lookup, listing)', async () => {
  const { r } = await make();
  const s = r.schematicManager.getSchematic('a')!;
  assert.deepEqual(s.getDimensions(), [2, 2, 2]);
  assert.deepEqual(s.getTightBoundsMin(), [0, 0, 0]);
  assert.deepEqual(s.getTightBoundsMax(), [1, 1, 1]);
  assert.deepEqual(s.getTightWorldBox().getSize().toArray(), [2, 2, 2]);
  assert.deepEqual(s.getSchematicCenter().toArray(), [1, 1, 1]);
  assert.deepEqual(s.getBoundingBox(), [[0, 0, 0], [2, 2, 2]]);
  assert.equal(s.containsPosition([1, 1, 1]), true);
  assert.equal(s.containsPosition([2, 0, 0]), false);
  assert.equal(s.getBlock([0, 0, 0]), 'minecraft:dirt');
  assert.equal(s.getAllBlocks().length, 8);
  assert.equal(s.getAllBlocks((b) => b.name === 'minecraft:dirt').length, 4);
  assert.deepEqual([s.position.toArray(), s.scale.toArray(), s.opacity], [[0, 0, 0], [1, 1, 1], 1]);
  assert.equal(r.schematicManager.getSchematicAtPosition([0, 0, 0]), s);
  assert.deepEqual(r.schematicManager.getMaxSchematicDimensions().toArray(), [2, 2, 2]);
  assert.deepEqual(r.schematicManager.getSchematicsAveragePosition().toArray(), [1, 1, 1]);
  assert.deepEqual(r.schematicManager.getGlobalBoundingBox(), [[0, 0, 0], [2, 2, 2]]);
  r.dispose();
});

test('manager: single-structure mode replaces; remove frees; dispose empties', async () => {
  const { r } = await make({ singleSchematicMode: true });
  await r.schematicManager.loadSchematic('b', cube);
  assert.deepEqual(r.getLoadedSchematics(), ['b']);
  assert.equal(r.schematicManager.schematicExists('a'), false);
  const b = r.schematicManager.getFirstSchematic()!;
  r.schematicManager.dispose();
  assert.ok(b.isDisposed);
  assert.ok(r.schematicManager.isEmpty());
  await assert.rejects(r.schematicManager.loadSchematic('c', cube), /关闭/);
  r.dispose();
});

test('materials: one neutral counter for host code that serves both editions', async () => {
  const bytes = buildMcStructure({ size: [2, 1, 1], blockAt: (x) => ({ name: x ? 'minecraft:stone' : 'minecraft:dirt' }) });
  const result = await countMaterials(bytes, 'door.MCSTRUCTURE');
  assert.deepEqual(result.materials.map((m) => [m.id, m.count]), [['minecraft:dirt', 1], ['minecraft:stone', 1]]);
  await assert.rejects(countMaterials(bytes, 'door.litematic'), /mcstructure/);
  assert.deepEqual([...BLUEPRINT_EXTENSIONS], ['.mcstructure']);
  assert.equal(isBlueprintFile('a.mcstructure'), true);
  assert.equal(isBlueprintFile('a.litematic'), false);
});

test('CameraControls.getView / setView: the yaw, pitch and zoom a share link keeps, in both projections', async () => {
  const { r } = await make();
  const cc = new CameraControls(r);
  cc.setView({ yaw: 1, pitch: 0.4, zoom: 12 });
  assert.deepEqual(cc.getView(), { yaw: 1, pitch: 0.4, zoom: 12 });
  assert.equal(r.viewer.distance, 12);
  cc.setView({ yaw: -2, pitch: 9, zoom: 0 });
  assert.deepEqual(cc.getView(), { yaw: -2, pitch: 1.55, zoom: 0.5 }, 'pitch and distance are kept in range');
  cc.setMode('ortho');
  cc.setView({ yaw: 0.5, pitch: 0.6, zoom: 2.5 });
  assert.deepEqual(cc.getView(), { yaw: 0.5, pitch: 0.6, zoom: 2.5 });
  assert.equal(r.viewer.orthoZoom, 2.5);
  r.dispose();
});

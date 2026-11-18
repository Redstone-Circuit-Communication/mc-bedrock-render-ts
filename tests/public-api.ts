import {
  createWorkshop,
  BlueprintLoader,
  CameraControls,
  readBlockInventory,
  materialsToCsv,
  countMaterials,
  type BlueprintResult,
  type Position,
} from "@rsw/mc-bedrock-render-ts";
import { countMcstructureMaterials } from "@rsw/mc-bedrock-render-ts/core";
import { MeshBuilder } from "@rsw/mc-bedrock-render-ts/mesh";

/**
 * Compile-only check of the surface a host uses. The body is the Java package's tests/public-api.ts with the package name and
 * the file type changed, plus the calls the site's viewer makes on both renderers (docs/UNIFIED_API.md): if this stops
 * compiling, a host written for the Java renderer stops compiling here.
 */
async function use(canvas: HTMLCanvasElement, buffer: ArrayBuffer) {
  const workshop = await createWorkshop({ canvas, resourcePackUrl: "/pack.zip" });
  const result: BlueprintResult = await workshop.load(buffer, "test.mcstructure");
  const position: Position = [0, 0, 0];
  const inventory = readBlockInventory(result.schematic, position);
  workshop.renderer.eventEmitter.on("test", () => {});
  new CameraControls(workshop.renderer).align(position);
  new BlueprintLoader(workshop.renderer);
  materialsToCsv((await countMcstructureMaterials(buffer)).materials);
  materialsToCsv((await countMaterials(buffer, "test.mcstructure")).materials);
  new MeshBuilder([]).build({ blocks: new Int32Array() });

  // the renderer, the way the Java renderer is driven
  const r = workshop.renderer;
  r.setBackgroundColor(0x1b1d23);
  r.setGridVisible(true);
  r.setAxesVisible(false);
  r.setCameraMode("isometric");
  r.setAutoOrbit(true);
  r.setAutoOrbitDuration(30);
  r.setTargetFPS(60);
  const fps: number = r.getFPS();
  const id = result.id;
  r.setRenderingBounds(id, [0, 0, 0], [4, 4, 4]);
  r.getBounds(id)!.maxY = 2;
  r.resetRenderingBounds(id);
  const dims: number[] | null = r.getSchematicDimensions(id);
  const shot: Blob = await r.takeScreenshot({ width: 1920, height: 1080, format: "image/png", transparent: true });
  await r.downloadScreenshot("view", { format: "image/png" });
  await r.startRecording(5, { frameRate: 30, onComplete: (blob) => void blob });
  r.stopRecording();
  await r.getResourcePacks();
  await r.cameraManager.focusOnSchematics();
  r.cameraManager.switchCameraPreset("perspective");

  // the managers and the loaded structure
  await r.schematicManager.loadSchematic("a", buffer, { focused: true });
  const s = r.schematicManager.getSchematic("a");
  s?.bounds.reset();
  s?.setRenderingBounds([0, 0, 0], [1, 1, 1], false);
  const tight: [number, number, number] | null = s?.getTightBoundsMin() ?? null;
  const all = r.schematicManager.getAllSchematics().map((x) => x.id);
  await r.schematicManager.removeAllSchematics();
  r.dispose();

  await workshop.dispose();
  return [inventory, fps, dims, shot, tight, all];
}
void use;

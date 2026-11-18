# 和 Java 渲染库的统一接口

站点的查看器（`WorkViewer` 的 `#canvas` 插槽）要按版本在 `@rsw/mc-java-render-ts` 和 `@rsw/mc-bedrock-render-ts` 之间二选一，查看器的代码只写一份。
所以两个库的公开接口要一致。**Java 包是参照**：基岩包只在它的接口上增加，不改它的名字、参数和返回值。

## 怎么保证一致

- `scripts/extract-java-api.mjs` 从 Java 包的源码里读出 `SchematicRenderer`、`CameraManager`、`SchematicManager`、`SchematicObject` 的全部公开成员和它发出的事件，写成 `tests/fixtures/java-api.json`（现在对应 `@rsw/mc-java-render-ts 1.0.3`）。
- `tests/unified-api.test.ts` 逐个检查：Java 的每个成员，这里要么有，要么写在测试里的「不适用清单」里并写明原因。清单必须和实际缺的完全一致：实现了一个成员就得把它从清单里拿掉，清单里写了一个其实有的也会失败。
- `tests/public-api.ts` 是只做编译的检查（照 Java 包的 `tests/public-api.ts` 写的），包括站点查看器会调的方法。`pnpm typecheck:consumer` 对着构建出来的包编译它。
- Java 包升级之后：

```bash
pnpm api:extract-java <mc-java-render-ts 的路径>   # 重新生成 tests/fixtures/java-api.json
pnpm test                                          # 新增的成员：实现，或者加进不适用清单并写原因
```

## 站点里怎么用

```ts
type Edition = "java" | "bedrock";

async function openViewer(edition: Edition, canvas: HTMLCanvasElement, packUrl: string | string[]) {
	const lib =
		edition === "java"
			? await import("@rsw/mc-java-render-ts")
			: await import("@rsw/mc-bedrock-render-ts");
	const workshop = await lib.createWorkshop({ canvas, resourcePackUrl: packUrl as never });
	const result = await workshop.loadUrl(workUrl); // .litematic 等 / .mcstructure
	await workshop.camera.fit();
	return { workshop, result };
}
```

`WorkViewer` 工具栏和两个库的对应关系：

| 站点要的 | 调用 | 两个库 |
|---|---|---|
| 复位视角 | `workshop.camera.fit()` | 相同 |
| 截图 | `workshop.screenshot()` 或 `workshop.renderer.takeScreenshot({ width, height, format, transparent })` | 相同 |
| 下载截图 | `workshop.renderer.downloadScreenshot(name, options)` | 相同 |
| 正交 / 透视 / 第一人称 | `workshop.camera.setMode("ortho" \| "orbit" \| "first")`，或 `renderer.setCameraMode("isometric" \| "perspective" \| "perspective_fpv")` | 相同 |
| 网格、坐标轴、背景 | `renderer.setGridVisible` / `setAxesVisible` / `setBackgroundColor` | 相同 |
| 自动环绕 | `renderer.setAutoOrbit` / `toggleAutoOrbit` / `setAutoOrbitDuration` | 相同 |
| 切片（看内部） | `renderer.setRenderingBounds(id, min, max)`、`getBounds(id).maxY = n`、`resetRenderingBounds(id)` | 相同 |
| 分享里「带上我现在的视角」（`ViewParams = { yaw, pitch, zoom }`） | `workshop.camera.getView()` / `setView(view)` | **基岩有，Java 没有**，见下 |
| 材料清单 | 按版本：`countLitematicMaterials` / `countMcstructureMaterials`，或 `countMaterials(buffer, filename)` | **基岩有 `countMaterials`，Java 没有**，见下 |
| 全屏、两态切换 | 站点自己做 | — |

## 对照：相同的部分

| 范围 | 内容 |
|---|---|
| `createWorkshop` / `Workshop` | 键完全相同（`renderer`、`blueprints`、`camera`、`load`、`loadFile`、`loadUrl`、`screenshot`、`dispose`）；初始化方式也相同：资源包放进构造函数，`onRendererInitialized` 之后才返回，失败走画布上的 `rendererError`，有超时 |
| 构造函数 | `new Renderer(canvas, schematicData, defaultResourcePacks, options)`：先加载资源包，再加载结构，再调 `onRendererInitialized`。基岩的 `McStructureRenderer` 还保留了两参数的旧写法 `(canvas, options)` |
| 选项 | `showGrid`、`showAxes`、`backgroundColor`、`enableAutoOrbit`、`autoOrbitDuration`、`targetFPS`、`idleFPS`、`cameraOptions`、`callbacks`；Java 才有的选项（`enableInteraction`、`sidebarOptions`、`wasmMeshBuilderOptions` …）接受并忽略，所以一份选项对象两个库都能用 |
| 回调 | `onRendererInitialized`、`onSchematicLoaded`、`onSchematicRendered`、`onResourcePackLoaded`、`onLoadingProgress`；其余 Java 回调在类型里有，基岩不会调用 |
| 渲染器 | 帧率（`getFPS`、`getTargetFPS`、`setTargetFPS`、`getIdleFPS`、`setIdleFPS`、`setContinuous`）、外观、相机模式、自动环绕、等距角度、`suspend` / `resume` / `invalidate`、渲染边界、资源包（`getResourcePacks`、`addResourcePack`、`toggleResourcePackEnabled`、`removeResourcePack`）、截图和录制、`rebuildAllSchematics`、`dispose` |
| `cameraManager` | 预设和 fly 控制、自动环绕、`lookAt`、`lookAtSchematicsCenter`、等距角度、`recordingManager`、`CAMERA_PRESETS` 等 |
| `schematicManager` | `schematics`、`loadSchematic`、`loadSchematics`、`loadSchematicFromFile`（结构 id 是文件名）、`loadSchematicFromURL(url, name?, properties?, options?)`、`getSchematic`、`getAllSchematics`、`getFirstSchematic`、`getSchematicAtPosition`、`isEmpty`、`schematicExists`、`removeSchematic`、`removeAllSchematics`、各种全局范围（`getGlobalTightWorldBox`、`getMaxSchematicDimensions` …）、`dispose` |
| 结构对象 | `id`、`name`、`visible`、`bounds`（`minX`…`maxZ`、`enabled`、`reset()`、`showHelper()`、`apply()`）、`renderingBounds`、`getDimensions`、`getTightDimensions`、`getTightBoundsMin/Max`、`getTightWorldBox`、`getSchematicCenter`、`getBoundingBox`、`containsPosition`、`getBlock`、`getAllBlocks`、`rebuildMesh`、`schematicWrapper`、`getBlockEntitiesMap`、`dispose` |
| 渲染边界 | `min <= 方块坐标 < max`（上界不含），边界外的方块不参与生成网格，所以切开的面是真的面；改边界后重建网格是异步的（基岩去抖 40 毫秒） |
| 事件 | `sceneReady`、`schematicAdded`（只在 `focused` 加载时发，和 Java 一样）、`schematicLoaded`（从文件或地址加载时）、`schematicLoadError`、`schematicRemoved`、`schematicPropertyChanged`、`resourcePacksReloaded`、`frameRendered`、`renderIdle`，载荷形状和 Java 一样；基岩另外还发 `schematicRendered`（结构 id）和 `resourcePackLoaded`（包名） |
| 核心模块 | `types`、`inventory`、`redstone`、`names`、`entities`、`frame-stats`、`material-export`、`settings`、`CameraControls` 的名字和类型相同（读的是各自版本的方块状态）；`pickScene`、`ItemAssets`、`applyRenderSettings` 的细小差别见 README 的对照表 |

## 对照：不一样的地方

| 方面 | Java | 基岩 |
|---|---|---|
| 蓝图格式 | `.litematic .schem .schematic .nbt` | `.mcstructure`（`BLUEPRINT_EXTENSIONS`、`isBlueprintFile`） |
| 材料统计 | `countLitematicMaterials`，在 Worker 里 | `countMcstructureMaterials`，在调用线程里异步；另有 `countMaterials(buffer, filename)` |
| `loadSchematic` 的返回值 | 没有，之后用 `getSchematic(id)` 查 | 返回结构对象（多出来的，两种写法都能用） |
| 结构的位置 | 可以设位置、旋转、缩放、不透明度 | 固定在原点：`position`、`rotation`、`scale`、`opacity` 是只读的，结构坐标就是方块坐标 |
| 相机动画 | 有（进场推近、路径、环绕动画） | 相机瞬时移动，`isCurrentlyAnimating()` 恒为 false |
| 后期处理 | SSAO、SMAA、伽马 | 相同（同一套 postprocessing + N8AO + SMAA + Java 的 GammaCorrectionEffect，同参数） |
| 录制 | ffmpeg.wasm：`h264`、`dnxhr_444`、`prores_4444`、`vp9_alpha`、`png_zip` | 浏览器的 `MediaRecorder`：`h264`（浏览器能出 MP4 就出 MP4，否则 WebM）和 `vp9_alpha`（WebM，透明背景）；其他编码直接报错 |
| 默认录制镜头 | 环绕路径 | 绕结构转一圈；传 `onFrame` 自己驱动相机 |
| 默认目标帧率 | 60（`idleFPS` 默认 1，空闲帧率这条路在 Java 里已经停用） | 60（1.3.0 起；以前是不限速）；`idleFPS` 只是记住，查看器没有变化时本来就不画 |
| 方块形状 | Cubane 按资源包的方块模型 | HoloPrint 的数据（`docs/HOLOPRINT.md`） |
| 相机视角读写 | 没有 | `CameraControls.getView()` / `setView()` |

## 不适用清单

Java 有、基岩没有对应物的成员（`tests/unified-api.test.ts` 里有同样的清单，每一项都写了原因）：

- three.js 对象：`timer`、`materialMap`、`controls`、`activeControlKey`、`switchControls`、`snapToAngle`、`getSnapAngles`、`calculateFramingDistance`。基岩的查看器是直接画 WebGL2，不依赖 three.js。
- 内置界面（宿主自己做）：`uiManager`、`sidebar`、`slicerOverlay`、`resourcePackNotice`、侧边栏、性能面板、切片叠加层、边界拖动手柄。
- 编辑和选择工具：`interactionManager`、`dragAndDropManager`、`highlightManager`、`gizmoManager`、`blockInteractionHandler`、`keyboardControls`、`overlayManager`、`inspectorManager` 和检查器、键盘快捷键。点选方块用 `pickScene`。
- 红石模拟（nucleation / mchprs）：`simulationManager` 和所有 `*Simulation`、`*AutoTick`。
- Insign、区域、电路、方块编辑（`setBlock` 等）：基岩版是只读查看。
- 分块网格（`worldMeshBuilder`、各种 `buildSchematicMeshes*`、`*Chunk*`）和 GLB / glTF 导出。
- 相机路径和进场动画（`animateCameraAlongPath`、`startAutoOrbitSmooth` …）。
- 摆放：`setPosition`、`setRotation`、`setScale`、`centerInScene`。
- `packs`（资源包管理代理）：用 `getResourcePacks` 等四个方法。

## 1.4.0 两个包一起加的（站点的 3D 视图要用）

| 成员 | 两个包 |
|---|---|
| 渲染器选项 `chunkLoading: { minIntervalMs }` | 相同：一次一个 16³ 区块，每块至少这么久；Java 走 `incremental` 构建、一批一块 |
| `callbacks.onChunkProgress(id, done, total)`、事件 `schematicChunkProgress` `{ id, done, total }` | 相同 |
| `BlueprintLoader.load(buffer, filename, { onStart, onChunk, signal })`、`Workshop.load` 同 | 相同；逐块加载时新的 `load` 取消旧的，`isAbortError` 认 |
| `SDK_API`、`SDK_EDITION`、`SDK_VERSION` | 相同（`SDK_EDITION` 各是 `java` / `bedrock`） |
| `CameraControls.getView()` / `setView()` | 下面第 1 条已经加进 Java 包（1.1.0） |

## 2026-11-18 两个包一起加的（站点的取景、第一人称、光影）

都是新增的可选成员，`SDK_API` 不变（还是 1）：站点先判断有没有，再用；旧版渲染组件照旧能用，只是没有这些功能。

| 成员 | 作用 |
| --- | --- |
| `camera.setFrame({ yaw, pitch, distance?, fov?, halfHeight? })` | 宿主自己算好的取景：目标点不变（`fit()` 之后就是结构中心），透视设视野（弧度）和距离，正交设画面半高（方块）。投稿页的简易模型、真实材质渲染和后台出图都用它摆同一台相机（以前各自 fit，60° 和 40° 视野、外框和外接球，同一个「远近倍数」摆出来不一样） |
| `camera.getFrame()` | 现在的取景（加上 `ortho`），和 `setFrame` 互逆 |
| `camera.setMode('first', { input: 'host' })` | 第一人称由宿主移动相机：不开自带的飞行控制（指针锁定、WASD），旋转的拖动也关掉 |
| `camera.setPose({ x, y, z, yaw, pitch })` / `getPose()` | 第一人称的眼睛：世界坐标，看的方向（yaw 0 朝 +z、往 +x 增加，pitch 大于 0 往上看）。轨道控制器的目标点放在眼睛前面一格，它更新时也不会把视线拧走 |
| `workshop.solids()` | 结构的碰撞格子 `{ origin, min, max, height(i, j, k) }`：格 (i, j, k) 占 `origin + [i, i+1]×[j, j+1]×[k, k+1]`，高度是 0（能穿过）、0.5（下半格：台阶、楼梯、床）或 1（整格）。方块分类在 `src/collision.ts`，两个包同一份规则，认 Java 的 `[props]` 和基岩的状态 |
| `postProcessingOptions.enableSMAA` / `multisampling` | 抗锯齿：SMAA（默认开）；多重采样的样本数（0 关，4 是「高」） |
| `applyRenderSettings(renderer, { shading, shadingQuality })` | 轻量光影：暖色的太阳光加软阴影（阴影框按结构对准）、天空和地面的半球光代替大部分平的环境光。`shadingQuality: 'high'` 用 4096 的阴影图，否则 2048。结构变了再调一次（基岩包会自己重新对准） |

同一次还改了：透视的最近距离从 1 格放到 0.05 格（可以贴到方块跟前）；环境光遮蔽加强到半径 2 格（正交 1.2 格），以前几乎看不出来——
Java 包建遮蔽效果时还把参数写死成了旧值，没用预设。

## Java 包里站点需要、现在没有的

我没有改 Java 包。下面三处是站点要同时用到两个库时会缺的，可以直接粘进 Java 包。

**1. 分享里的视角（`ViewParams = { yaw, pitch, zoom }`）**：`CameraControls` 里加两个方法。约定和基岩一样：`yaw` 0 是相机在目标的 +z 侧（南），往 +x 增加；`pitch` 为正是从上往下看；`zoom` 是到目标的距离（透视），正交时是 `camera.zoom`。

```ts
// src/camera-controls.ts（Java 包）
getView(): { yaw: number; pitch: number; zoom: number } {
	const offset = this.camera.position.clone().sub(this.target());
	const dist = offset.length() || 1;
	return {
		yaw: Math.atan2(offset.x, offset.z),
		pitch: Math.asin(Math.max(-1, Math.min(1, offset.y / dist))),
		zoom: isOrthographic(this.camera) ? this.camera.zoom : dist,
	};
}
setView(view: { yaw: number; pitch: number; zoom: number }): void {
	if (this.mode === "first") this.setMode("orbit");
	this.manager.stopAnimation();
	const target = this.target();
	const pitch = Math.max(-1.55, Math.min(1.55, view.pitch));
	const dist = isOrthographic(this.camera)
		? Math.max(1, this.camera.position.distanceTo(target))
		: Math.max(0.5, view.zoom);
	const direction = new Vector3(
		Math.sin(view.yaw) * Math.cos(pitch),
		Math.sin(pitch),
		Math.cos(view.yaw) * Math.cos(pitch)
	);
	this.camera.position.copy(target).addScaledVector(direction, dist);
	this.camera.lookAt(target);
	if (isOrthographic(this.camera)) {
		this.camera.zoom = Math.max(0.05, view.zoom);
		this.camera.updateProjectionMatrix();
	}
	this.orbitControls?.update();
	this.renderer.invalidate();
}
```

**2. 不带格式名的材料统计**：

```ts
// src/materials.ts（Java 包）
export async function countMaterials(input: ArrayBuffer, filename: string): Promise<MaterialsResult> {
	if (!/\.litematic$/i.test(filename)) throw new Error("材料预览支持 .litematic 文件");
	return countLitematicMaterials(input);
}
```

**3. 判断文件能不能当蓝图**（可选，站点上传时用）：

```ts
export const BLUEPRINT_EXTENSIONS = [".litematic", ".schem", ".schematic", ".nbt"] as const;
export const isBlueprintFile = (filename: string): boolean => /\.(litematic|schem|schematic|nbt)$/i.test(filename);
```

Java 包补上之后，站点就不用再按版本分支调用这三处。

## 没有验证过的

- 站点那边没有接过：这里的验证是库自己的测试（含用假浏览器环境实例化真实渲染器）和 Chromium 里的几次实测（用示例资源包加载、切片、截图、坐标轴、等距视角）。
- `getView` / `setView` 的 Java 版本只在这份文档里，没有在 three.js 里跑过。
- 录制（`MediaRecorder`）在 Chromium 无头环境里没有实际录过，只测了参数检查。

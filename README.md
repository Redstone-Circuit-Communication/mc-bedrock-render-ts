# @rsw/mc-bedrock-render-ts

> **许可：CC BY-NC-SA 4.0**（`src/renderer/holoprint/data/LICENSE-HoloPrint.txt`）。方块几何数据和 `holoprint/geo.ts` 来自 HoloPrint（SuperLlama88888），
> 经 neoHoloprintDB（Purple Rain）整理；构建出的 SDK 把这些数据和本库的代码打成一个文件，所以**整个包都受这个许可约束**：
> 用到它的产品要署名（红石阁的 `/credits` 页）、**不能用于商业目的**、改编要用同一许可发布（开源时不能用 MIT）。
> 另见 `NOTICE.md`：有几个文件是从 Java 渲染库拷来的，开源前要查清它们的著作权归属。

红石阁 前端基岩版 `.mcstructure` 渲染和结构解析组件。接口和目录结构与 `@rsw/mc-java-render-ts` 对齐，站点里可以按版本二选一，用同一套调用。

**画面由 Java 包同一套渲染栈绘制**：three.js + OrbitControls + postprocessing（N8AO、SMAA、Java 包的伽马效果），灯、材质、相机和后期参数照 Java 包的代码设置（`src/renderer/three-viewer.ts` 的文件头逐项列了出处）。three、postprocessing、n8ao 打进构建产物，使用方不用另装。没有真正 WebGL 的环境才退回自带的 WebGL2 查看器。

**接口以 Java 包为准。** Java 包的渲染器、相机、结构管理器、结构对象的公开成员和事件，这里要么都有，要么在 `tests/unified-api.test.ts` 的「不适用清单」里写明了原因；清单由脚本从 Java 源码读出，测试逐个检查。对照、站点里的用法和 Java 包需要补的三处见 `docs/UNIFIED_API.md`。

## 接入

```ts
import { createWorkshop } from "@rsw/mc-bedrock-render-ts";

const workshop = await createWorkshop({
	canvas,
	// 一个地址，或多个地址（按覆盖顺序：原版 vanilla → 新版内容的包 → 材质包）
	resourcePackUrl: ["/packs/vanilla.zip", "/packs/vanilla_newer.zip"],
});
const result = await workshop.loadUrl("/builds/door.mcstructure"); // 或 load(buffer, filename) / loadFile(file)
await workshop.camera.fit();
result.dimensions; result.materials; result.totalBlocks;
workshop.camera.setMode("ortho"); // "orbit" | "first" | "ortho"
const png = await workshop.screenshot();
await workshop.dispose();
```

站点里按版本选引擎：

```ts
import { createWorkshop as createBedrock } from "@rsw/mc-bedrock-render-ts";
import { createWorkshop as createJava } from "@rsw/mc-java-render-ts";
const createWorkshop = edition === "bedrock" ? createBedrock : createJava;
```

不用构建工具时：`<script src="dist/mcstructure-renderer.browser.js">`，全局 `window.McStructureRenderer` 是整个包的命名空间（`McStructureRenderer.createWorkshop(...)`，原来的 `McStructureRenderer.McStructureRenderer` 类也还在）。示例页：`example/index.html`。

## 逐块加载与 SDK（1.4.0）

```ts
const workshop = await createWorkshop({ canvas, resourcePackUrl, rendererOptions: { chunkLoading: { minIntervalMs: 200 } } });
await workshop.load(buffer, "door.mcstructure", {
  onStart: () => workshop.camera.fit(),          // 第一块之前：结构已经在场景里，尺寸已知
  onChunk: (done, total) => progress(done, total), // 每显示一块
  signal,                                         // 中止：两块之间以 AbortError 停下
});
```

- `chunkLoading`：按 16³ 区块逐块建网格、建好就显示（自下而上），每块至少 `minIntervalMs` 毫秒；不设是原来的整体构建。和 Java 包同名同义。
- 逐块加载时新的 `load` 会取消还在加载的那一次（`isAbortError(e)` 为真），旧结构留到新结构开始出现。
- 站点不把渲染库编进自己：`pnpm build:sdk` 生成 `sdk/mc-bedrock-render/<版本>/index.js`（一个 ES 模块，不依赖任何东西），放进站点的 SDK 目录、改清单，站点运行时 `import()`。
  约定版本是 `SDK_API`（`src/sdk.ts`）：修 bug 不改它，站点要跟着改的接口变化才加 1。

## 和 Java 包的对照

名字、参数、返回类型相同的部分不再列出，下面只写不同的地方。

| Java 包 | 基岩包 |
|---|---|
| `createWorkshop({ canvas, resourcePackUrl, resourcePackName?, rendererOptions?, timeoutMs? })` | 相同；`resourcePackUrl` 还可以是地址数组；`rendererOptions` 是 `RendererOptions`（查看器 + 网格选项 + `callbacks`） |
| `Workshop = { renderer, blueprints, camera, load, loadFile, loadUrl, screenshot, dispose }` | 键完全相同；`renderer` 是 `McStructureRenderer` |
| `BlueprintLoader.load(buffer, filename)`，接受 litematic / schem / schematic / nbt | 只接受 `.mcstructure`；返回同样的 `BlueprintResult`，`schematic` 是 `LoadedStructure` |
| `renderer.schematicManager` / `cameraManager` / `sceneManager` / `renderManager` / `eventEmitter` / `invalidate()` 等 107 个公开成员 | 同名同参数；除了模拟、侧边栏、Insign、区域、方块编辑、分块网格、GLB 导出、相机路径这些 Java 专有的子系统，都有（`docs/UNIFIED_API.md`） |
| `new SchematicRenderer(canvas, schematicData, defaultResourcePacks, options)` | 相同；`McStructureRenderer` 还保留两参数的旧写法 `(canvas, options)` |
| `schematic.group`（three Group） | `schematic.group` 只有 `visible`；`schematicWrapper`、`getBlockEntitiesMap()`、`getTightDimensions()`、`entityManager.records`、`getMeshes()` 都有 |
| `CameraControls`：`setMode / fit / align / focusBlock / toggleGrid / lock / unlock / target() / camera` | 相同；`camera.position` 是只读快照（改它不会移动相机），聚焦用 `focusBlock` |
| `pickScene(renderer, camera, ndc)` | 相同；`camera` 参数不使用。方块按方块自己的模型盒命中，实体按包围盒命中 |
| `readBlockInventory(schematic, position)` | 额外有可选的第三个参数 `origin`；大箱子靠方块实体的 `pairx/pairz/pairlead` 配对 |
| `readRedstone(state, nbt)` | 相同输出类型，读的是基岩的状态名（`redstone_signal`、`powered_bit`、`repeater_delay` …） |
| `countLitematicMaterials(buffer)` | `countMcstructureMaterials(buffer)`；另有不带格式名的 `countMaterials(buffer, filename)` |
| 没有 | `CameraControls.getView()` / `setView()`：分享链接里的 `{ yaw, pitch, zoom }` |
| `MaterialsCounter`（Worker） | 同名同接口，在调用线程里异步统计 |
| `ItemAssets(assetLoader)` | `ItemAssets(renderer 或 ResourceStack)`，图标来自 `item_texture.json` 或方块贴图 |
| `applyRenderSettings(renderer, settings)` | 只有 `maxPixelRatio`、`targetFPS` 生效，其余字段原样返回（查看器没有分块、裁剪和后期处理） |
| 录制（ffmpeg.wasm，多种编码） | 有，但用浏览器的 `MediaRecorder`：`h264`（能出 MP4 就出 MP4，否则 WebM）和 `vp9_alpha`；其他编码报错 |
| 渲染 | 同一套：three.js、MeshStandardMaterial、环境光 2.2 + 方向光 1.0、N8AO（同预设）+ SMAA + 伽马 0.5、OrbitControls（同预设） |
| 和 Java 还不同的地方 | 发光方块没有自发光贴图（还不知道每种方块的发光等级）；镂空贴图的 alpha 测试是 0.5（Java 按贴图分析用 0.01）；网格和坐标轴是 three 的线，不是 Java 的网格着色器；飞行模式和对准结构的取景是本库自己的 |
| 渲染边界（切片）：`setRenderingBounds`、`bounds.maxY = n` | 相同，`min <= 方块 < max`，边界外的方块不参与生成网格（切开的面是真的面） |
| 侧边栏、OBJ/STL/GLTF 导出、结构对比、红石模拟、区域高亮 | 基岩版没有 |

子路径和 Java 包一致：`. / core / renderer / mesh / mesh/worker`（没有 `mesh/three`，基岩自带 `createThreeObject(THREE, mesh)`）。

## 资源包：必须看（2026-11 更新）

游戏的 `resource_packs` 文件夹里有 59 个包（`vanilla`、`vanilla_1.14` … `vanilla_1.26.60`、`vanilla_base`、`vanilla_music`、`vanilla_trial`），每个包把 `.brarchive` 放在自己的 `__brarchive/` 子目录里。加载器现在按这个布局读取：整个文件夹的 zip（369 MB）、解开的文件夹、单个包都可以。

浏览器里不要直接加载 369 MB 的原包，用 `pnpm run pack:resources -- <resource_packs 文件夹或 zip> <out.zip>` 合成一个只含渲染需要的资源包（约 3.3 MB，3916 个文件，去掉了光追附属贴图），示例的 `example/public/packs/bedrock_resources.zip` 就是这样生成的。

下面是早先版本的说明（只给了单个 `vanilla` 包时的情况）：

**`vanilla` 文件夹本身只有 1.14 时代的方块贴图（703 张）和 98 种实体的定义。** 铜、深板岩、凝灰岩、黑石、樱花、红树、蜡烛、幽匿、各种新版生物等的贴图和定义不在里面，渲染器自己不画任何贴图，所以这些内容会显示成紫黑格子，或者出现在 `stats.unknownEntities` 里。

- 如果游戏把新版内容放在 `vanilla` 旁边的其他文件夹里，把它们一起放进 `resourcePackUrl`（或者把整个 `resource_packs` 文件夹打成一个 zip：渲染器会按文件夹拆成多个包，`vanilla` 在前，`vanilla_1.xx` 按版本排序，后面的覆盖前面的）。
- 也可以在最上面再叠一个只替换图片的材质包：按文件名找新方块的贴图。
- 加载完看 `mesh.stats`：`unknownBlocks`（没有模型的方块）、`missingTextures`（缺的贴图）、`unknownEntities`（没有定义的实体）、`missingEntityTextures`。

支持的输入：zip、`.mcpack`、单个 `.brarchive`、含 `.brarchive` 的游戏原版文件夹 zip、含多个包的 zip。

## 方块

- **形状来自 HoloPrint 的方块几何数据**（`src/renderer/holoprint/`，205 个形状；盒子、按状态的朝向、贴图变体、每个面的贴图坐标都由数据决定）。来源、许可和移植细节见 `docs/HOLOPRINT.md`。`createDefaultRegistry({ holoprint: false })` 可以退回 1.2 的手写形状。
- **仍由库自己处理**：要看邻居的（栅栏、玻璃板、铁栏杆的连接，红石线，水和岩浆，大箱子配对），以及床、头颅、潜影盒（走实体渲染，按资源包里的定义画）。渲染层（染色玻璃、冰）、半透明、同种相邻面剔除、自发光这些材质属性也取自库里原有的模型。
- 一个方块所有的面都找不到贴图（资源包的 `blocks.json` 没列它）时，回退到库里原有的手写形状；那里也没有处理的名字：植物名 + 同名贴图 → 十字形，其他名字 + 同名贴图 → 方块，都没有才显示占位方块。
- 手写形状（活塞、比较器、活板门等是对照真实结构文件测出来的）还在，用在上面这些回退和保留的场合。新版方块的贴图文件名用了多个候选名，实际用哪个取决于你的资源包。
- **没有拿游戏里的实物逐个对过**：和原版 HoloPrint 的几何逐面比对过（示例结构里 1368 个方块状态一致），渲染看过整体轮廓。
- `pnpm coverage:blocks` 用约 1200 个候选 id（由 Java 方块表按命名差异换算，不是官方列表）检查"有没有处理"。

## 实体

- 带客户端定义的生物：用包里的几何、贴图、渲染控制器、动画（静止姿态，Molang 求默认值）。
- 包里没有几何、由游戏写死的：船（按原版模型重建，六种木材）、画（`kz` 贴图集，所有原版画）、掉落物（图标或小方块）、下落的方块、点燃的 TNT。
- 方块实体：床、潜影盒、头颅（生物头）按包里的定义画。
- **不画**：生物身上的装备和手持物品、盔甲架的姿势、旗帜图案、告示牌文字、展示框里的物品、自定义皮肤的玩家头颅。
- 材质：资源包里没有 `entity.material`，按原版的材质名决定 alpha 的含义（透明 / 发光标记 / 染色遮罩，见 CHANGELOG 1.4.3）；渲染控制器的多张贴图按贴图槽叠成一张，附魔光效不画。
- 每个实体有一条 `EntityRecord`（`mesh.entityRecords`）：`status` 是 `model` / `builtin` / `unsupported`，`bounds` 是包围盒。

## 网格

方块的网格有两种后端：`meshBackend: 'ts'`（默认，共享的 TypeScript 网格核心）和 `'legacy'`（单遍）。`'wasm'` 仍然接受，给的是 `ts`：1.6.0 去掉了内嵌的 wasm 网格构建器（它的源码来自 AGPL 的上游，见 `NOTICE.md`；按 `docs/MESH.md` 量过的数，它本来也不比 TS 核心快）。数据、流程和验证见 `docs/MESH.md`。

## 已知问题

- **动画只有静止姿态**：烈焰人只看到头；水、岩浆、火、传送门是第一帧。（北极熊曾经是竖着的，那不是动画的问题，而是几何的：见 CHANGELOG「未发布」。）
- **1.8.0 格式实体**按定义里的 `animation_controllers` 播放，根骨骼位置的 `this` 取「支点 − (0, 24, 0)」（依据见 CHANGELOG 1.4.3）。这些姿势按资源包数据推出，没有逐个和游戏截图对照。
- **末影龙的翅膀根部有缺口**：来自原版贴图（内侧翼膜靠身体的一角是透明的），基岩的动画也没有向后掠的角度。不是渲染错误。
- **离水的鱼侧躺**：和游戏的扑腾动画一致；结构里在水中的鱼正着游。
- **单面渲染**（1.5.0）：方块照 Java 的 `FrontSide`；零厚度平面和不封闭的盒子的面两面都画（HoloPrint 的几何没有内表面）。实体照 Java 双面画。
- **面剔除和 Java 的差别**：Java 的方块材质是 `FrontSide`，这里实心层仍是双面（Bedrock 几何没有朝内的内表面，见 CHANGELOG）。
- **行为包里的数据拿不到**：`query.property('minecraft:climate_variant')` 这类属性用默认值（温带），结构里保存了就按保存的。
- 实体的**生命值**取 NBT 的 `Attributes`，没有就按满血（铁傀儡 100）。
- 完整的核对结论在 `docs/FLINT.md`（建模方式）和 `docs/MESH.md`（网格）。

## 开发

```bash
pnpm install        # esbuild / tsx / typescript
pnpm build          # dist/（ESM 入口 + 浏览器包 + .d.ts）
pnpm build:sdk      # sdk/mc-bedrock-render/<版本>/：给站点的 SDK 目录（docs 见站点的 RENDER-SDK.md）
pnpm test           # 57 个单元 / 集成测试（大部分用仓库里的示例资源包；个别用 BEDROCK_PACK=旧版 vanilla 文件夹 zip，没有就跳过）。有一部分用假的浏览器环境在 Node 里实例化真实的渲染器（tests/helpers/fake-dom.ts）
pnpm test:all       # 构建 + 对着构建出来的包做消费者类型检查（tests/public-api.ts）+ 测试
pnpm api:extract-java <mc-java-render-ts 路径>   # 重新生成 Java 接口清单（tests/fixtures/java-api.json）
pnpm data:import-holoprint <neoHoloprintDB 文件夹>  # 更新 HoloPrint 的方块数据
pnpm test:e2e       # 真实浏览器（Playwright）里跑 workshop 流程，以及 Java 同款示例（`three` 用 tests/e2e/three-stub.js 代替）
pnpm bench:mesh     # 三种网格后端的耗时
pnpm pack:resources <resource_packs 文件夹或 zip> <out.zip>
pnpm schematics:coverage   # 重新生成示例蓝图
pnpm dev:example    # 需要 vite 和 three（devDependencies）
```

`tests/helpers/fixture.ts` 会按方块处理逻辑要的贴图名生成纯色贴图，代替缺失的新版资源包，只用来检查形状和覆盖，**不能证明贴图文件名与真实资源包一致**。

## 没有验证过的假设

- 大箱子：两半各存 27 格，`pairlead = 1` 的一半排在 0–26 格。这个顺序是按 Java 版的约定推的，没有拿真实的基岩结构文件核对。
- 大箱子的渲染：有 `pairx` / `pairz` 时按它配对；没有时同种同朝向的相邻箱子沿一排两两配对，三个一排时哪两个成对可能和游戏不同。
- `pairx / pairz` 当作世界坐标，同时试了减去 `structure_world_origin` 和不减两种，取指向同名箱子的那个。
- 实体、画的 `Pos` / `Direction` 的偏移约定（画的中心位置、船的高度）按常见值处理，没有逐种核对。

## 许可和致谢

方块形状的数据和几何生成逻辑来自 **HoloPrint**（SuperLlama88888，https://github.com/SuperLlama88888/holoprint），经 **neoHoloprintDB** 整理，许可证是 **CC BY-NC-SA 4.0**（全文在 `src/renderer/holoprint/data/LICENSE-HoloPrint.txt`，说明在同目录的 `NOTICE.md`）：使用时要署名，不能商用（不能出售，也不能放在广告或付费墙后面），基于它的改编要用同样的许可共享。`src/renderer/holoprint/geo.ts` 是 HoloPrint 几何生成的 TypeScript 移植，同样受这个许可约束。

# mc-bedrock-render-ts

[English](README.md) | 简体中文

在浏览器里渲染 Minecraft **基岩版**结构（`.mcstructure`）的库，用 three.js 按基岩版资源包绘制。
[红石阁](https://redstonearchive.top)3D 视图里的基岩版部分就是用它渲染的。

**在线示例：** <https://redstone-circuit-communication.github.io/mc-bedrock-render-ts/>（默认英文，可切换中文）

> **许可：CC BY-NC-SA 4.0。** 方块几何数据和 `src/renderer/holoprint/geo.ts` 来自 SuperLlama88888 的
> [HoloPrint](https://github.com/SuperLlama88888/holoprint)，用的是 Purple Rain 在 neoHoloprintDB 里整理的版本。
> 构建出来的 SDK 把这些数据和代码打在一起，所以**整个包都适用这个许可**：要署名、不能商用、改编后要以同样的许可分享。
> 见[许可](#许可)。

接口和模块结构与 Java 版的对应库 [mc-java-render-ts](https://github.com/Redstone-Circuit-Communication/mc-java-render-ts)
一致，网站可以按版本选择引擎，用同样的方式调用。

## 用法

```ts
import { createWorkshop } from "@rsw/mc-bedrock-render-ts";

const workshop = await createWorkshop({
	canvas,
	// 一个资源包，或按顺序叠加的多个：后面的覆盖前面的
	resourcePackUrl: ["/packs/minecraft-data.zip", "/packs/my-textures.zip"],
});
const result = await workshop.loadUrl("/builds/door.mcstructure"); // 或者 load(buffer, filename) / loadFile(file)
await workshop.camera.fit();
console.log(result.dimensions, result.materials, result.totalBlocks);
workshop.camera.setMode("ortho"); // "orbit" | "first" | "ortho"
const png = await workshop.screenshot();
await workshop.dispose();
```

按版本选择引擎：

```ts
import { createWorkshop as createBedrock } from "@rsw/mc-bedrock-render-ts";
import { createWorkshop as createJava } from "@rsw/mc-java-render-ts";
const createWorkshop = edition === "bedrock" ? createBedrock : createJava;
```

不用打包工具时，`<script src="dist/mcstructure-renderer.browser.js">` 会把整个包挂在 `window.McStructureRenderer` 上。

### 逐块加载

```ts
const workshop = await createWorkshop({ canvas, resourcePackUrl, rendererOptions: { chunkLoading: { minIntervalMs: 50 } } });
await workshop.load(buffer, "door.mcstructure", {
	onStart: () => workshop.camera.fit(), // 第一个区块之前：结构已经在场景里，尺寸也知道了
	onChunk: (done, total) => progress(done, total),
	signal, // 在两个区块之间以 AbortError 中止
});
```

### 文字和图标

库输出的文字（方块和实体的名字、容器标题、红石说明、CSV 表头）默认是英文，`setLocale("zh-CN")` 切换成简体中文。
`ItemAssets` 以对象 URL 的形式给出图标：方块由 `ItemIconRenderer` 按物品栏里的样子画出来，它不需要 WebGL，
在 Node 里也能运行（`tools/item-icons.mts` 用它把一整套图标写成 PNG 文件）；物品用 `item_texture.json` 里的图标。

```ts
import { setLocale, ItemAssets } from "@rsw/mc-bedrock-render-ts";

setLocale("zh-CN");
const assets = new ItemAssets(workshop.renderer);
assets.decorate(element, "minecraft:furnace");
```

### 流式加载和 SDK 构建

新的 `load` 会取消还在逐块加载的那一次（`isAbortError(e)` 为 true）；新结构开始出现之前，旧结构一直保留在画面上。
`pnpm build:sdk` 生成 `sdk/mc-bedrock-render/<版本>/index.js`，一个不依赖其他文件的 ES 模块，网站可以在运行时加载；
`src/sdk.ts` 里的 `SDK_API` 只在宿主需要跟着改动时才变。

## 和 Java 包的差异

名字、参数、返回类型都相同的成员不列出来，完整对照见 `docs/UNIFIED_API.md`（英文）。

| Java 包 | 基岩包 |
|---|---|
| `BlueprintLoader.load(buffer, filename)` 接受 litematic / schem / schematic / nbt | 只接受 `.mcstructure`，返回同样的 `BlueprintResult` |
| `readBlockInventory(schematic, position)` | 可选的第三个参数 `origin`；大箱子按 `pairx` / `pairz` / `pairlead` 配对 |
| `readRedstone(state, nbt)` | 输出相同，读的是基岩版的状态名（`redstone_signal`、`powered_bit`、`repeater_delay` …） |
| `countLitematicMaterials(buffer)` | `countMcstructureMaterials(buffer)`，另有 `countMaterials(buffer, filename)` |
| `ItemAssets(assetLoader, { renderer })`：用 WebGL 画立体的方块图标 | `ItemAssets(renderer 或 ResourceStack)`：方块图标由 `ItemIconRenderer` 绘制，不需要 WebGL；物品图标来自 `item_texture.json` |
| 用 ffmpeg.wasm 录制 | 用浏览器的 `MediaRecorder` 录制：`h264`（能出 MP4 就出 MP4，否则 WebM）和 `vp9_alpha` |
| 侧边栏、OBJ/STL/GLTF 导出、蓝图对比、红石模拟、区域高亮 | 没有 |

## 资源包

库本身不带任何贴图。加载游戏的资源包，上面可以再叠一个材质包：

- 支持的输入：zip、`.mcpack`、单个 `.brarchive`、打包成 zip 的游戏资源包文件夹，或包含多个资源包的 zip。
- 游戏的 `resource_packs` 文件夹里有几十个包（`vanilla`、`vanilla_1.14` … `vanilla_base`），每个包的 `.brarchive`
  文件放在 `__brarchive/` 子文件夹里。`pnpm run pack:resources -- <文件夹或 zip> <out.zip>` 把它们合成一个只含渲染所需内容的
  小资源包（约 3 MB，原来是 369 MB）。
- 资源包按顺序叠加：后面的覆盖前面的；`blocks.json` 和游戏一样按字段合并，所以只改了几个属性的材质包不会丢掉其余内容。
- 加载之后，`mesh.stats` 会列出 `unknownBlocks`、`missingTextures`、`unknownEntities` 和 `missingEntityTextures`。

### 按需加载官方资源

Mojang 在 [bedrock-samples](https://github.com/Mojang/bedrock-samples) 里发布了游戏的资源包。`RemotePackSource`
可以直接从那里逐个文件加载，什么都不用打包进来：

```ts
const listings = await Promise.all(
	["bedrock-samples-v1.21.50.7-entity-models.json", "bedrock-samples-v1.26.60.5.json"].map(async (name) => (await fetch(`/packs/${name}`)).json()),
); // 每个都是 { baseUrl, files }
const workshop = await createWorkshop({ canvas, resourcePackUrl: listings });
```

文件清单里只有文件名，由 `pnpm pack:list-official` 从该仓库某个发布标签的克隆生成。这里叠加了两个版本，
就像已安装的游戏里叠着不同版本的资源包：较新版本发布的资源包里已经没有旧格式的实体几何，而北极熊、猫、狐狸、羊驼等
四足生物要靠旧几何里的绑定姿势才能趴下，所以把 v1.21.50.7 的实体模型放在当前版本下面。工作台会先下载全部定义文件
（约 900 个小 JSON 文件），之后每个结构只下载自己用到的贴图：通过 jsDelivr 下载，失败时改从 GitHub 原始文件地址下载，
浏览器会缓存它们。在代码里，也可以用 `loadResourcePack(pack)` 把 `RemoteResourcePack` 加到渲染器的资源包栈上。

示例就是这样加载资源的：示例里不带、也不发布任何 Minecraft 的文件。

## 方块

- **形状来自 HoloPrint 的方块几何数据**（`src/renderer/holoprint/`，205 种形状）：盒子、随状态变化的旋转、贴图变体、
  每个面的 UV 都由数据描述。来源和移植细节见 `docs/HOLOPRINT.md`（英文）。`createDefaultRegistry({ holoprint: false })`
  可以退回以前手写的形状。
- **由库自己处理的**：要看邻居的方块（栅栏、玻璃板和铁栏杆的连接，红石线，水和岩浆，大箱子配对），以及走实体渲染的
  床、头颅和潜影盒。
- 一个方块的所有面都找不到贴图时（资源包的 `blocks.json` 没有列出它），用手写的形状；再不行，名字像植物且有同名贴图的
  画成交叉片，其他有同名贴图的画成立方体，剩下的画占位方块。
- 和 HoloPrint 自己的几何逐面核对过（示例结构里的 1368 种方块状态全部一致）。
- 紧挨着实心方块的角落会像原版的平滑光照那样变暗（`MeshOptions.ambientOcclusion`，默认开启）；草和树叶使用平原生物群系的颜色。

## 实体

- 有客户端定义的生物，使用资源包里的几何、贴图、渲染控制器和动画（静止姿势，Molang 按默认值求值）。
- 游戏里写死、在这里重建的：船（六种木材）、画（全部原版画）、掉落物、下落的方块和点燃的 TNT。没有几何、只给方块提供
  贴图的客户端定义（饰纹陶罐、试炼刷怪笼）按对应的方块画出。
- 游戏在生命初期隐藏的实体（唤魔者尖牙、风弹）取它们可见的一刻来画。
- 不画的：穿戴和手持的物品、盔甲架的姿势、旗帜图案、告示牌文字、物品展示框里的物品、玩家自定义皮肤。
- 每个实体都有一个 `EntityRecord`（`mesh.entityRecords`），带有 `status`（`model` / `builtin` / `unsupported`）和包围盒。

## 已知限制

- 动画只显示静止姿势：水、岩浆、火和传送门只显示第一帧。
- 1.8.0 格式的实体播放定义里的 `animation_controllers`；姿势是从资源包数据推出来的，没有和游戏逐个对照过。
- 只存在于行为包里的数据拿不到：`minecraft:climate_variant` 这类属性，除非结构里保存了值，否则用默认值。
- 大箱子：每一半保存 27 格，`pairlead = 1` 的那一半排在前面，和 Java 的约定一致。

## 开发

```bash
pnpm install
pnpm build              # dist/（ES 模块入口、浏览器包、类型声明）
pnpm test               # 单元测试和集成测试
pnpm test:all           # 构建、对构建产物做消费者类型检查、测试
pnpm test:e2e           # 在真实浏览器里测试工作台流程和示例（Playwright）
pnpm dev:example        # 示例，http://localhost:5173
pnpm build:example      # example/dist，和部署到 GitHub Pages 的相同
pnpm build:sdk          # sdk/mc-bedrock-render/<版本>/，供运行时加载
pnpm pack:resources <resource_packs 文件夹或 zip> <out.zip>
pnpm data:import-holoprint <neoHoloprintDB 文件夹>
pnpm schematics:coverage   # 重新生成「全方块」「全实体」两个示例结构
```

测试和开发脚本使用 Mojang 的官方资源渲染：第一次需要时下载到 `.cache/`（不进仓库，见 `scripts/lib/official-pack.ts`），
所以第一次跑测试需要联网。示例页面默认英文，浏览器语言是中文时显示中文；页面文字在 `example/src/i18n.js`。

## 许可

[CC BY-NC-SA 4.0](LICENSE)。`src/renderer/holoprint/data/` 里的方块几何数据和 `src/renderer/holoprint/geo.ts` 里的几何生成器
（HoloPrint `BlockGeoMaker.js` 的 TypeScript 移植）由原作者以 CC BY-NC-SA 4.0 授权（全文见
`src/renderer/holoprint/data/LICENSE-HoloPrint.txt`，细节见同目录的 `NOTICE.md`）。SDK 把它们和其余代码打在一起，
所以整个包以同样的许可发布：

- **署名**：在使用本包的产品里注明 HoloPrint 和 neoHoloprintDB；
- **非商业性使用**：不能出售，也不能放在广告或付费墙后面；
- **相同方式共享**：改编作品必须以同样的许可分享。

第三方声明见 [NOTICE.md](NOTICE.md)。

## 致谢

- SuperLlama88888 的 [HoloPrint](https://github.com/SuperLlama88888/holoprint)（CC BY-NC-SA 4.0）：方块几何数据和几何生成器。
- Purple Rain 的 neoHoloprintDB（CC BY-NC-SA 4.0）：本库使用的那份整理过的数据。
- [three.js](https://github.com/mrdoob/three.js)（MIT）、[postprocessing](https://github.com/pmndrs/postprocessing)（Zlib）
  和 [N8AO](https://github.com/N8python/n8ao)（ISC）：渲染和后期处理。

Minecraft 是 Mojang AB 的商标。本项目不是 Minecraft 官方产品，与 Mojang 和 Microsoft 没有关联。

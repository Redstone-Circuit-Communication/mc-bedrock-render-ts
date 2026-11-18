# 更新记录

## 未发布

- `tools/item-icons.mts`：给站点生成物品图标（64×64 PNG，加一份清单）。
  - 资源包里每个方块用本库的网格生成器建模型，按物品栏的角度画：正交，转 45°、倾 30°，两倍超采样后缩小。
  - 本来就是平面物品的，用物品贴图；交叉形植物、铁轨、火把这些薄的，用方块贴图。
  - 有朝向的摆成物品栏里的样子：活塞朝上，炉子、发射器、侦测器正面朝南。
  - 发光的方块不画面的明暗：亮着的红石灯在小尺寸下要和灭着的分得开。
  - 不进库的包，只是个工具。

## 1.6.1（2026-11-18）

- 光影：所有模型都投影，阴影图画正反两面（单面材质只画背面时，方块网格去掉隐藏面之后很多表面不投影）；阴影改用 PCFShadowMap（three r18x 去掉了 PCFSoftShadowMap，用它会报警告）。
- 给站点的构建去掉 `console.log / info / debug`，不再带源码映射文件。
- **换了内容就换版本号**：1.6.0 的目录在线上会被长期缓存，同一个版本号里换文件，看过的浏览器还是用旧的。

## 1.6.0（2026-11-18）

许可整理（复审 4.4，详见 `NOTICE.md`「和 Java 渲染库共用的代码」）：

- **去掉内嵌的 wasm 网格构建器**（`src/wasm/`、`src/mesh/wasm.ts`、`scripts/embed-wasm.mjs`）。它编自 Java 包的 `mesh_builder_wasm`，
  那份 Rust 源码和上游 schematic-renderer（AGPL-3.0）的同名文件逐行相似 0.978，不能放进 CC BY-NC-SA 的包。
  默认后端改成 `ts`；`backend: 'wasm'` 仍然接受，给的是 `ts`，不碰 WebAssembly。`docs/MESH.md` 量过：wasm 本来就不比 TS 核心快。
  SDK 小了约 185 KB（base64 的二进制），页面的 CSP 也不再需要 `wasm-unsafe-eval`。
- **重写伽马那一段**（`src/renderer/gamma-effect.ts`）：原来那份和上游 `GammaCorrectionEffect.ts` 相似度 0.98。新的是用 postprocessing 的 Effect 接口自己写的，同一条 c^(1/γ) 曲线；γ ≤ 0 时不处理（原来是只有 γ = 0 时不处理）。
- 根目录加了 `LICENSE`（CC BY-NC-SA 4.0 全文，取自 creativecommons.org）。
- 同一版还加了站点的取景和第一人称要用的 `camera.setFrame / getFrame`、`setPose / getPose`、`setMode('first', { input: 'host' })`、`workshop.solids()`，
  轻量光影（`applyRenderSettings` 的 `shading`，three-viewer 的 `setShading`），抗锯齿的开关和多重采样，加强的环境光遮蔽；`applyRenderSettings` 现在也会开关环境光遮蔽。见 `docs/UNIFIED_API.md` 最后加的一节。
- 版本从 1.5.0 直接到 1.6.0：站点上发布过一个 1.5.1，它的源码不在这个仓库里（复审 B1）。合回 1.5.1 的改动时，合到这一版之上。

## 1.5.0（2026-11-18）

**画面改用 Java 包的渲染栈**（`src/renderer/three-viewer.ts`），不再自己写着色、遮蔽和相机：

- 渲染器：three.js 的 `WebGLRenderer({ alpha, antialias, powerPreference: 'high-performance', preserveDrawingBuffer })`（Java 的 RenderManager）。
- 灯：`AmbientLight(0xffffff, 2.2)` + `DirectionalLight(0xffffff, 1)` 在 (20, 20, −20)（Java 的 SceneManager）。
- 材质：方块是 `MeshStandardMaterial`、`FrontSide`、最近邻过滤、贴图不设色彩空间，半透明面照它的液体（`transparent`、不写深度）；
  染色和 Java 的 `material.color` 一样按线性颜色乘上去（这里放在顶点色里）。实体是 `MeshStandardMaterial`、贴图 `LinearSRGBColorSpace`、双面，
  发光的实体贴图同时作自发光贴图（Java 的做法）。
- 相机：`PerspectiveCamera(60, 宽高比, 0.1, 1000)` + three 自带的 `OrbitControls`，参数是 Java 的透视预设（阻尼 0.08、距离 1–1000、平移 1.0、
  旋转 0.8、缩放 1.2）；正交相机用它的等距预设。
- 后期：postprocessing 的 `EffectComposer` → `RenderPass` → n8ao 的 `N8AOPostPass`（半径 1、衰减 0.4、强度 5、Medium；等距 0.3 / 0.1 / 0.8）
  → `EffectPass(GammaCorrectionEffect(0.5), SMAAEffect())`。`GammaCorrectionEffect` 是 Java 包的文件，原样拷过来（只改了一个字段的类型标注）。
- 依赖：three 0.186.1、postprocessing 6.39.6、n8ao 1.10.3（和 Java 包同版本），打进 `dist` 和 SDK；SDK 从约 570 KB 变成约 1.4 MB。
- 网格不再把面亮度烘进顶点色（`shadeOf` 恒为 1），光照全由 three.js 计算。
- 面剔除照 Java 的 `FrontSide`：每个三角形按法线定绕向。两面都要看见的面（零厚度平面、不封闭的盒子的面——漏斗碗的内壁是外壁的背面）
  用材质标记，网格核心照常对它们做邻居剔除，输出时法线置零，查看器给它们各配一份反向的面。
- 1.4.4 自己写的环境光遮蔽、光照曲线和鼠标处理都撤掉了（`ssao.ts` 只留给后备查看器）。
- 后备：three.js 起不来的环境（没有真正的 WebGL，比如 Node 里的测试）才用原来的 WebGL2 查看器。
- 测试：`occlusion.test.ts` 的实心层法线、`fixes-1.4.4.test.ts` 的面亮度改成新规则。119 条，113 过、6 条照旧跳过。

## 1.4.4（2026-11-18）

- **末影龙的翼膜是菱形**：实体立方体底面的贴图方向沿 z 翻了。零厚度平面两面都画，从上面看时，顶面透明的地方透出底面，底面又是镜像的同一张图，
  三角形的翼膜叠成了菱形（「多了一对镜像的翅膀」）。底面现在和 Java 的 ModelPart.Cube 一样，与顶面同向（`geometry.ts` 的 `FACE_TABLE.down`）。
- **光照对齐 Java 包**：Java 用 three.js 的环境光 2.2 + 方向光 1.0（来自 (20, 20, −20)）照粗糙材质（朗伯漫反射），再经它的伽马（x²）和 sRGB 输出。
  这里以前是 Minecraft 固定的面亮度（顶 1、底 0.5、侧 0.8 / 0.6），对比更硬、没有光的方向。现在方块和实体按同样的灯算（线性 0.70 … 1.02），
  着色器最后取 x^(1/1.1)。
- **环境光遮蔽**（`src/renderer/ssao.ts`）：Java 包默认开 N8AO，这里以前没有，画面只有平的面亮度，显得像塑料。现在实心层先画进多重采样的离屏缓冲，
  从深度重建位置和法线，16 个半球采样、按深度的模糊，乘进颜色；半透明层、网格、标注照常画在上面。预设和 Java 相同（透视 半径 1 / 衰减 0.4 / 强度 5，
  等距 0.3 / 0.1 / 0.8），`isSSAOEnabled` / `setSSAOEnabled` / `setSSAOPreset` / `setSSAOParameters` 现在真的起作用，`postProcessingOptions.enableSSAO: false` 关掉。
  算法是自己的实现，不是 N8AO，强弱按画面调过。
- **鼠标手感对齐 Java 的 OrbitControls**：右键平移沿相机的右和**上**方向（screenSpacePanning，three.js 默认），以前竖直拖动是把目标沿世界 y 抬高，
  相机往下看时结构往不对的方向滑；中键拖动缩放（往下拖拉远）；相机距离限制在 1–1000；透视视角默认 60°（Java 的透视预设），以前是 45°。
- 测试：`tests/fixes-1.4.4.test.ts`（底面贴图方向、光照），`renderer-api.test.ts` 的 SSAO 和平移。119 条，113 过、6 条照旧跳过。
- **没做**：单面渲染（背面剔除）。见 README「已知问题」。

## 1.4.3（2026-11-18）

在浏览器里逐个渲染核对过；示例里 126 个实体的包围盒和 1.4.2 逐个对比，变化的 22 个都看过画面。

实体：

- **材质的 alpha 不都是透明度**（资源包里没有 `materials/entity.material`，按原版定义的名字分类，并对照了贴图）。
  - 发光标记：蜘蛛、洞穴蜘蛛（20 个眼睛像素 alpha 3）、末影人（6 个，alpha 3）、幻翼（4 个，alpha 18）。以前按 0.5 做 alpha 测试，眼睛被丢掉。
  - 整体发光：发光鱿鱼（全部 alpha 90）、岩浆怪（29 / 126），和烈焰人一样不受光照；以前整只被丢掉。
  - 染色遮罩：羊（593 个皮肤像素 alpha 3 = 不染色，羊毛 255 按 `Color` 染色），驯服的狼和猫的项圈。羊的皮肤、脸和腿回来了，羊毛按颜色染色。
  只有贴图里真的带遮罩时才染色（野狼的贴图全是 255，不会整只染成项圈色）。
- **渲染控制器的 `textures` 是材质的贴图槽**，不是几张图：每个控制器只画一次，附魔光效槽（`textures/misc/enchanted_*`）跳过，其余的槽按 alpha 叠在第一张上
  （羊驼装饰、马的花纹、村民职业服装）。以前每张贴图把模型画一遍：喷溅药水、滞留药水、经验瓶上盖着一块灰色渐变（光效贴图）。
- **经验球**：动画用 `query.camera_rotation` 朝向相机的实体按 2D 精灵画；`overlay_color` 取静止时的值烘进贴图（黄绿），`ignore_lighting` 不受光照。
- **1.8.0 格式的实体播放定义里的 `animation_controllers`**（游戏自己播放这些；以前按名字猜控制器、只对 5 个实体启用）。控制器的短名和动画的短名是两套
  （狼的控制器和它播放的动画都叫 `wolf_setup`），控制器用自己的别名登记。
- **根骨骼位置通道的 `this` = 支点 − (0, 24, 0)**（旧 Java 模型的旋转点：子骨骼相对父骨骼支点，根骨骼相对脚上方 24 像素的模型原点）。依据是狼的 setup
  动画逐个写着 Java 版狼模型的旋转点（身体 `-14` / `2`、腿 `-16`、尾巴 `-12`）：只有这样身体、腿、尾巴才停在几何定义的位置，鬃毛移到 z = −3。
  末影人的头回到身体上方（以前头留在身体里，下巴那层露在上面像两只角），脚落地；狼的身体转平。以前取 0 时狼下沉 14–16 像素、三脚架相机陷进地下 1.6 格、
  美西螈和海龟也低于地面，这几个现在都在地面上。离水的鱼侧躺（游戏的扑腾动画），结构里在水中的鱼正着游（新增 `query.is_in_water`）。
- **船桨**：两种船都有，按 Java 版船模型（18 像素的桨杆、6×7 的桨叶，倾斜 11.25°），角度是没在划船时的静止角度。
- **运输船的箱子**：位置照 Java 版（往船尾 4 像素），转 −90° 让正面和锁扣朝向乘客，箱盖贴图从第 59 行开始（以前读的是 58），补上锁扣。
- **末影龙的翅膀根部的缺口没有改**：原版 `dragon.tga` 里内侧翼膜靠身体的那一角本来就是透明的，几何和 Java 版相同；基岩的动画里翅膀没有 Java 版那样向后掠 14°，
  静止时缺口看起来更大。

方块：

- **门**：HoloPrint 的门由下半块画出整扇（模型跨两格），上半块自己没有面，以前于是退回库里手写的门，同一格多了一扇按另一套规则转向的门（「L」形）。
  站在自己下半块上的上半块现在不画；整扇门用下半块的朝向和开关、上半块的合页方向（游戏只在下半块上更新开关，开着的门上半块仍写 `open_bit` 0）。
  门（和双格植物）的模型不再按调色板缓存：状态相同的两半属于不同的门时，以前会拿到同一个模型。
- **漏斗**：新版游戏写的是字符串 `minecraft:facing_direction`（`"down"`），走通用的字符串旋转表时 `down` 绕 x 轴转 90°，漏斗侧倒。HoloPrint 旋转表按整数写的
  19 种形状（漏斗、按钮、发射器、木桶、物品展示框 …）先换成整数（0 下 1 上 2 北 3 南 4 西 5 东）。
- **大箱子**：以前没有大箱子模型，每一半都画成小箱子。现在按方块实体的 `pairx` / `pairz`（和它自己的 `x` / `z` 比较）配对；没有配对数据时，同种同朝向的相邻箱子
  沿一排两两配对。领头的一半画 30 像素宽的大箱子（`double_normal` / `trapped_double`，128×64），另一半不画。整数朝向（`facing_direction`）的箱子以前一律朝南。
  箱子的模型不再按调色板缓存。
- **酿造台**：三根支臂是平面，各显示 `brewing_stand.png`（整台酿造台的正面图）的一半。HoloPrint 的模板把这一半左右放反了：贴着烈焰棒的深色竖条跑到了支臂外端、
  一直垂到底座，有药水瓶的那种支臂从一面看是对的、从另一面看是反的。现在每个面都让图里靠近烈焰棒的一侧对着烈焰棒，两面一致。

测试：新增 `tests/fixes-1.4.3.test.ts`（8 条）；`entities.test.ts` 的船加上桨和运输船箱子的位置，`legacy-blocks.test.ts` 的门改成新的规则。116 条，110 过、6 条照旧跳过。

## 1.4.2（2026-11-17）

生物（逐个在浏览器里渲染核对过）：

- **守卫者、远古守卫者的尖刺飘在身体上方**：Molang 的 `this` 是通道现在的值（含静止值）。动画写的是 `"目标 - this"`（设成目标值），而 `this` 一直从 0 算起，
  尖刺被多推高 24 像素。现在 `this` 从静止值开始（`AnimContext.rest`）：子骨骼取「自己的支点 − 父骨骼的支点」，根骨骼取 0，旋转取几何里的静止旋转
  （旧 Java 模型的「旋转点」约定，守卫者的尖刺、尾巴和末影龙三者都对得上）。尖刺落回身体的 12 条棱上。
- **末影龙只剩身子和一只立着的翅膀**：几何里没有脖子和尾巴，只有一节 `neck` 模板，游戏的末影龙渲染器按 `neck1`…`neck5`、`tail1`…`tail12` 的姿势重复画它；
  所有部件挂在 `root` 下（它的姿势把龙抬高、转过来）；翅膀尖、腿尖、脚是相对上一节写的；右侧肢体是左侧的镜像。`geometry.ts` 的 `dragonSegments` 照这样重建，
  `planEntity` 把右侧肢体的姿势也按镜像换算（资源包里已经预先取反的分量不再取反）。**这是按数据和游戏的画法推出来的，只作用于 `geometry.dragon`。**
- **硫磺怪（`minecraft:sulfur_cube`）总是透明、里面空的**：它只有吞了方块（`minecraft:sulfur_cube_archetype` ≠ `none`）时外壳才透明、里面显出那个方块，
  默认是不透明的核心。这个属性在行为包里定义，资源包里没有，`query.property` 给了 0，`0 != 'none'` 为真，所以每只都当成吞了方块。现在默认是 `none`；
  吞了方块的那只在壳里画出它主手里的方块（`heldBlockDraws`，10 像素见方放在中间，**大小和位置是近似的**）。
- 测试：`tests/mobs.test.ts`。107 条，101 过、6 条照旧跳过。

## 1.4.1（2026-11-17）

对照 neoHoloprintDB 0.2.4 逐面检查之后的修正。**几何移植本身和 neo 一致**：`tools/compare-neo.mts` 在 Node 里运行 neo 自己的 `NeoBlockGeoMaker`，
和本库逐面比较演示结构里全部 1399 种「方块 + 状态」，差别只剩被挡住的内部面（本库多剔掉了，看不见）、交叉形植物（neo 把 X 的两片合成了一片，本库保留两片，和游戏一致）、
箱子（不走这条路）和本库自己补的数据。截图里那些问题都出在数据没覆盖到的地方：

- **旧方块 id**（`holoprint/legacy.ts`，`modernBlock`）：`yellow_flower`、`red_flower` + `flower_type`、`double_plant` + `double_plant_type`、`tallgrass` + `tall_grass_type`、
  `sapling` + `sapling_type`、`coral` / `coral_block` / `coral_fan*`、`tripWire`、`grass_path` 换成今天的 id 再查形状。以前它们匹配不到任何形状，按整块立方体画，
  花的贴图贴满六个面（「一圈花」）。原来的 `modernCoral` 并进来了，还在导出。
- **上半块缺状态**（门、双格植物）：从下面同一种方块的下半块补齐（`upperHalfStates`）。手工、生成的结构里上半块常常只有 `upper_block_bit`，门的上半块会转向别处。
- **通过插值读的状态也补默认值**：`requirements()` 现在也收 `${#block_states.X}`。酿造台的三根支臂靠 `brewing_stand_slot_a/b/c_bit` 决定，没有这几个状态时支臂整个消失。
- **新方块**：`sulfur_spike` 照尖滴石的做法给了交叉形状（数据修正写在 `scripts/import-holoprint-data.mjs`）；`shelf_mushroom` 用资源包里的 `models/blocks/shelf_mushroom_*.geo.json`。
  **两者真实的状态名都没有样本核对过**（演示里没有状态），没有状态时画尖端 / 小号。
- `dripstone_thickness` 缺省为 `tip`（以前尖滴石没有状态时找不到贴图）。
- 测试：`tests/legacy-blocks.test.ts`；`tests/blocks.test.ts` 里「没有贴图的方块」从 `shelf_mushroom` 变成空。104 条，98 过、6 条照旧跳过。

## 1.4.0（2026-11-16）

站点接入（作品页、审核页的 3D 视图），渲染库不编进站点，按版本放在独立的 SDK 目录里运行时加载（站点的 `docs/RENDER-SDK.md`）：

- **逐块加载**：渲染器选项 `chunkLoading: { minIntervalMs }`（和 Java 包同名）。结构按 16³ 区块一块一块地建网格、建好就显示，自下而上；每块至少 `minIntervalMs` 毫秒，
  建网格用掉的时间算在里面，剩下的是空闲（`setTimeout`），慢的设备在两块之间拿回主线程。空区块跳过。不设这个选项还是原来的整体构建；改渲染边界之后的重建总是整体构建。
  - 网格：`emitPalette` 的分块循环可以把每块交出去（`stream`），`buildStructureMesh(…, progress)` 依次给 `onAtlas`、`onChunk(chunk, done, total)`，最后照样返回整个网格（统计、实体）。legacy 后端没有分块，整个结果当一块交出去。
  - 查看器：`StructureViewer.beginMesh(size, atlas)` 先建只有贴图的对象，`ViewerObject.appendBlocks(solid, translucent)` 每块一组 GPU 缓冲（共用这张贴图，只在第一组释放），`appendEntities(batches)` 最后加实体；隐藏实体时只画方块的那几组。
  - 管理器：`loadSchematic(id, source, props, { onProgress, onStart, signal })`。逐块加载时结构在贴图好了之后就进场景（`onStart`），之后每块发 `callbacks.onChunkProgress(id, done, total)` 和事件 `schematicChunkProgress`；
    移除这个结构、`dispose`、`signal` 中止都在两块之间以 `AbortError` 停下，已经进场景的会被拿掉。
- **`BlueprintLoader.load(buffer, filename, { onStart, onChunk, signal })`**（`Workshop.load` 同）：`onStart` 在第一块之前（尺寸已知，可以对准相机），`onChunk(done, total)` 是进度。
  逐块加载时，旧结构留到新结构解析好、开始出现时才移除；新的 `load` 会取消还在加载的那一次（它以 `AbortError` 结束），快速切换不用等没人看的区块。`isAbortError(e)` 认这个错误。
- **SDK 构建**：`pnpm build:sdk` → `sdk/mc-bedrock-render/<版本>/index.js`（自带全部依赖的一个 ES 模块，约 550 KB）+ `release.json` + HoloPrint 的许可和说明。
  `src/sdk.ts` 导出 `SDK_API`（站点和渲染库的约定版本，现在是 1）、`SDK_EDITION`、`SDK_VERSION`，构建时核对 `SDK_VERSION` 和 package.json 一致。
- 测试：`tests/chunk-loading.test.ts`（7 条：分块数与顺序、和整体构建的面数一致、每块的最小间隔、中止、渲染器的进度与 GPU 分组、移除时停下、加载器的取消与替换）。100 条测试，94 过、6 条照旧跳过。

## 未发布

方块：

- **红石火把朝向反了**：`torch_facing_direction` 写的是**支撑方块所在的一侧**（真实结构里每根墙火把在命名那一侧都有实心方块），HoloPrint 的火把模板却把底座放在对面。`blockStateDefinitions.json` 的 `block_shapes` 里给 `torch,redstone_torch` 加了 180° 的旋转表（和已有的 `repeater,comparator` 同一机制）。`unlit_redstone_torch`、`soul_torch` 等同一形状一并修好。
- **活塞（以及床、旗帜、讲台）的"重叠"**：HoloPrint 的条件对**缺失的方块实体字段求值为 `true`**，没有 `PistonArm` 方块实体的活塞（手工结构、工具生成的结构）会把收回、伸出、移动三种活塞臂同时画出（46 个面）。现在缺的字段按方块上下文推断：前方有 `*_piston_arm_collision` 就是伸出，否则收回（18 / 21 个面）；旗帜 `Type`/`Base`、讲台 `hasBook` 等给安全默认值。`tests/orientation.test.ts`。
- **活塞移动中的姿势**：`State` 1 / 3 时按 `Progress` 连续摆放活塞臂（粗杆走半格，细杆和头板走一格），`Progress = 0.5` 和 HoloPrint 的半伸出模板逐面一致。
- **活塞的字符串朝向**：手工结构里的 `minecraft:facing_direction: "up"` 先转成游戏写的整数再交给 HoloPrint（字符串表假定模型朝北，而活塞模型朝上，会转错）。
- **半透明方块只画朝向相机的面**：查看器关了背面剔除，一个玻璃方块的前后六个面都画，alpha 叠加得又白又亮。网格核心输出的逐顶点法线现在传到半透明层（`MeshLayerData.normals`），着色器丢弃背向相机的面；零法线表示双面平面（交叉片等），照常保留。实心层不带法线。
- **面剔除按"面方向"计算遮挡**（Java 包的 `getBlockOcclusionFlags` 同款规则）：某个方向上，完全不透明的面铺满 16 × 16 的边界才算遮挡。台阶、活塞底面等现在能遮挡邻居的对应面；**贴图带透明孔洞的方块（铜格栅、旧版树叶、`stained_glass`、`tripWire` 等）不再遮挡**，以前它们把邻居的面剔掉，孔洞里能看到虚空。全部结构的面数少约 2%，六个视角的逐像素对比没有洞。`tests/occlusion.test.ts`。

- **缺失的方块状态按默认值补齐**：游戏写出的结构带全部状态，手工结构和生成的示例（`all-blocks.mcstructure` 里中继器、比较器、投掷器、发射器、活塞、活板门、金蒲公英的状态是 `{}`，门只有 `upper_block_bit`）没有；HoloPrint 的条件对缺失的状态求值为真，于是**所有分支同时画出**：中继器画出四种延迟的火把、门画出每一种开合和铰链、投掷器画出每个朝向的正面贴图，叠在一起。适配层现在对形状读取的状态，缺了就补默认值（数值和位类为 0，字符串类按游戏默认：`attachment: standing`、`cauldron_liquid: water` …），只补白名单里的真实状态，适配层自己算出来的变量（`Nbias`、`isJunction` …）不动。活板门 60→6 面、投掷器/发射器 12→6、中继器 25→16、门 20→10、活塞 46→18。移植本身没动，和原版 HoloPrint 的逐面等价测试不受影响。`tests/states-sprites.test.ts`。
- **推出的活塞臂被错误剔除**：边界面的判断只看面是否在格子的**平面**上，不看**范围**——伸出的头板在 `x = 16` 平面上，但一直伸到 `y = 32`（下一格），却被当成活塞自己那一格东侧的面，由**活塞那一格**的邻居去剔除（臂那一格的邻居才是对的）。现在 ① HoloPrint 面的 `cull` 要求整个面在格子内；② 调色板网格器对离开格子的面给零法线（核心看法线判定边界面，零法线永不剔除，wasm 和 TS 核心一致）；③ 活塞整体不做面剔除（`BlockModel.noCull`）。活塞格周围放石头时，臂上的面 7→11（修复前 v1 吃掉 4 个），两个后端相同。真实结构面数 4889→5246。
- **金蒲公英是方块**：数据里没有它的形状，掉进"按贴图名生成立方体"的兜底，6 个面的立方体贴着花的精灵图。现在和蒲公英一样是十字交叉片（`CORRECTIONS` 里补 `golden_dandelion → cross_texture`）。同样的兜底还有 `tripWire`、`sulfur_spike`、`straw_bed`，没有改。

- **珊瑚是立方体**：旧式 id（`coral` + `coral_color` / `dead_bit`、`coral_fan`、`coral_fan_dead`、`coral_fan_hang` / `2` / `3`）不匹配 `_coral$`、`_coral_fan$` 这些形状模式，掉进立方体兜底，六个面各贴一个珊瑚精灵图。现在规范成现代 id（`tube_coral`、`bubble_coral_fan`、`dead_fire_coral_wall_fan` …），走已有的形状和贴图。`tests/blockgeo.test.ts`。
- **稻草床（`straw_bed`）**：资源包里有 `models/blocks/straw_bed_head.geo.json` 和 `straw_bed_foot.geo.json`，渲染器没读，用的立方体兜底。新增 `src/renderer/blockgeo.ts`：读 `models/blocks/*.geo.json`（逐面 UV、立方体旋转 + 支点、几何 +x 朝西所以镜像），复用实体的立方体发射代码并用新的 `onQuad` 回调收集面；`head_piece_bit` 选头 / 脚。**`minecraft:cardinal_direction` 的转向没有对照物验证**，用的是和 HoloPrint 一致的表。`shelf_mushroom_*` 在包里有同样的几何，还没有接。
- **查看器的交互参数对齐 Java**（three.js OrbitControls 在 `CameraManager` 里的取值）：旋转速度 0.8（`2π · 0.8 / 画布高度` 弧度每像素，原来固定 0.008）、缩放速度 1.2（滚轮每格 `0.95^1.2`，原来每格约 10.5%）、阻尼 0.08（旋转和平移每帧应用 8%、保留 92%，松手后继续滑动）。只作用于用户的拖动和滚轮，程序化的 `setView` 不变。用真实鼠标事件核对：拖 100 像素最终偏航变化与公式一致，一格滚轮的缩放比 1.0635 等于 Java 的 `1/0.95^1.2`。`tests/entity-poses.test.ts`。
- **实心方块仍是双面，没有改成 Java 的 `FrontSide`**：试过。HoloPrint 的基岩几何是为双面材质设计的，没有朝内的内表面（漏斗碗的内壁其实是外壁立方体的背面）；Java 的 JSON 模型把内表面显式写出来。改成单面后，你的真实结构 1 里漏斗的内壁消失（726 像素），回退。半透明层（玻璃等）、活塞、离开格子的面、零厚度平面已经按 Java 的方式处理。

实体：

- **北极熊竖着、猫 / 豹猫 / 狐狸 / 鹦鹉 / 兔子 / 雪傀儡 / 村民帽檐的姿态不对**：同一个模型文件里常常同时有旧式 `geometry.x`（骨骼带 `bind_pose_rotation`，把竖着建的身体放平）和同标识符的 `minecraft:geometry`（立方体相同，但**没有任何旋转**）。加载器让后者覆盖前者，姿态丢了。新式骨骼现在继承旧式同名骨骼的 `bind_pose_rotation`（仅当新式没有骨骼旋转、没有 bind pose、立方体也没有旋转时），新式新增的内容（北极熊的耳朵）保留。17 个几何是这种双格式。
- **猪躺平、鸡是一块平板、矿车没有四面墙**：立方体写了 `rotation` 却没写 `pivot` 时，绕**立方体中心**旋转，而不是 `[0,0,0]`。依据：`minecart.v1.8` 的四个立方体按中心旋转能精确复现它 v1.0 旧版里写明的骨骼支点，猪和鸡同样吻合。
- **羊没有头、腿是白色短桩**：几何继承（`geometry.a:geometry.b`）里同名骨骼，Bedrock 是**合并立方体**，只有骨骼写了 `reset: true` 才丢弃继承来的（包里 60 个 `reset` 全是 true；所有换掉立方体的骨骼——末影人 6 个、僵尸村民 4 个——都有）。羊的毛骨骼没有 `reset`：6 高的毛袖套在 12 高的皮肤腿上，毛帽套在伸得更远的头上，都要底下的皮肤。女巫的疣鼻同理。同位置同尺寸的子立方体**覆盖**父立方体（玩家的 `leftArm` 只改 uv），位置或尺寸不同的**追加**；骨骼自己的字段（`mirror`、`pivot` …）仍以子骨骼为准。`tests/geometry-inheritance.test.ts`。
- **蜘蛛腿是直杆、烈焰人只有一个头**：1.8.0 格式的客户端实体没有 `scripts.animate`，游戏自己播放它旁边的 `controller.animation.<名字>.move`（蜘蛛：`default_leg_pose` + `walk`（权重 `query.modified_move_speed`，静止为 0）+ `look_at_target`；烈焰人：`move` + `look_at_target`）。渲染器从来没接上。新增 `legacyControllers`：按实体名（或动画 id 里的所属名，洞穴蜘蛛声明的是 `animation.spider.*`）找控制器，只取引用的动画都在该实体 `animations` 里的，引用集合相同的取一个。**只对验证过的实体启用**（蜘蛛、洞穴蜘蛛、烈焰人、猫、豹猫）：全部启用会让狼下沉 1 格、北极熊 0.7、鹦鹉 0.4、末影人长到 3.5（它们的控制器需要渲染器没有的 `query` / `variable`）。蜘蛛腿最低点 0.31→0.02，洞穴蜘蛛 0.22→0.01。`tests/entity-poses.test.ts`（守住"没有实体被推到地下"）。
- **零厚度平面的两个重合面互相抢深度**：悦灵翅膀、蝙蝠翅膀、药水、经验瓶等平面把正反两面存成两个重合的面，各有各的 uv，深度测试随机选一个（喷溅药水显示一块灰板而不是瓶子）。现在两个面沿各自法线推开 0.004 格，离相机近的赢；近的那面该处透明时（悦灵的翅膀只有一面有图）alpha 测试让后面的面透出来。**没有改成单面**：原版实体渲染不剔除背面（Java 的 `entityCutoutNoCull`），骷髅的肋骨缝、硫磺方块的镂空处都要靠背面才看得到里面，试过一律单面，骷髅 / 骷髅马 / 守卫者就露出了背景。`tests/entity-faces.test.ts`。
- **火焰弹等是 2D 精灵，不是 3D 平板**：`geometry.fireball`（火焰弹、小火焰弹、龙息弹）和 `geometry.item_sprite`（雪球、鸡蛋、末影珍珠、药水）现在画成**始终面向相机的精灵**，和 Java 的 `faceCamera` 一致。精灵的四个顶点都放在中心，`MeshLayerData.billboards` 给每个顶点在相机右 / 上方向的偏移，顶点着色器用 `uRight` / `uUp` 展开（普通顶点偏移为 0）；正反两面成对时只留一个，火焰弹只有南面一个面就留这个。火焰弹 2 格宽，小火焰弹 0.5 格。
- **史莱姆只有一个纯色方块**：外壳（`slime_outer`，`sulfur_cube_outer`）被当成实心，不透明地盖住了里面的核心。材质名以 `_outer` 结尾的按半透明处理，核心的眼睛和嘴透出来。
- 126 个实体前后逐一渲染对比：只有羊和女巫的主体变了，其余实体的主体区域像素不变（此条是零厚度平面的修改之前的结果；之后用 40 个实体单独渲染对比：26 个逐像素一致，其余是带平面的实体）。

## 1.3.0

- **方块形状改用 HoloPrint 的数据**（`src/renderer/holoprint/`，neoHoloprintDB 0.2.4 的 205 个形状）：几何生成是 HoloPrint `BlockGeoMaker.js` 的 TypeScript 移植，和原版逐面比对（示例结构里 1368 个方块状态一致，`tests/holoprint-equivalence.test.ts`）。模型新增"自由四边形"（`BlockModel.quads`），两种网格构建和点选都支持。要看邻居的方块、水和岩浆、实体渲染的方块仍由原有处理负责；`createDefaultRegistry({ holoprint: false })` 退回 1.2 的形状。**数据是 CC BY-NC-SA 4.0**，见 `docs/HOLOPRINT.md` 和 `src/renderer/holoprint/data/NOTICE.md`。
- **x 轴**：HoloPrint 的几何坐标 +x 指向西，渲染时镜像到世界坐标。
- **和 neoHoloprintDB 的一处差异**：它内联的 `conditionallyGroup` 两组顺序和原版 HoloPrint 相反，会让带旋转的盒子被合并（交叉植物少一片）；移植版按原版，测试用的参考副本改了这一行（`docs/HOLOPRINT.md`）。
- **接口对齐 Java 包**（`docs/UNIFIED_API.md`）：Java 渲染器的公开成员（`SchematicRenderer` 107 个、`CameraManager` 53、`SchematicManager` 26、`SchematicObject` 78）除 Java 专有的子系统外都已提供，同名同参数；事件按 Java 的名字和载荷发出。清单由 `scripts/extract-java-api.mjs` 从 Java 源码读出，`tests/unified-api.test.ts` 检查。
  - 构造函数支持 Java 的四参数形式（资源包 → 结构 → `onRendererInitialized`，失败走画布上的 `rendererError`），`createWorkshop` 照 Java 的方式构造。
  - 渲染边界（切片）：`min <= 方块 < max`，边界外的方块不参与生成网格；`schematic.bounds`、`setRenderingBounds`、`resetRenderingBounds`、线框辅助盒。
  - 帧率（`getFPS`、`getTargetFPS`（默认 60）、`setIdleFPS`）、背景色、网格、坐标轴、相机模式、自动环绕、等距角度、资源包的列出 / 添加 / 停用 / 移除、`downloadScreenshot`、带宽高和透明背景的 `takeScreenshot`、录制（`MediaRecorder`：`h264`、`vp9_alpha`）。
  - `schematicManager`：`schematics`、`loadSchematicFromFile` / `FromURL`、`removeAllSchematics`、各种全局范围、`dispose`；结构对象：`name`、`visible`、`bounds`、`getTightBoundsMin/Max`、`getAllBlocks` 等。
  - 选项和回调接受 Java 的名字（`showGrid`、`showAxes`、`enableAutoOrbit`、`autoOrbitDuration`、`idleFPS`、`onLoadingProgress` …），Java 才有的选项接受并忽略。
  - SSAO 的方法在，没有效果（`isSSAOEnabled()` 恒为 false）。
- **站点要用的**：`CameraControls.getView()` / `setView()`（`{ yaw, pitch, zoom }`，分享链接用）、`countMaterials(buffer, filename)`、`isBlueprintFile`、`BLUEPRINT_EXTENSIONS`。Java 包没有这几个，补法在 `docs/UNIFIED_API.md`。
- **资源包**：保留目录加了 `textures/particle/`（蜡烛火苗要 `textures/particle/particles`），示例资源包里补了这一张；`ResourceStack` 的包变化后会让依赖它的缓存失效（`version`、`invalidate()`、`setPacks()`）。
- **截图**：宽高截图在 `toBlob` 之后立刻把画布尺寸和背景还原并重画，不会有一帧画在错的尺寸上。
- 测试 57 个（新增 29 个：Java 接口对照、渲染边界、渲染器接口、与原版 HoloPrint 的逐面比对），`tests/public-api.ts` 做消费者类型检查；新增脚本 `scripts/extract-java-api.mjs`、`scripts/import-holoprint-data.mjs`。

## 1.2.1

- **定义文件按标识符合并**：渲染控制器、动画、动画控制器、几何在游戏里是按标识符合并的，之前按文件“新的盖掉旧的”，丢了 151 个文件里的定义（铁傀儡的基础渲染控制器丢了，只剩半透明的裂纹层）。`ResourceStack.getAll(path)` 返回各个包的版本；`scripts/pack-resources.ts` 合并这些文件。
- **草方块侧面**：`grass_side` 的 alpha 是染色遮罩，按生物群系色烘进贴图集（`|mask:grass`），不再用没染色的 `grass_side_carried`。
- **树叶**：云杉 / 白桦固定色，红树叶染色，樱花 / 杜鹃 / 苍白橡木不染色。
- **实体默认值**：`query.property('minecraft:climate_variant')` 默认温带（鸡 / 牛 / 猪不再选寒带变种），`health` / `max_health`（铁傀儡 100，裂纹层不再选错）。
- **方块**：双铜台阶、旧版木台阶；`water` 模型按高度共享。
- 新增 `docs/FLINT.md`；测试 28 个（草方块遮罩、树叶色、合并、实体默认值）。

## 1.2.0

- **资源包**：识别游戏的 `__brarchive/` 布局（之前整包读不进来，是新版方块没有贴图的主因）；跳过光追附属文件（`*_mers.tga`、`*_normal.tga`、`*.texture_set.json`），`*_normal.png`（活塞）保留；`blocks.json` / `terrain_texture.json` 损坏时只跳过那个包。
- **`scripts/pack-resources.ts`**：把整个 `resource_packs` 合成一个约 3.3 MB 的资源包。
- **方块**：新版方块按真实资源包的贴图名修正（藤蔓、干恶魂）、双铜台阶、旧版木台阶；颜色床 id（`white_bed` …）、`light_block_N`、`unknown` 不再画占位方块。`blocks.json` 里的每个 id 都有回归测试。
- **实体**：新版船的贴图键名、运输船几何、颜色床、实体位置（世界坐标 / 相对坐标自动判断）；`stats.entities` 只数真正画出面的实体，新增 `stats.undrawnEntities`。
- **网格后端**：新增调色板 + 分区块的网格流程，构建器可选 Java 包的 wasm（默认，回退 TS 核心）或共享 TS 核心；`legacy` 保留。输出逐四边形一致，速度同一个量级（见 `docs/MESH.md`）。`mesh.stats.meshBackend` / `timings`。
- **示例**：Java 包的整套示例（工作台、检查器、视角控制、渲染设置、性能面板、最小示例）原样搬入 `example/`，只改包名、文件格式、资源包和蓝图名；`scripts/generate-coverage-structures.ts` 生成全方块 / 全实体 / 容器 / 红石 / 实体示例蓝图。
- **引擎成员**（示例用到的、与 Java 包同名）：`cameraManager` 事件、`flyControls`、`camera.quaternion`、`renderManager.setFrameProfilingEnabled/getFrameProfile`、`chunkVisibility.getStats`、`frameRendered` / `renderIdle`、`suspended`、`cubane.getAssetLoader()`、`schematic.group.add()`（线段选中框）、`entityManager.setVisible/setShowDebug`、`entity.snbt`、选项 `backgroundColor` / `targetFPS` / `cameraOptions` / `postProcessingOptions`。

## 1.1.0

对原 `dist`（mcstructure-renderer）的扩展；原有 API（`McStructureRenderer`、`buildStructureMesh`、`ResourcePack`……）全部保留。

- **接口对齐 `@rsw/mc-java-render-ts`**：`createWorkshop` / `BlueprintLoader` / `CameraControls` / `captureScreenshot` / `pickScene` / `listContainers` / `listEntities` / `ItemAssets` / `MaterialsCounter` / `readBlockInventory` / `readRedstone` / `nameFor` / `materialsToCsv` / `FrameStats` / `applyRenderSettings`，名字、参数、返回类型与 Java 包一致；子路径 `. / core / renderer / mesh / mesh/worker`。
- **查看器**：多结构、正交视角、第一人称（指针锁定 + WASD）、方块网格、射线、帧率上限、`suspend/resume`。
- **资源包**：一个 zip 里放多个包（`vanilla/`、`vanilla_1.xx/` …）按版本叠加；默认加载范围补上 `textures/items`、`misc`、`painting`、护甲、`environment`。
- **方块**：新增约 45 个新版方块的模型（幽匿、紫水晶、滴水石锥、垂滴叶、蜡烛蛋糕、雕纹书架、饰纹陶罐、悬挂告示牌、铜箱、藤蔓、花瓣……）和一个按贴图名兜底的通用规则。
- **实体**：船、画、掉落物、掉落方块、点燃的 TNT；每个实体有包围盒和 `EntityRecord`（用于拾取与 `listEntities`）。
- **网格**：分层缓冲改成可增长的类型化数组，空方块只解析一次，裁剪不再逐面分配对象；输出与原版逐字节一致（黄金哈希测试），64×384×64 的大结构 1545 ms → 544 ms。

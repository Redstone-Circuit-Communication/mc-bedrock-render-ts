# 方块形状：HoloPrint 的数据

方块的形状（盒子、按状态的朝向、贴图变体、每个面的贴图坐标）来自 HoloPrint 的方块几何数据，用的是 neoHoloprintDB 0.2.4 整理的版本。
以前这些形状是手写的，覆盖不全，很多不准；现在 205 个形状由数据描述，库里原有的手写处理只留下数据表达不了的那一部分。

数据的来源、署名和许可（**CC BY-NC-SA 4.0：禁止商用，要署名，改编要同样许可共享**）见 `src/renderer/holoprint/data/NOTICE.md`。

## 一个方块怎么变成模型

```
方块名 + 状态 ──shapeOf──▶ 形状名 ──geo.ts──▶ 面（顶点、贴图角、贴图引用）──textures.ts──▶ 贴图 ──model.ts──▶ BlockModel（自由四边形）
```

- `src/renderer/holoprint/geo.ts`：HoloPrint `BlockGeoMaker.js` 的移植。条件（`if`）、复制（`copy`、`copy_block`）、按状态覆盖（`block_states`）、`${…}` 插值、盒子合并和内部面剔除、贴图坐标（`uv_rot`、`flip_textures_*`、`box_uv`、顶面和底面转 180°）、盒子自己的旋转、按状态的整块旋转和贴图变体，都照原版一步一步来。
- `src/renderer/holoprint/textures.ts`：贴图引用 → 渲染器的贴图。按 `blocks.json` 找到 `terrain_texture.json` 的键，再取变体；叠在上面的材质包仍然优先。
- `src/renderer/holoprint/model.ts`：把面变成 `BlockModel.quads`，作为 `BlockRegistry.primary` 处理器接进去。
- 网格：两种网格构建（`legacy` 单遍和调色板）都认 `quads`，点选也认。

## 坐标：x 轴是镜像的

HoloPrint 的几何坐标是像素（一格 0–16），**+x 指向西**：叫 `west` 的面在 x = 16。渲染器的世界坐标 +x 是东，所以 `model.ts` 把每个顶点的 x 换成 `16 - x`，法线的 x 取反。
不翻的话所有方块东西颠倒。依据有两条：朝东的楼梯（`weirdo_direction=0`）旋转后台阶落在数据 x 较小的一侧；各面的贴图坐标也只有镜像之后才和游戏一致。
neoHoloprintDB 自带的说明里对这一点的描述和实测不符，以原版 HoloPrint 的代码为准。

## 和库里原有处理怎么分工

HoloPrint 的数据只看单个方块，所以这些仍由库自己处理（`KEEP_SHAPES` / `KEEP_BLOCKS`）：

- 要看邻居的：栅栏、竹栅栏、玻璃板、铁栏杆的连接，红石线的四向连接，水和岩浆（水面高度、同种水之间的面），大箱子的配对。
- 库里本来就不画成方块模型的：空气、光源方块这类不画的方块，以及床、头颅、潜影盒、移动中的方块（走实体渲染，按资源包里的定义画）。

另外，渲染层（染色玻璃、冰）、半透明、同种相邻面剔除（`cullSame`）、自发光这些材质属性，HoloPrint 的数据里没有，取自库里原有的同一个方块的模型；`opaque` 只有在 HoloPrint 的形状正好是一个完整方块时才保留。
一个方块所有的面都找不到贴图（资源包的 `blocks.json` 没列它）时，整个方块回退到库里原有的模型；只有部分面找不到时，只画找到的面。

`createDefaultRegistry({ holoprint: false })` 可以整个关掉，退回 1.2 的手写形状。

## 贴图

- 草、蕨、树叶、藤蔓、睡莲、甘蔗等按生物群系染色的贴图，继续用渲染器的染色（`MeshOptions.tints` 可调），不用 HoloPrint 那种预先染好色的物品栏贴图；草方块侧面的 alpha 当染色遮罩（见 `docs/FLINT.md`）。
- `bush`、`firefly_bush`、`open_eyeblossom`、`light_block*` 用 `blocks.json` 里的 `carried_textures`，和 HoloPrint 一致。
- `blocks.json` 里没有的几个名字用一张补丁表（`BLOCKS_DOT_JSON_PATCHES`，`grass_block`、橡木板等）。
- 蜡烛火苗要 `textures/particle/particles`，所以资源包的保留目录里加了 `textures/particle/`（`DEFAULT_ROOTS`）；示例资源包里补了这一张。
- 告示牌贴图名用 Bedrock 的真实方块 id：橡木墙牌是 `wall_sign`（贴图 `textures/entity/sign`），其他木材是 `spruce_wall_sign` 这一类。没有 `oak_wall_sign` 这个方块。

## 和原版移植的差异

- 没有 HoloPrint 的"全息投影缩放"（`config.SCALE`），也没有它的贴图集：面里只留贴图引用。
- 多层嵌套旋转（`extra_rots`）按最内层先转的顺序对每个顶点应用（原版对每个顶点把数组反转一次，只有两层以上嵌套才有区别）。
- 错误不打日志，收集在 `HoloGeometry.warnings` 里。
- 顶点坐标对齐到 1/64 像素（1/1024 方块），和网格核心的量化精度一致：旋转留下的 28.999999 这类浮点噪声，wasm 构建器和 TypeScript 核心会各取到不同的格子。

## neoHoloprintDB 里和原版 HoloPrint 不一样的一处

neoHoloprintDB 的 `core/NeoBlockGeoMaker.js` 里内联的 `conditionallyGroup` 返回的两组，和原版 HoloPrint 的 `utils.js` 正好相反。
`#optimizeGeometry` 用第一组当"不能合并的盒子"（带 `rot` 的），所以按随包的顺序，被合并、被剔除面的是**带旋转的**盒子，不带旋转的反而不动。
实际后果：交叉植物的两片面是两个旋转的零厚度盒子，其中一片被合并掉（`tall_grass` 比原版少一片）。
移植版按原版的顺序来。比对测试用的参考副本（`tests/holoprint/NeoBlockGeoMaker.reference.js`）只改了这一行，文件里有标注。建议告知 neoHoloprintDB 的维护者。

## 验证

- `tests/holoprint-equivalence.test.ts`：在 Node 里把原版核心（参考副本）和移植版各跑一遍，示例结构里的全部方块状态（1368 个）逐个比对：每个面的顶点位置、贴图角和贴图引用都要一致。把任何一处旋转符号取反，56 个状态立刻出现差异。
- 在 Chromium 里用示例资源包渲染过两样东西：一个约 50 种有朝向或状态的方块的对照场景，和"全方块"示例。看的是整体轮廓和有没有缺贴图（对照场景现在一张都不缺），**没有逐个方块和游戏实物对照**。

## 已知局限

- 没有拿游戏里的实物逐个方块对过，只对了上面那一批。
- 示例结构里的墙（`*_wall`）没有存方块状态，HoloPrint 会把所有分支都画出来，看起来像十字；真实结构里有状态，不受影响。
- 形状只对示例资源包验证过；换了资源包，贴图文件名不一样的方块会回退到库里原有的模型。
- 依赖方块实体数据的形状（讲台的书、花盆里的植物、炼药锅的颜色、旗帜、陶罐）需要结构里保存了对应的方块实体；没有就用数据里写的默认值，条件里缺了字段按"成立"处理（会多画一些几何）。

## 对数据的改动

数据本身（`src/renderer/holoprint/data/*.json`）只改了两处，其余和 neoHoloprintDB 一致（许可要求标明改动，另见该目录的 `NOTICE.md`）：

- **火把的旋转表**：`blockStateDefinitions.json` 的 `rotations.block_shapes` 里加了 `torch,redstone_torch`，`torch_facing_direction` 的四个水平方向各转 180°（`west:[0,180,0]`、`east:[0,0,0]`、`north:[0,-90,0]`、`south:[0,90,0]`）。依据：Bedrock 的这个状态写的是支撑方块所在的一侧，真实结构里每根墙火把在命名那一侧都有实心方块；而数据里的火把模板把底座放在对面。这一条由 `scripts/import-holoprint-data.mjs` 的 `CORRECTIONS` 在每次导入后重新应用，`tests/orientation.test.ts` 检查。

- **`golden_dandelion` 的形状**：`blockShapes.json` 的 `individual_blocks` 里加了 `golden_dandelion: cross_texture`（数据里没有它，原来是按贴图名生成的立方体）。同样由 `CORRECTIONS` 重新应用。

核对过**没有问题**的朝向（不用改）：中继器和比较器的 `minecraft:cardinal_direction` 是输入侧，输出在反面（数据里已有 180° 的覆盖项）——依据是结构里 4 个比较器的 `OutputSignal` 与其 `cardinal_direction` 一侧容器的装满程度精确吻合，原版 Java 模型里输入端放双火把 / 可调火把，顶面箭头尖端在输出端；活塞的 `facing_direction`（0 下、1 上、2 南、3 北、4 东、5 西，和其他方块的标准映射不同）。

## 更新数据

```bash
pnpm data:import-holoprint <neoHoloprintDB 文件夹>   # 去掉注释，写进 src/renderer/holoprint/data/
pnpm test                                            # holoprint-equivalence 会用原版核心比对新数据
```
新版本的核心 JS 换进 `tests/holoprint/NeoBlockGeoMaker.reference.js` 之前，先看 `conditionallyGroup` 那一行是不是还和原版相反。

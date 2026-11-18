# 参考库 flint 的建模方式

`flint.zip` 是 flint v4.4.0，一个 WebGPU 路径追踪渲染库（辐射级联全局光照、FSR3 放大、BVH）。读完之后的结论：

**它没有方块或实体的形状数据**：没有 NBT、调色板、骨骼，也没有楼梯、栅栏之类的定义，只有渲染一侧的场景表示。把方块和实体转成盒子的代码在使用它的应用里（`flint.js` 的注释提到 redstonifyNBT），不在这个包里。

## 它的场景表示

- **盒子**是唯一的几何：轴对齐盒（`pos` + `size`）、四元数旋转盒、任意 3×3 矩阵变换盒。变换是对盒子实例的操作（平移、四元数、矩阵、欧拉角、增减尺寸），烘焙完成后算出包围盒，再进 BVH。
- 每个盒子 6 个面，每个面是 `{ origin, uAxis, vAxis, layer, materialInstID }`：贴图集里的起点、u 轴和 v 轴（带符号的像素向量，所以翻转、90° 旋转只是换轴）、贴图集分页、材质实例。
- 面的顺序（来自 `testIntersectionWithBox`）：−X、+X、−Y、+Y、−Z、+Z，也就是 west、east、down、up、north、south。每个面的 UV 取法：

  | 面 | u | v（从上往下） |
  |---|---|---|
  | −X west | z 从小到大 | y 从大到小 |
  | +X east | z 从大到小 | y 从大到小 |
  | −Y down | x 从小到大 | z 从大到小 |
  | +Y up | x 从小到大 | z 从小到大 |
  | −Z north | x 从大到小 | y 从大到小 |
  | +Z south | x 从小到大 | y 从大到小 |

  我逐项对过：本包 `face.ts` 里的 `FACE_VERTS` 和 `defaultUv` 和这张表一致，不用改。

## 它的 6 种材质，和本包的对应

| flint | 做法 | 本包 |
|---|---|---|
| `Builtin_Basic` | 直接取贴图 | 默认 |
| `Builtin_ColorMul` | 贴图 × 颜色 | 顶点色（着色 × 色调） |
| `Builtin_Linear` | 贴图 × a + b | 不需要 |
| **`Builtin_MaskedColorMul`** | 只在贴图 alpha 标记的区域染色，输出不透明 | **已借用**：`grass_side|mask:grass`，染色在构建贴图集时烘进去 |
| `Builtin_Sequence` / `SequenceColorMul` | 动画帧（带帧间插值） | 没做：水、岩浆、火、传送门只显示第一帧 |
| MERS 贴图 | 金属度 / 自发光 / 粗糙度 | 不需要：光栅化只画漫反射，资源包加载时跳过 `_mers` 和 `*_normal.tga` |

## 在真实资源包里验证的

基岩的 `grass_side` 正是遮罩染色的用法：16×16 里 211 个像素 alpha 为 0，里面存的是泥土色（平均 130, 93, 65）；45 个像素 alpha 为 255，是灰色的草边（155）。游戏里侧面是 `grass_side` 按生物群系染色，而不是 `grass_side_carried`（手持用的、已经上好色的版本）。之前本包用的是后者，所以侧面颜色和绿色的顶面对不上。

不是所有透明贴图都是遮罩：树叶、蜡烛、藤蔓等透明处的 RGB 是白底，只有 `grass_side` 这一种存了有意义的颜色。所以只对它启用，没有做成通用规则。

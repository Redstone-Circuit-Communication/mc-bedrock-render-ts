# 许可与来源

- **整个包的许可是 CC BY-NC-SA 4.0**：方块几何数据和 `src/renderer/holoprint/geo.ts` 来自 HoloPrint（SuperLlama88888，
  https://github.com/SuperLlama88888/holoprint），经 neoHoloprintDB（Purple Rain）整理，详见 `src/renderer/holoprint/data/NOTICE.md`。
  构建出的 SDK 把这些数据和本库的代码打进同一个文件，所以成品整体受这个许可约束：署名、非商业、相同方式共享。
- 依赖：three、postprocessing、n8ao 等，各自的许可见各自的包（MIT 等）。

## 和 Java 渲染库共用的代码（1.6.0 整理）

Java 渲染库 fork 自 CoastlineCreations 的 schematic-renderer，是 **AGPL-3.0-only**。AGPL 不允许附加「非商业」这类限制，CC BY-NC-SA 又要求整体同许可，
**两种许可的代码不能合进同一个包发布**。2026-11-18 复审之后，本库里每一个写着「从 Java 库拷来」「照 Java 库写」的文件，都和上游
[schematic-renderer](https://github.com/CoastlineCreations/schematic-renderer) 的 master 分支（2026-11-17 下载）逐个比过：

| 本库 | 和上游比 | 处理 |
| --- | --- | --- |
| `src/renderer/gamma-effect.ts` | 和上游 `src/effects/GammaCorrectionEffect.ts` 相似度 0.98：**来自上游** | 1.6.0 重写：用 postprocessing 的 Effect 接口自己写，同一条 c^(1/γ) 曲线 |
| `src/wasm/`（wasm 网格构建器：wasm-bindgen 胶水代码，加 185 KB 的二进制）、`src/mesh/wasm.ts` | 二进制编自 Java 库的 `mesh_builder_wasm` crate，它的 `src/lib.rs` 和上游同名文件逐行相似 0.978：**来自上游** | 1.6.0 删掉。默认改用 TS 网格核心；`backend: 'wasm'` 仍然接受，给的是 TS |
| `src/mesh/core/` 下 5 个文件、`src/mesh/worker/` 下 2 个文件 | 上游 master 里找不到对应（最相似的文件约 0.2，只有 `x`、`y`、`z` 这类字段重合） | 留着。看起来是 fork 之后写的，**仍要从提交历史确认作者** |
| `src/frame-stats.ts`、`src/material-export.ts`、`src/names.ts`（第一行写着 Mirrors） | 同上（约 0.2；`names.ts` 在上游没有相似的文件） | 同上 |

比法：去掉注释后按词法切分，用 Python 的 difflib 算序列相似度；Rust 按行比。**只比了上游现在的 master**，上游更早的版本没有比（下载的源码包没有提交历史）。

还要你们做的：

- 从 Java 库的提交历史确认上面「留着」的 10 个文件是谁写的。是红石阁团队写的，著作权在你们，两个库可以各用各的许可，在两边写明作者和这一安排即可；
  来自上游，就要在本库里重新独立实现，或者联系上游拿许可。
- 如果查清 `mesh_builder_wasm` 是你们写的、后来贡献给了上游（上游 master 里有它），或者拿到了上游的书面许可，可以从 1.5.0 原样恢复 wasm 后端（`git revert` 这次提交）。
  去掉之后网格构建慢多少，见 `docs/CHANGELOG.md` 的 1.6.0。

`three-viewer.ts`、`ssao.ts` 只是照 Java 库设了同样的参数值（灯光强度、相机视角、AO 的半径），没有拷代码，参数值本身不是问题。

# 数据来源和许可

本目录的四个 JSON（`blockShapes`、`blockShapeGeos`、`blockStateDefinitions`、`blockEigenvariants`）来自
**neoHoloprintDB 0.2.4（20261028）** 的 `file/*.jsonc`，转换时去掉了注释和多余的逗号，并应用了一处修正（`scripts/import-holoprint-data.mjs`；**改动：`blockStateDefinitions` 里给 `torch,redstone_torch` 加了旋转表；`blockShapes` 里给 `golden_dandelion` 加了 `cross_texture`；新方块 `sulfur_spike`（数据里没有）照尖滴石加了形状（`blockShapes`、`blockShapeGeos` 各一项）**，说明见 `docs/HOLOPRINT.md`），其余内容没有改动。

- 原始的方块几何数据和解析逻辑是 **HoloPrint**（SuperLlama88888，https://github.com/SuperLlama88888/holoprint）的。
- neoHoloprintDB 是把这套数据接到 MCvox 工作流里的对接层（作者署名 Purple Rain），它的 JSON 字段已经按那边的需要调整过。
- 许可证是 **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International**，全文在 `LICENSE-HoloPrint.txt`：
  - 署名：使用这些数据的产品要注明来自 HoloPrint 和 neoHoloprintDB；
  - 非商业：不能出售，也不能放在广告或付费墙后面；
  - 相同方式共享：基于这些数据的改编要用同样的许可发布。

`src/renderer/holoprint/geo.ts` 是 HoloPrint `BlockGeoMaker.js`（经 neoHoloprintDB 整理的版本）的 TypeScript 移植，同样受上面的许可约束。

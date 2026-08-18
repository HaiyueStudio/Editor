# AnimationEditor samples

- `gltf/animation-characterization.gltf` 是原生 3D glTF 角色模板使用的真实、完全内联 glTF 2.0 fixture，
  包含 TRS、Step rotation、Cubic Spline scale、skin/joint 和 Morph 动画。
- 六个产品模板由 `src/integration/DesignerTemplates.ts` 生成并立即通过对应 2D/3D codec；这样 UI、Node E2E、
  HYA compiler 和 delivery package 共用同一份可执行样例，不维护易漂移的第二份 JSON。
- `examples/state-machine-multitrack.hya-project.json` 是可直接打开的完整 2D 多轨状态机工程。

模板与样例用于开发/候选验收。正式发布像素与性能 baseline 由 M02 在干净、固定设备的 HEAD 上晋升。

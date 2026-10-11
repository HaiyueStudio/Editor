# Photoshop 对比第一批：合成与图层样式

本批扩展常用混合、Fill、高级混合和常用缺失样式。所有编辑进入现有文档事务、撤销、工程保存／恢复和 Platform 调度。没有新增传输层。

## 交付能力

- 混合模式从 9 种扩展到 26 种：新增柔光、颜色减淡／加深、线性减淡／加深、亮光、线性光、点光、实色混合、减去、划分、深色、浅色、色相、饱和度、颜色、明度。非分离模式按 RGB 向量计算；智能滤镜混合也使用同一实现。
- `fillOpacity` 独立于图层 `opacity`。降低 Fill 保留样式，降低 Opacity 衰减整体结果。
- 高级混合包括将剪贴图层混合成组、将内部效果混合成组、图层蒙版隐藏效果，以及挖空当前隔离组。根级挖空露出透明画布。
- 新增内阴影、外发光、多色标线性／径向渐变叠加、平滑内斜面和光泽。描边增加内侧／居中／外侧；投影和描边支持最多 10 个实例，支持效果混合模式。
- 阴影／发光可保留等高线采样；读取全局光时根据文档角度／高度角解析实际效果，未修改的原始描述继续通过 PSD 档案保留。
- 图层样式面板提供新增样式参数、渐变色标增删、多重投影／描边编辑；“混合选项”面板提供 Fill 和高级混合，继续使用实时预览、取消和一次撤销。

## 公共 API

现有命令 ID 和 API version 1 保持不变。`image.layer.update` 的 patch 增加：

```json
{
  "fillOpacity": 0.3,
  "blend": "soft-light",
  "advancedBlend": {
    "blendClipped": true,
    "blendInterior": false,
    "maskHidesEffects": true,
    "knockout": false
  }
}
```

`image.layer.styles` 的 `styles` 新增 `innerShadow`、`outerGlow`、`gradient`、`bevel`、`satin`、`extraShadows`、`extraStrokes`。完整类型和边界由 `styleSchema.ts` 注册到命令发现。`image.document.query` 返回这些参数，调用者通过原有浏览器 API、IPC、本地 RPC 访问。对象传入后独立复制并深冻结，失败事务不改变 revision 或历史。

## 渲染与持久化

新语义共用区域合成，halo 包含阴影偏移、扩展、发光和斜面邻域；渐变位置及噪声以文档坐标定位。支持 RGB8、RGB16、RGB32 和异步磁盘像素块。区域渲染不会因效果半径大而隐式回退到整张画布分配。复杂样式仍为 CPU 区域合成后经 Haiyue WebGPU 显示，尚不是全部效果的 GPU compute 实现。

使用新语义时保存工程 v17、恢复 v15，旧版本仍可读。旧版本标签夹带新语义会拒绝，避免旧客户端静默丢失属性。普通旧文档继续使用已有最低必要版本。

PSD／PSB 使用原生混合、`iOpa`、`clbl`、`infx`、`lmgm`、`knko` 和 `lfx2`／`lmfx` 描述。Fill 依 PSD 8 位字段量化；渐变色标位置依 1/4096 量化。导出自检检查参数与字段，避免把合法量化误判为参数丢失。智能滤镜的 PSD 原生映射仍属于后续批次。

## 明确边界

本批不是 Photoshop 全效果逐像素认证。阴影／发光使用有界近似模糊，描边使用形态学近似，斜面采用高度场近似。混合公式与 Fill 的组合，尤其 Photoshop 特有混合行为，仍需跨软件像素对齐；PSD 原生参数保留不等于重绘像素完全一致。

仍明确拒绝图案叠加／图案描边、渐变描边、非平滑内斜面的其他浮雕技法、纹理斜面、多重内阴影／渐变叠加、噪声渐变与非居中色标中点、关闭“透明形状图层”的高级选项，以及深层挖空。挖空只承诺当前隔离组语义。独立矢量蒙版隐藏效果及双重栅格蒙版仍未补齐。

调整层尚不开放 Fill／高级混合；CMYK 日常像素编辑支持 Fill 和分离混合公式，但样式及非分离 RGB 混合仍需转换 RGB。溶解模式未加入本批。本文的范围替代早期文档中“只有 9 种混合／四种样式”的描述。

## 验证

- `npm test -w @haiyue/image-editor`
- `npm run app:check -w @haiyue/image-editor`
- `npm run check:boundaries`
- `node imageEditor/test/compositing-styles-browser.mjs`
- `node imageEditor/test/tiled-native-browser.mjs`

新增单元测试覆盖参考混合向量、Fill 与 Opacity、组内挖空、蒙版隐藏效果、剪贴 Fill、区域接缝、冷磁盘 RGB8／16／32 区域读取、不可变历史、工程版本门禁、恢复、公共 API，以及全部 26 种模式的 PSD 编码重读。浏览器场景覆盖参数面板、实时预览、撤销、PSD 和工程重开。无需本机安装 Photoshop；不宣称 Photoshop 实机认证。

2026-10-10 验收：385 项单元测试全部通过；应用类型检查、构建、产物校验和仓库边界检查通过。新增样式浏览器闭环与原大图 HDR／PSB 浏览器回归均通过，报告绑定同一最终构建 `fb66d5cfaec67c8ad1cec6a563e40f2d5d6a3238c651447062df0d7ee3576699`。产物 4,467,701 B raw／1,462,615 B gzip，保持现有预算不变。浏览器报告分别位于 `artifacts/compositing-styles/browser.json` 和 `artifacts/tiled-native/browser.json`；HDR 回归仍为模拟环境，不是物理 HDR 认证。

# 第一批：图像处理质量

本批覆盖高质量重采样、RGB 分通道曲线／色阶、直方图、高斯模糊与 USM。本批完成时图像命令共 52 个（[第二批](non-destructive-pipeline.md) 后为 55 个），沿用 Plugin SDK 的文档定位、revision 检查、原子提交和资源句柄，通过现有浏览器 API、Electron IPC 与本地 RPC 调用。

## 界面

- 顶部「重采样」选择用于接下来的交互式自由变换；「变换图层」面板可单独选择。默认双三次，另有双线性、Lanczos 3 和最近邻（像素画）。
- 「调整图层」选择曲线或色阶，再选择 RGB／红／绿／蓝。切换通道保留各自参数，重新编辑、撤销／重做都保留通道设置。曲线／色阶强度由图层不透明度控制。
- 调整面板显示打开时的可见合成直方图，作为输入参考，不冒充实时调整后预览。顶部「直方图」支持合成／当前图层、RGB／单通道／亮度、仅选区，以及刷新和统计值。
- 「滤镜」新增高斯模糊和 USM，支持原图对比、后台预览、取消和单次撤销。高斯参数为标准差 σ（0.1–32 px）；USM 强度 0–500%，半径 σ 0.1–32 px，阈值 0–255 色阶。
- 「批处理」提供相同的重采样方式、高斯及 USM 参数。

## 算法及边界

重采样使用预乘 Alpha 运算，避免透明像素隐藏 RGB 污染边缘。缩小时按比例扩大采样核，使用可分离低通滤波；中间浮点平面选择较小的轴向组合。双三次使用 Catmull–Rom 核，Lanczos 使用 3 瓣窗。缩放后再执行逆映射旋转／翻转，旋转图像以外为透明，精确四分之一转保持对应 RGBA。最近邻仍提供逐像素复制。

高斯采用归一化、截断于 3σ 的可分离卷积，边界夹取，并对 Alpha 加权。USM 使用原图减高斯低频分量，逐颜色通道阈值控制增强，保留原始 Alpha。滤镜的选区混合继续采用预乘 Alpha，单次应用只创建一条历史记录。预览和浏览器 API 滤镜运行于可取消 Worker；API prepare 完成后仍由平台校验版本再提交。

曲线沿用自然三次样条与 256 项 LUT；色阶支持输入／输出黑白场和 gamma。当前约定先应用 RGB 合成 LUT，再应用对应 R/G/B LUT。Alpha 不参与颜色调整。所有操作仍在 RGBA8 编码值上处理，未引入线性光、高位深或 HDR。

直方图返回 256 个桶，按 Alpha × 选区覆盖率加权，不计完全透明像素；`pixels` 是有贡献的像素数量，`weight` 是加权像素总数。均值、中位数、标准差以编码值亮度 `round(.2126 R + .7152 G + .0722 B)` 计算。API 的图层来源采用该层独立合成（含样式、蒙版、偏移），与现有取色口径一致；文档、选区或图层没有有效像素时返回零统计。

画布尺寸、像素总数、图层数和批处理容量沿用既有上限。大半径高斯在大图上计算成本较高，Worker 保留 120 秒超时与取消机制；未宣称 GPU 加速或提升大图容量。

## API 示例

以下为 `params`；仍需按公共契约提供 `apiVersion`、`requestId`、`operation`，文档写操作提供 `documentId` 与 `expectedRevision`。

```json
{"operation":"image.layer.transform","params":{"layerId":"…","width":1920,"height":1080,"resampling":"lanczos"}}
{"operation":"image.histogram.query","params":{"selection":true}}
{"operation":"image.filter.apply","params":{"layerId":"…","kind":"gaussian","amount":2.5}}
{"operation":"image.filter.apply","params":{"layerId":"…","kind":"usm","amount":120,"radius":1.5,"threshold":4}}
```

分通道参数通过现有 `image.content.create`／`image.content.update` 提供，主通道仍使用旧字段，以兼容现有调用：

```json
{
  "type":"adjustment", "filter":"curves", "amount":100,
  "curves":[{"input":0,"output":0},{"input":255,"output":255}],
  "channels":{
    "red":{"curves":[{"input":0,"output":0},{"input":128,"output":170},{"input":255,"output":255}]}
  }
}
```

色阶的 `channels.red/green/blue.levels` 与主 `levels` 结构相同；未指定的通道为恒等变换，拒绝 Alpha／未知通道和与调整类型不符的字段。`image.filters.query` 列出新增滤镜，USM 附带半径／阈值参数范围。

`image.batch.run` 是工作区命令，不携带文档目标。其 `fit` 步骤增加可选 `resampling`，`filter` 步骤接受同一套滤镜参数。

## 保存与 PSD

- 含分通道调整或显式智能对象重采样参数的工程写入 v6，恢复记录写入 v7；继续读取旧版本。旧智能对象没有重采样字段时保持原先最近邻重建语义，新变换默认双三次。
- R/G/B 曲线和色阶映射到 PSD 原生通道记录，不需要栅格化；色阶继续规范化为 29 记录的 v2 格式。工程保留显式恒等通道，PSD 重开可能省略这些等价的恒等通道。
- 智能对象的重采样选择保存在 `.hyimage` 与恢复记录中。PSD 保存变换、嵌入源与缓存像素，当前编解码器未映射采样偏好；PSD 重开后再次变换时应明确选择采样方式。
- 原生通道参数、缓存合成和第二代导出有回归验证；不等于已认证 Photoshop 重绘像素完全一致。

## 验证与包体

```sh
npm run typecheck -w ./imageEditor
npm test -w ./imageEditor
npm run test:browser:quality -w ./imageEditor
node scripts/editor-e2e/rpc-electron.mjs imageEditor
PSD_NATIVE_PYTHON=/path/to/python-with-psd-tools node imageEditor/scripts/check-quality-psd.mjs
npm run check:boundaries
```

`quality.test.mjs` 覆盖缩小抗锯齿、恒色及透明边缘、旋转、独立二维高斯参考、USM 阈值、直方图口径、通道验证、历史、工程／恢复、PSD 原生往返及 API／批处理。`quality-browser.mjs` 覆盖真实面板操作、Worker 预览和取消、通道切换／重新编辑、PSD 重开及批处理，证据位于 `artifacts/quality/`。

包体预算调整：新增算法、UI、Worker 和契约从此前约 299,875 B gzip 增至约 305 KB（约 +1.8%）；产品 gzip 上限由 300,000 B 调整至 320,000 B，raw 上限保持 1,000,000 B。已尝试合并纯计算模块、合并编解码器和不同压缩配置，收益约 1–2 KB，且合并编解码器会失去按需加载，故保留原动态边界。没有移除已有功能或改动预算测量器；确切文件大小、文件哈希与构建身份见 `app-dist/app-manifest.json`。后续超预算仍需重新评估，不自动放宽。

本机验证（2026-10-09）：161 项单元测试、处理质量／日常编辑／非破坏性浏览器回归、真实 Electron IPC／HTTP RPC、类型检查、仓库边界和应用产物校验通过。独立 psd-tools 对色阶和曲线两组样本验证了 R/G/B 通道记录、参数和缓存像素，无解码警告。Photoshop 人工重绘等价性仍未验证。

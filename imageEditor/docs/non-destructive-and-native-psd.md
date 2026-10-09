# 非破坏性编辑与 PSD 原生往返

> 本文记录前一阶段的交付范围。2026-10-09 新增分通道曲线／色阶、高质量重采样、直方图和滤镜；现有 52 个命令，新语义使用工程 v6／恢复 v7，当前包体预算 320,000 B gzip。最新契约与验证见 [处理质量](processing-quality.md)。

本阶段增加剪贴蒙版、常用图层样式、RGB 曲线／色阶和嵌入式像素智能对象。它们保存独立参数或源图，编辑、撤销／重做、`.hyimage` 保存、IndexedDB 恢复和统一命令 API 使用同一个文档模型。以下矩阵取代 P5 文档中的旧 PSD 边界；这是经过验证的原生子集，不是 Photoshop 全兼容声明。

## 操作与限制

| 能力 | 已实现 | 当前范围 |
| --- | --- | --- |
| 剪贴蒙版 | 内容面板“创建／释放剪贴”；同组连续剪贴层引用下方最近的非剪贴基底；支持剪贴调整层 | 基底为像素层或隔离组。基底透明度只应用一次，隐藏基底隐藏整条剪贴链。无基底时不显示孤立剪贴层。 |
| 图层样式 | 颜色叠加、纯色外描边、投影；启用／移除；预览不写历史，应用产生一次撤销记录 | 正常混合；描边 1–64 px；投影整数偏移 ±256 px、模糊 0–64 px。使用方形膨胀、分离盒式模糊，画布外源像素不参与效果扩展；边角、边界和 Photoshop 渲染可能不同。 |
| 色阶 | 输入黑白场、中间调、输出黑白场，可重复编辑 | RGB 合成通道；输入黑场 0–253，白场 2–255，黑场小于白场；gamma 0.10–9.99，精度 0.01。 |
| 曲线 | 图形加点、拖动、右键删点；数值控制点编辑 | RGB 合成通道，自然三次样条，2–16 点；输入递增、首尾输入为 0／255；输出 0–255。强度用图层不透明度控制。 |
| 智能对象 | 像素层转智能对象、查看源尺寸、替换 PNG/JPEG 源图、非破坏性缩放／旋转／翻转 | 每个实例有独立源像素。每次变换从源图采样，缩小再放大不累积损失；替换源图保留当前变换。使用最近邻采样，不支持透视、变形网格、智能滤镜、外链或内部多层文档编辑。带图层蒙版的变换需先处理蒙版。 |

原始内容层仍不能直接进行像素绘画／滤镜，需显式栅格化。样式作用于蒙版后的像素，基底样式在剪贴内容之后应用。合并命令拒绝直接含剪贴／启用样式的顶层选择，以及有未选剪贴层依赖的基底，避免改变其他图层的结果。

## PSD 原生矩阵

| 内容 | 写入／读回 | 限制与提示 |
| --- | --- | --- |
| 剪贴关系 | PSD clipping 标志 | 同组基底关系，保留像素缓存 |
| 常用样式 | `lfx2` 等原生效果字段 | 颜色叠加、单重外描边、单重投影；其他效果、单项停用、特殊轮廓／混合方式等明确拒绝分层编辑。全局停用可往返。 |
| 基础文字 | `TySh` 原生文字、字体名称、字号、颜色、粗斜体、对齐、多行 | 统一样式、水平、未变形点文字，仅接受与本编辑器原点／1.4 倍行距匹配的布局。富文本、段落框、文字路径、自定义原点／缩进／行距不转换。字体替代及重新排版会改变字形；未编辑时保留像素缓存。编解码库会吞掉末尾空行，因此这种文字导出须明确同意合并。 |
| 基础形状 | 原生矢量路径、纯色填充、居中描边 | 矩形／圆角矩形、椭圆、直线；必须匹配基础几何及缓存范围。任意复合路径、渐变／图案填充、复杂描边不转换。 |
| 色阶／曲线／反相 | `levl`／`curv`／`nvrt` 原生调整层 | RGB 合成通道；反相限 amount=100。单独 R/G/B 通道调整暂不支持。 |
| 其他现有调整 | 明确确认后导出合并副本 | 亮度、对比度、饱和度、色相、灰度及部分强度反相尚未映射原生参数；工程仍保留参数。 |
| 智能对象 | placed layer + embedded linked PSD 数据 | 无滤镜／透视／变形的嵌入式单像素层 RGB8 PSD；独立源图、矩形变换、原始源像素与缓存均保留。源图用于 PSD 原生导出最多 32 MiB RGBA，以满足嵌入源 64 MiB 解码预算；更大源需确认合并。外链永不自动下载。 |

保留原有 RGB8 PSD v1、8192 边长、16M 画布像素、128 图层、16 层嵌套和 128 MiB 文档像素预算；源像素也计入文档与历史预算。ICC 字节保留，但未进行 ICC 转换。无法解释的原生内容继续显示兼容报告，只在存在可信合成图时允许显式打开合并副本。PSD 导出不会覆盖原件。

原生 PSD 保留**参数与缓存**。ag-psd 不会按这些字段重绘图像，见其 [官方说明](https://github.com/Agamnentzar/ag-psd/blob/master/README.md)。本编辑器维护自己的渲染缓存。格式实现参照 [Adobe PSD 规范](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)。

## 工程与编解码修正

- 使用新功能时工程升级为 v4，二进制恢复记录为 v5；继续读取旧版本。智能源像素使用 Base64 工程字段／独立恢复分块，纳入去重、校验和内存预算。
- ag-psd 31.0.2 的色阶写入器输出 63 个旧式记录却缺少 `Lvls` 扩展头，独立解码会失败。`psdLevels.ts` 仅规范化本编辑器刚生成的块为标准 29 条 v2 记录，清零保留槽，并更新所有上层长度。遇到库布局改变会拒绝导出，不能将这个修正用于“修复”未知输入。
- 外层 PSD 与智能源 PSD 均采用有界原始平面合成数据，绕开编解码库小图 RLE／透明预览问题。导出自检比较原生参数、源像素、蒙版、图层缓存及合成图。
- Logo 仅重新压缩 PNG 数据流，解压扫描行与其他块完全一致，详见 [品牌说明](../assets/branding/README.md)。打包配置、300,000 B gzip 门禁未放宽。

## API

新增五个领域命令：`image.layer.clipping`、`image.layer.styles`、`image.smart.convert`、`image.smart.source`、`image.smart.replace`。现有 `content.create/update` 支持曲线／色阶，`layer.transform` 支持智能对象。当前共 46 个图像命令，通过 renderer API、IPC、本地 RPC 使用相同的版本、资源和事务契约，详见 [命令文档](../../docs/for-ai/editor-platform/operations.md#image-non-destructive-commands)。

## 验证

```sh
npm run typecheck -w imageEditor
npm test -w imageEditor
npm run test:browser:native -w imageEditor
PSD_NATIVE_PYTHON=/path/to/psd-tools-venv/bin/python npm run test:psd:native -w imageEditor
npm run test:browser:p5 -w imageEditor
npm run test:browser:daily -w imageEditor
node scripts/editor-e2e/rpc-electron.mjs imageEditor
npm run test:performance -w imageEditor
npm run editor-architecture:check
```

独立检查要求先运行当前构建的浏览器验收；源码指纹或 buildHash 不匹配会拒绝使用旧样本。报告位于 `artifacts/non-destructive/`：

- `browser.json`：智能源缩放还原、剪贴撤销、样式预览取消、曲线拖点、原生导出重开、工程及恢复。
- `native-codec.json`／`native-independent.json`：psd-tools 独立验证原生字段、曲线／色阶数值、形状节点、嵌入源与变换、图层缓存、合成透明度。额外强制重绘验证剪贴半透明与旋转智能对象。
- Photoshop 实机重绘仍待人工验收，文字／矢量／样式／调整的强制重绘未宣称与 Photoshop 等价，报告明确区分参数检查、缓存检查和已验证的重绘场景。

本机验收（2026-10-08，macOS x64）：135 项单元测试通过；新增原生浏览器验收、P5 和日常编辑浏览器回归通过；Electron IPC／本地 RPC 通过；psd-tools 1.10.9 的三组独立样本通过且无解码警告。2K／4K 原性能场景通过、释放后残余缓存为 0；仓库边界及 Platform API 检查通过。最终包体 712,192 B raw / 287,180 B gzip，保持原 1,000,000 / 300,000 B 上限。实时报告及源码指纹以 `artifacts/non-destructive/native-codec.json` 为准，以上不替代 Photoshop 人工验收。

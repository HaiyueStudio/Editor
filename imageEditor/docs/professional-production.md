# 专业修图与生产能力（首版）

> 本文记录前一阶段的交付范围。2026-10-09 新增分通道曲线／色阶、高质量重采样、直方图和滤镜；现有 52 个命令，新语义使用工程 v6／恢复 v7，当前包体预算 320,000 B gzip。最新契约与验证见 [处理质量](processing-quality.md)。

这批功能在 Image Editor 的现有文档、撤销历史、工程恢复和 Platform 命令模型上实现。它提供可用的修图／生产流程，尚不等同于 Photoshop 的完整专业排版、印前与超大图系统。

## 使用入口与支持范围

| 能力 | 界面入口 | 实现与边界 |
| --- | --- | --- |
| 软笔刷、笔压 | 画笔／橡皮擦 → 硬度、笔压 | 硬度 0–100%；笔压控制大小、不透明度或两者。真实 PointerEvent 笔压与合并采样；鼠标按满压力处理。支持已有选区与蒙版绘画，同笔画覆盖不反复叠加不透明度。尚无倾斜、纹理笔尖、ABR。 |
| 仿制 | 左侧“仿” | Alt 点击当前图层取源，涂抹到目标；支持对齐取样。读落笔前的图层像素，重叠区域不会采到刚画出的内容。API 可指定另一源图层。 |
| 修复 | 左侧“修” | Alt 取源，保留源细节并匹配目标局部色调；可调局部半径 1–32。采用局部低频色差近似，不是内容感知填充或 Poisson 修复。 |
| 边缘细化 | 选择 → 边缘细化 | 半径、对比度、扩张／收缩、亮度引导。后台快速 guided filter，保留空选区语义；可取消、可撤销。尚无头发识别、去色边或画笔式边缘区域指定。 |
| 贝塞尔路径 | 左侧 P／生产 → 新建贝塞尔路径 | 点击加点、拖出控制柄；编辑内容可移动锚点和控制柄。Enter 应用、Esc 取消、Backspace 删除末点；生产菜单切换开闭。最多 256 个节点，支持开闭路径、纯色填充／描边、两种填充规则；外观参数可通过内容 API 修改。新建路径使用前景填充及 2 px 白描边。尚无复合路径布尔操作、路径文字、SVG 导入。 |
| 富文本 | 文字 → 选中文字 → 应用样式 | 每段字号、字体族／字体名、颜色、粗体、斜体、下划线，段落宽度和对齐；UTF-16 范围最多 128 段，禁止拆开代理对。编辑文字时重定位样式范围，同样式片段交由浏览器塑形；按字素换行。尚无完整双向／区域排版、字符距面板、字形转轮廓。 |
| 色彩管理 | 生产 → 色彩管理 | 显式指定 sRGB、Display P3、Adobe RGB (1998)、嵌入 ICC 或导入 ICC；转换像素、文字／路径／形状颜色、样式颜色与智能源到 RGB8 sRGB，替换 PSD ICC，整次可撤销。支持 RGB/XYZ 矩阵＋TRC 的 ICC v2/v4；相对色度计算、超出色域裁切。 |
| 批处理 | 生产 → 批处理文件 | PNG、JPEG、PSD、工程输入；按比例缩小到尺寸框、滤镜，输出 PNG、白底 JPEG 或单层工程。处理独立合成副本，不改原文档；每文件显示下载／失败结果，可取消整批。API 支持有序的多步骤配方。 |

色彩转换不会自动套用到 PSD：导入仍保留源 ICC 并提示，用户需要明确转换。含实时调整层的文档必须先使用合成像素副本，避免转换改变调整参数的含义；锁定图层拒绝转换。不支持 CMYK/Lab ICC、LUT/device-link 配置、感知色域映射、软打样、专色、16/32 位工作流。引擎 CMYK 数值对象不等于印刷设备 ICC 工作流。已转换工程中缓存与可编辑颜色一起保留，RGB 混合仍使用现有编码值合成。

## 文件与历史

- 工程 v5、二进制恢复 v6 保留路径节点、富文本片段、换行宽度与色彩转换信息，仍读取以前版本。
- 单条画笔／仿制／修复笔画、路径提交、文字提交、边缘细化和色彩转换各形成一次撤销；预览、取消、失败提交不留下半成品。
- 单条纯色贝塞尔路径可用 PSD 原生矢量字段往返。PSD 坐标采用 24 位定点精度，自检按文档尺寸对应的一个量化单位验证节点。
- 富文本、换行宽度仍需明确同意栅格化／合并才能导出 PSD；保存 `.hyimage` 保留可编辑内容。未认证 Photoshop 重排／重绘一致性。
- 批处理输出是合成副本；不执行隐藏的有损 PSD 导入降级。无法安全分层读取的 PSD 单独报错。含未转换 ICC 的工程／PSD 拒绝批处理，先做明确的 sRGB 转换。

## 公共 API、IPC 和本地 RPC

命令沿用 API version `1`，已自动进入命令发现、IPC 与本地 RPC 调度；无需另建图片专用传输。当前共 51 个 image 命令。写文档请求携带 `documentId` 与 `expectedRevision`；取消使用原 `requestId`。ICC 与文件数据通过资源句柄传递，完成后调用方释放输入及输出句柄。

| 命令 | 主要参数 |
| --- | --- |
| `image.pixels.stroke`（扩展） | `layerId`, `points:[{x,y,pressure?}]`, `size`, `color`, `opacity?`, `hardness?`（0–1）, `pressure?`（none/size/opacity/both），支持原有 mask 目标 |
| `image.retouch.stroke` | `layerId`, `sourceLayerId`, `kind:clone/heal`, `offset:{x,y}`（目标坐标加偏移得到源坐标）, `points`, `size`, 可选 opacity/hardness/pressure/radius |
| `image.selection.refine` | `radius:1..32`, `contrast:0..100`, `shift:-32..32`, `edgeAware:boolean` |
| `image.content.create/update`（扩展） | `content.type:path`，width/height/closed/fill（hex 或 null）/stroke/strokeWidth/fillRule/nodes；每节点 `{x,y,inX,inY,outX,outY}`。文字新增 `runs` 与 `wrapWidth`。 |
| `image.color.query` | 空参数；返回工作空间、转换来源、是否存在嵌入 ICC、支持的预置 |
| `image.color.convert` | `source:srgb/display-p3/adobe-rgb/embedded/resource`，resource 来源另传 `resourceId` |
| `image.batch.run` | workspace 命令；`inputs:[{resourceId,name,format}]`, `steps`, `format:png/jpeg/project`，返回逐文件 `{name,resourceId,byteLength}` 或 `{name,error}` |

批处理示例（省略资源上传）：

```js
const result = await haiyueEditor.execute({
  apiVersion: '1', requestId: crypto.randomUUID(),
  operation: 'image.batch.run',
  params: {
    inputs: [{ resourceId, name: '产品.hyimage', format: 'project' }],
    steps: [
      { type: 'fit', width: 1920, height: 1080 },
      { type: 'filter', kind: 'sharpen', amount: 25 }
    ],
    format: 'png'
  }
});
```

每批 1–16 个文件、1–32 个步骤；输入合计和成功输出合计各不超过 128 MiB。逐项 progress 通过 Platform 事件／RPC 进度通道发布。写输出资源失败时，已创建的输出句柄全部回滚释放。取消批次不会发布部分输出；单文件解码失败会继续后续文件。

## 性能与验证

画笔覆盖缓冲改为按需分配的 128×128 瓦片，长对角线拆分短段，避免扫描大块空白包围盒。测试中的 64 px 短笔画仅分配 64 KiB 覆盖缓冲，原 4K 覆盖缓冲为 16 MiB。RGBA 工作位图仍整层驻留；这不是 out-of-core 图像引擎。

边缘模型最多 262,144 个像素，再用原图引导重建全分辨率结果；边缘细化、颜色转换、批处理滤镜／缩放位于可终止 Worker。保留现有边长 8192、16,777,216 画布像素、128 MiB 文档像素预算；没有扩大 PSB／超大图准入。画布尺寸不变时复用 backing store；原有差量历史和缓存预算继续有效。

验证入口：

```sh
npm run test -w imageEditor
npm run app:check -w imageEditor
npm run test:browser:professional -w imageEditor
npm run test:browser:native -w imageEditor
npm run test:performance -w imageEditor
PSD_NATIVE_PYTHON=/path/to/python node --expose-gc imageEditor/scripts/check-professional.mjs
PSD_NATIVE_PYTHON=/path/to/python node imageEditor/scripts/run-native-psd.mjs
node scripts/editor-e2e/rpc-electron.mjs imageEditor
npm run check:boundaries
```

`artifacts/professional/` 保存带构建／源码指纹的浏览器、ICC 和大图诊断记录；大图诊断不替代原 P4 性能门禁。独立 Pillow 11.3.0 / LittleCMS 2.17 校验使用 1,024 个 RGBA 像素，三个空间的内置与解析配置共六组，相对色度转换最大通道差 1/255，alpha 完全一致。另用 psd-tools 检查原生路径节点与像素缓存。实际 Photoshop 手工验收、压感硬件设备验收仍待完成（浏览器自动化使用真实 PointerEvent 的 pen 压力通道）。

包体仍遵守 1,000,000 B raw / 300,000 B gzip 上限。图片编辑器选择 codec 官方 ESM 入口并压缩内部函数／类名，公共命令 ID 不变，共享构建默认设置不变。动态模块与 Worker 同目录输出，使相对 Worker URL 在拆包后仍有效。品牌图标仅进行无损 PNG 重新编码，像素与非 IDAT 块不变。

参考：[ICC v4.2 规范](https://www.color.org/icc1v42.pdf)、[sRGB 注册参数](https://registry.color.org/rgb-registry/files/sRGB.pdf)、[CSS Color 4 颜色转换示例](https://www.w3.org/TR/2021/WD-css-color-4-20210601/)。

# 第二批：非破坏性处理链

本批实现智能滤镜堆栈、共享滤镜蒙版、图层／滤镜蒙版的实时密度与羽化、Blend If。界面、领域命令、撤销／重做、工程文件与恢复会话共用同一份文档模型。

## 界面

- 选择像素图层，先点「转为智能对象」，再点「智能滤镜」。从上往下执行，可添加、删除、排序、切换启用，修改滤镜参数、不透明度和混合模式。沿用全部已实现的滤镜，包括高斯与 USM。
- 在智能滤镜面板从选区建立滤镜蒙版；没有选区时建立全白蒙版。黑色保留原始图像，白色应用整组滤镜。滤镜蒙版作用于整个堆栈。
- 「蒙版属性」在图层蒙版和滤镜蒙版之间切换，可创建、反相、删除、禁用、调整密度／羽化。「应用并绘制蒙版」提交面板并进入对应蒙版绘制模式。
- 「Blend If」选择灰色或一个 RGB 通道，分别控制本图层／下方图层的黑场起终点、白场起终点。分离的端点形成平滑过渡。
- 面板预览使用可取消 Worker，取消不写文档；应用为一次历史操作。切换文档或文档发生变化会阻止过期预览提交。比较原图显示打开面板前的文档。

## 数据与渲染语义

`layer.bitmap` 保留智能对象变换后的未过滤缓存；智能源始终保留。`smartFilters` 是最多 16 项的有序数组，索引 0 先执行。每项有稳定 ID、enabled、settings、opacity（0–1）、blend。禁用或不透明度为 0 时跳过。滤镜混合在编码 RGB 下计算，使用关联 Alpha 插值，避免透明像素混出隐藏 RGB。

`filterMask` 与 `mask` 都是图层局部坐标的灰度像素。可选 `density` 默认 1，取值 0–1；有效覆盖率是 `1-density*(1-coverage)`。`feather` 默认 0，取值 0–64，表示高斯 σ 像素值；核截断到 3σ，蒙版外使用 defaultColor。原始覆盖率永不被参数处理覆盖，绘制／填充修改原始蒙版，保留密度和羽化。

`blendIf` 保存 enabled、channel、source、underlying；每组颜色带是递增的四个 0–255 整数。灰色使用编码 RGB 的 Rec.709 亮度系数。下方透明区域按其 Alpha 加权，不会被不存在的背景色隐藏。分组沿用隔离合成；剪贴层在底层 Alpha 组内处理。启用 Blend If 的顶层不能直接做子集图层合并，避免改变与未合并背景的关系。

滤镜结果按输入缓存和参数缓存，预览／API Worker 的结果用于预热主线程缓存。蒙版羽化使用按原始蒙版数据及参数的缓存。缓存不写入工程或历史；滤镜源像素、蒙版像素计入文档及历史预算。

## 公共 API

本批完成时共 **55** 个（[第三批](productivity.md) 后为 65 个） `image.*` 命令；通过浏览器 Platform、Electron IPC 和本地 RPC 使用相同调用契约。文档写操作仍须提供 `documentId` 与 `expectedRevision`。

| 命令 | 参数／行为 |
| --- | --- |
| `image.smart.filters` | `{layerId, filters}`，完整替换有序列表；空列表清除处理效果。异步 Worker 可取消。 |
| `image.layer.blend-if` | `{layerId, rule}`；或 `{layerId, remove:true}` 删除参数。 |
| `image.mask.settings` | `{layerId, target?, density?, feather?, disabled?}`，更新已存在蒙版。 |
| `image.mask.update` | 新增 `target: 'layer' \| 'filter'`，默认 layer；沿用 fromSelection/invert/enable/disable/remove。 |
| `image.pixels.fill/stroke` | target 新增 `filterMask`；既有 `pixels`、`mask` 保持原义。 |
| `image.document.query` | 返回 smartFilters、blendIf、filterMask 元数据，以及两类蒙版的 density/feather；不存在时为 null，不传输像素缓冲。 |

示例 filters：

```json
[{"id":"blur-1","enabled":true,"settings":{"kind":"gaussian","amount":2},"opacity":0.8,"blend":"normal"}]
```

示例 rule：

```json
{"enabled":true,"channel":"gray","source":[0,40,220,255],"underlying":[0,0,255,255]}
```

## 文件与兼容边界

- 使用本批数据的 `.hyimage` 写版本 7，IndexedDB 二进制恢复写版本 8；旧数据继续使用最低必要版本。旧版本标签夹带新特性会拒绝，防止降级丢失。
- PSD 原生往返支持灰色或单 RGB 通道的 Blend If，以及像素蒙版 density／feather。导出密度量化到 PSD 的 8 位值，缓存合成图使用同一个量化值。
- 多通道同时生效的外部 PSD Blend If 暂阻止可编辑导入；仍可使用有可靠合成预览的合并副本。不会丢弃额外颜色带。
- **智能滤镜和滤镜蒙版尚无 PSD 原生映射**。PSD 导出默认拒绝，显式 `allowRasterize:true` 或界面确认后才输出整个文档的合并副本。完整编辑数据请保存在 `.hyimage`。
- 栅格化智能对象会将滤镜及滤镜蒙版结果烘焙一次，然后移除该处理链；图层蒙版和 Blend If 继续保留，可撤销。
- 带蒙版的缩放／旋转仍受原有变换限制；滤镜蒙版需移除或栅格化。图层平移及智能源替换保留图层局部蒙版与滤镜设置。
- 当前仍是 RGBA8／编码 RGB、8192 单边／16,777,216 像素／128 MiB 文档像素预算。羽化及复杂处理不是 GPU 分块算法，大图极端参数仍可能较慢；Worker 超时／取消不提交。
- PSD 原生参数和缓存通过独立解码器检查，不等于 Photoshop 重绘认证。羽化 σ、灰色亮度及叠加边缘在 Photoshop 中可能存在差异。

## 验证

- `npm --prefix imageEditor test`：叠加顺序、Alpha、原始数据、蒙版参数、原生 PSD、版本门禁、原子失败与撤销。
- `npm --prefix imageEditor run test:browser:live`：真实浏览器面板、预览取消、两类蒙版、Blend If、项目重开、IndexedDB 恢复、Worker 取消。
- `node scripts/editor-e2e/rpc-electron.mjs imageEditor`：真实沙箱预加载 IPC 与 loopback RPC 命令闭环。
- `PSD_NATIVE_PYTHON=/path/to/python node imageEditor/scripts/check-live-psd.mjs`：现有 psd-tools 环境独立检查四种通道、原始蒙版、密度／羽化和缓存 Alpha；缓存关联 RGB 最大允许误差 1/255（与既有 PSD 导出契约相同）。证据绑定源文件哈希、构建哈希、Git 版本、运行环境。
- 证据目录：`imageEditor/artifacts/live-effects/`。尚无 Photoshop 手动重绘对照。

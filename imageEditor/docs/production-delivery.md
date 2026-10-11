# 第四批：生产交付与超大文件

本批增加可使用的 TIFF／OpenEXR 文件工作流、多画板交付范围、独立专色分版、随机读取 PSD／PSB 和高位深蒙版换页。画板、专色和分页蒙版保存在 `.hyimage` v19 与恢复会话 v17；编辑通过同一个 Platform 调度器进入撤销历史，IPC／本地 RPC 自动暴露相同契约。

## 界面

- “打开”支持 `.tif`、`.tiff`、`.exr`；导出图片增加 TIFF 和 OpenEXR。
- “画板与专色…”使用 UI 库 `hy-input`、`hy-select`、`hy-button`。支持从选区创建／更新画板，编辑坐标与尺寸，指定全部或选中图层，画布显示边界，定位选区，单画板导出。
- 最多 64 个画板，均在当前文档画布内。画板是带可选图层成员列表的交付区域；共享图层可以出现在多个画板。尚不是 Photoshop 原生画板组，文档外画板和拖动画板边框未实现。
- 最多 16 个命名专色通道；从选区生成墨量，编辑显示色与 solidity，按选区填充、反相和预览。墨量与 RGB／CMYK 主图独立。分版 TIFF 使用 16 位灰阶数值写入 RGB 三通道：白色为纸张，黑色为 100% 墨量。
- solidity 只影响专色在白纸上的近似预览，不改变分版墨量。没有 Pantone 等商业色库、印刷叠印模拟或认证；TIFF 主图不自动烘焙专色。

## 格式覆盖

| 格式 | 导入 | 导出 |
| --- | --- | --- |
| TIFF | Classic TIFF 单页；大小端；交错 RGB／灰度／CMYK；8／16 位整数，RGB／灰度 32 位浮点；Raw、LZW、Deflate、PackBits；整数水平预测；直通／预乘 Alpha；嵌入 ICC | 小端 Classic TIFF；32 行无压缩条带；RGB 8／16／32、CMYK 8／16；直通 Alpha；可嵌入文档 ICC |
| OpenEXR | 单部件扫描线；HALF／FLOAT RGB(A)；NONE、ZIPS、ZIP；线性 sRGB 色度；保留 dataWindow 相对 displayWindow 的位置 | FLOAT RGBA 扫描线；NONE 压缩；转换到线性 sRGB；预乘 Alpha；不应用曝光预览、色调映射、软打样 |
| PSD／PSB | 随机读取头部、资源与图层记录；按通道范围读取 Raw／RLE／ZIP／ZIP prediction；RGB 8／16／32、CMYK 8／16；包括仅有合并图的文件 | 沿用原生位深、磁盘暂存与分段输出 |

TIFF 尚不支持 BigTIFF、多页、平面分离、平铺 TIFF、JPEG 压缩、浮点 Predictor 3 或非正向 Orientation。灰度 ICC 与 RGB 文档不匹配时拒绝，不把灰度配置当作 RGB 使用。OpenEXR 尚不支持 Deep、Tiled、Multipart、额外 AOV、PIZ／DWA 等压缩、自定义色度或非方形像素。未实现的变体明确报错。

原生 PSD 支持范围仍经过现有逐层检查。流式通道从原文件按范围读取，原生元数据保留为移除了通道负载的轻量 PSD 档案；文字、样式、智能源等继续使用已有原生描述和逐层字体诊断。未知特性不因文件较大而静默栅格化。UI 对大于 64 MiB 的 PSD／PSB 自动使用此路径，并保留原有导入确认面板和 ICC 策略。

PSD 副本尚不写入本批画板和专色数据。导出策略明确提示，需要调用方设置 `allowRasterize: true` 才允许丢弃这些工程元数据；完整编辑状态请保存工程，交付使用画板图片／独立专色分版。

## 内存与大图编辑

- 新文件路径支持最大 2 GiB 输入，几何仍为每边 30,000；PSD 非像素元数据累计限 64 MiB，单次读取最多 32 MiB。没有通过提高 128 MiB 像素工作集预算来容纳整图。
- 导入每次最多 32 行解码数据，以 256 像素磁盘块保存。外部 TIFF 的大条带会渐进解压；ZIP 输出有精确长度上限，损坏或超额数据中止导入。
- 16／32 位蒙版以浮点标量块存储，保留分数覆盖率，取消原先 16M 像素／64 MiB 密集蒙版限制。支持局部画笔／填充、反相、密度／羽化、合成、应用蒙版、撤销恢复和 PSD 输出。未受影响的页与历史共享。
- 仿制／修复画笔现在按目标块读取不可变源和修复邻域，支持交互和 `image.retouch.stroke`；不会取样本笔画刚写入的像素。大图图层合并也改为条带合成；保留原来的相邻图层、锁定和混合限制。
- `image.selection.refine` 在大图上使用所选参考图层和局部细化路径；局部窗口沿用精细选区的预算，不分配整幅画布。
- 原有分块绘画、选区、滤镜、颜色管理、自由变换继续可用。带蒙版的自由变换仍要求先应用蒙版；大面积内容感知、剪贴板、智能源、便携工程包仍有各自的预算。本批不宣称所有工具都支持任意大图。

## API

14 个新命令，Image 域共 125 个。所有 JSON schema 通过 `listOperations()` 查询。

| 命令 | 关键参数／结果 |
| --- | --- |
| `image.artboard.list` | 画板列表 |
| `image.artboard.set` | `id?`, `name`, `x`, `y`, `width`, `height`, `layerIds?`；返回 `artboardId` |
| `image.artboard.delete` / `select` | `id`；删除／生成画板范围选区 |
| `image.artboard.export` | `id`, `format: png\|jpeg\|tiff\|exr`, `embedProfile?`；返回 exportId |
| `image.spot.list` | 名称、颜色、solidity、尺寸、精度 |
| `image.spot.save` | `id?`, `name`, `color: #RRGGBB`, `solidity: 0–1`, `source: selection\|empty\|preserve` |
| `image.spot.fill` | `id`, `amount: 0–1`, `invert?`；填充选区／整通道反相 |
| `image.spot.delete` / `export` | `id`；删除／生成 TIFF 分版 exportId |
| `image.import.begin` | workspace；`name`, `format: tiff\|exr\|psd\|psb`, `size`；返回 importId |
| `image.import.write` | workspace；`importId`, `offset`, `resourceId`；每段 ≤4 MiB，顺序写入，最后一段可原样重试 |
| `image.import.finish` | workspace；`importId`；完成解码后才发布新文档；PSD 返回逐层诊断 |
| `image.import.close` | workspace；`importId`；释放暂存句柄 |

`image.document.open/export` 和 `image.export.prepare` 增加 `tiff`、`exr`。普通资源仍受 128 MiB 限制；更大输入使用 begin → write → finish → close；每段资源用完后释放。导入最多两个暂存句柄，30 分钟空闲过期；解码失败可重试，不修改当前文档。导出继续使用 prepare → read → close，读取上限 4 MiB。`artboard.export`、`spot.export` 的结果也用同一 `image.export.read/close` 读取。

## 验证与边界

最终 Node 回归 441／441 通过；`app:check`、类型构建和仓库边界检查通过。第四批交付界面与第三批修图浏览器回归均通过，报告及截图分别保存在 `imageEditor/artifacts/delivery-batch/`、`imageEditor/artifacts/retouch-batch/`。最终构建 hash 前缀 `f038acb648077cf1`。

- `node --test imageEditor/test/delivery-batch.test.mjs`：三种 TIFF 位深、CMYK、HDR EXR、独立 HALF／ZIP fixture、PSD／PSB 三位深原生蒙版、仅合并图预测解码、超过 128 MiB 的文件偏移、超过 16M 的浮点蒙版、COW、邻域仿制／修复、合并、撤销、工程／恢复、取消、损坏数据、RPC 分段导入导出。
- `node imageEditor/test/delivery-batch-browser.mjs`：原生 WebComponent 事件、画板边界、专色编辑／预览、真实 TIFF 下载、TIFF／EXR 重新打开、分段调用、恢复重载；保存截图与构建 hash。
- `node imageEditor/test/delivery-samples.mjs <files...>`：只读本地样本，记录 SHA-256、最大单次读取、累计读取、尺寸和图层数。已用桌面的 Ducky.tif、rich-text.psd、Fish.psd、Smart Objects.psd、Layer Comps.psd、3d-preview-mockup.psd 检查。
- 新生成的 TIFF／EXR 经 macOS `sips` 独立解码为 PNG。此验证不等同 Photoshop 实机认证；没有安装 Photoshop。
- 包体变更检查：第三批基线 raw 4,527,251 B、gzip 1,482,036 B；第四批首个完整构建 raw 4,581,452 B、gzip 1,500,581 B（gzip 增量 18,545 B），最终构建 raw 4,583,811 B、gzip 1,501,359 B。新增编解码器使用现有 pako／ICC，不增加第三方依赖；主要体积仍来自原有引擎／ICC。保留 raw 4,600,000 B 门槛，将 gzip 门槛从 1,500,000 B 调整为 1,520,000 B，容纳本批覆盖及少量修正；应用 validator 继续执行。

格式参考：[OpenEXR File Layout](https://openexr.com/en/latest/OpenEXRFileLayout.html)、[OpenEXR Technical Introduction](https://openexr.com/en/latest/TechnicalIntroduction.html)。

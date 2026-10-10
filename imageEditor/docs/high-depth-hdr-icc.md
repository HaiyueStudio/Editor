# 高位深、HDR 与 ICC：实现及验收边界

入口：**生产 → 色彩管理**。图像域共 89 条公共命令（包含 CMYK、ICC 文档工作流、ICC 参考引擎及显示能力查询）；沿用 Platform 调度、revision 冲突检查、资源池及 IPC／本地 RPC，不另建私有调用通道。

## 像素与文档

- RGB 文档支持 8、16、32 位。8 位保持原来的字节存储；16 位使用 Float32 工作缓冲，在 PSD／RGBA16 输出边界量化为 65536 个代码值；32 位使用线性浮点，保留负值和大于 1 的高光。内部算法沿用 0–255 单位，外部 float32 资源使用通常的归一化单位。
- 画笔、填充、渐变、仿制／修复、滤镜、连续曲线／色阶、变换、图层合成、复制粘贴和简单智能源缓存可处理浮点像素。蒙版使用浮点覆盖率；选区和命名 Alpha 通道仍为 8 位覆盖率。
- 32 位有效 RGB 范围为 ±65504，alpha 为 0–1；拒绝 NaN／Infinity。16 位 RGB 为 0–1。降低位深需要 `allowLoss:true`；多层智能对象在转换整个文档位深前需要栅格化，避免源 PSD 与缓存不同步。
- RGB 高位深工程 v10、恢复 v11；声明颜色模式的工程 v11、恢复 v12，保存原生 CMYK、浮点像素、显示设置与 ICC。旧工程继续读取；旧版本号不能携带新格式。撤销保存精确浮点缓冲，不使用 RGB8 XOR 历史压缩。
- 保持 8192 边长、1677 万像素、128 MiB 文档、256 MiB 历史预算。浮点图层占 16 B／像素，因此高位深可接受的实际图层总量低于 8 位。

## HDR 显示与输出

`image.hdr.exposure` 修改选定像素层的线性 RGB，可撤销。`image.document.display` 只改变显示曝光、输出模式和 SDR clip／Reinhard／ACES 近似映射；不改源像素。

- `output:sdr|auto|hdr`，默认 SDR。auto/hdr 在系统报告 `(dynamic-range: high)` 且 WebGPU 可用时使用独立 `rgba16float` 画布和 `toneMapping.mode:extended`，不将高光压进 8 位。嵌入 RGB ICC 转为线性 sRGB后上传 GPU，画布标记 sRGB 并编码相应传递函数，系统负责显示映射。
- 不支持的环境、非 RGB32、软打样／自定义显示器预览、GPU 丢失或配置失败时回退 SDR，并显示原因。监听显示能力变化；透明度不影响原画布的鼠标事件。GPU 重建有异步版本检查，避免旧文档覆盖新画布。
- `image.display.query` 报告 WebGPU、dynamic-range、P3、屏幕 colorDepth、当前后端及回退原因；`physicalLuminanceVerified:false` 始终表明软件不能代替亮度计认证。Web/Electron 均使用 Chromium 的系统显示链路，无 macOS 私有 API。
- 尚无 HDR 屏幕实测、PQ／HLG 图像文件输出、OpenEXR 或 Radiance 编解码。参考 ICC 引擎能执行 PQ/HLG DeviceLink，不等于上述文件编解码。

PNG／JPEG 是经过当前显示映射的 sRGB 8 位输出；导出忽略显示器配置、软打样与色域警告，避免把模拟显示效果烘焙进交付文件。PSD 和 `.hyimage` 保留文档位深与原始高光。

## PSD

独立高位深通道编解码补足 ag-psd 的 8 位写入限制。支持 RGB16／RGB32 的 raw、RLE、ZIP、ZIP prediction 读取；写入大端平面通道、Lr16／Lr32 图层信息和对应透明度标记。保留图层、像素蒙版、支持范围内的原生内容与 ICC 资源；写后重读检查图层和合成误差。输出使用 raw 通道，文件较大，仍受 128 MiB 限制。

未知的图层附加块（包括高位深图层区内的块）仍阻止无损导入。仓库中的外部 16／32 位样本有 `LMsk` 等未支持语义，虽可正确解码其像素，仍不能静默当成完整可编辑文档。PSB、专色／额外通道和原有未覆盖的 Photoshop 语义没有借此解锁。

## ICC

引入固定版本 `lcms-wasm@1.0.5`（Little CMS 2.16，MIT），WASM 和许可随应用离线分发。支持 ICC v2/v4 矩阵／曲线和引擎可处理的 LUT 配置，四种 rendering intent、黑点补偿、软打样和色域警告。RGB 和 CMYK 文档使用 Little CMS 的 v2/v4 工作配置；浮点资源接口支持 RGB／CMYK／Gray／Lab／XYZ 间转换。

- 指定配置保留数值，转换配置改变像素并嵌入目标配置；均可撤销。显示自动使用嵌入配置。自定义显示器配置作为 SDR 目标模拟，转换回画布 sRGB 后交给系统，避免把设备编码误标为 sRGB。
- 转换工作配置不烘焙软打样。包含参数化文字／形状／调整层、图层样式、智能滤镜或 Blend If 的文档，当前要求先明确栅格化相应内容，避免转换像素缓存后原生参数重绘改变外观。
- 大块资源和图层颜色转换走可取消 worker；渲染按现有 tile 处理。ICC 限制为 4 MiB，转换输入输出合计最多 128 MiB。
- 官方 `iccdev@2.3.23`（BSD-3-Clause）补充 ICC v2/v4/ICC.2 iccMAX v5 配置验证和配置链转换。按需加载两个独立 WASM 工具：`iccDumpProfile` 与 `iccApplyNamedCmm`。不分发整个 148 MB npm 包，不在主线程执行参考 CMM。
- `image.icc.reference` 支持配置链、DeviceLink、named color、DeviceN、多过程元素／calculator、光谱 PCS、PCC 和环境参数。Node 测试实际编译并执行官方 calculator、光谱命名色、D93 PCC、6CLR、Gray GSDF、PQ/HLG DeviceLink 样本；不是按 RGB 近似替代。
- 每配置最多 4 MiB、链最多 8 个／合计 32 MiB、输入文本 1 MiB、输出报告 8 MiB、超时 60 秒。资源句柄映射到 WASM 内存文件名，调用者不能传宿主路径／原始 CLI 参数。取消和超时终止 Worker。validate 返回 valid/warnings/invalid 及完整报告；transform 必须真的输出样本才能成功。
- **这不是“完整 ICC 标准合规认证”。** v5／DeviceN／光谱目前在资源转换与校验接口中使用，不是文档画布的工作配置；未逐项验证 ICC.1/ICC.2 全部标签、ICS 子规范与所有 profile class。未自动读取私有系统 ICC 文件、写系统校准或集成打印机驱动。官方参考实现的能力不能替代产品符合性测试。

## CMYK 原生文档

C/M/Y/K 以四分量 Float32、0–100% 单位独立保存，alpha 独立；RGB 仅是预览／工具缓存。8/16 位在 PSD 输出边界量化。原生油墨读写／选区填充／软笔刷、九种可分离混合、隔离组、像素蒙版、透明度、图层位置、精确撤销、工程与恢复均保存 K 分色。合成按 256px 分块，单次完整 CMYK 输出受 128 MiB（保守 32 B/px）限制。

- 原生 CMYK8/16 PSD 读取 raw/RLE/ZIP/prediction，写入四个反相 PSD 油墨平面和独立透明通道，使用负图层数声明合并透明度。五通道但未声明透明度的文件不会误当透明图导入。ICC 资源原样保留。
- 转换模式需要 CMYK v2/v4 ICC；RGB→CMYK 直接从源工作配置分色，避免经过 sRGB 缩小色域。原生通道操作不重新分色。RGB 画笔／滤镜等工具仅对改变的 RGB 像素重新分色，未改变区域的 K 保持原值；跨 Worker 后同样成立。透明度编辑不重新分色。
- 无配置的 CMYK 可以保存／原生通道编辑，预览是明确的近似；RGB 工具需先指定 ICC。配置转换与指定有不同语义，均可撤销。
- 当前 CMYK 文档不支持剪贴、参数化文字／形状／调整层、图层样式、智能滤镜或 Blend If；提交会原子失败。CMYK 也不支持 32 位 HDR。转换到 RGB 后可使用这些能力。专色、DeviceN **文档**和原生 CMYK 的所有 Photoshop 操作仍未覆盖。

## 公共命令

| 命令 | 参数／输出 |
| --- | --- |
| `image.document.create` | 新增可选 `bitDepth:8\|16\|32` |
| `image.document.depth` | `depth`，降位深需 `allowLoss:true` |
| `image.document.display` | `exposure:-20..20`，`operator:clip\|reinhard\|aces`，可选 `output:sdr\|auto\|hdr` |
| `image.hdr.exposure` | `layerId`、`ev:-20..20`，要求 32 位像素层 |
| `image.pixels.write` | `layerId/resourceId/width/height/format`，格式必须匹配文档位深 |
| `image.pixels.copy` / `paste` | 格式扩展为 `rgba8/rgba16le/rgba32fle/cmyka32fle`，所有格式 straight alpha；CMYK copy 返回原生分色，原生 paste 仅接受 CMYK 目标文档，默认格式仍为 rgba8 |
| `image.icc.inspect` | workspace read，`profileId` → 配置名称、颜色空间、引擎 |
| `image.icc.transform` | workspace write，`resourceId/source/target`，source／target 可为 `srgb/lab/xyz` 或 ICC resourceId |
| `image.icc.assign` / `convert` | document write，`profileId` 或 `preset:srgb\|linear-srgb\|display-p3\|adobe-rgb` 二选一；可选 `intent:0..3`、`bpc` |
| `image.icc.proof` | document write，补丁语义：省略保留；`proofProfile/monitorProfile` 为 resourceId，`proofEnabled` 独立开关，`clearProof/clearMonitor` 显式清除；另有 `intent/bpc/proofIntent/gamutWarning` |
| `image.icc.query` | document read；工作／打样／显示器配置描述、有效状态及当前设置 |
| `image.icc.read` | document read；`slot:working\|proof\|monitor`（默认 working）→ 原始 ICC 资源，调用者用后释放 |
| `image.icc.remove` | document write；移除工作配置，保留像素数值，可撤销 |
| `image.icc.builtin` | workspace read；`preset` → 内置 RGB ICC 资源，调用者用后释放 |
| `image.document.open` | `colorPolicy:preserve\|assign\|convert`，默认 preserve；assign/convert 需要 `profileId` 或 `preset` |
| `image.document.export` | PSD／PNG／JPEG 支持 `embedProfile`，默认 true；工程始终保留 ICC |
| `image.cmyk.mode` | document write；`mode:rgb\|cmyk`，转 CMYK 必须带 `profileId`；转 RGB 目标为 sRGB |
| `image.cmyk.read` | document read；`layerId` → 资源、尺寸、`format:cmyka32fle` |
| `image.cmyk.write` | document write；`layerId/resourceId`；资源必须匹配当前层尺寸 |
| `image.cmyk.fill` | document write；`layerId/ink:[C,M,Y,K]`，0–100%；可选 `channels:[0,1,2,3]`、`opacity`、`preserveAlpha`（默认 true）、`erase`；遵守当前软选区 |
| `image.cmyk.stroke` | `layerId/ink/size/points:[{x,y,pressure?}]`；同 fill 通道参数，preserveAlpha 默认 false；另有 `hardness:0..1`、`pressure:none\|size\|opacity\|both` |
| `image.cmyk.sample` | read；`x/y` 画布坐标 → 合成原生 `ink:[C,M,Y,K]`、`alpha:0..1`，只合成单像素 |
| `image.icc.reference` | workspace write；`mode:validate\|transform`、`profiles:[{profileId,intent,pccId?,environment?:[{name,value}]}]`；transform 另需 `resourceId`，可选 encoding(0–6)、interpolation(0/1) |
| `image.display.query` | workspace read；系统显示能力和当前画布后端 |

`cmyka32fle`：行优先、每像素 5 个 little-endian Float32（20 B/px），C/M/Y/K 为 0–100，alpha 为 0–1，所有值必须有限。`icc.reference` 输入／输出沿用官方工具的文本编码（首行四字节颜色空间签名，次行编码名，随后数值或命名色）；默认输出 `icEncodeFloat`，intent 数值含义遵循固定版本官方 CLI，PCC/环境通过结构化参数传入。返回报告是资源，使用后需要释放。例：RGB 文本 `'RGB ' ; Data Format\nicEncodeFloat ; Encoding\n1 0 0\n`。


`icc.transform` 输入和输出为 little-endian float32 **颜色分量，不包含 alpha**。RGB／Gray／XYZ 使用 0–1 单位（浮点可超范围），CMYK 使用 0–100%，Lab 使用 L*、a*、b* 的实际单位。返回 `resourceId/format/channels/pixels/sourceSpace/targetSpace`，调用方负责保留 alpha 并释放资源。图层接口自动保留 alpha。

## 可复验检查

从 Editor 仓库根目录执行：


```sh
npm test -w @haiyue/image-editor
npm run build:app -w @haiyue/image-editor
CHROME_PATH=/path/to/chrome node imageEditor/test/high-depth-browser.mjs
PSD_PYTHON=/path/to/python-with-psd-tools node imageEditor/scripts/check-high-depth.mjs
PSD_PYTHON=/path/to/python-with-Pillow node imageEditor/scripts/check-icc.mjs /path/to/ColorSync/Profiles
npm run check:boundaries
npm run release:artifact:check
```

ICC 独立对照使用本机配置（不分发系统配置），Pillow/native Little CMS 2.17 对比 WASM 2.16：Display P3、CMYK LUT、Gray 四种意图，以及 CMYK 软打样；容许 2 个 8 位代码值误差。PSD 独立对照使用 psd-tools 1.10.9 对比原始通道归一化值，容许 1e-6。报告含输入 hash、源码 fingerprint、revision、dirty 状态和运行环境。

## Photoshop 验收工具

本机未安装 Photoshop，**没有 Photoshop 实机通过结果**。

```sh
npm run build:types -w @haiyue/image-editor
node imageEditor/scripts/photoshop-certification.mjs prepare /path/to/new-run
# 将整个 new-run 目录带到 Photoshop 机器：文件 → 脚本 → 浏览 → run-in-photoshop.jsx
node imageEditor/scripts/photoshop-certification.mjs verify /path/to/new-run
```

`prepare` 生成 RGB8／16／32、CMYK8／16 样本、ICC、输入哈希清单和 JSX；拒绝覆盖已有验收目录。JSX 仅打开生成的测试样本，编辑图层名、撤销、再次编辑、另存新 PSD、重开并检查；恢复原应用对话框设置，关闭自身测试文档，不保存到源文件。生成带 runId、Photoshop 版本和 OS 的回执。

`verify` 校验脚本和输入哈希、完整用例集合、Photoshop 回执、输出位深／图层及像素精度。缺少实际回执时失败；通过也只标记 `automated-cases-passed-visual-review-pending`。这五项精度样本并不等于全部 Photoshop 功能认证，仍需追加真实生产文件、原生文字／形状／样式重绘、视觉审核和 HDR 设备证据。

脚本依据 [Adobe Photoshop 脚本能力说明](https://developer.adobe.com/photoshop/)。ICC 实现依据 [Little CMS](https://littlecms.com/color-engine/) 与 [lcms-wasm](https://github.com/mattdesl/lcms-wasm)；PSD 通道格式依据 [Adobe PSD 文件格式](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)。

## 打包预算变更

此前应用实测 815513 B raw／324862 B gzip；增加 ICC 后初次测得 1214023 B raw／469950 B gzip，超出原 1000000／330000 限额。主要新增离线 WASM 315910 B 及其胶水代码，另有高位深 codec／API／界面。WASM 只随共享 chunk 分发一份，不内联 base64，不绕过统计。预算调整为 1300000 B raw／500000 B gzip，并重新跑应用组装和 release artifact gate；不是放宽像素、历史或运行时内存预算。

本次本机结果：208 项 Node 测试通过；Chrome/Metal 浏览器用例通过（包含真实 ICC worker 转换及取消、PSD worker 往返、界面操作、刷新恢复）；Electron IPC＋HTTP RPC 最小闭环通过。最终包为 1219396 B raw／472872 B gzip，应用 artifact 验证、仓库边界和 release descriptor 检查通过。报告在 `imageEditor/artifacts/high-depth/`，待实机包在 `imageEditor/artifacts/photoshop-certification/`；这些本地运行产物不替代仓库中的测试与生成脚本。

## 系统显示／CMYK／ICC 扩展验收

```sh
npm run test -w @haiyue/image-editor
npm run build:app -w @haiyue/image-editor
CHROME_PATH=/path/to/chrome node imageEditor/test/color-domains-browser.mjs
PSD_PYTHON=/path/to/python-with-psd-tools node imageEditor/scripts/check-color-domains.mjs
```

新增证据位于 `imageEditor/artifacts/color-domains/`。浏览器测试验证 CMYK worker PSD／滤镜／撤销／恢复、ICC 参考 WASM 校验／转换／取消、HDR GPU 浮点读取大于 1、回退和鼠标命中。当前运行环境报告 SDR，测试仅模拟 media capability，真实 GPU 渲染通过，物理 HDR 认证标记 pending；没有伪造 HDR 显示器。独立 psd-tools 读取外部 CMYK 样本及新导出的 8/16 位原生平面，归一化误差分别不超过一个代码值。

参考引擎加入后首次测量 2788523 B raw／1055205 B gzip；主要增加约 1.54 MB 的两个 WASM 与胶水文件。两个工具在 Worker 按需执行，离线 PWA 仍完整计入下载和 precache 预算。确认没有包含 npm 包内的 XML、测试文件或其他 15 个 CLI 后，将应用预算调整为 3000000 B raw／1150000 B gzip；不改变文档、历史与资源池预算。

实现依据：[Chrome WebGPU HDR extended canvas](https://developer.chrome.com/blog/new-in-webgpu-129)、[ICC 规范目录](https://www.color.org/icc_specs2/)、[ICC iccDEV](https://github.com/InternationalColorConsortium/iccDEV)。实际支持范围与剩余限制以本文的 CMYK 和 ICC 条目为准。

2026-10-09 本机最终回归：218 项 Node 测试全部通过，无跳过；两组 Chrome/Metal 浏览器验收通过；CMYK 与 RGB 高位深独立 psd-tools 对照通过；Electron IPC／本地 HTTP RPC 闭环通过。最终构建 2792664 B raw／1056524 B gzip，应用产物校验、仓库边界及 release descriptor 检查通过。新 Photoshop 待验收包：`imageEditor/artifacts/photoshop-color-domains.zip`（5 个样本，状态 `pending-photoshop`）。既有 `artifacts/photoshop-certification/` 是上一阶段的 3 样本包，不代表本阶段实机证据。


## CMYK 日常编辑（2026-10-09）

CMYK 文档右侧显示四个分色缩略图和油墨百分比。勾选通道决定原生画笔和填充要修改的版；例如只勾选 K，可以调整黑版并保留 C/M/Y。画笔沿用软硬度、不透明度和笔压设置，默认可在透明图层绘制；“保留透明度”固定 alpha。原生吸管读取画布合成分色，橡皮擦／清除只修改 alpha。矩形、椭圆、套索等现有选区的软遮罩共同生效；图层及父组锁定均阻止写入。每笔、每次填充均可撤销。

复制粘贴保留选区内四个油墨通道与独立 alpha。CMYK 跨文档粘贴采用**保留油墨数值**策略，目标 ICC 负责显示，因此不同配置下外观可能变化。界面粘贴到 RGB 使用源文档预览；无 ICC 的源预览是近似。API 的无配置原生资源仅接受 CMYK 目标，避免把近似 RGB 当作色彩转换。

缩放、旋转、翻转和交互式自由变换均在四个油墨平面上按关联 alpha 重采样，支持最近邻、双线性、双三次、Lanczos。透明背景不参与邻近颜色的权重；有蒙版的图层仍需先应用蒙版。正常图层可按既有多选／对齐／合并流程操作，合并保留原生分色。

正常、正片叠底、滤色、叠加、变暗、变亮、强光、差值、排除在反相油墨值上逐通道计算，遵守 alpha、图层不透明度、像素蒙版和隔离组。该数学实现和 PSD 字段往返已测试，不等同于 Photoshop 实机视觉认证。

原生工具无需 RGB 重新分色；渐变、仿制／修复、RGB 滤镜等颜色工具仍走工作 ICC。专色／DeviceN 文档、原生参数化 CMYK 内容和剪贴效果尚未覆盖。

复验命令：`npm test -w @haiyue/image-editor`、`npm run test:browser:cmyk-daily -w @haiyue/image-editor`。浏览器证据保存在 `imageEditor/artifacts/cmyk-daily/`，包含源码哈希、构建哈希、真实鼠标操作、通道面板截图和编辑后的 CMYK16 PSD。既有 Photoshop 待验收包对应上一阶段源码，不代表本次验证。

本次验收：229 项 Node 测试通过；新增 11 项 CMYK 日常测试；Chrome/Metal 实际鼠标操作和 Electron IPC／HTTP RPC 原生分色闭环通过。`PSD_PYTHON=<带 psd-tools 的 Python> node imageEditor/scripts/check-color-domains.mjs --daily` 可在浏览器验收后独立检查其导出的 PSD。最终构建 2804365 B raw／1059971 B gzip，保持现有体积预算。Photoshop 实机认证仍未执行。


## ICC 文档工作流（2026-10-10）

色彩管理面板显示工作配置名称、颜色空间、版本和来源状态。可以选择内置 sRGB、线性 sRGB、Display P3、Adobe RGB，或载入 ICC 文件；“指定”保留数值，“转换”尽量保持外观。两者均可撤销，也可下载或移除工作配置。RGB／CMYK 模式不匹配、设备链接等不能作为工作配置的 profile class 会在提交前拒绝。

PSD 打开对话框显示嵌入配置和未标记状态，默认保留，也可指定或转换到目标配置。错误保持对话框开启且不新增文档。无 ICC 的 RGB8/16 假定 sRGB，RGB32 假定线性 sRGB；无 ICC 的 CMYK 仍是明确标注的近似预览，转换前需先指定源配置。PNG／JPEG 经浏览器解码到 sRGB 后标记为 sRGB；作为图层插入时转换到目标工作配置，不保留文件原来的 ICC 元数据。

软打样配置、显示器配置和工作配置各自独立。修改意图／黑点补偿时，省略的配置不会清空；打样可以临时关闭且保留配置，并可单独设置打样意图（包含绝对色度）。清除按钮明确移除对应配置。新开关使用工程 v12／恢复 v13 保存；旧文件继续可读。工作配置转换、PNG／JPEG 导出均排除打样、显示器模拟和色域警告，界面与 API 使用同一导出编码器。

PNG 默认写入压缩 iCCP，JPEG 默认写入可分段 APP2，嵌入的是输出 sRGB 配置。PSD 默认保留文档工作 ICC；关闭嵌入只改变元数据，不转换源数值。工程始终保留色彩配置。导出不改变当前文档和历史。

界面跨 RGB 文档复制粘贴自动携带源工作配置并转换到目标配置，保持 alpha。RGB 复制到 CMYK 直接从源配置分色，避免经过 sRGB；CMYK 到 CMYK 继续保留油墨数值。API `image.pixels.paste` 的可选 `sourceProfileId` 为 RGBA 资源声明源 ICC；未传时保留原有原始数值语义。调用方可用 `image.icc.read` 获取源文档配置；原生 CMYK 资源不接受该字段。

复验：

```sh
npm test -w @haiyue/image-editor
npm run build:app -w @haiyue/image-editor
CHROME_PATH=/path/to/chrome node imageEditor/test/icc-workflow-browser.mjs
PSD_PYTHON=/path/to/python-with-Pillow-and-psd-tools node imageEditor/scripts/check-icc-workflow.mjs
node scripts/editor-e2e/rpc-electron.mjs imageEditor
```

证据保存在 `imageEditor/artifacts/icc-workflow/`：真实界面指定／转换／配置冲突／软打样／PSD 打开／刷新恢复、界面和 API 导出一致、独立 Pillow／psd-tools 检查配置字节及 P3→sRGB 外观。报告绑定源码、构建和输入哈希。ICC v5／DeviceN／光谱仍属于参考引擎资源能力，未扩展为文档工作空间；Photoshop 实机与物理 HDR 验收仍待有相应环境时执行。

本次本机验收：240 项 Node 测试全部通过（新增 11 项 ICC 工作流测试）；ICC 工作流、高位深及 CMYK 日常编辑三组 Chrome/Metal 用例通过；Electron IPC／HTTP RPC 通过。独立 native Little CMS 2.17 使用 PSD 浮点样本对照 WASM 2.16 输出，最大误差 1 个 8 位代码值（门槛 2），PNG／JPEG 嵌入 ICC 字节一致。最终构建 2843157 B raw／1072287 B gzip，应用验证、仓库边界、release descriptor 检查通过，未提高既有体积或误差预算。

## 大图交互与内存优化（2026-10-10）

- 普通笔刷、橡皮擦、仿制／修复和原生 CMYK 画笔的 SDR 预览按实际脏区域合成及更新画布，包含父组偏移、剪贴和图层样式的空间影响。取消笔画恢复相同区域。蒙版绘制与非局部智能滤镜使用完整重绘。
- 提交、撤销和重做比较不可变像素缓冲，颜色配置及结构未变时只重绘变化区域。支持 RGB8/16/32 和原生油墨；冻结历史创建的元数据副本按值比较，避免误判配置变化。结构／显示配置改变、超过半幅图层的大面积变化等情况回退完整重绘。比较缓冲本身仍有线性扫描成本。
- 最后一次 pointerup 会刷新尚未显示的笔段，避免取消 RAF 后遗留旧缓存；提交不再先重绘一遍原文档。缩放和平移继续使用画布变换，不重新合成像素。
- 同一同步合成遍历复用 Little CMS 转换器，最多同时保留 8 个，结束或异常时释放所有原生句柄；不同转换意图、配置和软打样参数不会共用错误的转换器。ICC 像素打包改为连续索引循环。智能滤镜与滤镜蒙版的同层输出在一次分块遍历内只生成一次，笔画改变缓存时显式失效。
- 吸管只合成目标像素及效果所需边界；直方图分块累积准确统计，不额外生成整幅合成图。软选区使用文档坐标，透明度加权不变。普通 4096² RGB8 的直方图避免额外 64 MiB 合成输出；RGB16/32 按每像素 16 B 计算。实际进程峰值还包括源图、Worker 输入副本、效果缓存和历史。
- 位图画布缓存只转换脏区域，超预算条目不进入缓存。既有 8192 边长、1677 万像素、128 MiB 文档和 256 MiB 历史限制不变。

首次打开、工作配置转换、大范围滤镜、非局部智能滤镜、较大样式边界和系统 HDR GPU 纹理更新仍可能需要整图处理；本次没有实现磁盘瓦片、超预算文档或整个处理链的 GPU 化。大图实时效果的下一步应继续针对这些全幅路径测量。

复验：`npm test -w @haiyue/image-editor`、`npm run test:browser:large -w @haiyue/image-editor`。浏览器诊断使用 4096² RGB8、2048² RGB16、Display P3 与 32px 软笔刷，真实鼠标输入；核对局部预览、提交、完整 PNG 导出、撤销／重做、取消与最后笔段的像素一致性。时间为合成／颜色转换／画布提交的 CPU 墙钟时间，不包含 GPU 呈现、整个命令历史提交或端到端输入延迟，不作为跨设备发布时间门槛。证据位于 `imageEditor/artifacts/large-image/`，绑定源码与构建哈希。

本机诊断（Chrome/Metal，每例 7 次局部预览采样）：4096² RGB8 局部重绘 P50 3.92 ms／P95 32.05 ms；2048² RGB16 为 3.96 ms／6.46 ms。两例单帧最多重绘 1406 px，提交、撤销、重做与取消均未触发全幅重绘。完整导出与局部画布逐像素一致，最后 pointerup 笔段与源像素一致。首次全幅 ICC 绘制分别约 11.54 s、2.98 s，仍是后续瓶颈，不能把局部重绘时间当作整图耗时。最终构建 2848431 B raw／1074310 B gzip，保持现有预算。

最终验证：248 项 Node 测试通过（本轮新增 8 项），大图、ICC 工作流、CMYK 日常编辑三组浏览器验收通过；独立 native Little CMS 对照保持最大 1 个 8 位代码值误差。应用产物、仓库边界和 release descriptor 检查通过。

## HDR 环境验收（2026-10-10）

**生产 → 色彩管理 → 导出 HDR 环境报告**可以保存当前浏览器的 dynamic-range、video-dynamic-range、P3／Rec.2020、屏幕与窗口尺寸、像素比、浏览器版本，以及编辑器实际后端、GPU 适配器、画布格式／颜色空间／tone mapping 和回退原因。相同信息通过 `image.display.query` 提供，继续支持现有 IPC／RPC。`phase` 区分 idle、initializing、ready、fallback；ready 在提交的 GPU 工作完成后发布。颜色深度及媒体查询是浏览器报告，不是面板位深或亮度实测。

两类验收严格分开：

```sh
# 自然环境：默认真实 Chrome 窗口，不强制 WebGPU，也不改写 HDR 媒体查询。
CHROME_PATH=/path/to/full-chrome npm run test:hdr:environment -w @haiyue/image-editor
# HDR 设备验收门槛：自然窗口必须报告 high，并通过真实 GPU 浮点读回，否则非零退出。
CHROME_PATH=/path/to/full-chrome npm run test:hdr:environment -w @haiyue/image-editor -- --require-hdr
# 故障模拟：仅验证软件链路；结果永远不能升级为自然 HDR 环境通过。
CHROME_PATH=/path/to/chrome npm run test:hdr:simulated -w @haiyue/image-editor
# 检查报告、样本字节长度／哈希、当前源码与构建指纹及验收条件。
node imageEditor/scripts/verify-hdr-environment.mjs imageEditor/artifacts/hdr-environment/environment-headed/report.json
node imageEditor/scripts/verify-hdr-environment.mjs imageEditor/artifacts/hdr-environment/environment-headed/report.json --require-hdr
```

报告分别位于 `artifacts/hdr-environment/environment-headed/` 与 `simulated-headless/`。自然模式可显式传 `--headless` 做无窗口诊断，但不能满足 `--require-hdr`。要求 HDR 不满足时仍先写出环境报告，再以非零退出；不会将普通 SDR 回退当成 HDR 认证。UI 下载的环境快照只提供观察数据，不是包含自动用例和哈希的完整验收报告。

固定样本是 64×16 RGBA32F：线性 0、0.18、1、2、4、8 倍高光，另有半透明与全透明色块。GPU 读回取自生产着色器绘制后的 rgba16float 画布（仅附加 COPY_SRC 用途），逐通道对照 sRGB 编码及预乘 alpha，误差门槛固定为 0.006；曝光 +1 EV 后再次核对，并验证文档像素未改变。截图会经过 SDR 捕获，不能用截图判断真实 HDR 亮度。

自然组检查 SDR／RGB16 回退、32 位 HDR 是否实际启用、环境报告导出及样本保持；可用时必须通过高光、alpha、曝光和指针命中检查。模拟组额外验证 dynamic-range 切换、GPU 设备丢失与重建、配置失败、无适配器、恢复，以及 GPU 工作延迟完成后切回 SDR 的旧帧隔离。故障只注入模拟层，着色器与文档处理使用生产代码。

物理显示仍需在目标机器上另行验收：

1. 记录 OS／浏览器版本、显示器型号与连接方式、系统 HDR 开关、显示器模式、供电和亮度设置；确认验收窗口位于目标 HDR 屏幕。
2. 在正常系统设置下运行自然窗口验收并保存报告；若浏览器仍报告 standard，记录原因，不强制改写能力来通过。
3. 用校准亮度计记录参考白和 2／4／8 倍测试块的实测 cd/m²、黑位、环境光、色度及仪器型号／校准日期；比较不同块的亮度、色相和高光区分。内容输入的倍数不能直接推算屏幕 nits，显示器可能执行色调映射或亮度限制。
4. 手动验证在 HDR／SDR 屏幕间移动窗口、系统 HDR 切换、休眠唤醒及电源状态改变后的显示与回退，重新导出报告。设备模拟只覆盖事件与恢复代码，不替代这些系统操作。

所有自动报告保留 `physicalLuminanceVerified:false` 与 `physicalHdrCertification:pending`。没有测量数据时，不生成物理亮度或完整 HDR 合规通过结论。

本次本机验收：251 项 Node 测试全部通过。自然 Chrome 窗口报告 `dynamic-range: standard`，4 项 SDR 回退／样本／报告检查通过，严格 `--require-hdr` 门槛按预期拒绝通过；这不代表物理面板没有 HDR 能力。模拟组使用真实 WebGPU 渲染，13 项检查全部通过，浮点读回最大误差约 0.001102（门槛 0.006），包含设备恢复与延迟旧帧隔离。两份报告的样本、源码及构建指纹复验通过。最终构建 2850515 B raw／1075018 B gzip，应用产物、仓库边界和 release descriptor 检查通过，保持既有预算。自然 HDR 输出和物理亮度仍待在对应显示环境验收。

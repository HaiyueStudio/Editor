# Haiyue Image Editor — PSD、选区与滤镜

这是 Image Editor 的分层图像工作区。P1 已实现新建、多文档、PNG/JPEG 打开与图层导入、
画布浏览、图层管理、独立撤销历史、工程副本和本地会话恢复。
P2 新增画笔、橡皮擦、矩形选区、填充/清除、移动、裁剪、缩放旋转翻转、栅格文字及 PNG/JPEG 导出。
P3 已接入受限 PSD 分层导入、兼容性报告、显式合并图回退与 PSD 兼容副本导出。
P4 已实现二进制分块恢复、像素差量历史、缓存释放和本机 Electron 候选打包，见 [P4 验收与限制](docs/p4-stability.md)。
P5 已加入可编辑文字／形状、灰度图层蒙版、6 类调整图层和 9 种混合模式，见 [P5 功能与 PSD 兼容矩阵](docs/p5-content-and-masks.md)。
新增非破坏性剪贴蒙版、常用图层样式、RGB 曲线／色阶、嵌入式像素智能对象，以及基础文字／形状／调整层的 PSD 原生往返，见 [当前支持矩阵](docs/non-destructive-and-native-psd.md)。
ICC 资源保留但当前不作颜色转换；Photoshop 全兼容和实机验收仍未完成。

最新扩展提供 13 种滤镜，以及反选、颜色范围、魔术棒、椭圆、自由/多边形套索、选区组合、羽化与扩展/收缩。
支持后台效果预览、原图对比、取消和撤销；操作与格式兼容说明见 [高级选区与滤镜](docs/advanced-editing.md)。

默认示例为 1200 × 800 的“海上生明月”，包含夜空、明月、海面与月光、题字四个独立像素图层，可直接导出分层 PSD。页眉、浏览器和 PWA 使用 Haiyue 原生引擎共享的冰蓝琉璃月牙，素材来源见 [品牌说明](assets/branding/README.md)。

日常编辑新增像素复制／粘贴（编辑器内跨文档）、吸管（I）、线性／径向渐变（G）、
图层多选／对齐／合并和交互式自由变换（Cmd/Ctrl+T，Enter 确认，Esc 取消）。
合并限连续、可见、正常混合的同组图层；自由变换支持单个像素层或智能对象；文字／形状及蒙版需先栅格化／应用。
新增功能与原有绘画、选区、内容、蒙版、PNG/JPEG 编解码均可通过统一 API、IPC 和本地 RPC 调用，
完整参数和边界见 [命令调用契约](../docs/for-ai/editor-platform/operations.md#image-daily-editing-commands)。

## 运行

在 Editor 仓库根目录执行（Node.js >= 22）：

```sh
npm ci --ignore-scripts
npm run build:foundations
npm run preview -w ./imageEditor
```

预览默认地址为 `http://127.0.0.1:4174/`。可通过 `EDITOR_APP_PORT=4178` 更换端口。
恢复副本按浏览器 origin 隔离，更换协议、端口或浏览器不会共享恢复数据。

验证命令：

```sh
npm test -w ./imageEditor
npm run test:browser -w ./imageEditor
npm run test:browser:p2 -w ./imageEditor
npm run test:browser:p3 -w ./imageEditor
npm run test:browser:advanced -w ./imageEditor
npm run test:browser:p4 -w ./imageEditor
npm run test:browser:p5 -w ./imageEditor
npm run test:browser:daily -w ./imageEditor
npm run test:browser:native -w ./imageEditor
npm run test:performance -w ./imageEditor
npm run app:check -w ./imageEditor
npm run test:image:p0
npm run typecheck -w ./imageEditor
npm run check:boundaries
npm run api:check
```

浏览器测试需要本机 Chrome 和本地 HTTP 监听权限；`CHROME_PATH` 可覆盖浏览器路径。
它会使用临时浏览器配置，产物放在 `artifacts/p1/`、`artifacts/p2/` 和 `artifacts/p3/`，不会操作用户的日常浏览器数据。

PSD 使用方法、兼容矩阵与验证见 [P3 实现记录](docs/p3-psd.md)。

## P1 操作

- 新建透明/白色画布；通过“打开”、拖放文件或“导入图片为图层”加载内容。
- 图层面板支持添加空白图层、图层组、复制、删除、同级排序、显隐、锁定、命名、
  不透明度和普通/正片叠底/滤色；选中组后添加或导入的图层位于组内。
- 属性面板修改像素图层坐标；手形工具拖动画布，滚轮缩放，提供适合窗口和实际像素。
- 保存 `.hyimage` 工程副本，之后通过“打开”恢复全部图层像素和属性。
  支持文件选择器的浏览器会确认实际写入；其他浏览器使用下载回退。
- IndexedDB 在操作后约 350 ms 自动保存当前会话，不替代外部工程文件；自动保存不会
  把未导出的文档标为已保存。关闭未保存文档时可保存、放弃或取消。
- 同一 origin 只允许一个窗口写入恢复会话。第二个窗口仍可编辑和下载工程文件，
  但不会覆盖第一个窗口的恢复数据。存储失败或数据损坏会显示具体提示，并保留原记录。
- 快捷键：Mod+N 新建、Mod+O 打开、Mod+S 保存、Mod+Z 撤销、Mod+Shift+Z/Mod+Y 重做、
  Mod+0 适合窗口、Mod+1 实际像素、Delete/Backspace 有选区时清除像素，无选区时删除图层。输入框内保留原生键盘行为。

P2 工具快捷键、操作说明、验收与限制见 [P2 实现记录](docs/p2-tools.md)。
工作区基础与历史阶段验收见 [P1 实现记录](docs/p1-workspace.md)。

## P0 兼容性研究

P0 输出位于 `imageEditor/artifacts/p0/`，该目录不进入版本控制。
`report.json` 包括源码/样本指纹、Git revision/dirty 状态、机器信息、解析和写出耗时、
逐样本兼容结果、资源丢失情况、独立解码状态及 Photoshop 验收状态。
独立解码器未配置时，报告明确标记 unavailable，不能将此运行当作交叉验收。

可选的独立交叉检查在隔离 Python 环境中运行：

```sh
python3 -m venv /tmp/haiyue-psd-p0
/tmp/haiyue-psd-p0/bin/pip install -r imageEditor/scripts/requirements-p0.txt
PSD_P0_PYTHON=/tmp/haiyue-psd-p0/bin/python npm run test:image:p0
```

Python 检查使用 psd-tools，直接比较两份 PSD 的图层结构、解码像素、蒙版及合成缓存，
并强制重新合成编辑后的合成样本。合成缓存的差异是研究结果，不能被图层测试通过掩盖。
详见 [P0 兼容性报告](docs/p0-findings.md) 与 [Photoshop 验收流程](docs/photoshop-acceptance.md)。

## 结构

- `src/psdPrototype.ts`：格式准入、诊断、参考 CPU 合成器、受限导出原型。
- `src/psdAdapter.ts` / `psdResources.ts`：P3 分层准入、资源保留与兼容导出自检。
- `src/psdJobs.ts` / `psdWorker.ts`：可取消、有超时的后台 PSD 任务。
- `src/document.ts` / `workspace.ts`：图像文档、命令历史和共享平台适配。
- `src/canvasView.ts` / `main.ts`：浏览器画布与工作区交互。
- `src/projectFile.ts` / `recovery.ts`：版本化工程文件、严格验证及串行 IndexedDB 恢复。
- `test/fixtures/`：固定 upstream commit 的外部样本、参考结构、SHA-256 和 MIT 许可证。
- `test/psd.test.mjs`：参考结构、像素数学、编辑往返和拒绝路径测试。
- `scripts/run-p0.mjs`：本地诊断报告和人工验收文件生成。
- `scripts/independent-check.py`：独立解码器验证。
- `evidence/`：本次研究的报告快照；重新运行时核对指纹与版本。

## 边界

原型接受 8-bit RGB PSD v1。128 MiB 文件、256 MiB 解码像素、16384 边长、512 图层、
32 层嵌套是 P0 的保守运行边界，不是最终产品性能指标或整个进程的内存上限。
文件先读取结构、检查图层及蒙版大小，再解码像素。P3 产品边界收紧为 8192 边长、
16M 画布像素、128 图层、16 层嵌套和 128 MiB 解码像素；已提供 Worker 隔离、取消及解析超时。
P4 提供恢复分块、差量历史与有界缓存；完整分块工作位图、完整元数据语义及更大文档性能仍未完成。

参考合成器仅实现普通、正片叠底、滤色、隔离组及 100% 不透明度的穿透组；
P0 参考实现使用编码 RGB 数值合成。当前产品已支持受限 RGB ICC 转换，范围见专业修图说明；Photoshop 完整色彩设置仍未对齐。
复杂内容在原型导出时明确阻止。实验脚本中的 `*.codec-roundtrip.psd` 刻意绕过保护以研究
编解码损失，**这些文件不是可交付的无损导出结果**。

P1 通过共享 Platform、Shell 和 App Kit 接入仓库构建、类型检查、测试、app assembly 与
产品描述符检查。Web/PWA 和 Electron renderer 来自相同内容树；P4 已验证浏览器断网重启和 macOS 本机候选包，
Windows/Linux 实机、公开发行签名及公证尚未验收。P3 Worker 复用 P0 格式诊断和 CPU 参考合成器，
浏览器使用新的适配层控制准入与导出。

## 专业修图与生产能力

已接入软笔刷／笔压、仿制／修复、引导式边缘细化、贝塞尔路径、富文本、RGB ICC 转换与可取消批处理。UI 与统一 API / IPC / 本地 RPC 共用操作契约；工程 v5、恢复 v6 保留新增语义。该阶段使用方式、命令的新增部分、PSD 降级规则及大图边界见 [专业修图与生产说明](docs/professional-production.md)。

### 处理质量（第一批）

高质量重采样、RGB 分通道曲线／色阶、直方图、高斯模糊与 USM 已接入 UI、历史和公共 API。参数、兼容范围、算法口径及包体变更见 [处理质量说明](docs/processing-quality.md)。浏览器回归：`npm run test:browser:quality`。

第二批已增加智能滤镜堆栈、滤镜蒙版、实时蒙版密度／羽化及 Blend If，并提供 55 个领域命令。详见 [非破坏性处理链](docs/non-destructive-pipeline.md)，包括界面入口、API 示例、工程版本及 PSD 兼容边界。

第三批已增加命名选区／Alpha 通道、参考线吸附、参数化动作与模板批量导出，图像领域命令增至 65 个。工程 v8／恢复 v9 保留生产设置；入口在右侧「通道／生产工具」。详见 [生产效率说明](docs/productivity.md)。

### 第四批兼容性与基础能力

新增多层智能源编辑／回写、工程 v9／恢复 v10、带扩边的分块合成、16 位／浮点 SDR 色彩转换资源 API，以及两代 PSD 独立验证。公共命令共 68 个。主文档仍为 RGB8；完整高位深／HDR／ICC 与 Photoshop 实机认证尚未完成。见 [范围、API 和验证](docs/compatibility-foundations.md)。

## 共享 UI 组件与可调布局

主界面命令按钮、工具参数、混合模式、图层坐标及不透明度使用 `@haiyue/ui` 的 `hy-button`、`hy-input`、`hy-select`、`hy-checkbox`，按公开子路径注册。图像编辑器单独依赖 UI 0.1.2，锁文件保留其他编辑器的旧版依赖，避免混用 `hy-` 与 `ge-` 命名。

画布和右侧导航器／图层面板之间使用 `hy-split`：拖动调整宽度，聚焦分隔条后用左右方向键微调（Shift 加大步长），Home／End 到最小面板边界，双击恢复右侧默认 300px。两侧最小宽度为 240px；比例保存到当前浏览器，刷新后恢复。窄窗口的顶栏换行、侧栏滚动，画布观察自身尺寸变化。

输入与下拉组件通过 `value-change` 桥接编辑器的提交事件；禁用态使用属性，快捷键识别 Shadow DOM 焦点。表单弹窗、文档标签、图层树和工具切换按钮仍保留原生实现，以保持提交校验及各自的键盘语义。

复验：`npm run test:browser:ui -w @haiyue/image-editor`。报告和宽／窄窗口截图位于 `imageEditor/artifacts/ui-components/`，覆盖真实分隔条拖动与键盘调整、输入提交／撤销、复选框、刷新恢复和布局复位；下拉框通过内部原生 change 事件验证组件边界，不将操作系统弹出菜单的自动化结果视为验收。另运行既有选区手势与日常编辑浏览器回归。

2026-10-10 验证：251 项 Node 测试通过；UI 组件、选区手势和日常编辑三组 Chrome 回归通过；类型构建、应用产物、仓库边界及产品描述符检查通过。最终应用 2,883,473 B raw／1,081,890 B gzip，保持原有预算。

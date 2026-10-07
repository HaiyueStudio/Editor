# Haiyue Image Editor — PSD、选区与滤镜

这是 Image Editor 的分层图像工作区。P1 已实现新建、多文档、PNG/JPEG 打开与图层导入、
画布浏览、图层管理、独立撤销历史、工程副本和本地会话恢复。
P2 新增画笔、橡皮擦、矩形选区、填充/清除、移动、裁剪、缩放旋转翻转、栅格文字及 PNG/JPEG 导出。
P3 已接入受限 PSD 分层导入、兼容性报告、显式合并图回退与 PSD 兼容副本导出。
P4 已实现二进制分块恢复、像素差量历史、缓存释放和本机 Electron 候选打包，见 [P4 验收与限制](docs/p4-stability.md)。
P5 已加入可编辑文字／形状、灰度图层蒙版、6 类调整图层和 9 种混合模式，见 [P5 功能与 PSD 兼容矩阵](docs/p5-content-and-masks.md)。
ICC 资源保留但当前不作颜色转换；Photoshop 全兼容和实机验收仍未完成。

最新扩展提供 13 种滤镜，以及反选、颜色范围、魔术棒、椭圆、自由/多边形套索、选区组合、羽化与扩展/收缩。
支持后台效果预览、原图对比、取消和撤销；操作与格式兼容说明见 [高级选区与滤镜](docs/advanced-editing.md)。

默认示例为 1200 × 800 的“海上生明月”，包含夜空、明月、海面与月光、题字四个独立像素图层，可直接导出分层 PSD。页眉、浏览器和 PWA 使用 Haiyue 原生引擎共享的冰蓝琉璃月牙，素材来源见 [品牌说明](assets/branding/README.md)。

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
使用编码 RGB 数值合成，尚未完成 ICC 转换及 Photoshop 色彩设置对齐。
复杂内容在原型导出时明确阻止。实验脚本中的 `*.codec-roundtrip.psd` 刻意绕过保护以研究
编解码损失，**这些文件不是可交付的无损导出结果**。

P1 通过共享 Platform、Shell 和 App Kit 接入仓库构建、类型检查、测试、app assembly 与
产品描述符检查。Web/PWA 和 Electron renderer 来自相同内容树；P4 已验证浏览器断网重启和 macOS 本机候选包，
Windows/Linux 实机、公开发行签名及公证尚未验收。P3 Worker 复用 P0 格式诊断和 CPU 参考合成器，
浏览器使用新的适配层控制准入与导出。

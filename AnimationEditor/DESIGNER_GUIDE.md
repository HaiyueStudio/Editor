# AnimationEditor 设计师指南

AnimationEditor 默认使用简体中文。它有互不混合的 2D 与原生 3D 工作区；两者都保存可编辑的
`.hya-project.json`，并交付裸 `.hya` 或 `.hya-package.zip`。

## 1. 从模板开始

点击工具栏的“新建工程”打开模板选择器：

| 模板 | 工程族 | 适合任务 |
| --- | --- | --- |
| Tween UI 动效 | 2D | 位移、缩放、缓动和 UI 入场 |
| SpriteSheet 序列 | 2D | 图集网格、序列、Step 关键帧 |
| Path / Vector | 2D | 路径、描边、Trim Path、Morph |
| 粒子动效 | 2D | 固定种子 Particle2D 与运动轨道 |
| 原生 3D 摄像机与物体 | 3D | Camera3D、PBR、Primitive 和 TRS |
| glTF 角色样例 | 3D | 真实 glTF、skin、Morph 和模型动画 |

工程创建或导入时即固定工程族。打开 3D 工程会自动进入 `native3d.html`；混合 2D/3D 数据会在
`$.mode` 以 `E_PROJECT_MIXED_DIMENSIONS` 拒绝，不会自动投影或伪装成 2D。

## 2. 2D 黄金路径

1. 从模板新建，或用“打开”载入 2D `.hya-project.json`。
2. 资源面板的 `＋` 导入图片、音频或二进制；`⇩` 将 Lottie/裸 HYA 转为新工程。
3. 点击资源行右侧 `↻` 重链接文件。资源 ID 和全部组件引用保持不变，操作支持 Undo/Redo。
4. 在层级面板选择节点，在 Inspector 编辑属性；锁定会阻止编辑，隐藏会把编译后的节点 opacity 设为 0。
5. 在时间轴添加轨道；双击轨道空白处插入关键帧。关键帧按工程帧率吸附，右侧 Inspector 编辑插值和曲线。
6. 在 State Machine 页签用命名片段创建状态、参数和转场，并直接驱动 exact runtime preview。
7. 保存工程，重新打开检查；再分别“导出 HYA”和“导出交付包”，最后点击播放验证运行时。

裸 HYA 反向导入只能恢复有限编辑数据，状态栏会显示 `W_HYA_DELIVERY_LIMITED_PROJECT` 和路径；原始
authoring ID、图布局或源文件信息不会被猜测恢复。

## 3. 原生 3D 黄金路径

1. 选择“原生 3D 摄像机与物体”或“glTF 角色样例”，进入 3D 工作区。
2. 在层级选择节点，在 Inspector 修改 Translation；每次提交进入同一 Undo/Redo 历史。
3. 画布使用 Orbit/滚轮导航，时间轴显示稳定 binding、插值和关键帧。
4. Exact preview 从编译后的 HYA bytes 再解析 `org.haiyue.animation-3d@1`，再创建唯一的
   `HyaAnimation3DRuntime`；不会运行编辑器专用近似动画。
5. 保存/重开 `.hya-project.json`，导出裸 HYA 或 3D 交付包并播放。glTF 外部依赖会明确列在 manifest，
   编辑器不会在确定性打包时偷偷抓取可变网络内容。

## 4. 画布、时间轴与快捷键

- 画布滚轮缩放；按住 Space + 左键或鼠标中键平移；平移时按 Shift 吸附到 10 px 网格；聚焦画布后
  `⌘/Ctrl +`、`⌘/Ctrl -` 和 `⌘/Ctrl 0` 可缩放/复位。
- 时间轴支持 40–800 px/s 缩放、播放头 scrub、双击插帧、拖动关键帧和末尾 32 px 可视留白。
- `⌘/Ctrl S` 保存，`⌘/Ctrl Shift S` 另存为，`⌘/Ctrl Z` 撤销，`⌘/Ctrl Shift Z` 重做，Delete 删除所选。
- `ge-split` 分隔条支持鼠标和方向键调整，布局保存在浏览器；时间标尺文案不可被 CSS 选中。
- 控件提供中文 `aria-label`、焦点样式、实时状态区；设置中可切换英文，默认始终是中文。

## 5. 诊断、任务和交付

工程、编译和状态机错误显示稳定 code、JSON path 和消息。来源导入、资源重链接和交付包构建由
latest-wins 任务持有，状态栏显示进度并可取消；取消、替换工程或关闭页面会终止任务并释放 worker、
object URL、asset handle 和监听器。

交付包固定 ZIP 顺序和时间戳，包含 HYA、`manifest.json` 与可打包资源；每个打包资源和 HYA 都有
SHA-256 integrity。外部 HTTPS/相对 URI 保持为 manifest 中的 external dependency。

## 6. 明确限制与候选预算

- 不支持同一 composition 内混排原生 2D/3D，也不提供 NLE、视频剪辑、任意脚本表达式或 DCC 建模。
- SpriteSheet rotated/trimmed atlas、任意 audio cross-fade、重叠 resource switch、状态机中的高级
  paint/text/effect/composite animated channel 会精确拒绝；详见 [CAPABILITY_MATRIX.md](./CAPABILITY_MATRIX.md)。
- 单个本地资源和工程内嵌资源总量当前均为 5 MiB；project 输入最大 64 MiB；交付包单资源 64 MiB、
  archive 128 MiB。2D/3D schema 还分别限制 node、track、key、particle 与 resource 数量。
- G09 候选 fixture 为 1,000 nodes / 2,000 tracks / 10,000 keys / 100,000 particle capacity /
  256 resources；scrub P95 16ms、drag P95/long task 50ms、compile 3s、preview/startup 5s、heap 增长
  96 MiB、JS 与 sourcemap 各 7 MiB。它们是本地候选证据，不是正式 release baseline。

运行完整验证：

```sh
npm run typecheck -w ./AnimationEditor
npm test -w ./AnimationEditor
npm run test:candidate -w ./AnimationEditor
npm run test:browser -w ./AnimationEditor
```

HYA core、binary、状态机和 native 3D extension 的规范入口见 [`animation-spec/SPECIFICATION.md`](../animation-spec/SPECIFICATION.md)与 [`docs/api/animation-spec.md`](../docs/api/animation-spec.md)。AnimationEditor 的可编辑 project 版本独立于 HYA 和 npm package version，不能互相替代。

WebGPU、HTTPS、资源/Worker base path、device lost 与 issue 信息见[故障排查](../docs/engine-guide/troubleshooting.md)。编辑器可以在没有 WebGPU 时继续校验/编译部分 2D 数据，但 exact runtime preview 和原生 3D 预览仍要求受支持的原生 WebGPU；这不是 WebGL fallback。

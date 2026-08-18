# G09 设计师集成候选状态

- 日期：2026-08-05
- 候选状态：`accepted`
- 产品实现：完成
- 正式 M01 状态：`complete`
- 正式 baseline：API surface 经评审更新；未更新性能、像素、bundle 或 release baseline

## 候选结论

G02–G08 已接入同一 AnimationEditor 产品流程。2D 与原生 3D 工程可从模板或导入开始，完成编辑、
Undo/Redo、资源重链接、保存/重开、exact HYA、确定性交付包和真实 WebGPU 播放。项目自带的 Headless
Chrome runner 已获用户认可为浏览器验收证据，产品黄金路径与 8 个上游能力 fixture 共 9 组全部通过。

G09 已由 integration owner 接受，M01 正式晋升为 `complete`。API surface 已按 ADR 0035/0042/0067
逐项评审并同步 snapshot；主 `editor` 通过 source alias、side-effect metadata 与输出压缩恢复到 10.18%
total gzip headroom，既有预算未放宽。

## 功能验收

- 6 个模板：Tween UI、SpriteSheet、Path/Vector、Particle、原生 3D Camera/Object、glTF Character。
- 2D/3D family 在创建和打开时固定；3D 工程路由到独立 `native3d.html`，混合数据显式拒绝。
- 资源重链接保持 asset id 和全部引用不变，并进入 Undo/Redo 历史。
- 画布支持 zoom、pan、Shift 10 px snapping/guides；节点支持 lock 与 preview hide。
- 来源导入、资源操作和打包使用 latest-wins 任务、进度、取消与 teardown。
- preview、bare HYA 与 package 消费同一编译结果；2D/3D package 均为确定性 ZIP。
- 页面关闭、工程替换与 preview hot-swap 会释放 listener、action、binding、scene 和 GPU owner。
- 默认简体中文，可切换英文；关键操作采用图标和可访问名称。

## 候选性能

预算来源为 `config/designer-candidate-budgets.json`，只用于本地候选，不是 release baseline。

| 指标 | 实测 | 候选预算 |
| --- | ---: | ---: |
| 1000-node / 2000-track / 10k-key scrub P95 | 0.037 ms | 16 ms |
| full-project drag P95 | 13.45 ms | 50 ms |
| compile | 48.34 ms | 3000 ms |
| heap 增长 | 27,051,624 B | 100,663,296 B |
| HYA | 257,752 B | 信息项 |
| AnimationEditor JS | 5,444,728 B | 7,340,032 B |
| source map | 6,351,086 B | 7,340,032 B |

最终 9 组聚合 Headless Chrome 复跑中，产品 fixture 启动为 2D 124.9 ms、3D 82.3 ms，
heap 增长 26,411,852 B，long task 为 0。
该产品 fixture 实际操作了 zoom/pan、Shift snapping/guides、选择、锁定/隐藏、快捷键、错误弹窗、
2D/3D 保存重开、导出与播放；缩放期间的 GPU backing store 保持布局分辨率，不随 CSS transform 递归放大。

## 无头浏览器 / WebGPU 证据

`npm run test:browser -w ./AnimationEditor` 通过 9/9：

1. Stage 4 exact runtime：HYA Runtime 已连接，3 visuals / 1 track。
2. 产品黄金路径：6 templates，2D/3D create/edit/reopen/export/play、relink、Undo/Redo、teardown。
3. Timeline：2 timeline commits、3 graph commits、10k scrub 0.11 ms、selection 0.09 ms、drag 5.24 ms、long task 0。
4. SpriteSheet：25 frames、3 playback modes、无 per-frame resource、GPU error 0。
5. Path/Vector：真实像素 `4540/4390/568`、cache `8/8`、GPU error 0。
6. Particle：54 次 scrub，max 3.84 ms，GPU error 0。
7. Native 3D：HYA 20,360 B，像素 hash `edb2e762/add0ce67/cd60999c`，package 36,090 B，owner residual 0，GPU error 0。
8. Source import：2D/2D/3D family，object URL 0，active task 0。
9. State machine：本次候选像素 hash `5b2bf426/8f979e94/1e4d89ae`，20 次快速切换，destroy 后 action/binding/side-effect/particle 与 GPU residual 全为 0。

产品 fixture 自身的三个 canvas hash 相同，因此不把它单独作为动画像素差异证据；真实帧差异由 Native 3D、
State Machine、Path/Vector 等 focused WebGPU fixture 提供。

## 最终门禁状态

- `animation-spec` typecheck，68/68 tests。
- `extensions` typecheck，154/154 tests，稳定 facade 声明不泄漏内部 runtime path。
- `AnimationEditor` typecheck，107/107 tests，production build，candidate budget，9/9 browser fixtures。
- workspace boundaries、architecture、performance policy、capability admission、docs、shader-language、contracts、lifecycle、fast workspace tests、UI build。
- API snapshot 经评审更新，`api:check` 通过；engine 根 golden path 仍与 ADR 0035 完全一致。
- 主 `editor` production build 与 bundle gate 通过：total 5.88 MiB、1.06 MiB gzip、10.18% gzip headroom。
- `npm run check:fast` 完整通过。
- `npm run check:slow -- --content-tier=smoke` 完整通过，包括真实 Chrome/WebGPU、Stage 14 25 节点、
  editor E2E/10k 大场景/内存、产品截图、AO GPU cost 与 44 个 smoke 内容目标。
- `git diff --check`。

本里程碑只晋升经评审的 API surface snapshot；本地候选性能、像素和 dirty-worktree benchmark artifact
不作为正式 release evidence，后者由 M02 在 clean RC revision 上统一采集。

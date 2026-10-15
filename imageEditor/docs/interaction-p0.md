# 第二轮 P0：视口缓存与前台调度

本批覆盖视口缓存优先级、后台任务抢占，以及 PSD 导入对话框已有缩略预览的显示。提前发布导入预览、笔刷增量执行和 GPU 自由变换属于后续 P1。

## 实现

- GPU 显示缓存仍为 48 MiB，源纹理和临时合成池仍为 8 MiB。每帧重新排序已有缓存：当前可见的呈现瓦片、当前缩放级别及相邻采样核心优先；其余缓存继续保护粗级别金字塔，避免冷帧重复遍历。共享边缘核心在最后一个使用者准备完成后释放优先级；视口准入计算同时存活的核心、呈现瓦片和递归缩小临时工作集，避免把所有曾使用的核心都计为常驻而过早降低清晰度。实际工作集仍超出预算时才提高缩小级别。
- 渲染指标增加 `uniqueComposedTiles` / `duplicateComposedTiles`。测试要求冷帧、放大和平移的帧内重复合成为零；瓦片边缘仍从相邻原始核心采样，Alpha 加权缩小和颜色规则不变。
- GPU 资源操作共用串行队列，压缩和持久写入在队列外等待。后台工作在操作停止 80 ms 后启动，每批最多 8 个瓦片、2 MiB 像素回读，并在批次之间让出执行。后台递归遍历另以 8 ms 为检查间隔让出主线程，使全部命中内存的计算也能处理输入事件。输入取消旧后台任务，取消 GPU 映射会解除映射并释放借用，再允许下一帧使用资源。
- RGB8 常驻 GPU 预览使用 Worker 压缩；只转移可丢弃的回读副本，导航器像素保留独立所有权。取消立即终止压缩 Worker，完成后释放 Worker。Worker 不可用时跳过可选持久缓存，不在主线程进行整批压缩。
- 已提交的 IndexedDB 事务允许完成，但其 Promise 不占用 GPU 队列。取消后的旧任务不能更新当前缓存完成标记或导航器。参考合成的持久缓存等待同样支持取消，原生像素存储和导出不变。
- PSD 对话框优先使用 `result.preview`，没有时使用合并图位图。分页文档不再因为 `flattened === null` 而隐藏可用预览。

## 验收

先运行 `npm test -w ./imageEditor`、`npm run build:app -w ./imageEditor`、`npm run check:boundaries`，再使用同一构建运行：

```sh
node imageEditor/test/interaction-p0-browser.mjs
node imageEditor/test/tiled-viewport-browser.mjs
node imageEditor/test/render-p2-browser.mjs
node imageEditor/test/performance-p1-browser.mjs
node imageEditor/test/tiled-native-browser.mjs
node imageEditor/test/idle-work-p0-browser.mjs
```

- `interaction-p0.test.mjs`：优先级切换、冷帧与边缘复用、预算准入、待完成写入与前台独立、映射取消释放、取消队列任务、Worker 取消后重建、内存命中时的后台计算让出。
- `interaction-p0-browser.mjs`：在真实 Chrome WebGPU 中人为保持缓存写入、GPU 映射、压缩请求的 Promise 未完成；此时新前台帧必须仍在 2 秒内完成。随后验证真实 Worker 压缩可恢复，GPU 无未捕获错误。
- `tiled-viewport-browser.mjs`：9001×1000 与 20000×12000 PSD 的导入缩略图、冷帧、缩放、平移、16 次连续拖动及小图切换。每帧检查零重复合成、呈现前零回读和纹理预算；记录输入到提交的 P95 和主线程长任务。P95 本机诊断上限为 250 ms。
- `render-p2-browser.mjs`：透明边缘、奇数尺寸、Display P3、ICC 参考回退、持久恢复、缓存损坏和设备恢复；采样落到文档外时按透明裁剪校验，文档内仍使用独立 CPU 参考比较；其他套件覆盖混合模式、滤镜、原生高位深／模拟 HDR 与元数据零绘制。

渲染耗时及输入到提交时间不等同于显示器最终呈现延迟。记录属于本机诊断；压缩、解码与文件导入的整体性能不在本批加速承诺内。

## 本机记录（2026-10-11）

最终构建 `fbcd370ab2d8ae867e9b8682fcf2e63b52efcf5fb04b1a179c970681b68648a9`：raw 4,590,026 B / gzip 1,512,346 B，沿用 4,600,000 B / 1,520,000 B 预算。

20000×12000 样例的对照记录：

| 指标 | 原 P2 记录 | 本轮 |
| --- | ---: | ---: |
| 放大后的合成次数 | 135 | 63 |
| 一次平移的合成次数 | 162 | 6 |
| 平移渲染提交耗时 | 125 ms | 11.3 ms |
| 连续 16 次拖动的输入到提交 P95 | 未记录 | 17.8 ms |

本轮连续拖动的帧内重复合成均为零，记录期间无 50 ms 以上主线程长任务。冷帧仍需要合成 3713 个叶瓦片（各一次），提交约 5.67 s；整体导入不是本批优化目标。透明边缘、颜色转换等 GPU 像素对照最大通道误差约 2.725，低于门槛 3。

482 项 Node 测试、6 组浏览器回归、类型检查、构建／包体与仓库边界检查全部通过。汇总记录为 `artifacts/interaction-p0/acceptance.json`，校验所有浏览器结果属于同一构建，并记录源文件与日志指纹。

详细产物在 `artifacts/interaction-p0/`；大图、像素一致性等共享回归产物分别保存在各自套件目录。记录中的延迟仅适用于本机测试条件。

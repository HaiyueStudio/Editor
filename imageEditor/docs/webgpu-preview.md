# Haiyue WebGPU 图像预览

默认预览通过 `@haiyue/engine/core` 的公开导出创建 `HaiyueEngine`，采用 simple profile、按需提交。引擎负责适配器、设备、画布配置及设备恢复；图像编辑器在该设备上实现 PSD 图层合成 shader。引擎模块按需加载，不启动连续场景循环，也不影响 CPU 导出器。

## GPU 合成范围

- RGB 8 位像素、文字、形状、智能对象的当前栅格；图层位置、可见性、不透明度。
- normal、multiply、screen、overlay、darken、lighten、hard-light、difference、exclusion。
- 不透明度 100% 且没有组蒙版/效果的穿透组；保持图层顺序与父级坐标。
- 图层蒙版覆盖、密度、羽化在纹理上传时计算并缓存。智能对象仍保留原生源与变换信息。
- RGB matrix/TRC ICC 的解码曲线及颜色矩阵在最终 GPU 显示 pass 应用。

隔离组、半透明穿透组、剪贴组、调整层、图层样式、智能滤镜、Blend If、CMYK、高位深、ICC LUT/软打样/自定义显示器等仍使用已有精确参考合成器，结果上传 GPU 后统一呈现。HDR/EDR 保留原有 extended 浮点显示路径。本次不声称所有编辑算法、ICC 标准和 PSD 效果都已 GPU 化。

## 更新与内存

缓存当前可见图层的 GPU 纹理。移动、透明度、混合模式变化复用纹理；像素/蒙版变化只替换受影响图层。已知且可信的脏区可局部上传；连续取消时退回完整更新，避免遗漏之前未呈现的更改。

两个离屏纹理交替合成，所有等待与上传完成后才获取 swapchain 并提交一次显示 pass。旧任务检查 AbortSignal，并通过串行 GPU 更新队列防止覆盖新帧。无 WebGPU 时使用离屏 Canvas 完成后一次性复制，避免重新出现逐块显示。

兼容选区颜色采样的 Canvas2D 是完整 GPU 帧的快照，不再次用 CPU 合成图层；导航器读取 GPU 画布。主可见画布为 `#gpu-image-canvas`。窗口缩放不改变文档像素尺寸。

预览资源保守预算为 128 MiB，包含图层纹理、两张合成纹理、呈现表面、引擎深度附件及采样快照的估算。超过尺寸/预算限制使用参考 Canvas 路径；关闭文档与销毁时释放缓存。既有磁盘分页及解码预算保持不变。

`image.display.query` 的 `renderer` 返回 backend、composition、documentId、revision、frame、uploadedBytes、textureBytes、budget、ms；`ms` 是 CPU 准备/提交时间，不是 GPU 计时。`active.backend` 的 SDR 值可为 `haiyue-webgpu`，HDR 激活仍为 `webgpu-extended`。

## 验证

`node imageEditor/test/gpu-preview-browser.mjs` 使用桌面的 `psd/3d-preview-mockup.psd`，记录暖缓存透明度编辑耗时（包括等待 GPU 队列完成），检查零纹理重传、完整帧呈现、移动/9 种混合模式与 PNG 参考输出的逐像素差异、复杂效果参考路径、取消任务、窗口尺寸以及设备恢复。`--no-gpu` 验证适配器不可用时的原子 Canvas 回退。`--baseline` 可在旧构建上记录对照；结果在忽略的 `artifacts/gpu-preview/`，不修改 PSD 源文件。

初始旧路径四次透明度操作为 1963、2110、2675、1488 ms。最终构建 `650151a6abfb2e04` 的同一操作为 47.0、39.6、38.4、42.2 ms（含 GPU 队列完成，中位数约 40.9 ms，旧路径中位数约 2036.5 ms，约 50 倍）。四次图层纹理上传均为 0 B，预览预算估算 61,551,308 B。9 种混合模式/移动的 RGBA 平均误差不超过 0.003/255、最大 2/255；复杂效果参考路径逐像素一致。此测试衡量暖缓存图层属性编辑，不代表首次 PSD 解码、智能对象重建或所有复杂效果耗时，也不是屏幕实际发光延迟的测量。

新增单测覆盖 GPU 合成范围与保守降级，既有 mockup PSD 导入/编辑/撤销/导出以及磁盘选区手势继续回归。引入 HaiyueEngine 后应用下载增加约 1.35 MB raw / 0.30 MB gzip；引擎为独立懒加载 chunk，离线包仍完整计入。最终包为 4,304,383 B raw / 1,406,393 B gzip；应用下载上限调整为 4.5 MB raw / 1.5 MB gzip，不放宽文档或分页内存预算。

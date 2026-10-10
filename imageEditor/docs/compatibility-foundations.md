# 第四批：兼容性与基础能力

> 后续高位深／HDR／Little CMS 实现及实机待验收状态见 [高位深与色彩管理](high-depth-hdr-icc.md)。本文保留第四批交付时的范围记录。

本批实现多层智能源的编辑闭环、PSD 两代往返验证、带效果扩边的分块合成，以及可供 API／IPC／本地 RPC 调用的 16 位／浮点 SDR 色彩转换。**主文档仍为 RGB8；完整高位深编辑、HDR 和完整 ICC 引擎尚未实现。**

## 多层智能源

“编辑智能源文档”将智能对象打开为独立文档，支持增加图层、分组及当前 PSD 可原生保存的文字、形状、路径、调整层、蒙版、样式和 Blend If。“回写智能源”重新计算源合成缓存，保留父对象的几何变换、智能滤镜、滤镜蒙版及其他外层参数；父文档一次撤销即可恢复。源文档继续独立存在，可保存或关闭。

解析和回写运行于 Worker。开始处理后若父文档或源文档有新修改，提交被拒绝；父文档关闭后也不能回写。源文档与父对象的 UI 临时关联不跨刷新持久化，工程／PSD 中的嵌入源本身会完整保存。再次编辑请重新打开源文档。

源内部保存为自包含 PSD 字节，因此 PSD 导出不需要将多层源合并为单层。限制为 32 MiB 嵌入文件、64 MiB 解码预算、128 层、16 层分组；暂不允许递归智能对象和外部链接。不支持的原生结构、生产元数据或需要栅格化的效果在回写时明确拒绝，不能静默丢失。可将这类源另存为工程，或显式准备可兼容的源副本再替换。

含多层智能源的工程使用 **v9**；二进制恢复使用 **v10**，嵌入源参与分块去重、SHA-256 校验、文档／撤销内存预算。无此特性的文档继续写入所需的最低版本。

## 公共命令

新增 3 个命令，目前共 68 个图像领域命令，均走现有 Platform 调度及资源句柄接口。

| 命令 | 目标／访问 | 参数与结果 |
| --- | --- | --- |
| `image.smart.source.read` | document／read | `{layerId}` → `.hyimage` 工程资源句柄；通过 `image.document.open` 打开后可查询、编辑、撤销、导出 |
| `image.smart.source.replace` | document／write | `{layerId,resourceId,format:'project'\|'psd'}` → `{applied:true}`；需父文档 `expectedRevision`，一次撤销 |
| `image.color.precision` | workspace／write | 见下例，返回新资源，不修改任何文档；支持取消与资源发布失败回滚 |

```json
{
  "apiVersion": "1",
  "requestId": "color-16bit",
  "operation": "image.color.precision",
  "params": {
    "resourceId": "<上传后的句柄>",
    "width": 1024,
    "height": 1024,
    "input": "rgba16le",
    "output": "rgba16le",
    "source": "display-p3",
    "target": "srgb",
    "exposure": 0
  }
}
```

高精度资源为行优先、无行尾填充、straight RGBA；输入支持 little-endian `rgba16le`、`rgba32fle`，输出另支持 `rgba8`。16 位使用 0–65535，浮点仅接收有限的 0–1 SDR 样本，HDR／负值／NaN 明确拒绝。转换以 float64 计算，4097 点 TRC 插值／反查，只在输出端量化；Alpha 不参加颜色转换。曝光在源线性 RGB 中执行，范围 ±20 EV。

源／目标支持 sRGB、Display P3、Adobe RGB，或 `resource` 加 `sourceProfile`／`targetProfile` ICC 资源句柄。支持 RGB matrix/TRC 的 ICC v2/v4、D50 PCS、相对色度转换；返回 `clippedPixels` 报告目标色域裁剪。输入／输出合计不超过 128 MiB。无感知映射、黑点补偿、CMYK/Lab、LUT profile、显示器软打样或印刷分色。资源结果需调用方释放；将结果转为 RGB8 后才可进入现有像素编辑链路。

## 分块合成

CPU 合成按 256×256 核心区域处理，分组与剪贴合成的中间缓冲也缩小到区域范围；画布逐块提交，避免额外创建整幅最终 CPU 合成图。蒙版、调整层、混合模式、Blend If 与智能滤镜沿用一致的计算路径。

描边、阴影模糊与偏移的影响范围沿图层树累加，用扩边区计算后裁切，避免块边接缝。支持范围超过分块边长时回退整幅计算，避免重复扩边变成性能退化。ROI API 对越界请求拒绝。测试用不同块尺寸逐字节对照整幅参考实现。

这不是磁盘分页或无限画布：原始图层、画布 backing store、部分智能滤镜／羽化缓存及最终导出仍是密集缓冲；文档尺寸和总像素上限不变。尚未实现脏块依赖缓存、视口优先调度、GPU 分块渲染或超内存文档。

## 验证及兼容声明

- `npm test -w @haiyue/image-editor`：源像素所有权、撤销、项目版本、恢复校验、两代 PSD 往返、分块接缝及高精度相邻码值。
- `npm run test:browser:foundations -w @haiyue/image-editor`：真实 UI 源文档编辑／回写／撤销，PSD 导出／重开，真实 Worker 高精度转换／取消及 IndexedDB 恢复。
- `PSD_NATIVE_PYTHON=<psd-tools Python> npm run test:psd:foundations -w @haiyue/image-editor`：绑定当前浏览器证据、构建及源码指纹，以独立 psd-tools 检查两代 PSD 的嵌入源字节、层结构、缓存及源重合成。
- 现有原生 PSD 浏览器及独立解码矩阵继续验证文字、形状、路径、色阶、曲线、样式和智能变换。
- `node scripts/editor-e2e/rpc-electron.mjs imageEditor`：本地 RPC 智能源读取／替换／撤销、高精度二进制上传／转换／下载，以及 IPC 查询。

Photoshop 实机打开、编辑、另存、重绘的验收仍为 **pending-manual-acceptance**。独立解析与数值对照不等同于 Photoshop 认证；见 [验收清单](photoshop-acceptance.md)。

高位深文档模式、16／32 位 PSD 原生读写、全链路高精度历史／滤镜／合成、ICC LUT／CMYK 印刷管理、递归智能对象、超内存分块存储属于下一阶段，不能标为本批已完成。

### 本次验证记录

2026-10-09：196 项单元测试通过；第四批、原生 PSD、非破坏性效果、生产工具四组浏览器回归通过；Electron IPC／RPC、仓库边界、产品描述符和构建产物验证通过。构建 `f2a2bcb1c418cd06478149d25b8c742ce57871f72d28bd0a58c2df197feba7c0` 为 815,513 B raw／324,862 B gzip，无需调整原有 330,000 B gzip 预算。

独立 psd-tools 检查中，两代文件的嵌入 PSD 字节一致，缓存合成像素一致；源图层强制重合成最大 Alpha 差为 1，预乘 RGB 差约 1.42（8 位码值）。原有四例原生 PSD 独立矩阵亦通过，无解码警告。

`node imageEditor/scripts/check-tile-performance.mjs` 在三个独立进程样本中比较 1536×1536、三层分组、五个像素层的输出哈希，全部一致。本机整幅参考耗时 534–808 ms、峰值 RSS 88–89 MiB；分块耗时 615–698 ms、RSS 76–91 MiB。该小型诊断没有证明稳定的耗时／RSS 改善，只验证分块路径的正确性与局部缓冲架构，不作为正式性能收益或发布基准证据。原始数据位于 `artifacts/foundations/tile-diagnostic.json`。

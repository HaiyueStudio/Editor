# 分项图层锁定

`sample_1920×1280.psd` 的 L1 使用 PSD 图层头中的 `transparencyProtected`，不是整层锁定。编辑器现将其导入为 `locked: false, locks: { transparency: true, pixels: false, position: false }`。普通解码和按需解码使用相同映射。

| 开关 | 行为 |
| --- | --- |
| 全部锁定 `locked` | 保留原有整层保护；允许显隐和调整锁定开关 |
| 透明像素 `locks.transparency` | 绘制、填充、渐变、滤镜和原始像素写入保持原 Alpha、透明位置的隐藏颜色和原图层边界；允许移动／自由变换 |
| 像素编辑 `locks.pixels` | 阻止图像像素／内容编辑；允许移动与自由变换；图层蒙版可单独绘制 |
| 位置 `locks.position` | 阻止坐标修改、移动、对齐和自由变换；允许绘制，绘制缓存扩边不视为移动已有像素 |

图层组的限制向子层继承。删除／合并受保护图层需要先解除锁定。锁透明像素时，橡皮擦／清除不会擦出新的透明像素；应用蒙版、修改文字／形状等原生内容需要先解锁，避免原生内容与像素缓存不一致。CMYK 隐藏油墨和 Alpha 同样受保护。

图层面板使用 `hy-checkbox` 提供四个开关；图层列表用着色锁标记部分锁定。`image.document.query` 返回自身 `locked`、`locks` 及包含父组限制的 `effectiveLocks`。公共 IPC／本地 RPC 继续使用现有命令调度，无需新增传输协议。

```json
{
  "operation": "image.layer.update",
  "params": {
    "layerId": "<图层 ID>",
    "patch": { "locks": { "transparency": true, "position": false } }
  }
}
```

`locks` 按字段合并；传 `false` 解除单项锁定。`locked` 是独立整层开关，关闭整层锁不会清除之前设置的分项锁。每次修改进入撤销历史。

PSD 使用图层头透明锁标记和 `lspf` 的 transparency/composite/position 位往返；全三位开启按整层锁解析。artboards 位作为元数据保留，不代表已支持 Photoshop 画板功能。导出自检包含锁定语义。含分项锁的工程保存为 v14，旧工程仍可读取，二进制恢复保留锁定对象。

测试：`test/layer-locks.test.mjs` 覆盖 8／16／32 位、CMYK、分块、层级、API、动作、历史、工程与 PSD 往返；`test/layer-locks-browser.mjs <本地 PSD 路径>` 验证实际导入和 UI。全部使用本地编辑器，不向第三方传送测试文件。

2026-10-10 验收：308 项 Node 测试通过；类型构建、应用校验、仓库边界检查通过。实际 `sample_1920×1280.psd` 完成本地导入、锁定查询、填充与 Alpha 校验、撤销、PSD 导出重开；浏览器验证开关点击与 API 错误回滚，导入兼容提示为空。验收产物位于忽略目录 `artifacts/layer-locks/`。

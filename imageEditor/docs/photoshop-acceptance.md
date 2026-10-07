# P0 Photoshop 实机验收

状态：**pending**。当前自动化运行没有 Photoshop 实机证据。
上游样本中的 Adobe Photoshop 写入器元数据仅说明样本来源，不能替代本次验收。

## 准备

1. 运行 `npm run test:image:p0`，需要独立解码时配置 `PSD_P0_PYTHON`。
2. 记录 `artifacts/p0/report.json` 的源码指纹、运行时间、输入/输出 SHA-256。
3. 记录 Photoshop 完整版本、操作系统、色彩设置、缺失字体和每个打开警告。
4. 原样本位于 `test/fixtures/`；候选输出位于 `artifacts/p0/`。全部使用副本测试。

## 必验路径

| 路径 | 操作 | 验收条件 |
| --- | --- | --- |
| 原生编辑闭环 | 打开 synthetic-original.psd 与 synthetic-edited.psd | 无损坏/修复警告；编辑版保留分组、Unicode 名称、隐藏层、锁定、不透明度与混合模式 |
| 编辑验证 | 检查 Edited 编辑图层 | left=5、top=4；图层左上像素 RGBA=(10,240,80,255)；Screen 图层 opacity=128/255 |
| 二次保存 | Photoshop 将 edited 文件另存为一个新 PSD | 在原型和 psd-tools 中重新读取；检查图层像素、层级与合成输出，记录 Photoshop 新增的资源 |
| 基础真实文件 | 对比 layers、layer-offsets-read 的原件与 codec-roundtrip 输出 | 检查尺寸、图层顺序、偏移、显隐、锁定；比较重新合成的 PNG，而非只看缓存缩略图 |
| 透明边缘 | 对比 groups、layer-mask、effects 等原件与输出 | 放在黑、白底上检查半透明边缘；量化实际视觉差异 |
| 复杂语义 | 对比文字、矢量、智能对象、调整层、图层效果 | 分别测试是否仍可编辑、是否要求修复、重算是否变样；逐项记录，不能用整体可打开替代 |
| 色彩与资源 | 检查含 ICC 文件 | 已知 raw codec 会丢失资源；记录 Photoshop 颜色配置及打开提示，不允许据此批准无损导出 |

`codec-roundtrip` 是研究文件，允许发现不兼容；不能用这些文件覆盖用户原稿。
未提供参考图像时，Photoshop 对比结果保持 pending，不能填写 passed。

## 证据与退出条件

将结果保存到一个新的验收目录，包含版本信息、每例操作记录、原始和重算 PNG、警告截图、
Photoshop 另存 PSD，以及更新后的机器可读验收结果。保留原自动化报告。

P0 正式关闭需要：基础编辑闭环经过 Photoshop 实测、像素和结构差异有明确结论、
ICC/复杂内容的降级和保留边界已确认、未通过项目进入 P1/P3 的明确阻塞项。
如仅具备自动测试证据，状态必须保留为 `pending-photoshop`。

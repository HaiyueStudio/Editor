# Adobe 样本与 Photopea 双向验证

## 官方素材来源

1. [Adobe 帮助中心 Sample files](https://helpx.adobe.com/photoshop/kb/downloadable-plugins-and-content.html)：英语 Windows ZIP 为 `Win_Samples_E.zip`（13.x 旧版教学素材，网页仍提供下载）。包含 Fish、Layer Comps、Smart Objects、Vanishing Point、HDR 五个 PSD，以及其他格式的教学素材。
2. [Adobe Photoshop API SDK](https://github.com/adobe/adobe-photoshop-api-sdk/tree/0df921e63735490b4d7a5b186ac00107a38e59c5/testfiles/input)：固定到提交 `0df921e63735490b4d7a5b186ac00107a38e59c5`，包含 `input01.psd`、`input02.psd`。
3. [Adobe PSD / PSB 文件规范](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/) 用于解释结构。

以上均为官方发布的示例，但没有证据表明它们是覆盖全部特性的认证套件。仓库原有 `fixtures/manifest.json` 中的 ag-psd 样本属于第三方测试数据，应与 Adobe 样本分开标注。公开样本与 ZIP 的大小、来源、SHA-256 固定在 `test/fixtures/adobe-sources.json`；文件仅下载到忽略的 artifacts，不重新分发素材。

## 本次修复

- `sn2P` 对齐渲染标记可保留在原生档案中，不再阻止官方 SDK 样本导入。路径编辑仍使用现有画布描边规则，不能保证与 Photoshop 的像素对齐描边完全一致。
- 读取文档全局光照角度，将黑色正片叠底投影等价映射到黑色普通投影；保留未修改的原生效果、停用项和全局参数。
- 修正 Photoshop 光源角度与画布 Y 方向的映射（90° 光源向下投影），支持小数像素偏移及双线性透明度采样；API 和样式面板都可编辑。
- 没有图层记录但有真实合并图的按需导入文档会创建背景图层，不再打开为空文档。声明没有真实合并图的占位数据仍拒绝。
- 导入结果的 `warnings` 只包含实际存在的文字重排、近似样式、羽化、Blend If 或元数据损失风险；新增 `notes` 保存文件预算、ICC、派生资源等信息。界面分别显示阻塞项、编辑风险及折叠的保留信息。不会为了消除提示而放行未知特性。
- 高位深 ZIP 出错时区分校验失败与解码长度不符，保留严格完整性及输出预算检查。

## Adobe 样本盘点（2026-10-10）

| 样本 | 当前结果 | 主要缺口／说明 |
| --- | --- | --- |
| input01.psd | 4 层可编辑、导出重开通过 | 修复全局光照／对齐标记；文字重排和投影近似仍提示 |
| HDR.psd | 32 位背景文档、导出重开通过 | 原样本只有合并像素；不能用单张 PNG 判定 HDR 数值／显示认证 |
| Vanishing Point.psd | 1 个背景层、导出重开通过 | 已修复空文档问题；此样本没有可编辑消失点结构，不能据此宣称支持消失点工具 |
| Fish.psd | 8 层 RGB 16 位编辑、导出重开通过 | 保留 `LMsk`、效果面板状态和图案预设；原生图层像素逐值一致，见 [Fish 验收](fish-psd.md) |
| Layer Comps.psd | 17 层可编辑、4 个复合可切换 | 已补齐本样本导入与往返；投影／HSL 渲染仍有近似，详见 [图层复合验收](layer-comps-psd.md) |
| Smart Objects.psd | 分层仍阻塞 | 旧式智能对象、`lmgm`、全局蒙版／资源结构 |
| input02.psd | 分层仍阻塞 | 填充不透明度、线性加深、滤镜效果、复杂矢量和超限智能源 |

## Photopea 验证方式与结果

采用 [官方 Live Messaging API](https://www.photopea.com/api/live) 和 [脚本接口](https://www.photopea.com/learn/scripts)：选定文件 → ArrayBuffer 发给 Photopea iframe → 查询文档 → 保存 PNG 与 PSD → 在 Haiyue 重开；另外将 Haiyue 导出的 PSD 发回 Photopea 并比较 PNG。只向精确 Photopea origin 发送，接收消息也核对 origin 和 iframe window。测试服务器仅对此 iframe 测试关闭跨源隔离；编辑器产品及其他测试的隔离默认值不变。

本次只使用上述三个公开 Adobe 样本，没有向 Photopea 发送桌面的私人 PSD。

- **Haiyue → Photopea**：三个样本均能打开。由同一 Photopea 渲染器分别输出原件和 Haiyue 导出文件，PNG 的 RGBA 通道差均为 0。这验证这些文件的结构往返，不能替代 Haiyue 渲染器或 Photoshop 的一致性测试。
- **Haiyue 自身预览 → Photopea**：input01 的 RGBA 平均绝对差为 0.146825，最大 18（范围 0–255）。投影模糊近似仍是实际差异，因此不移除对应提醒。
- **Photopea → Haiyue**：Vanishing Point 可重开；input01 的矢量层被 Photopea 保存为零尺寸、无像素缓存，当前需要实现根据原生路径重建缓存；HDR 的四个 ZIP-prediction 通道均被 pako 和 Node zlib 独立检出 `incorrect data check`。该输出保存为回归证据，不关闭校验来接受它，也不据此概括其他 Photopea 文件。

报告：`artifacts/psd-compatibility/adobe/audit.json`、`photopea/report.json`、`photopea/measured.json`、`ui/browser.json`。包括输入哈希、真实阻塞原因、PNG、PSD 副本和界面截图；不会把“执行完测试”标成“所有兼容测试通过”。

## 复验命令

```sh
npm test -w @haiyue/image-editor
npm run build:app -w @haiyue/image-editor
node imageEditor/scripts/audit-adobe-psd.mjs --fetch  # 首次下载公开素材，校验固定哈希
node imageEditor/scripts/audit-adobe-psd.mjs          # 已有素材时完全离线
CHROME_PATH=/path/to/chrome node imageEditor/test/psd-compatibility-browser.mjs
CHROME_PATH=/path/to/chrome node imageEditor/test/photopea-psd-browser.mjs \
  imageEditor/artifacts/psd-compatibility/adobe/input01.psd \
  imageEditor/artifacts/psd-compatibility/adobe/HDR.psd \
  'imageEditor/artifacts/psd-compatibility/adobe/Vanishing Point.psd'
```

Photopea 是独立的在线互操作测试，不应放入离线单元测试，也不能当成 Photoshop 实机认证。仅传入获准交给该第三方网页的文件。

本次 296 项 Node 测试、类型／应用构建、产物校验、仓库边界检查及三个官方样本的本地 UI 验收通过。UI 验收绑定构建 `9ecc84131e2da642`。下一批优先处理无像素缓存矢量层的重建和 16 位元数据往返，然后按上述官方样本推进图层复合、填充透明度及旧式智能对象。每个特性需要合成单特性用例、官方／真实素材、双向语义检查和渲染误差阈值。

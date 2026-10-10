# Smart Objects.psd 兼容验收

本机样本为 Adobe 旧版教学素材：731 × 469、RGB 8 位、7 个图层，5 个矢量智能对象共享一个 383,196 字节的 `Vector Smart Object.ai`（实际为含 Illustrator 数据的 PDF）。文件大小 1,419,665 字节。

PSD SHA-256：`062bd6c1c651d2570cf2a2f45500bf2e4e387035cc1f995ac485a079099b4bdf`。内嵌 PDF SHA-256：`5f544f9acf2ce3efd8763e3400d9bc0397af6f835849a1a1b638d92c03a80570`。

## 已实现

- 读取旧版 `PlLd` 矢量智能对象；保留内嵌 PDF、共享源 ID、页码、置入四边形及源边界。导出仍为矢量智能对象，不把整个文档合并为图片。
- `lmgm=false` 的蒙版选项、`lyvr`、全局蒙版显示设置、图案及既有资源随原生档案保留。会改变效果／剪贴组合语义的 `lmgm=true` 组合仍明确拒绝。
- 修正旧版置入记录中蒙版矩形使用文档坐标、却带相对位置标志的情况；以旧置入记录缺少源尺寸识别，现代记录的相对蒙版行为保留。
- 支持对象与普通像素蒙版一起缩放、旋转、翻转，蒙版笔刷、透明度和位置编辑，以及撤销。PDF 源字节保持不变，导出的置入坐标随变换更新。
- 替换单个实例为 PSD／图像时脱离原 PDF，其他实例保留原共享关系。撤销恢复 PDF 与蒙版。替换目前是单实例操作，不是同时回写全部共享实例。
- 图层面板新增“导出原始智能源”。对 PDF 输出原始 PDF 字节，PSD／PSB 保持其实际格式。矢量源的“编辑智能源文档”入口禁用并说明应导出到矢量工具。
- 工程 v16 保留 PDF 数据与缓存；支持自动恢复、磁盘换页。修复选择图层后冻结状态丢失原生 PSD 档案访问入口，导致后续撤销失败的问题。

## API

查询 `image.document.query` 时，智能内容增加 `sourceFormat`（`pdf`／`psd`／`pixels`）、`preview`（`cached`／`source`）与原生源字节数。

```json
{
  "operation": "image.smart.source.read",
  "params": { "layerId": "目标图层 ID", "format": "original" }
}
```

返回 `resourceId`、`format`（`pdf`／`psd`／`psb`）和 `name`，通过资源接口读取后释放。原有默认 `format: "project"` 继续返回可编辑工程；PDF 不伪装成可编辑像素源工程。既有 `image.layer.transform`、`image.pixels.stroke`（`target: "mask"`）、`image.smart.source.replace`、`image.history.undo` 和导出命令适用于此次闭环，IPC／RPC 共用相同契约。

## 验收与边界

- 真实文件在浏览器中完成打开、查询、原始 PDF 提取（UI 与 API）、带蒙版变换、蒙版笔刷、替换单个实例、撤销、PSD 导出、磁盘清缓存及刷新恢复。
- 原样导出／撤销后的导出：图层缓存及蒙版像素逐值一致，原始 PDF 字节一致，5 个实例共用原源 ID。原文件哈希保持不变。
- 本地合成与原件内嵌合并图比较，RGBA 0–255 平均绝对误差 0.042793，最大 2；修正蒙版坐标前平均误差为 8.084586。
- 341 项全量单元测试通过；最终原始源导出调整后的 15 项相关回归通过。应用类型／构建、产物校验和仓库边界检查通过。最终浏览器验收构建：`6300443c850dc488`。
- 报告、截图与导出副本保存在忽略的 `artifacts/smart-objects/`；不重新分发原始素材。

当前 PDF 作为原生矢量源保留，**预览及变换使用原 PSD 像素缓存**，没有实现 PDF 矢量重渲染或 Illustrator 内部路径编辑。放大不会自动增加预览细节；导入报告会列出受影响的具体图层。带独立矢量蒙版或羽化的蒙版联合变换仍须先应用蒙版。此次没有进行 Photoshop 实机或 Photopea 在线认证。

结构依据：[Adobe PSD 文件格式说明](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)。旧版蒙版坐标解释同时通过本文件的原生合并图对照验证，不仅依赖标志名称。

## 复验

```sh
npm test -w @haiyue/image-editor
npm run build:app -w @haiyue/image-editor
CHROME_PATH=/path/to/chrome node imageEditor/test/smart-objects-browser.mjs '/path/to/Smart Objects.psd'
```

单元测试为合成结构用例，不依赖桌面文件。实际样本测试单独校验源文件哈希、像素、原生变换和内嵌 PDF 字节。

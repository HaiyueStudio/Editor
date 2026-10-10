# Layer Comps.psd 支持与验收

本地文件 SHA-256：`32ae096f868f4fb3f48fb32ff5aff3a0cbaeb733955e663cc43638b619c6fb01`。它与已登记的 Adobe 官方旧版教学样本相同：400 × 424、RGB8、17 个图层／分组，包含 title、large votives、6 purple votives、small vase 四个图层复合。没有改动原件，也没有把文件发给外部服务。

## 支持范围

- 分块导入原生 `comps` 与文档 Layer Comps 资源；展开稀疏设置为独立快照，切换不会依赖用户上一次切换顺序。位置与可见性在工程、撤销／重做和 PSD 中往返。
- 右侧图层复合面板使用 UI 库的 Select、Input、Button：应用、新建、更新、删除。新建／更新记录可见性与位置。导出重建复合资源与图层 ID，删除的复合不会从旧档案复活。
- 色相／饱和度支持主控 HSL、着色及六色范围参数。`ag-psd` 的 master.a/b/c/d 实际对应 hue2 的着色开关／着色 HSL，通过适配层读取。未修改时保留原描述，包括未激活的主控值；修改后输出标准 hue2。
- 两个矢量字形层分别有 11 和 37 个轮廓，保留贝塞尔节点、合并轮廓与内部孔洞。路径编辑可选择子路径，其余轮廓不会被覆盖；API 同样可更新 contours。
- 读取样式 scale，缩放投影距离和模糊半径，支持小数模糊半径。未修改效果仍输出原生描述。
- `globalLayerMaskInfo.kind=128` 作为逐层蒙版的显示颜色元数据保留，不误判为必须执行的全局像素蒙版。其他 kind 仍不放行。
- 零尺寸常量蒙版映射为等价常量覆盖，不当作缺失像素。按需通道增加 RGB8 ZIP／ZIP-prediction，解压尺寸严格受限，并纳入现有 64 MiB 缓存预算。
- 新能力使用工程版本 15；恢复／磁盘工程继续使用通用像素档案保存。

## API

所有写命令沿用 Platform 的 documentId、expectedRevision、原子提交和历史契约，IPC／本地 RPC 自动复用。

| 命令 | 参数 | 作用 |
| --- | --- | --- |
| `image.comp.list` | `{}` | 返回 list 与 lastApplied |
| `image.comp.apply` | `{id}` | 应用复合，可撤销；遵守位置锁 |
| `image.comp.capture` | `{name, id?, comment?}` | 不传 id 新建，传 id 更新可见性／位置快照 |
| `image.comp.delete` | `{id}` | 删除复合，可撤销 |
| `image.document.query` | `{}` | 新增 layerComps 与扩展后的 content 数据 |
| `image.content.create/update` | `content` | 支持 hue-saturation／hueSaturation 和 path.contours |

着色内容示例：

```json
{"type":"adjustment","filter":"hue-saturation","amount":100,"hueSaturation":{"colorize":true,"hue":-148,"saturation":25,"lightness":0}}
```

## 已知边界

不是 Photoshop 实机认证。四个复合的效果参考点元数据随 PSD 保留，但本轮没有实现不同复合之间的独立样式参数快照；面板新建／更新也不捕获样式差异。当前支持合并轮廓与附属孔洞，独立 subtract/intersect/xor 路径运算仍拒绝导入。

投影使用近似模糊；HSL 采用本地合成模型，未完成 Photoshop 逐像素校准。因此仍按实际层名提示这两项风险。初始合成相对原 PSD 合并缓存的 RGBA 平均绝对误差为 0.812314/255，最大误差 71；均值不能代表局部阴影完全一致。没有其他复合的原软件参考图，不能据此宣称四种外观已获认证。

## 复验

```sh
npm test -w @haiyue/image-editor
npm run build:app -w @haiyue/image-editor
CHROME_PATH=/path/to/chrome node imageEditor/test/layer-comps-browser.mjs '/path/to/Layer Comps.psd'
npm run check:boundaries
```

本地浏览器脚本验证：17 层导入、四个复合 UI 应用／撤销／导出／重开、未编辑的矢量／效果／调整／全局蒙版描述保留、子路径编辑不丢轮廓、孔洞透明像素、HSL 面板编辑、复合新建／删除／撤销和源文件哈希不变。截图、PSD 副本和绑定构建哈希的报告保存到忽略的 `artifacts/layer-comps/`。

本轮验证：329 项 Node 测试通过，类型／应用构建、应用产物校验和仓库边界检查通过；实际文件的便携工程往返保留 17 层、4 个复合和原生档案。另通过 rich-text.psd 的八个文字层及既有路径／智能源浏览器回归。

Node／IPC 的 Buffer 输入会复制为独立 Uint8Array；工程编码统一使用标准类型标签，避免写入无法跨环境恢复的 Buffer 名称，并防止调用方修改源缓冲影响文档。

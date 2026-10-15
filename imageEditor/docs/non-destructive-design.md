# 非破坏性设计：第二批

本批补齐共享智能源、显式外链更新、多层变换、单片贝塞尔网格、常用智能滤镜原生描述，以及七种调整层。所有写命令仍由 Platform 校验 `expectedRevision`，异步准备后原子提交；通过同一 API、IPC、本地 RPC 发现和调用。图像命令共 104 个。

## 智能源与外链

- 复制智能对象保留 `sourceId`；“回写智能源”与 `smart.source.replace` 默认更新同一文档内所有共享实例，保留各自位置、变换、蒙版和滤镜，一次撤销。锁定任一实例则整次更新失败。
- `scope:'instance'` 只替换当前实例并分离共享关系；“独立智能源副本”解除当前实例的共享关系和外链。
- “链接／更新 PSD 源”通过文件选择器显式选择 PSD/PSB，保存源缓存、文件名和逻辑地址。API 可传入路径／URI 作为元数据，**不会自动读取文件系统、访问网络或定时监视文件**。刷新需再次提供资源；浏览器不保存文件读取权限。
- 工程 `.hyimage` 保留外链地址。PSD 副本将外链转换为嵌入缓存源，导出前提示省略链接关系；API 通过既有 `allowRasterize:true` 接受该提示，此情形仍保留分层和智能对象。共享源在 PSD 中只写一份嵌入文件。
- 导入外链 PSD 时，有可解析源缓存才提供源编辑；缺失缓存的外链仍显示具体兼容问题，不尝试按文件里的路径自动加载。
- 源文件沿用 32 MiB、解码 64 MiB、128 层预算；支持多层 PSD/PSB，暂不支持嵌套智能源。原始源文档编辑后清除外链关系，避免误报它仍与磁盘文件同步。

| 命令 | 参数与结果 |
| --- | --- |
| `image.smart.instances` | `{layerId}` → `{instances:[{layerId,name,sourceId,link}]}` |
| `image.smart.detach` | `{layerId}` → `{applied:true}` |
| `image.smart.link.relink` | `{layerId,resourceId,name,uri,scope?:'shared'\|'instance'}`；资源为完整 PSD/PSB 字节 |
| `image.smart.link.update` | `{layerId,resourceId,name?,scope?}`；要求已有 link，保留链接地址 |
| `image.smart.source.replace` | 既有 `{layerId,resourceId,format:'project'\|'psd'}`，新增 `scope`，默认 shared |

`document.query` 的智能内容增加 `link`；源 ID、尺寸、格式、字节数和变换仍可查询。命令不写回外部源文件。

## 变换

多选图层后使用原来的“自由变换”：统一包围框下移动、缩放、旋转，Enter 提交一次历史，Esc 取消。API：

```json
{
  "operation": "image.layers.transform",
  "params": {
    "layerIds": ["layer-a", "layer-b"],
    "width": 1200,
    "height": 800,
    "angle": 15,
    "dx": 0,
    "dy": 0,
    "flipX": false,
    "flipY": false
  }
}
```

`width/height` 为整个选中包围框的新尺寸，围绕原框中心缩放和旋转，`dx/dy` 为文档坐标位移。组与子层重复选择只处理一次。保留组层级、各层相对位置以及智能对象的原始源、透视和已有网格；像素层使用关联 alpha 双线性采样。当前适用于 RGB 像素／智能层及由它们组成的组；包含文字、形状、调整层、蒙版或锁定成员时明确拒绝，需先转换内容／应用蒙版。不会隐式栅格化原生内容。

网格按钮打开 4×4 贝塞尔控制点及图像预览，可拖动或输入坐标。API `image.smart.warp` 接收 `{layerId,points:[{x,y},…]}`，按行 16 点；`{layerId,reset:true}` 移除网格。坐标为源单位矩形上的目标控制点，恒等网格为 `(column/3,row/3)`。它是双三次贝塞尔曲面，不是 16 个独立图像块。使用逆映射、关联 alpha 双线性采样；正 Jacobian 的保守控制网约束拒绝可能折叠的变形。网格可重新编辑、撤销、保存工程，并写回 PSD 的 custom envelope warp。

当前为一个 4×4 patch，不支持 Photoshop 多片 Quilt、木偶变形、折叠网格和 PDF 矢量源网格；带蒙版的网格编辑明确拒绝。网格显示范围为当前变换框，超出框的曲面会被裁剪。分块路径使用 256 像素输出页和有界源页缓存，保留 RGB16/32 精度，不申请整张中间画布。连续路径超过 128 MiB 会拒绝，导入原生智能滤镜时的底图重建仍受该预算约束。

## PSD 智能滤镜

支持参数化原生往返：反相（全强度）、方框模糊、高斯模糊和 USM。保留顺序、启用、混合模式和不透明度；导入时从原始智能源重建底图，避免重复应用 PSD 已滤镜化的缓存像素。导出同时更新原生滤镜描述及缓存通道，流式 PSD/PSB 使用带 halo 的区域滤镜。

空间滤镜叠加缩放、旋转、透视或网格时，因为 PSD 在源坐标应用滤镜、Haiyue 当前在实例位图上应用滤镜，暂不映射该组合。其他滤镜、智能滤镜蒙版、PDF 矢量源上的智能滤镜仍逐层提示，需明确接受合并副本。参数往返不代表 Photoshop 像素级匹配：模糊半径、边缘处理、滤镜相对几何的运算顺序仍需独立视觉对照；Haiyue 当前在实例位图上应用滤镜。尚未进行 Photoshop 实机认证。

## 新调整层

新增曝光度、自然饱和度、色彩平衡、通道混合器、六色黑白、色调分离、阈值。调整面板使用 `hy-input` / `hy-checkbox`，支持重新编辑及撤销；`image.content.create/update` 使用相同模型，PSD 原生导入／导出。图层混合与蒙版继续控制调整作用范围。

新增内容形如：

```json
{
  "type": "adjustment",
  "filter": "exposure",
  "amount": 100,
  "parameters": {"exposure": 1, "offset": 0, "gamma": 1}
}
```

| filter | parameters（必须完整） |
| --- | --- |
| exposure | exposure −20～20；offset −1～1；gamma 0.1～9.99 |
| vibrance | vibrance、saturation，各 −100～100 |
| color-balance | `shadows/midtones/highlights` × `cyanRed/magentaGreen/yellowBlue`，点号连接的 9 个键，各 −100～100；preserveLuminosity 布尔 |
| channel-mixer | `red/green/blue/gray` × `red/green/blue/constant`，点号连接的 16 个键，各 −200～200；monochrome 布尔 |
| black-white | reds/yellows/greens/cyans/blues/magentas，各 −200～300；不含着色模式 |
| posterize | levels，2～255 整数 |
| threshold | level，1～255 整数 |

浮点曝光度保留超白及负数；色调分离／阈值按 SDR 映射。色彩平衡、自然饱和度及黑白使用本引擎的公开算法，参数和图层语义可往返，未宣称 Adobe 渲染器一致性。CMYK 原生文档仍不接受 RGB 调整层。

## 持久化与验证

有外链、网格或新调整层时工程版本为 **18**，恢复版本为 **16**；旧版本读取器拒绝这些新语义，原有工程继续可读。默认共享源写回行为在此批发生变化；需要旧版单实例替换行为的调用者应显式传 `scope:'instance'`。

- `node --test imageEditor/test/design-batch.test.mjs`：非中性调整参数、共享／分离、PSD 去重、原生滤镜不重复应用、网格／HDR、分块与连续一致性、锁定和取消、版本降级保护、公共 API。
- `node imageEditor/test/design-batch-browser.mjs`：真实控件、多选拖动、网格修改、调整面板、撤销、PSD／工程往返、IndexedDB 恢复、命令目录。
- `npm test -w @haiyue/image-editor`、`npm run app:check -w @haiyue/image-editor`、`npm run check:boundaries`。

报告在 `imageEditor/artifacts/design-batch/`。未安装 Photoshop，因此没有 Photoshop 实机结果；也未将同编解码器往返视为独立兼容认证。

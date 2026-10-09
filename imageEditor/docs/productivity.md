# 第三批：生产效率

已实现命名选区／Alpha 通道、参考线与吸附、参数化动作、模板批量导出。共 65 个 image 领域命令，经同一 Platform 队列提供浏览器 API、Electron IPC 和本地 RPC。

## 界面入口

右侧「内容与蒙版」→「通道／生产工具」，切换三个工具页：

- **命名选区／Alpha 通道**：从当前选区、合成 R/G/B 或透明度新建／替换通道；重命名、反相、删除、灰度预览；以替换、添加、减去、相交方式载入选区。软边覆盖率按 8 位灰度保存，载入后可继续生成图层或滤镜蒙版。
- **参考线与吸附**：输入水平／垂直线的位置，可新增、更新、删除并统一应用；独立控制显示、吸附、画布边缘／中心、其他可见图层边缘／中心和屏幕像素容差。参考线随缩放／平移，且不绘入导出图片。
- **参数化动作／模板输出**：提供可编辑动作示例、JSON 定义与本次参数。选择文字层可生成标题模板示例，其他层生成透明度模板。支持导入 JSON 数据行文件，生成逐项下载链接；失败行显示具体错误。耗时任务可取消，关闭面板也会取消未完成请求。

吸附用于移动工具、自由变换的平移和矩形／椭圆／裁剪框终点；多选按整体边界吸附，排除选中层及其子层。按住 Alt 临时绕过。当前不含标尺拖线、旋转后的缩放手柄吸附、可视网格或多画板。

## 命名通道与文档生命周期

每文档最多 32 个通道。每个通道保存唯一 ID、名称和画布大小的 `Uint8Array`：0 未选，255 全选，中间值为部分覆盖。RGB 通道从当前合成的直通 RGB 字节提取；alpha 来源单独提取合成透明度。需要灰度乘 Alpha 的遮罩时请通过资源接口提供明确的灰度数据。

通道缓冲计入 128 MiB 文档像素预算及历史预算；工程自持有输入副本，资源读取不泄漏内部缓冲。裁剪画布会同时裁剪所有通道并平移参考线，作为同一次撤销操作。显示或吸附设置也属于可撤销工程状态。

## 参数化动作

每文档最多 32 个动作，动作库 JSON 不超过 256 KiB；每个动作最多 32 个参数、1–32 个步骤，定义不超过 64 KiB。参数类型为 string、number、boolean，可有同类型默认值。仅完整对象 `{"param":"name"}` 被替换；普通字符串不插值，不执行脚本、表达式、网络请求或递归动作。

`layerId` 可引用确定的图层 ID，也可写 `$selected`，在执行开始时绑定当前选中层。固定 ID 适合同一工程的模板副本，`$selected` 适合在不同层上复用。动作目标不存在、锁定、参数错误或某个步骤失败，原稿保持不变。步骤先在独立文档快照中执行，成功后校验 revision 并一次提交，撤销可整体恢复。

| 步骤 operation | params |
| --- | --- |
| `layer.update` | `{layerId,patch:{name?,visible?,opacity?,blend?,x?,y?}}`，沿用领域命令 patch 结构，不支持动作解除锁定 |
| `pixels.fill` | `{layerId,color?,opacity?,erase?}`，处理像素层并遵守当前选区 |
| `filter.apply` | `{layerId,kind,amount,radius?,threshold?}`，像素滤镜，通过可取消 Worker 计算 |
| `text.replace` | `{layerId,text}`，替换统一样式文字并重新栅格化缓存；含 runs 的富文本明确拒绝，避免错配字符区间 |
| `smart.filters` | `{layerId,filters}`，完整替换智能滤镜堆栈，保留智能源 |
| `layer.transform` | `{layerId,width?,height?,angle?,dx?,dy?,flipX?,flipY?,resampling?}`，沿用现有变换限制 |

示例：

```json
{
  "id": "poster-title",
  "name": "标题版本",
  "parameters": [{"name":"title","type":"string","default":"海上生明月"}],
  "steps": [
    {"operation":"text.replace","params":{"layerId":"文字图层ID","text":{"param":"title"}}},
    {"operation":"layer.update","params":{"layerId":"文字图层ID","patch":{"x":20,"y":20}}}
  ]
}
```

此版本是显式步骤配方编辑器，尚不包含任意 UI 操作录制、条件／循环、跨文档动作、模板动态图片上传槽位或动作间调用。

## 模板批量输出

每批 1–16 行，数据行 JSON 合计最多 256 KiB；成功输出总量最多 128 MiB。每行 `{name,values,width?,height?}` 使用同一原稿快照和已保存动作。参数定义在处理前统一检查；执行／导出中的单行错误单独报告，后续行继续。取消整批不发布部分资源；发布资源时失败会释放之前已创建的句柄。

```json
[
  {"name":"明月版","values":{"title":"海上生明月"},"width":1080,"height":1080},
  {"name":"横版","values":{"title":"天涯共此时"},"width":1920,"height":1080}
]
```

- `.hyimage`：保留图层结构、可编辑内容、蒙版、通道、动作和参考线；只改变副本中的动作目标。不同副本有不同文档 ID，图层 ID 保持稳定。
- PNG／JPEG：默认原画布尺寸；同时指定 width 和 height 时，以双三次重采样按比例缩放（允许放大）、居中适配到精确输出尺寸。PNG 留透明边，JPEG 垫白。输出前需要显式处理未转换的嵌入 ICC。
- PSD：沿用受限原生映射。需要明确 `allowRasterize:true` 才允许省略生产数据；仅在图层本身有不支持特性时合并为像素，不会仅因通道／参考线／动作而强制合并图层。
- 文件名移除路径分隔符和不合法字符，同名追加编号。UI 提供 Blob 下载链接，不自动写入任意磁盘路径；API 返回资源句柄，调用方下载后释放。

## 10 个新增命令

所有命令 target 为 document。除 `channel.read` 外为 write，须传 `documentId` 和 `expectedRevision`。`template.export` 的 write 表示提交输出资源；不修改原稿 revision 或历史。

| 命令 | 输入 |
| --- | --- |
| `image.channel.save` | `{name,source,id?,resourceId?}`；source 为 selection/red/green/blue/alpha/resource，id 表示替换现有通道，resource 为画布大小的 gray8 字节 |
| `image.channel.update` | `{id,name?,invert?}` |
| `image.channel.delete` | `{id}` |
| `image.channel.load` | `{id,mode?,invert?}`，默认 replace |
| `image.channel.read` | `{id}`，返回 gray8 资源、width/height/name |
| `image.layout.set` | `{layout:{visible,snap,canvas,layers,tolerance,guides:[{id,axis,position}]}}`；axis=x/y，最多 128 条，位置整数 ±32768，容差 0–32 屏幕像素 |
| `image.action.save` | `{action:{id,name,parameters,steps}}`，同 ID 替换 |
| `image.action.delete` | `{id}` |
| `image.action.run` | `{id,values?}`，全部步骤为一次历史提交 |
| `image.template.export` | `{actionId,rows,format,allowRasterize?}`；返回逐行 `{name,resourceId,byteLength}` 或 `{name,error}` |

`image.document.query` 增加 channels 元数据、layout 和 actions；不内联通道像素。API 动作／模板进度沿用 Platform 事件，取消沿用公共 requestId 契约。

## 文件版本与 PSD 边界

使用本批字段的工程写版本 **8**，二进制恢复会话写版本 **9**；旧工程仍使用最低必要版本。旧版本标签夹带新字段、损坏通道块、重复 ID、非法尺寸均拒绝。恢复块继续使用 SHA-256 校验与增量去重。

命名 Alpha 通道、参考线与动作本批仅在 `.hyimage`／恢复会话中完整持久化，**尚无 PSD 原生映射**。PSD 导出默认阻止静默省略，界面／API 明确确认后输出副本。外部含额外 Alpha／专色通道的 PSD 仍执行原有准入限制，不声称已支持完整 Photoshop 通道工作流。

## 验证与包体

- `npm --prefix imageEditor test`：通道所有权、历史、裁剪、版本门禁、恢复校验、预算、吸附、参数类型、原子失败、取消、模板隔离、资源发布回滚与 revision 冲突。
- `npm --prefix imageEditor run test:browser:productivity`：真实鼠标吸附／Alt 绕过、通道与文字模板 UI、一次撤销、分层副本、不同尺寸 PNG、实际 Worker 取消、工程重开与 IndexedDB 恢复。
- `node scripts/editor-e2e/rpc-electron.mjs imageEditor`：真实 Electron 沙箱预加载 IPC + 回环 HTTP RPC；通道二进制资源和模板输出下载／释放。
- 同时执行旧非破坏性闭环浏览器回归、typecheck、构建及 artifact validate、仓库边界检查和产品 descriptor 检查。证据位于 `artifacts/productivity/`，绑定构建、源码与运行环境。

本批开始构建为 769,999 B raw／312,636 B gzip。新增通道、布局、动作／模板执行器、UI 和 10 个公共命令后，构建约 803 KB raw／323 KB gzip。核对使用既有 level-9 gzip 验证器，PNG 品牌资产不变，codec ESM、共享模块提取和代码压缩仍开启。试验合并共享模块后仅节省约 0.6 KB，且扩大 Worker 的加载模块范围，因此保留原拆分。gzip 预算由 320,000 调整至 **330,000 B**（+3.125%），raw 保持 1,000,000 B；不修改验证器或排除产物。

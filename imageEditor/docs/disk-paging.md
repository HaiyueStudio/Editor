# 通用异步磁盘换页

图像编辑器的压缩像素现在可以真正退出内存，按需从 IndexedDB 读取。该机制覆盖普通位图、智能对象源、RGB8／16／32 浮点数据、CMYK 分色平面，以及保留原生描述的 PSD 档案。它不依赖 PSD 文件格式，也不会修改导入的原文件。

## 存储与调度

- `diskPager.ts` 提供与图像无关的 `PageStore`、`DiskPager`、`DiskRef` 和 `DiskBlob`。默认后端使用当前站点的 IndexedDB；可注入其他异步字节存储后端。
- 编码数据按最大 256 KiB 分页，以 SHA-256 寻址。读取检查长度和哈希；并发读取同一页共用一个 I/O。读写队列限制并发临时分配。
- 常驻编码页使用 16 MiB LRU。调用方通过 lease 固定操作所需页面，最多保留 128 MiB 编码工作集；完成、失败、取消均释放。没有固定的页面可以淘汰，之后异步读回。取消某个等待者不会取消其他等待者的共享读取。
- 位图按 256 × 256 像素分块，浮点样本按小端编码，CMYK 平面单独保存。块内无损压缩，HDR 数值不经过 8 位量化。
- 每次替换底层存储前先等待磁盘事务完成。写入失败保留原位图；编辑只写修改块，未改块及撤销历史继续共享不可变页引用。存储迁移本身不改变文档修订号。
- CPU 画布、导航器、缩略图、HDR 上传、栅格导出及 Worker 合成／直方图通过异步块读取工作。重绘可取消，避免旧文档的迟到结果覆盖新画面。
- 统一命令在 prepare 阶段加载像素操作所需页面，commit／rollback 释放。查询、历史切换和元数据操作不加载整份像素。跨层仿制同时加载目标与源层。原有同步算法不会被自动重放，防止一次操作产生重复修改。

编码页预算、16 MiB 解码块缓存、64 MiB 全层兼容缓存均为每个 JS 执行环境独立的限制。它们不是整个浏览器的 RSS 上限；画布、输出缓冲、Worker、ICC 和编码器仍有各自开销。

## 启用与 API

超预算且满足按需解码条件的 RGB8 PSD 在导入后自动转入磁盘模式。其他文档可以通过统一 API／IPC／本地 RPC 启用；后续自动恢复会将新增像素写入磁盘。

| 命令 | 行为 |
| --- | --- |
| `image.storage.spill` | 等待当前文档的位图、智能源和 PSD 档案持久化，切换为磁盘引用，并清理未固定缓存 |
| `image.storage.trim` | 清理未固定的编码／解码缓存；不删除磁盘数据、不改变像素 |
| `image.document.query` | `storage` 返回 `mode`、唯一页数、`diskBytes`、源 PSD 大小及 `pager` 统计 |

两个 storage 命令都是文档级 write 命令，沿用 `apiVersion`、`requestId`、`documentId`、`expectedRevision` 契约，参数为 `{}`。`pager` 包含 `reads`、`writes`、`hits`、`evictions`、`residentBytes`、`peakBytes`、`pinnedBytes`、`pendingReads`、`budget` 和 `workingBudget`。`diskBytes` 是该文档引用的唯一编码页大小，不是整个站点的磁盘占用。

内部新代码优先使用 `bitmapRegionAsync`、`compositeRegionAsync`、`forEachCompositeTileAsync`。需要复用同步算法时，用 `withDiskPages` 包住确定的工作集。直接读取尚未加载的 `bitmap.data` 会抛出明确的缺页错误，不能把磁盘描述当作已驻留的位图。

## 恢复与便携文件

恢复清单仍使用 v14，像素由 `page:` 键单独保存。启动只读取清单与少量 `chunk:` 元数据，避免 IndexedDB `getAll()` 把全部像素拉回内存。页写入先于新清单提交，恢复时按实际访问验证页面。

磁盘文档另存 `.hyimage` 时采用便携 v14 包：内嵌清单和所引用的全部编码页，不暴露只能在本机使用的裸引用。打开先验证并安装页面，全部成功后才发布文档。旧工程格式继续可读；没有磁盘引用的工程继续使用原格式。

## 当前边界

- 支持文档总编码数据超过 128 MiB，前提是单次操作工作集在预算内。现有全层滤镜、部分整文档操作与 PSD 编码仍需要完整工作集；超限明确拒绝。这里没有宣称所有算法都已流式化。
- 便携工程导出仍有 128 MiB 编码数据预算，API 资源、画布边长、像素数及图层数上限保持不变。超大便携文件的流式容器属于后续工作。
- 蒙版、选择通道、ICC 配置及智能对象附带的独立 `sourcePsd` 载荷仍受原有内存预算约束。
- 数据依赖当前站点／Electron 存储分区的 IndexedDB 配额。存储被清除或页损坏会明确报错；本地恢复不是外部备份。
- 当前不自动删除历史遗留的 `page:` 页，防止清除仍被撤销历史、其他文档或 Worker 使用的内容。关闭文档不会立即释放磁盘空间；跨文档与历史引用的垃圾回收尚待实现。

## 验证

```sh
npm test -w @haiyue/image-editor
npm run build:app -w @haiyue/image-editor
npm run check:boundaries
CHROME_PATH=/path/to/chrome node imageEditor/test/disk-psd-browser.mjs /absolute/path/to/sample.psd
CHROME_PATH=/path/to/chrome node imageEditor/test/disk-large-browser.mjs
```

单元测试覆盖逐出／冷读取、读取去重、固定页释放、并发取消、损坏／缺页／写盘失败、RGB／HDR／CMYK 精度、共享智能源、撤销重做、便携工程和仅元数据恢复。浏览器验收使用真实 IndexedDB；PSD 验收另外检查原生描述、嵌入 PNG 哈希、源文件不变及导出重开。大图场景包含 40 个 1024² 高噪声 RGBA 图层（160 MiB 像素），编码数据也超过 128 MiB，并检查首／中／尾层冷取色与刷新恢复。报告保存于忽略的 `artifacts/disk-psd` 和 `artifacts/disk-large` 目录。

### 2026-10-10 本机验收结果

281 项单元测试、应用构建／产物校验、仓库边界检查通过。macOS x64 Chromium 验收绑定构建 `0acae064aecc8e3d`：

- 桌面 `sample.psd`：114 层／组、33 文字层、33 智能对象、4 穿透组；编辑、撤销重做、便携保存、恢复、Worker 导出重开及原生描述／源文件哈希检查通过。
- 160 MiB 像素场景：唯一磁盘编码数据 143,907,148 字节。冷恢复阶段 661 次读取、544 次淘汰，编码页峰值 16,639,741 字节；完成并 trim 后常驻／固定／待处理读取均为 0。这是该场景的观测值，不是进程总内存或所有算法的峰值承诺。
- 普通与磁盘模式各通过 9 类交互检查，包括连续矩形／椭圆替换、属性失焦提交、触摸多边形、窄窗口缩放、撤销和工程保存。磁盘读取前先获取指针捕获，释放事件按输入顺序处理，避免异步缺页时丢失鼠标松开。

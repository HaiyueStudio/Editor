# P4 稳定性与本机发布验收

P4 实现自动恢复、资源释放、大图内存优化及 Web／Electron 打包。当前交付为 experimental 本机候选版；Windows/Linux 实机、公开发行签名／公证、Photoshop 实机往返尚未验收。

## 实现

- 恢复数据使用 256 KiB 二进制分块、SHA-256 校验和去重。不可变像素缓冲只指纹化一次；修改图层后复用未变化块，不再每次把整个会话编码为 Base64 JSON。
- IndexedDB 在同一事务中提交清单、新块并回收旧块。任何写入失败（包括同步异常）都中止整个事务；界面显示失败并提供“重试恢复保存”。不会覆盖损坏且无法读取的旧会话。
- 保留单写入窗口锁；最多一个正在写入和一个最新待写入快照。关闭文档后回收不再引用的数据块。兼容读取旧 version 1 恢复副本，下一次正常保存迁移；`.hyimage` 文件格式仍兼容版本 1／2。
- 同尺寸像素修改的历史改用 128×128 区块 XOR 差量，重建时逐字节恢复 RGBA（包括透明像素中的 RGB）。历史不强引用这些操作的旧整幅像素快照；分支与关闭时释放差量。尺寸变化仍用整幅快照，并受既有历史预算约束。
- 画笔只上传变化区域，提交局部笔画时只比较受影响区块；选区、名称、锁定等不改变像素的更新不再重绘主画布。工作位图仍为连续 RGBA，不是完整瓦片渲染架构。
- Canvas 缓存设 64 MiB 像素容量上限，按最近使用淘汰并缩为 1×1；切换／关闭文档及销毁视图时清空。该上限不含缓存键引用的 RGBA、工作画布、浏览器内部开销，不能解释为整个进程内存上限。
- 文档销毁释放图层／选区／PSD 资源和历史；下载 Object URL 在超时／页面退出时撤销。滤镜仅向 Worker 复制目标图层像素及必要的树结构，结果通过 transfer 返回。
- 使用公共 App Kit 生成相同 Web/PWA 和 Electron renderer 树，补齐产品原生打包命令、跨平台候选路径解析和本机启动校验。目录候选包禁用自动寻找签名证书；发行命令仍由部署环境配置签名。

## 验证与复现

在 Editor 根目录执行：

```sh
npm run typecheck -w ./imageEditor
npm test -w ./imageEditor
npm run app:check -w ./imageEditor
npm run test:performance -w ./imageEditor
npm run test:browser:p4 -w ./imageEditor
node imageEditor/test/p4-canvas-browser.mjs
npm run test:browser:p2 -w ./imageEditor
npm run test:browser:advanced -w ./imageEditor
npm run test:browser:selection -w ./imageEditor
npm run test:browser:p3 -w ./imageEditor
PSD_P3_PYTHON=/path/to/isolated/python node imageEditor/scripts/run-p3.mjs
node --test scripts/editor-electron-layout.test.mjs scripts/editor-e2e/browserDriver.test.mjs
npm run check:boundaries
npm run api:check
```

浏览器命令使用 `CHROME_PATH` 指定 Chrome。隔离 Python 依赖见 `scripts/requirements-p0.txt`。原生构建在目标操作系统执行；使用 `npm ci --ignore-scripts` 安装后须先运行 `node node_modules/electron/install.js` 安装锁定的运行时。

```sh
npm run electron:pack -w ./imageEditor
npm run test:electron:p4 -w ./imageEditor
npm run electron:smoke -w ./imageEditor
# 配置目标系统签名环境后生成发行安装包：
npm run electron:dist -w ./imageEditor
```

Web 文件在 `app-dist/`，可部署到独立 origin 或子路径；使用 HTTP(S) 服务，不能把 PWA 当作 `file://` 页面运行。首次联网访问并完成 Service Worker 缓存后才具备离线启动能力。
桌面候选位置记录在 `.electron-candidate.json`，不上传或发布安装包。

证据保存在 `evidence/p4/`，包含构建哈希、源码／脚本指纹、平台、样本与时间；`artifacts/p4/` 为可重新生成的输出。旧阶段报告保留原先的构建身份，不替换为新版本的结论。

自动测试覆盖：

- 存储额度异常发生于清单写入之后：整个事务回滚，重试保存最新像素，旧块回收。
- 关闭 HTTP 缓存并断网，重新加载整个应用，恢复后继续滤镜、撤销／重做和 PSD 导出。
- 连续 6 轮关闭／重开文档后的 IndexedDB 块回收。
- 强制 GC 后 24 笔像素修改的精确撤销／重做，20 轮大位图文档销毁及缓冲回收。
- Canvas 缓存实际淘汰、画布销毁、2K／4K 渲染与 30 帧缩放诊断。
- 原生 `.app` 中 Node 全局不可见、冻结的关闭桥、滤镜／PSD Worker、IndexedDB 恢复和 4 图层 PSD 再打开。
- 7 份导出经独立 `psd-tools 1.10.9` 验证；这不替代 Photoshop 实机验收。

## 性能范围

固定工作负载为 2048×2048／20 图层和 4096×4096／50 图层；各包含一个满画布背景，其余为 64×64 裁剪素材图层。报告明确记录实际像素量、24 笔局部画笔的端到端 CPU 时间、撤销／重做、首次／重复恢复编码、进程内存采样，以及独立浏览器渲染和缩放帧间隔。

原规划中若每层都是满画布，两档分别需要 320 MiB 与 3200 MiB 原始 RGBA，超过既定 128 MiB 文档预算，均验证为拒绝。没有扩大预算，也没有把裁剪素材布局冒充满画布多层测试。

本机诊断设备为 Intel Core i7-9750H、16 GiB、macOS x64、Node 24.19.0。具体数值见 `performance.json` 和 `canvas.json`；当前尚无固定参考设备的跨平台性能门槛，报告里的 passed 表示正确性／资源断言通过，并不表示达到了交互流畅度指标。4K 仍有整幅工作缓冲复制及 CPU 编解码开销，完整分块工作存储、GPU 合成和更大的像素预算继续留作后续优化。

恢复保存有 350 ms 防抖；页面隐藏和离开前会尽力提交，不能保证操作后立刻断电时尚未提交的数据。浏览器配额／清理策略也可能移除本地数据，工程文件仍应独立保存。公开发行还需 Windows/Linux 实机、目标平台签名／macOS 公证及 Photoshop 实机验收。

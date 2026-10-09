# Haiyue 共享品牌图标

`haiyue-moon.png` 复用 `Native/bridge/branding/assets/haiyue-moon.png` 的 384 px 透明发布版本，与海月引擎共用冰蓝琉璃月牙。素材来源及生成记录见 Native/bridge/branding/README.md。

为保持新增图像编辑功能后的 300,000 B gzip 包体上限，对 PNG 执行无损重新编码：129,565 B → 104,340 B。保持原始 RGBA8 像素及所有非 IDAT 块；仅重新选择 PNG 行预测器并执行 zlib level 9 / memLevel 9 / strategy 1 压缩（候选预测器按已有压缩上下文与后 8 行选择）。未调整尺寸、颜色、透明度或隐藏 RGB。

解码后 RGBA SHA-256：`32daa987be0754e68575bbaf803fb00522d52edb1b84c0d04c83d91a9e4181ee`。本地复制支持独立离线打包，无跨仓库运行依赖。

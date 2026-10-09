# Haiyue Shader Editor

独立的 Shadertoy 风格编辑器产品。首页 Gallery 和 WGSL 编辑页共享一个工程；渲染使用
`@haiyue/engine` 的 WebGPU 设备、画布、帧循环、Scene、BasicMaterial 和 OrbitControl。
只使用公开包导出，不依赖相邻仓库源码。Web/PWA 与 Electron 通过 Editor App Kit 使用同一构建产物。

## 启动

在 Editor 仓库根目录（Node.js 22+）：

```sh
npm install
npm run build:foundations
npm run preview:shader
```

预览默认地址为 `http://127.0.0.1:4174`；可用 `EDITOR_APP_PORT` 更改端口。
首次安装 Engine/UI 本地候选包的流程见仓库根 README。

```sh
npm run electron:start -w ./shaderEditor
npm run typecheck -w ./shaderEditor
npm test -w ./shaderEditor
npm run test:browser -w ./shaderEditor
npm run test:electron -w ./shaderEditor
npm run check:boundaries
npm run release:artifact:check
```

## 创作与保存

- Gallery 包含五个可编辑示例：Aurora ribbons、Liquid chrome、Neon passage、Afterglow、Key light。
  缩略图在进入 Gallery 时通过真实 Haiyue GPU 渲染生成，直接加载编辑页后返回也会生成。
  生成中或失败时显示状态占位；单个示例失败不会阻塞其他预览，重试只补齐缺失的截图。
  页面切换复用正在进行的任务和已成功的截图。打开示例会创建独立副本。
- CodeMirror 提供 WGSL 高亮、行号、撤销/重做、查找、括号匹配、补全与行内诊断。
  Ctrl/⌘+Enter 编译所有已启用 Pass；可以选择自动编译。
- Common 标签页编辑共享 WGSL 函数、常量、结构体和私有变量；编译时加入所有启用的 Buffer / Image。入口 `mainImage` 留在各个 Pass。Common 没有自己的纹理通道，其函数读取调用 Pass 的内置变量和绑定；私有变量按像素/Pass 独立，跨 Pass 通信仍使用 Buffer。错误会定位到 Common 或原 Pass 行号。Afterglow 示例演示共用坐标函数。
- 工程增加 `common` 字符串（最多 100,000 字符）；旧 version 1 工程缺省为空，保存/导出/重新打开均保留公共代码。
- 每个 Pass 定义 `fn mainImage(fragCoord: vec2f) -> vec4f`。坐标以像素计，原点在左下角。
  不需要自定义 entry point 或资源声明；`hy_` 为编辑器内部前缀。
- 每个 Pass 有四个输入，支持内置素材、PNG/JPEG/WebP 图片、视频、键盘纹理、六面 Cubemap 或 Buffer A–D。
  选择 Buffer 会自动启用；禁用时清空引用它的通道。图片可在多个 Pass/通道复用。
  Buffer 通道显示该 Buffer 最新输出的实时缩略图，保留 A/B/C/D 标识；暂停、单步和重置同步更新。
  缩略图保持画面比例、直接复用 Haiyue GPU 纹理，不额外运行 Shader 或读取整张图像。
  播放时最多每秒刷新 8 次；Buffer 的 alpha 可能存放数据，缩略图按不透明 RGB 显示。
- 点击「保存作品」或按 Ctrl/⌘+S 才保存到「我的作品」（当前浏览器、当前来源的 IndexedDB）。
  打开示例、新建、导入、修改、运行及返回 Gallery 都不会自动保存。已保存作品的后续修改也需再次保存。
  返回 Gallery 时当前草稿仍保留在编辑页；保存操作同时截取当前预览。导出 `.hyshader` 可备份完整工程和上传的图片。
  导入工程会创建副本；不会覆盖现有 Gallery 作品。PNG 导出为 Image Pass 的原始输出。
- 全屏 Canvas 和 3D 场景可随时切换。3D 模式将 Image 输出作为 Haiyue BasicMaterial 的纹理，
  提供球体、立方体和圆环。OrbitControl 支持旋转、缩放和平移；暂停 Shader 不会冻结相机。
  此模式是程序化纹理的材质预览，不是顶点位移或自定义 PBR 光照编辑器。
- 编译是原子替换：全部 Pass 和图片准备完成后才生效。失败保留最后一次成功预览。
  修改代码或切换工程使旧的异步编译结果失效。错误行号已减去编辑器包装代码。

示例：

```wgsl
fn mainImage(fragCoord: vec2f) -> vec4f {
  let uv = fragCoord / iResolution.xy;
  let color = vec3f(0.5) + 0.5 * cos(vec3f(iTime) + uv.xyx + vec3f(0.0, 2.0, 4.0));
  return vec4f(color, 1.0);
}
```

GLSL 转换支持 `tanh(float/vec2/vec3/vec4)`，直接映射为 WGSL 同名内置函数。

## 内置图片、视频与键盘

通道菜单包含 8 张可直接使用的图片：两种尺寸的 Noise、两种尺寸的 RGBA Noise、Blue Noise、
MSDF 字符图集，以及 512×512 的未来城市、WebGPU 原创图标。
内置图片只保存稳定 ID，随 Web/PWA/Electron 一起打包，离线可用；不会复制进每个工程。
两张新增图由内置 image_gen 生成并缩至 512×512，完整提示词见 [生成记录](assets/generated-images.json)。
为容纳用户提供的无损噪声图与 MSDF，产物预算调整为 10 MB raw / 8 MB gzip。

「上传视频」接受 MP4 / WebM，每个文件最多 24 MB、最长边 4096；实际编码支持取决于浏览器。
视频静音循环，跟随预览的播放、暂停、单步、重置；离开编辑页或隐藏窗口时暂停。
单步等待媒体异步解码后刷新画面，视频按自身帧率采样；同一资源在多个通道复用同一帧。
保存与导出包含视频数据。没有音频输入，也不接受远程视频 URL。

「键盘」是 256×3 的二维纹理，红色通道为 0 或 1，使用常见键码（A–Z 为 65–90、0–9 为 48–57、
空格为 32、方向键为 37–40）。点击预览画布后才接收按键；离开画布或窗口会释放按住状态。
编辑代码和 Ctrl/⌘ 快捷键不会输入纹理。重置会清空全部状态。

| 从左下角起的行 | 含义 |
| --- | --- |
| 0 | 当前按住 |
| 1 | 本次按下，仅持续一个渲染帧；系统自动重复不重触发 |
| 2 | 每次按下在 0 / 1 间翻转 |

采样像素中心：`channel0(vec2f((f32(key) + 0.5) / 256.0, (f32(row) + 0.5) / 3.0))`。
GLSL 的 `texelFetch(iChannel0, ivec2(key, row), 0).r` 也可直接翻译使用。
原生 WGSL `textureLoad` 使用左上角坐标，应取行 `2 - row`。

Gallery 的 **Key light** 示例将键盘接入 Buffer A，保存最后按下的 A–Z / 0–9；
Image 使用所提供 msdf.png 的 Alpha 有符号距离绘制字形（小于 0.5 为内部），并用屏幕导数抗锯齿。
该图片 RGB 中位数会在字形外产生色块，因此示例明确使用经验证的 Alpha 通道。
图集为 1024×1024，16×16 网格，每格 64×64，字符编码从左上角逐行递增。
打开后默认显示 A，点击画布按键即可替换，松开后保留字母。

## 内置变量和纹理

| 名称 | 类型 / 含义 |
| --- | --- |
| `iResolution` | `vec3f(width, height, 1)`，当前 Pass 的像素尺寸 |
| `iTime`, `iTimeDelta` | `f32`，从零开始的播放时间和本帧间隔（秒）；暂停时不增加 |
| `iFrame` | `i32`，从 0 开始的 Shader 帧编号 |
| `iFrameRate` | `f32`，本次模拟步长的倒数，暂停时为 0 |
| `iMouse` | `vec4f`，xy 为左键拖动位置；zw 为按下位置，松开后为负；左下角像素坐标 |
| `iDate` | `vec4f`，本地年、月（1–12）、日、当日秒数 |
| `iSampleRate` | `f32(44100)`，Sound 合成采样率；当前不支持音频输入 |
| `iChannelResolution` | `array<vec3f, 4>`，空通道为零 |
| `iChannelTime` | `array<f32, 4>`，Buffer 对应帧时间；视频为当前播放时间；静态图片和键盘为 0 |
| `iChannel0`–`iChannel3` | 根据通道绑定为 `texture_2d<f32>` 或 `texture_cube<f32>` |
| `iSampler` | 重复、线性过滤的 `sampler` |
| `channel0(coords)`–`channel3(coords)` | 二维纹理传入 `vec2f` UV；Cubemap 传入 `vec3f` 方向；返回 `vec4f`，显式 LOD 0，可在非一致控制流中采样 |

原生 `textureSampleLevel(iChannel0, iSampler, uv, 0.0)` 使用 WebGPU 左上角 UV 原点。
二维通道的 `channel0(uv)` 等辅助函数负责翻转 Y。上传图片和 framebuffer 使用相同约定。

通道卡片的「上传立方体贴图」分别选择 **+X、−X、+Y、−Y、+Z、−Z** 六个面。
它们必须是尺寸相同的正方形；上传失败不添加部分资源，成功后绑定当前通道。
通道缩略图显示六个面，其他 Pass 可从同一来源列表复用，保存/导出包含全部面图片。
Cubemap 按原图方向上传、不翻转 Y；方向向量直接交给 GPU，不应用二维 UV 翻转。
`iChannelResolution` 对 Cubemap 返回单面 `vec3f(width, height, 1)`。
目前图片、Cubemap 和 Buffer 都只有基础 mip 层，不自动生成 mipmap；`textureLod` 仍传递原始 LOD，
采样会限制在可用层级。Cubemap 输入可与二维图片和 Buffer 在四个通道中任意混合。

例如先将 iChannel0 绑定 Cubemap，再编写：
```wgsl
fn mainImage(p: vec2f) -> vec4f {
  let rd = normalize(vec3f((p * 2.0 - iResolution.xy) / iResolution.y, 1.0));
  return channel0(reflect(rd, vec3f(0.0, 1.0, 0.0)));
}
```

Pass 顺序固定为 **Buffer A → Buffer B → Buffer C → Buffer D → Image**。
前面已经执行的 Buffer 读取本帧；自身或后面的 Buffer 读取上一帧。这支持自反馈和交叉反馈，
不会在同一 render pass 中同时采样/写入同一纹理。每个 Buffer 优先使用两张 **RGBA32F** 纹理，
以保留相机矩阵、位置、深度等反馈数据的精度，避免半精度量化导致重投影拖影。
通过 Haiyue 的公开 GPU provider 请求设备支持的 `float32-filterable` 特性，保留线性过滤。
不支持该特性的设备使用 RGBA16F 兼容模式，并在编译诊断中显示精度提示；运行状态的
`bufferFormat` 字段可查询实际格式。Image 使用 RGBA8 输出。首次使用、成功编译、重置时间或改变分辨率会将反馈纹理清零。

暂停、继续、重置和逐帧按钮分别控制模拟时间；逐帧步长为 1/60 秒，长帧间隔上限 0.1 秒。
预览缩放为 100% / 50% / 25%，实际尺寸额外限制为最多 1,048,576 像素、最长边 2048。
画布栏显示实际 Shader 分辨率。每张图片最多 8 MiB / 4096×4096，最多保存 16 个纹理资源（每个 Cubemap 算一个资源），
当前使用图片总像素最多 16,777,216；工程文件最多 48 MiB，每个 Pass 代码最多 100,000 字符。

## 共享 UI 与可调布局

布局使用 `@haiyue/ui` 的 `ge-split`，支持拖拽/方向键调整预览与代码、画布与纹理、
代码与编译输出三个分区，比例按屏幕方向保存在本地。窄屏自动改为上下排列。
分辨率、预览物体和纹理来源使用共享 `ge-select`，自动编译与 Pass 开关使用
`ge-checkbox`；统一主题变量同时覆盖下拉选项的背景、文字和选中状态。

## GLSL 导入的范围

编辑器中粘贴 Shadertoy 单个 Pass 的 GLSL，先检查翻译结果，再应用到当前 Pass。
GLSL 输入区使用 CodeMirror，支持语法高亮（含宏与 Shadertoy 内置变量）、行号、
括号匹配、查找和撤销；Ctrl / ⌘ + Enter 翻译。修改源码后须重新翻译才能应用。
转换结果使用只读 WGSL 高亮编辑器，可选择复制；转换提示、警告和错误在独立提示区显示。
导入器使用词法分析和带类型的表达式/语句解析，不是直接字符串替换。

支持 `mainImage(out vec4, in vec2)`、标量/向量、常量、辅助函数、常用数学函数、
if/else、for/while、swizzle、`texture/texture2D/textureCube/textureLod`、`textureSize`、`texelFetch`。
处理 GLSL 的标量/向量提升、可变参数副本、早退以及 swizzle 多分量赋值。

支持只读 GLSL 内置量 `gl_FragCoord`（`vec4`），可在入口、辅助函数及可变全局初始值中读取。
转换器仅在实际引用时生成私有坐标变量，在每个像素的全局初始化之前赋值；`.xy` 与
`mainImage` 原始像素坐标一致，以左下角为原点并保留半像素中心，不受修改入口参数的影响。
适用于 Image 与所有 Buffer，按当前渲染分辨率更新。当前全屏绘制对应 GLSL 的 `.z=0.5`、`.w=1.0`；
3D 材质预览中的 Shader 仍生成这张二维纹理，坐标不表示物体表面的深度。
`res` 等原作自定义别名仍由源代码声明，例如 `#define res iResolution`。

支持 `sampler2D` / `samplerCube` 作为只读函数参数，包含嵌套传递、函数重载、原型和 precision 限定。
分别转换为 WGSL `texture_2d<f32>` / `texture_cube<f32>`，复用通道已有的 `iSampler`。
显式 `uniform samplerCube iChannel0;` 或 `uniform sampler2D iChannel0;` 复用内置绑定，不生成重复资源，可用逗号声明多个通道。
未绑定通道时可从 `texture(iChannel0, reflect(rd,n))` 的三维方向、`textureCube` 或唯一匹配的
`samplerCube` 辅助函数参数推断 Cubemap，翻译结果提示需要绑定六面图片。
界面自动读取当前 Pass 的已绑定类型；API 指定 `pass` 时同样读取该 Pass。
显式声明、实际绑定和使用方式冲突时返回 GLSL 行列错误，不把三维方向截成二维坐标。
存在仅采样器类型不同的重载时，请先绑定对应通道或显式声明 uniform。
独立 `shaderEditor.translateGlsl(code, {channelTypes:['cube', null, '2d', null]})`
也可指定四路类型；`null` 表示允许推断。结果的 `channelTypes` 返回四路实际翻译类型。
Cubemap 类型还会写入生成 WGSL 顶部的 `// @haiyue-channel iChannel0 cube` 标记，
因此只复制 WGSL、使用 `shader.code.set` 或保存/导出工程也能保留。
尚未绑定的 Cubemap 通道使用不透明黑色六面占位纹理，编译成功并提示上传；
它的 `iChannelResolution` 仍为零。上传并绑定真实 Cubemap 后直接运行即可。
如果绑定了普通图片或二维 Buffer，会指出该 Pass 和通道的类型冲突，保留上次成功预览。
旧转换结果没有类型标记时，请重新翻译并应用一次，或先绑定六面贴图。
自定义全局纹理名需用 `#define source iChannel0` 映射到通道，纹理由通道面板绑定。
`texture` / `texture2D` / `textureCube` 沿用第 0 层采样，`textureLod` 传递显式层级；`textureSize` 返回 `ivec2`，
`texelFetch` 仅接受二维纹理的整数像素坐标。二维采样和像素读取保留左下角坐标原点；Cubemap 保留三维方向，坐标和层级表达式只求值一次。
当前运行时只创建基础 mip 层；未扩展采样器数组、整数纹理或自定义过滤器。
采样器不能作为局部变量、函数返回值或赋值目标，也不能参与数值运算。

支持 `mat2` / `mat3` / `mat4` 及所有 2–4 列、2–4 行的 `matCxR` 浮点矩阵，
对应 WGSL `matCxRf`。遵循 [GLSL ES 矩阵构造与运算规则](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)：
单个标量只填对角线；标量/向量混合参数按列填充；矩阵扩展时新增区域补单位矩阵，缩小时保留左上区域。
支持矩阵与矩阵、矩阵与向量的乘法（包括 `uv *= rotation`）、标量运算、逐元素除法、
相等/不等比较、`m[column][row]` 和列向量 swizzle 读写。支持 `transpose`、`determinant`、
`inverse`、`matrixCompMult`、`outerProduct`，以及 `vec4(mat2(...))` 等显式展开转换。
逆矩阵通过余子式与行列式生成，奇异矩阵的结果与 GLSL 一样未定义。矩阵变量也支持全局初始化和函数重载。
全局 `const` 构造保持常量表达式；运行时通过辅助函数避免重复求值构造参数和读写下标。

支持前置/后置 `++`、`--`，包括整数、浮点、向量、矩阵及其可写分量。独立的浮点增减语句
转换为 `+= 1.0` / `-= 1.0`，整数保持 WGSL 的后置增减语句。增减出现在表达式中时，
生成返回旧值或新值的辅助函数，保留短路条件、循环条件和 `continue` 的执行语义；
带副作用的下标和函数实参只求值一次。常量、只读内置量和不可写表达式不能增减。
支持局部、全局及 `for` 初始化中的逗号分隔声明，例如
`vec2 b = floor(n), f = smoothstep(vec2(0.0), vec2(1.0), fract(n));`
会按顺序拆成两条 WGSL 变量声明。`for` 的多个初始化变量仍限制在循环作用域内。
也支持语句中的逗号序列，例如 `if (h.id == 2) c = vec3(.2), sp = 3.;`：
两条赋值按顺序保留在同一个 `if` 分支内。普通语句、`if/else`、循环体、`switch` 分支，
以及 `for` 初始化/更新中的赋值、函数调用和增减序列均可使用；`continue` 仍执行整组循环更新。
函数/构造函数的参数分隔逗号以及多变量声明保持各自语义。
重复分号产生的空语句会自动忽略；`for (;;)` 的分隔符，以及 `if` / `while` / `for`
后有意保留的空语句体仍按原语义转换。

支持三元表达式 `condition ? a : b`，包括嵌套、宏展开、初始化、函数实参、返回值、
数组/向量/矩阵下标，以及循环条件与更新表达式。遵循
[GLSL ES 三元运算规则](https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html#expressions)：
条件必须是 `bool` 标量，两分支类型一致；支持标量、向量、矩阵和 `void` 函数调用结果，
不能直接选择 `sampler2D` / `samplerCube`。结果不可作为赋值或 `out/inout` 目标。
转换器仅对能证明可安全提前求值的标量/向量分支生成紧凑 `select`：条件也必须安全，支持字面量、变量读取、构造、swizzle、白名单算术/比较，以及除以已知不小于 1 的有限常量。未知函数、动态下标、采样、可能不安全的算术仍保守处理。
其他运行时三元表达式生成包含 `if/else` 的辅助函数，只计算一次条件且仅执行选中分支；
分支中的增减、纹理采样、`out/inout` 回写和 `discard` 都保留原执行位置。不能无条件用 `select` 替换所有三元表达式，因为它会提前求值两个分支。
全局 `const` 保持 WGSL 常量表达式；矩阵按列选择，字面量布尔条件直接保留选中分支。

支持 GLSL `isnan` / `isinf`：`float` 返回 `bool`，`vec2/vec3/vec4` 返回对应的
`bvec2/bvec3/bvec4`，并支持 `any(isnan(v))`、`all`、`not`、布尔向量声明、构造、
分量读取/赋值、索引、函数参数与返回值。通过 `bitcast` 检查 f32 的位模式，参数只求值一次。
可用于常量、可变全局初始化、短路条件、三元表达式及带副作用的函数调用。
按照 [GLSL 内置函数定义](https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html#common-functions)，
NaN 与正负无穷分别分类；同时遵循 [WebGPU 浮点限制](https://www.w3.org/TR/WGSL/#floating-point-evaluation)：
无效运算不保证生成或保留 NaN/Inf，因此不能承诺与所有 Shadertoy 后端逐像素一致。

支持整数移位 `<< / >>`、按位运算 `& / | / ^ / ~` 及复合赋值
`<<= / >>= / &= / |= / ^=`，按 GLSL 优先级解析。移位保留左操作数的类型：
有符号右移保留符号，无符号右移补零。根据 [WGSL 位运算规则](https://www.w3.org/TR/WGSL/#bit-expr)，
移位次数转换为 `u32`，向量移位转换为对应的 `vecNu`，标量次数只计算一次再广播。
按位运算要求整数符号类型一致，支持标量/向量组合；浮点、布尔和不匹配的向量会报告源位置。
常量计算按 32 位处理，支持 `1 << 31`、`~0u` 和整数 `case` 标签；已知移位次数超出 0–31 会拒绝。
复合赋值保留动态下标、swizzle、循环更新和实参的求值次数。整数结果放入 `vec2/vec3/vec4`
时自动转换各分量，例如 `vec2((5493>>sh)&3,(10903>>sh)&3)` 输出含 `f32(...)` 的 `vec2f(...)`。

支持 `switch / case / default`，选择表达式为 `int` 或 `uint`，只计算一次。
按照 [WGSL switch 规则](https://www.w3.org/TR/WGSL/#switch-statement)生成分支；连续标签合并，
未写 `break` 的 GLSL 分支会补入后续代码，以保留贯穿执行。支持位于中间的 `default`、
条件 `break`、嵌套循环与 switch、指向外层循环的 `continue`，以及函数提前返回（含 `out/inout`）。
GLSL 未写 `default` 时补空分支。共享的分支变量使用独立名称，初始值仍在原位置执行，
花括号内的局部变量保持各自作用域；未初始化变量沿用 WGSL 零值，勿依赖 GLSL 未定义值。
`case` 类型须与选择表达式一致，支持整数文字、常量宏、局部/全局 `const`、
标量转换、算术、三元常量及 `abs/sign/min/max/clamp`；运行时或尚不能求值的常量表达式会报告位置。
重复 `case` / `default`、非法标签或跳转会在转换时拒绝；单个 switch 的贯穿代码展开限制为 100 KB。

非 `const` 的标量/向量/矩阵全局变量转换为 `var<private>`，可在入口与辅助函数中读写。
支持有/无初始值、逗号分隔的多变量声明，以及宏展开后的声明。变量按像素独立，
不会跨像素或跨帧保留；需要帧间状态时仍使用 Buffer 反馈。未提供初始值时使用 WGSL 的零值。
显式初始值按声明顺序在 `mainImage` 开始前计算，此时内置变量已就绪，可引用已声明的
全局变量、`iTime` / `iFrame` 等内置量，或调用已定义/声明的辅助函数（含重载）。
为兼容已有 Shader，导入器允许这类运行时初始化；全局 `const` 仍只能使用常量初始值。
全局变量会加上 `hy_global_` 前缀；同名局部变量或参数仍保持各自的作用域。

支持按参数数量及标量/向量/矩阵类型区分的辅助函数重载，也支持函数原型（包括未命名参数）。
调用按 [GLSL ES 的函数规则](https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html#function-definitions)
精确匹配参数类型：`f(1)` 匹配 `int`，`f(1.0)` 匹配 `float`，需要类型转换时请显式写 `float(1)`。
所有辅助函数按“名称 + 参数数量 + 类型”改名，例如 `shade(float)` → `hy_fn_shade_1_f32`、
`shade(vec2)` → `hy_fn_shade_1_vec2f`；定义与调用同步改写，`mainImage` 保留入口名。
返回类型和参数限定符不能区分重载。重复定义、调用未实现的原型、无匹配签名及递归调用会报告源代码位置。

辅助函数支持 `out` / `inout`，包括标量、向量、矩阵、重载及函数原型。
转换遵循 [GLSL ES 的参数复制规则](https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html#function-calling-conventions)：
`inout` 读取调用时的值，`out` 不读取调用者原值；函数操作独立的局部副本，
在正常结束或提前 `return` 时回写。WGSL 使用内部返回结构携带原返回值和输出参数，
再由调用包装函数写回；允许在表达式、短路条件及循环中调用。
可传入可写局部/全局变量、不重复的 swizzle、向量元素、矩阵列或元素；
动态下标只求值一次，参数按从左到右求值，输出指向同一变量时也保持副本独立。
多个输出重叠时按参数顺序回写（GLSL 本身未指定回写顺序，请勿依赖某一种结果）。
`out` 中未赋值的部分使用 WGSL 零值；GLSL 对该值不作保证，建议完整赋值。
常量、只读内置量、临时表达式和重复分量不能作为输出实参；`sampler2D` / `samplerCube` 仍只支持 `in`。

支持 `#define PI 3.14159` 等常量/别名宏、`#define SQR(x) ((x)*(x))` 等带参数宏，
包括零参数、嵌套调用、反斜杠续行、注释和 `#undef`。宏按源码顺序展开，保留替换内容的
括号和运算优先级；宏名称必须完整匹配，不会改写其他标识符的一部分。
宏正文错误定位到调用处，实参保留自身行列。递归引用停止重复展开；仍未解析的名称会报错。
宏嵌套最多 64 层，展开处理限制为 100,000 次标记操作及 100 KB 文本（含实参预展开）。
界面、`shader.glsl.translate` 操作和 `shaderEditor.translateGlsl()` 使用同一转换器。

支持 `#if / #ifdef / #ifndef / #elif / #else / #endif`，在转换为 WGSL 前移除未启用的分支。
`defined NAME` 与 `defined(NAME)` 检查宏是否存在，包含值为 0 的宏、空宏和带参数宏。
条件支持宏展开、32 位有符号/无符号整数（十进制、八进制、十六进制）、括号、
算术、比较、位运算和短路 `&& / ||`；未求值的操作数不会触发未定义名称或除零错误。
遵循 [GLSL ES 条件编译规则](https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html#preprocessor)：
被求值的未定义标识符会报错，不默认为 0；条件不支持浮点数、布尔文字、函数调用和三元运算。
未启用分支中的普通代码、宏修改、`#error` 和不支持的指令均跳过；启用的 `#error` 返回原始行号及消息。
默认导入上下文为 GLSL ES 300，预定义 `GL_ES=1`、`GL_FRAGMENT_PRECISION_HIGH=1`、
`__VERSION__=300`、`__FILE__=0` 和调用位置的 `__LINE__`。这些宏不能重新定义或取消定义。
条件分支和条件表达式各最多嵌套 64 层，继续共用宏展开的处理上限；不匹配、重复或缺少结束指令会报错。

支持具名 `struct`：成员可为标量、向量、矩阵或先前定义的结构体；支持逗号分隔成员、
声明时构造、整体复制、嵌套成员读写、swizzle/索引、自增/复合赋值、函数参数/返回值、
重载及 `out/inout`。结构体可在全局或块内定义，局部类型使用独立 WGSL 名称并保持作用域；
支持同类型的 `==/!=` 比较及三元选择。未初始化值沿用 WGSL 零值，勿依赖 GLSL 未定义值。
结构体构造按声明顺序为每个成员传入一个匹配类型的值，数组成员已支持，不支持采样器成员、
匿名结构体或在成员列表里直接定义另一结构体（请先定义内部类型，再作为成员使用）。

GLSL 标识符若与 [WGSL 关键字或保留字](https://www.w3.org/TR/WGSL/#reserved-words)冲突，
转换时自动改名，例如 `ref` → `hy_user_ref`；变量、常量、参数、成员及所有引用保持一致。
结构体及辅助函数采用独立生成名称。原始 GLSL、宏、注释和 `reference` 等不同标识符不会被文本替换。

**不是完整 GLSL 编译器**：`#include`、`#version`、`#extension`、`#line` 等其他预处理指令、
可变参数宏、`#` 字符串化、`##` 标记拼接、运行时长度数组及采样器数组、
音频输入、动态 Cubemap 渲染 Pass、全景图自动转换及 Shadertoy 链接自动抓取尚未支持。Sound 音频输出与上传视频输入已支持。
辅助函数须先定义或声明原型再调用；暂不支持重载内置函数。遇到不支持的语法返回原始 GLSL 行列和说明，不应用部分输出。
转换后的代码仍必须通过 GPU 的 WGSL 编译；浮点计算、纹理颜色空间或算法的差异需要作者检查。
多 Pass 源码需分别导入，纹理需在通道面板重新配置。

## GLSL 数组

支持全局/局部定长数组、const 数组、结构体数组及数组成员、数组参数（含 out/inout）和返回值。
声明可写为 `float a[3]` 或 `float[3] a`；逗号分隔变量分别保留自己的维度。

```glsl
const int N = 3;
const float weights[N] = float[](0.2, 0.3, 0.5);
vec2 offsets[] = vec2[](vec2(-1.0, 0.0), vec2(1.0, 0.0));
float grid[2][3];
```

分别生成 `array<f32, 3>`、`array<vec2f, 2>` 和 `array<array<f32, 3>, 2>`。
支持 `T[N](...)` / `T[](...)` 构造、数组花括号初始化、整体赋值、同类型比较及三元选择。
`a.length()` 返回该维度的定长大小；动态索引、自增、swizzle、矩阵元素及 out/inout 写回保留索引的求值次数。
长度必须是可计算的正整数常量（支持宏、const、算术），省略长度时必须由初始化表达式推断。
数组参数和返回值需明确长度，重载按元素类型及各维长度精确匹配。
最多 8 维、65536 个元素；不支持运行时长度、未初始化且省略长度的声明、sampler 数组。
未初始化数组沿用 WGSL 零值；GLSL 中未初始化值和越界访问不可依赖。
验证：`test/glsl-arrays.test.mjs` 与 `test/arrays-browser.mjs`。

## API / IPC

浏览器暴露 `window.haiyueEditor`，沿用 Editor Platform 的带版本、文档 revision 和
资源句柄的操作协议。`window.shaderEditor` 额外提供 `create()`、`open(project)`、
`compile()`、`getProject()`、`getStatus()`、`translateGlsl(source)`；返回的工程是独立副本。

```js
const api = window.haiyueEditor;
console.table(api.listOperations().map(x => x.descriptor));

async function call(operation, params = {}) {
  const doc = api.listDocuments().documents[0];
  const result = await api.execute({
    apiVersion: '1', requestId: crypto.randomUUID(), operation,
    documentId: doc.identity.id, expectedRevision: doc.revision, params,
  });
  if (result.status !== 'completed') throw new Error(result.error.message);
  return result.value;
}

await window.shaderEditor.create(); // 确保编辑页/GPU 已就绪
await call('shader.code.set', {
  pass: 'image', code: 'fn mainImage(p: vec2f) -> vec4f { return vec4f(1.0, 0.2, 0.1, 1.0); }',
});
await call('shader.compile');
await call('shader.preview.set', { mode: 'scene', mesh: 'sphere' });

const output = await call('shader.project.export');
const bytes = api.readResource(output.resourceId);
api.releaseResource(output.resourceId);
// bytes 是完整 .hyshader 文件，由宿主自行保存。
```

| 操作 | 参数 / 返回 |
| --- | --- |
| `shader.query` | `{}`；`common` 公共源码、Pass、代码、通道、资源摘要、编译诊断和运行状态 |
| `shader.glsl.apply` | `{pass, code}`；导入 Common / Image / Buffer / Sound GLSL，保存源码并更新关联 Pass |
| `shader.code.set` | `{pass, code}`；pass 可为 Common、Image、Buffer 或 `sound`（ID 使用小写） |
| `shader.pass.add` | `{pass}`；添加 Buffer A–D、Sound 或 Common 页签，渲染 Pass 自动启用；API 调用不解锁音频 |
| `shader.pass.enable` | `{pass, enabled}` |
| `shader.channel.set` | `{pass, index:0..3, channel:{kind:'none'\|'image'\|'cubemap'\|'buffer'\|'builtin'\|'video'\|'keyboard', assetId?, pass?, texture?}}` |
| `shader.texture.upload` | `{resourceId, name, mimeType}`；返回 `assetId`，随后用 channel.set 绑定 |
| `shader.textures.list` | `{}`；返回内置图片 ID、名称与文件名；通过 `{kind:'builtin',texture:'msdf'}` 等绑定 |
| `shader.video.upload` | `{resourceId,name,mimeType:'video/mp4'或'video/webm'}`；返回 `assetId`，用 `{kind:'video',assetId}` 绑定；键盘直接用 `{kind:'keyboard'}` |
| `shader.cubemap.upload` | `{name, faces:{px,nx,py,ny,pz,nz}}`，每个面为 `{resourceId,mimeType}`；返回 `assetId`，用 `channel.set` 的 `kind:'cubemap'` 绑定 |
| `shader.compile` | `{}`；返回 `{compiled, revision, diagnostics}`，失败时不替换预览 |
| `shader.preview.set` | `{mode:'canvas'\|'scene', mesh:'sphere'\|'box'\|'torus'}` |
| `shader.playback.set` | `{playing:boolean}` |
| `shader.playback.reset`, `shader.playback.step`, `shader.camera.reset` | `{}` |
| `shader.project.open` | `{resourceId}`；导入完整工程到当前文档；UI 会显示编辑页并尝试编译 |
| `shader.project.export` | `{}`；返回完整工程的 `{resourceId, byteLength}` |
| `shader.glsl.translate` | `{code, pass?}`；`pass:'sound'` 转换 mainSound；只翻译，不修改代码；传入 pass 时使用该 Pass 的通道类型，否则根据源码推断 |
| `shader.sound.configure` | `{duration?:1..120, volume?:0..1}`；时长修改后重新 compile，音量立即应用 |
| `shader.sound.export` | `{}`；上次成功合成的 PCM16 双声道 WAV 资源句柄与 mimeType |
| `shader.sound.audible` | `{enabled:false}` 关闭试听；首次开启需用户点击界面的“开启声音”，随后可用 playback.set 控制 |
| `shader.image.read` | `{}`；返回 RGBA8 原始像素资源句柄、宽高及 `origin:'top-left'` |

Pass ID 为 `image`、`buffer-a`、`buffer-b`、`buffer-c`、`buffer-d`。
所有操作使用同一当前文档；写操作必须提供最新 `expectedRevision`，否则返回 `REVISION_CONFLICT`。
工程/图片/像素通过 `putResource/readResource/releaseResource` 传递，不在 JSON 请求中塞入二进制。
CodeMirror 历史用于用户输入；API 替换代码会重建该 Pass 的编辑状态，当前不提供跨 API 修改的工程级撤销。

Electron 构建接入沙箱 preload 的 `window.haiyueEditorIPC`，复用共享 JSON-RPC 主机。
用 `HAIYUE_EDITOR_RPC=1` 或 `--editor-rpc` 启用仅本机访问的 RPC，私有端点信息写入
Electron userData 下的 `editor-rpc.json`。外部 Node 程序可通过
`@haiyue/editor-app-kit/node` 的 `createEditorRpcClient` 调用相同操作，并使用分块资源上传/下载。
浏览器版本不创建网络监听端口。协议及客户端示例见
[Editor 操作和 IPC 文档](../docs/for-ai/editor-platform/operations.md)。

## 生命周期与验证

自定义 WGSL 包装属于产品的动态 Shader 创作代码，不修改 Engine 的生成着色器。
帧 uniform 为 group 0，材质采样器/纹理为 group 2；GPU 资源由产品持有，等待已提交工作完成后销毁。
隐藏 Gallery/浏览器页停止预览。设备丢失显示恢复说明，工程仍可编辑/保存；重新加载恢复 GPU。
不使用隐式 WebGL 回退。

单元测试覆盖工程校验、反馈顺序、诊断偏移、GLSL 子集、宏参数/续行/递归与展开上限、
API revision/资源往返与 RPC 分发。
浏览器测试使用仓库共享 Chrome 驱动，在真实 WebGPU 上验证缩略图、像素输出、编译失败保留预览、
反馈累积/重置、图片上传与四路纹理、UV 方向、3D 切换/OrbitControl、GLSL 宏导入与编译、
共享控件配色/交互、分割拖拽/键盘操作、窄屏布局、高亮/代码输入、保存导出和刷新恢复。
截图和带构建哈希的报告写入 `artifacts/browser/`（不提交生成产物）。

2026-10-07 本地验证：Chrome WebGPU 浏览器流程、嵌套路径/PWA 离线重载、类型检查、
单元测试、构建/产物校验和仓库边界检查通过。Electron 43.2.0 的本机原生测试暂不可验证：
空白页面也出现 renderer `launch-failed`（exitCode 49）和 GPU 子进程 `-1073741515`，
发生在编辑器代码加载之前。保留真实 Electron IPC/RPC 测试，不把浏览器验证记为桌面通过。

## 教程页面

顶部「教程」打开 `#tutorial`，保留既有章节链接，例如 `#tutorial/ellipse`。
提供 **8 个阶段、65 章、65 套独立可运行的 WGSL 练习**：

| 章节 | 阶段 | 主题 |
| --- | --- | --- |
| 01–04 | 看懂每一个像素 | 片元、坐标、颜色、函数与抗锯齿 |
| 05–08 | 用解析式画图 | 圆、椭圆、线段、极坐标与曲线 |
| 09–23 | 2D 距离场建模 | 符号与距离、圆、半平面、矩形、圆角框、胶囊、三角形、多边形、星形、椭圆近似、圆弧、变换、并集/交集/差集 |
| 24–34 | 让图形生长 | 平滑组合、重复、哈希、1D 插值、2D 噪声/fBM/高度图、3D 噪声/fBM、域变形 |
| 35–48 | 走进三维 | 射线、空间切片、Sphere Tracing、球、盒、圆环、圆柱、挤出、法线、半透明球/立方体、体积步进、体素地形与洞穴 |
| 49–52 | 让表面可信 | 光照、软阴影、AO、环境反射 |
| 53–61 | 让画面响应 | 动画、图片、鼠标坐标/拖动、键盘按住/脉冲/切换、Buffer 移动、MSDF、反馈 |
| 62–65 | 完成一件作品 | 距离雾、自发光与色调映射、相机运动、步进成本诊断 |

每章提供独立代码、本章新增内容、三步推导、核心公式、误区、参数对照实验和预期画面。
「查看代码变化」展示相对前置练习的实际行差异；2D 动画从平滑组合分支继续，
三维雾从环境反射分支继续。三维几何和光照逐步累加，代码不再按阶段共用。
多通道练习可分别查看 Image / Buffer A 的完整高亮代码与纹理绑定。

椭圆距离示例使用 64 段折线近似，明确保留误差说明；布尔组合不保证处处是精确欧氏距离。
反射示例使用解析环境，自发光不包含 Bloom，距离雾不包含体积云，相关高级方向保留为扩展任务。
IQ 文章为原作者延伸阅读链接，未转载原文；本地正文和代码阅读不依赖联网或 WebGPU。
「打开练习 · 新草稿」创建可编辑工程，点击保存才加入我的作品；仅阅读教程会保留编辑器草稿。
编辑器左上角返回按钮按照本次进入来源返回：从教程进入回到对应章节，从 Gallery 进入回到首页；按钮提示显示目的地。
鼠标章节说明按住更新坐标、释放保留位置、点击起点与拖动向量；暂停时间仍能响应鼠标。
键盘章节依次讲解三行状态、方向规范化和用浮点 Buffer 按秒累积位置，示例自带通道绑定。
先点击预览画布获取键盘焦点；方向键控制移动，空格切换配色，持续移动章节用 R 单次归中。
目录支持搜索、前后章、章节直达和窄屏布局。

`test/tutorial-browser.mjs` 验证全部 65 个练习的实际 WebGPU 编译及渲染、反馈通道展示、
导航和草稿保留；`test/tutorial.test.mjs` 检查课程完整性、代码差异和有效工程绑定。

体积渲染分为三章：球体解析交点与路径厚度、旋转立方体 Slab 求交、非均匀密度的中点体积积分。
使用 Beer–Lambert 透射率与预乘颜色合成棋盘背景，可切换 alpha/厚度诊断视图；不是只设置固定表面 alpha。
这是带常量源颜色的教学介质模型，不包含折射、Fresnel 表面反射或多次散射。

噪声路线分别讲解可复现整数哈希、1D 线性/平滑插值、2D 四角插值与归一化 fBM、彩色高度图、3D 八角插值和移动切片。
两个体素练习使用同一个有限世界与 DDA 遍历器：先以 2D 高度函数堆叠方块，再以 3D 密度阈值挖洞，展示同一列的实体—空洞—实体。
体素示例默认 50% 预览分辨率；这是一种教学用程序化地形，不包含游戏区块存储、物理或建造系统。

Common 支持相同的 API / IPC 写入：`shader.code.set` 的 `pass` 可为 `common`；`shader.query` 返回 `common` 和当前 `tabs`。`shader.pass.enable` 与 `shader.channel.set` 仅接受渲染 Pass，不能对 Common 配置通道或执行开关。Common 可通过 GLSL → WGSL 导入公共定义，无需入口函数。先导入 Common，再导入各个 Pass；转换时合并 Common 的宏、常量、结构体、数组和辅助函数，支持 Image、Buffer 与 Sound。通过转换窗口修改 Common 后，已导入的 Pass 会从保存的 GLSL 重新转换。工程保留 `commonGlsl` 和各 Pass 的 `glsl` 原文；直接编辑某个模块的 WGSL 会解除该模块与 GLSL 原文的关联。原生 WGSL Pass 可以调用转换结果中显示的 Common 函数名。`shader.glsl.translate({pass:"common",code})` 仅预览，`shader.glsl.apply({pass,code})` 应用并保存关联源码。

### Sound 音频输出

新作品只显示 Image 页签。点击页签旁的“＋”，可以按需添加 Buffer A–D、Sound 或 Common；已有代码、通道引用和启用的 Pass 会自动显示。添加记录随工程保存，空 Common 与暂时禁用的 Pass 也会保留页签，旧工程会自动识别已有内容。

Sound 是独立的音频 Pass，带有短琶音示例。通过“＋”选择 Sound 会自动启用，并在该次用户点击中解锁音频；编译完成后自动播放，无需再点击“开启声音”。仍可静音、暂停或禁用 Sound。仅打开添加菜单、添加 Buffer/Common、导入或重新打开作品不会自动解除静音。
编译或打开作品不会自动开启声音。以 Haiyue 的 GPU 设备在 1024×64 的浮点目标上分块生成采样，再交给 Web Audio 播放。
音频以 44100 Hz 双声道持续分块合成，播放不限制总时长；WAV 导出范围为从 0 秒开始的 1–120 秒，默认 60 秒；GLSL 转换继续遵循现有 100 KB 源码限制。

WGSL 入口：

~~~wgsl
fn mainSound(sampleIndex: i32, time: f32) -> vec2f {
  let tone = 0.2 * sin(6.2831853 * 440.0 * time);
  return vec2f(tone, tone);
}
~~~

Sound 标签页的 GLSL 转换接受 `vec2 mainSound(int samp, float time)`，也接受早期的 `vec2 mainSound(float time)`。
直接调用转换器时传 `{entryPoint:'sound'}`；API 使用 `shader.glsl.translate({pass:'sound',code})`。
返回值 x/y 分别为左右声道振幅，范围 −1 到 1。NaN/Infinity 被置零，超限振幅裁剪。
`sampleIndex` 是从零开始的全曲采样序号，分块边界不会重置；`time`、`iTime` 均为序号 / 44100，`iSampleRate` 为 44100。
Sound 可复用 WGSL Common、常量、结构体和辅助函数；可绑定四张静态图片、内置纹理或 Cubemap，提供 `channel0–3` 和 `iChannelResolution`。
Sound 在播放前预备少量采样，之后按音频时钟持续合成后续分块，已播放分块会释放。不接受实时 Buffer、视频或键盘输入；它也不是可供 Image 读取的音频频谱纹理。
Sound 的 `iResolution` 为合成块大小 1024×64；鼠标、日期和 iFrame 保持零值。

试听使用音频时钟推进图像时间轴。全局播放/暂停、重置与音频联动；离开编辑页或页面隐藏时停止声音并保留位置，
返回后仅恢复用户已经开启的试听。切换作品会关闭试听。播放不受导出时长影响，也不会循环前一段；Shader 的时间持续递增，只有代码自身返回零才自然静音。合成暂时跟不上时暂停音频时间轴，保留下一采样，避免跳过音乐。
编辑代码时保留上次成功合成，全部 Pass 编译和合成成功后才替换；失败或过期结果不覆盖现有音频。
“导出时长”只影响 WAV，修改它不需要重新运行，也不会中断试听；音量是试听增益，不改变导出波形。导出 WAV 为 16 位 PCM 双声道原始合成信号。

兼容字段 `duration` 现在只表示 WAV 导出秒数，旧工程的 16 秒设置不会截断播放。运行状态提供 `continuous`、`bufferedUntil` 与 `exportDuration`。
工程字段 `sound:{id:'sound',enabled,code,channels,duration,volume}` 随 Gallery 保存和 .hyshader 导入导出保留。
旧工程缺省为禁用 Sound。WAV 可用界面导出或 `shader.sound.export` 获取资源；API/IPC 支持代码写入、启用、通道配置、音量/时长及全局播放控制。
`test/sound-browser.mjs` 验证真实 GPU 双声道采样、440 Hz 频率、块边界连续性、两种 GLSL 入口、
静态纹理/Common、试听手势与时间轴、失败保留、WAV 下载以及工程保存恢复。

GLSL 导入支持右结合的连续赋值（如 `a = b = value`、`q.x = q.x = 26-q.x`）以及赋值表达式。内层赋值返回实际写入的值，右侧调用与动态索引仅求值一次；可用于声明初值、函数参数、返回值、条件与循环。三元分支和短路逻辑中的赋值保持惰性求值。

GLSL 的 `texture(sampler, uv, bias)`、`texture2D(..., bias)`、`textureCube(..., bias)` 支持可选的第三个 float 参数，包括 `-100.0`。按 [GLSL ES 规范](https://registry.khronos.org/OpenGL/specs/es/3.2/GLSL_ES_Specification_3.20.html)，bias 是隐式 mip 层级的偏移。当前 Shader Editor 为图片、Buffer、视频与 Cubemap 分配单个 mip 层，因此生成的辅助函数在完整求值坐标和 bias 后，以 `textureSampleLevel(..., 0.0)` 采样；转换提示会注明这一限制。它不等同于 `textureLod(..., bias)`，也不提供多级 mipmap 的偏移过滤效果。

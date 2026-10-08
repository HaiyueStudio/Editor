export interface TutorialChapter {
  id: string; title: string; stage: number; goal: string; intro: string; detail: string;
  formula: string; pitfall: string; exercise: string; references: string[];
}
export const TUTORIAL_STAGES = [
  {
    "title": "看懂每一个像素",
    "description": "从零建立坐标、颜色和函数的直觉。",
    "lab": "coordinates"
  },
  {
    "title": "用解析式画图",
    "description": "从圆、椭圆到线段与曲线，理解图形如何成为函数。",
    "lab": "analytic"
  },
  {
    "title": "2D 距离场建模",
    "description": "把轮廓变成可计算的距离，再组合成复杂形状。",
    "lab": "boolean"
  },
  {
    "title": "让图形生长",
    "description": "重复、噪声、分形叠加与域变形，生成丰富细节。",
    "lab": "warp"
  },
  {
    "title": "走进三维",
    "description": "建立相机与 3D 距离场，用光线步进寻找表面。",
    "lab": "march"
  },
  {
    "title": "让表面可信",
    "description": "从法线出发加入光照、阴影、遮蔽与反射。",
    "lab": "light"
  },
  {
    "title": "让画面响应",
    "description": "时间、纹理、键盘和反馈，把静态图像变成系统。",
    "lab": "feedback"
  },
  {
    "title": "完成一件作品",
    "description": "整合雾、发光、程序化场景与性能诊断。",
    "lab": "scene"
  }
];
export const TUTORIAL_REFERENCES: Record<string, { title: string; author: string; url: string }> = {
  "book-functions": {
    "title": "The Book of Shaders · 造型函数",
    "author": "Patricio Gonzalez Vivo / Jen Lowe",
    "url": "https://thebookofshaders.com/05/?lan=ch"
  },
  "book-shapes": {
    "title": "The Book of Shaders · 形状",
    "author": "Patricio Gonzalez Vivo / Jen Lowe",
    "url": "https://thebookofshaders.com/07/?lan=ch"
  },
  "book-patterns": {
    "title": "The Book of Shaders · 图案",
    "author": "Patricio Gonzalez Vivo / Jen Lowe",
    "url": "https://thebookofshaders.com/09/?lan=ch"
  },
  "book-fbm": {
    "title": "The Book of Shaders · 分形布朗运动",
    "author": "Patricio Gonzalez Vivo / Jen Lowe",
    "url": "https://thebookofshaders.com/13/?lan=ch"
  },
  "iq-2d": {
    "title": "2D Distance Functions",
    "author": "Íñigo Quílez（IQ）",
    "url": "https://iquilezles.org/articles/distfunctions2d/"
  },
  "iq-3d": {
    "title": "Distance Functions · 3D",
    "author": "Íñigo Quílez（IQ）",
    "url": "https://iquilezles.org/articles/distfunctions/"
  },
  "iq-ellipse": {
    "title": "Distance to an Ellipse",
    "author": "Íñigo Quílez（IQ）",
    "url": "https://iquilezles.org/articles/ellipsedist/"
  },
  "iq-ray": {
    "title": "Raymarching Distance Fields",
    "author": "Íñigo Quílez（IQ）",
    "url": "https://iquilezles.org/articles/raymarchingdf/"
  },
  "iq-smooth": {
    "title": "Smooth Minimum",
    "author": "Íñigo Quílez（IQ）",
    "url": "https://iquilezles.org/articles/smin/"
  },
  "iq-shadows": {
    "title": "Soft Shadows in Raymarched SDFs",
    "author": "Íñigo Quílez（IQ）",
    "url": "https://iquilezles.org/articles/rmshadows/"
  },
  "iq-fbm": {
    "title": "Fractional Brownian Motion",
    "author": "Íñigo Quílez（IQ）",
    "url": "https://iquilezles.org/articles/fbm/"
  },
  "hart": {
    "title": "Sphere Tracing: A Geometric Method for the Antialiased Ray Tracing of Implicit Surfaces（PDF）",
    "author": "John C. Hart",
    "url": "https://graphics.stanford.edu/courses/cs348b-20-spring-content/uploads/hart.pdf"
  }
};
/** Original teaching notes. External articles are further reading, never embedded copies. */
export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  {
    "id": "pixels",
    "title": "片元、像素与第一个颜色",
    "stage": 0,
    "goal": "理解 mainImage 如何把一个像素坐标映射到颜色。",
    "intro": "把画布想象成同时求值的许多个问题：这个位置应该是什么颜色？mainImage 的 fragCoord 是当前像素的位置，返回的 vec4f 依次为红、绿、蓝与 Alpha。",
    "detail": "先输出一种固定颜色，再让其中一个分量随横坐标变化。片元之间不能靠普通全局变量传递数据；每个像素看到的私有变量都独立初始化。",
    "formula": "return vec4f(0.1, 0.6, 0.9, 1.0);",
    "pitfall": "Shader 中的 var 不是跨帧记忆。持久状态需要 Buffer。",
    "exercise": "依次让 R、G、B 为 1；再把 R 换成 fragCoord.x / iResolution.x。",
    "references": [
      "book-functions"
    ]
  },
  {
    "id": "coordinates",
    "title": "UV、中心坐标与宽高比",
    "stage": 0,
    "goal": "在任意尺寸画布上得到形状不变的坐标。",
    "intro": "uv = fragCoord / iResolution.xy 将画布归一到 0–1，但横纵单位代表的像素数可能不同。直接在 uv 上画圆，宽屏上会被拉成长椭圆。",
    "detail": "令 p = (2 × fragCoord − resolution) / resolution.y，原点位于画布中心，横纵都以画布高度为尺度。之后调整窗口，圆仍然是圆。",
    "formula": "let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;",
    "pitfall": "本编辑器 fragCoord 原点在左下角；原生 WGSL 纹理采样原点在左上角。",
    "exercise": "显示 vec3f(uv, 0.0)，找出四角颜色；再缩窄预览验证比例。",
    "references": []
  },
  {
    "id": "color",
    "title": "颜色、插值与分层",
    "stage": 0,
    "goal": "用遮罩决定两种颜色怎样交接。",
    "intro": "把背景和前景分别记作两个 vec3f，遮罩 m 表示该像素被前景覆盖的程度。mix(bg, fg, m) 在 m 为 0 时取背景，为 1 时取前景。",
    "detail": "让 m 从横坐标、距离或时间函数获得，颜色就能与几何解耦。先保持 Alpha 为 1，避免把透明度与明暗混在一起；发光常需要加色，实心图形常需要遮罩混合。",
    "formula": "let color = mix(background, foreground, clamp(mask, 0.0, 1.0));",
    "pitfall": "mask 超出 0–1 会产生外插；多个不透明层的顺序会改变结果。",
    "exercise": "把同一个圆形遮罩用于两组不同配色，确认只改颜色而不改轮廓。",
    "references": []
  },
  {
    "id": "functions",
    "title": "step、smoothstep 与抗锯齿",
    "stage": 0,
    "goal": "把硬阈值变成稳定的像素覆盖率。",
    "intro": "step 把函数分成两侧，能画出边界却容易出现锯齿。smoothstep 用一段过渡区把边缘连续化。过渡太宽像模糊，太窄仍然闪烁。",
    "detail": "对距离 d 使用 fwidth(d) 估算一个像素跨过的变化量，再在零附近插值。先在一致控制流中计算导数，随后才按条件选颜色，避免导数的非一致控制流问题。",
    "formula": "let aa = max(fwidth(d), 0.0001);\nlet mask = 1.0 - smoothstep(-aa, aa, d);",
    "pitfall": "smoothstep 的下界必须小于上界；不要靠反转两个边界来反转遮罩。",
    "exercise": "把分辨率切到 25%，比较固定过渡宽度与 fwidth 的效果。",
    "references": [
      "book-functions"
    ]
  },
  {
    "id": "circle",
    "title": "圆的解析式：从等式到填充",
    "stage": 1,
    "goal": "用圆方程画轮廓、圆盘和圆环。",
    "intro": "圆上各点到圆心 c 的距离等于 r。隐式函数 F(p) = dot(p−c,p−c)−r² 的零集合就是圆；F 小于 0 表示圆内。它足够判断填充，但数值单位是长度的平方。",
    "detail": "若需要恒定宽度描边，改用 d = length(p−c)−r，它以长度为单位。圆环可以对 abs(d) 做阈值；圆的参数式 c + r(cos θ, sin θ) 则描述沿轮廓移动的点。",
    "formula": "let d = length(p - center) - radius;\nlet ring = abs(d) - thickness;",
    "pitfall": "dot(p,p)−r² 与 length(p)−r 的零边界相同，但不是同一个距离。",
    "exercise": "画一个实心圆和一个圆环；改变半径，观察描边是否保持同样像素宽。",
    "references": [
      "book-shapes",
      "iq-2d"
    ]
  },
  {
    "id": "ellipse",
    "title": "椭圆解析式与距离近似",
    "stage": 1,
    "goal": "区分内外判定、局部距离近似和精确最近距离。",
    "intro": "半轴为 a、b 的椭圆满足 x²/a² + y²/b² = 1。将 p 除以半轴后再计算 length，会得到正确的零轮廓，适合填充与导数抗锯齿；它不是原坐标里的精确距离。",
    "detail": "在边界附近可以用 F / length(∇F) 作一阶距离近似，其中 F = dot(p/axes,p/axes)−1，梯度为 2p/(axes²)。靠近中心梯度为零，必须保护分母。真正的等距线需最近点求解。",
    "formula": "let f = dot(p / axes, p / axes) - 1.0;\nlet approx = f / max(length(2.0 * p / (axes * axes)), 0.0001);",
    "pitfall": "该近似只在边界附近可靠，不可当作严格 SDF 无条件用于 Sphere Tracing。",
    "exercise": "把横轴变为纵轴的 3 倍，比较隐式阈值描边与局部距离近似。",
    "references": [
      "iq-ellipse",
      "book-shapes"
    ]
  },
  {
    "id": "segments",
    "title": "直线、线段与胶囊",
    "stage": 1,
    "goal": "用最近点投影画可旋转的线条。",
    "intro": "无限直线没有端点；线段必须限制投影落在两个端点之间。令 ab=b−a，计算 t=dot(p−a,ab)/dot(ab,ab)，再把 t 限制到 0–1，得到最近点 a+t·ab。",
    "detail": "点到最近点的距离减去半径 r，就是圆头线段的胶囊 SDF。端点重合时应退化为圆，而不是除零。你已经可以用一组胶囊绘制简单字母与连线。",
    "formula": "let ab = b - a;\nlet t = clamp(dot(p-a, ab) / max(dot(ab,ab), 0.000001), 0.0, 1.0);\nlet d = length(p - a - t * ab) - radius;",
    "pitfall": "不要只计算到无限直线的距离，否则线条会穿过端点继续延伸。",
    "exercise": "用三根胶囊画字母 A，分别调整粗细、长度与夹角。",
    "references": [
      "iq-2d"
    ]
  },
  {
    "id": "curves",
    "title": "极坐标、弧线与参数曲线",
    "stage": 1,
    "goal": "把角度、半径和参数当成绘图工具。",
    "intro": "length(p) 给出半径，atan2(p.y,p.x) 给出角度。半径随角度周期变化可以形成花瓣，角度遮罩可以从圆环裁出弧段。角度在 −π 与 π 处有接缝，处理跨缝区间时要显式环绕。",
    "detail": "二次 Bézier 曲线通过三个控制点及参数 t 描述一条路径。参数式给出曲线上的点，却没有直接给出任意像素到曲线的距离；入门可以把曲线采样成短线段，再取最小距离。",
    "formula": "B(t) = (1−t)² A + 2(1−t)t C + t² B,  0 ≤ t ≤ 1",
    "pitfall": "r−radius(angle) 通常不是精确 SDF。高曲率曲线需要更多采样段。",
    "exercise": "用 sin(5 × angle) 改造圆形边界，画一朵五瓣花，再尝试保留一个弧段。",
    "references": [
      "book-shapes"
    ]
  },
  {
    "id": "sdf",
    "title": "有符号距离场：画出看不见的数",
    "stage": 2,
    "goal": "用正负号和等距线理解 SDF。",
    "intro": "有符号距离场不仅回答内外，还回答到最近边界有多远。这里约定内部为负，边界为零，外部为正。画出距离的正负颜色和等距线，比只画轮廓更容易发现错误。",
    "detail": "精确 SDF 在可微处满足梯度长度为 1；拐角和多条最近路径交会处不可微。把形状压缩成一个数值函数后，描边、膨胀、组合与三维步进就有了共同语言。",
    "formula": "d(p) < 0：内部；d(p) = 0：边界；d(p) > 0：外部",
    "pitfall": "具有正确零轮廓的隐式函数不一定是距离函数。",
    "exercise": "把圆的 SDF 显示为正负两色，并每隔 0.1 距离画一条等距线。",
    "references": [
      "iq-2d"
    ]
  },
  {
    "id": "primitives",
    "title": "矩形、圆角框与基础图元",
    "stage": 2,
    "goal": "搭建自己的二维距离函数工具箱。",
    "intro": "对于以原点为中心、半尺寸为 b 的矩形，q=abs(p)−b 表示相对各边的位置。外部距离由正分量的向量长度给出；内部距离由最接近零的负分量给出。",
    "detail": "将一个较小矩形的距离减去圆角半径，可以得到圆角框。构建工具函数时统一约定：中心放在原点，尺寸是半尺寸，距离单位与 p 相同；后续组合会更容易。",
    "formula": "let q = abs(p) - halfSize;\nlet d = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);",
    "pitfall": "只用 max(q.x,q.y) 会在矩形外部角落低估欧氏距离。",
    "exercise": "将布尔练习里的圆替换为矩形，再制作圆角卡片轮廓。",
    "references": [
      "iq-2d"
    ]
  },
  {
    "id": "transforms",
    "title": "平移、旋转、缩放与重复",
    "stage": 2,
    "goal": "通过变换采样坐标移动形状。",
    "intro": "形状函数通常定义在自己的局部空间。要把形状放在 c 处，查询 d(p−c)；要旋转物体，应给查询坐标施加逆旋转。你修改的是提问的位置，而不是在移动像素。",
    "detail": "均匀放大 s 倍时使用 s·d(p/s)，把距离还原到原来的世界单位。非均匀缩放不再保留精确距离；可以乘最小缩放量构造保守步长，但应清楚这是距离界。",
    "formula": "uniformScale(p, s) = s × sdf(p / s),  s > 0",
    "pitfall": "忘记缩放返回的距离，形状轮廓可能正确，描边宽度和步进却会错误。",
    "exercise": "让圆角框平移并旋转；把尺寸放大两倍，检查等距线间隔。",
    "references": [
      "iq-3d"
    ]
  },
  {
    "id": "boolean",
    "title": "布尔运算：并集、交集与差集",
    "stage": 2,
    "goal": "把多个简单 SDF 组合成可读的复杂轮廓。",
    "intro": "在内部为负的约定下，并集用 min(dA,dB)，交集用 max(dA,dB)，A 减 B 用 max(dA,−dB)。先画两个相交圆，再观察哪一侧的符号决定最后的轮廓。",
    "detail": "这些运算精确表达集合边界，但组合后的场在整个空间不一定仍是精确距离。对外部 Sphere Tracing，正确的保守距离界仍然有价值；不要把组合公式与全局精确距离混为一谈。",
    "formula": "union = min(a, b)\nintersection = max(a, b)\nA_minus_B = max(a, -b)",
    "pitfall": "差集不满足交换律；max(b,−a) 表示 B 减 A。",
    "exercise": "用圆减去偏移圆画月牙，再用矩形和圆做一个钥匙孔。",
    "references": [
      "iq-3d"
    ]
  },
  {
    "id": "smooth",
    "title": "平滑并集、描边与形态变化",
    "stage": 3,
    "goal": "让几何接缝变柔和，同时控制形状厚度。",
    "intro": "硬并集在接缝处突然切换最近表面。平滑最小值让两个距离在一个过渡带中混合，会产生类似软泥连接的形状；混合宽度 k 必须为正。",
    "detail": "膨胀可以用 d−r，收缩可以用 d+r，厚壳可以用 abs(d)−w。它们可以组合，但收缩后的小细节会消失，平滑并集也会改变体积与零轮廓。",
    "formula": "h = clamp(0.5 + 0.5 × (b−a)/k, 0, 1)\nsmoothUnion = mix(b,a,h) − k×h×(1−h)",
    "pitfall": "平滑混合是建模操作，不只是给原有接缝加模糊；不要令 k=0。",
    "exercise": "在硬并集与平滑并集间切换，再制作一个空心的软连接环。",
    "references": [
      "iq-smooth"
    ]
  },
  {
    "id": "patterns",
    "title": "网格、镜像与极坐标重复",
    "stage": 3,
    "goal": "用一个小图元覆盖更大的空间。",
    "intro": "把 p 除以周期，取 fract，再减去 0.5，会把每个网格单元映射回局部中心。floor 则保留单元编号，可以据此改变颜色、大小或方向。",
    "detail": "极坐标重复把角度折叠到一个扇区。重复不是复制大量对象，而是复用同一个查询函数。贴近单元边界的形状可能需要查询邻近单元，尤其是物体大小不一致时。",
    "formula": "let cell = floor(p / period);\nlet local = (fract(p / period) - 0.5) * period;",
    "pitfall": "重复处会有导数不连续；图形跨过单元边界时不能只看当前单元。",
    "exercise": "把一个圆角框排列成砖墙，让奇数行错开半格。",
    "references": [
      "book-patterns"
    ]
  },
  {
    "id": "noise",
    "title": "随机、连续噪声与 fBM",
    "stage": 3,
    "goal": "用有组织的变化代替杂乱像素。",
    "intro": "随机值适合给每个格子一个稳定属性；连续噪声则让相邻位置平滑变化。先区分两者，再用噪声驱动颜色、高度或边界，而不是一开始就叠加很多层。",
    "detail": "fBM 把多个不同频率、逐渐衰减的噪声相加。每一层称为 octave。提高频率会增加细节，但细节小于一个像素时容易闪烁，应限制层数或过滤。",
    "formula": "fBM(p) = Σ amplitude[j] × noise(frequency[j] × p)",
    "pitfall": "改变噪声值与改变采样坐标会产生不同效果；更多层数不一定更清晰。",
    "exercise": "从一层噪声开始，依次增加到四层，记录每一层给轮廓带来的变化。",
    "references": [
      "book-fbm",
      "iq-fbm"
    ]
  },
  {
    "id": "warp",
    "title": "域变形与二维特效练习",
    "stage": 3,
    "goal": "扭曲坐标，制作流动的大理石与能量纹路。",
    "intro": "域变形先计算一个向量场 w(p)，然后查询 pattern(p + strength·w(p))。与直接把噪声加到颜色相比，变形会推动已有纹路，形成流动和卷曲的视觉结构。",
    "detail": "先用两组正弦组成低频向量场，再尝试不同位置采样的噪声组成 xy 偏移。每加一层嵌套都要检查成本与边界连续性；变形后的场一般不再是严格 SDF。",
    "formula": "let q = p + strength * vec2f(sin(p.y * 3.0), cos(p.x * 2.0));",
    "pitfall": "把任意变形场当成距离进行三维步进，可能穿过表面。",
    "exercise": "在纹路练习中把 strength 从 0 改到 0.4，做一张可平铺的流体纹理。",
    "references": [
      "iq-fbm"
    ]
  },
  {
    "id": "rays",
    "title": "相机与三维射线",
    "stage": 4,
    "goal": "让每个屏幕像素对应一条世界空间中的射线。",
    "intro": "射线可以写成 ro+t·rd：ro 是相机位置，rd 是单位方向，t 是行走距离。最简单的相机位于 z 正方向，看向负 z，将屏幕坐标放入向量后归一化即可。",
    "detail": "可旋转相机需要前、右、上三个互相垂直的基向量。相机目标决定前向，叉积构造右向，再叉乘得到上向。视线接近参考上向时要更换参考，避免退化。",
    "formula": "let ro = vec3f(0.0, 0.0, 3.5);\nlet rd = normalize(vec3f(p, -1.8));",
    "pitfall": "未归一化的 rd 会让 t 不再表示真实距离，破坏步长和阈值的单位。",
    "exercise": "改变镜头参数 −1.8，比较广角和长焦；注意这与把物体缩小不同。",
    "references": [
      "hart",
      "iq-ray"
    ]
  },
  {
    "id": "sdf3d",
    "title": "球、盒、圆环与拉伸",
    "stage": 4,
    "goal": "把二维距离场工具迁移到三维空间。",
    "intro": "球的距离仍是 length(p)−r，只是 p 变成了 vec3f。盒子公式也沿用二维思路。圆环则先把 xz 平面到主圆的距离与 y 高度组成 vec2，再计算到小圆的距离。",
    "detail": "二维轮廓沿一个轴拉伸，可以产生立体字、徽标或机械零件。场景函数 map(p) 应只回答距离；将材质编号或颜色作为额外结果返回，避免把它们混进距离本身。",
    "formula": "torus(p) = length(vec2f(length(p.xz) − majorRadius, p.y)) − minorRadius",
    "pitfall": "圆环的主半径与管半径不是同一尺寸；返回颜色长度不能替代距离。",
    "exercise": "把球替换成圆环，再用盒子减去一部分，得到开口机械环。",
    "references": [
      "iq-3d"
    ]
  },
  {
    "id": "march",
    "title": "Ray Marching 与 Sphere Tracing",
    "stage": 4,
    "goal": "沿射线寻找第一个可靠的表面交点。",
    "intro": "Ray Marching 指沿射线分步查询；Sphere Tracing 使用距离或保守距离界决定步长。若当前位置到表面的安全距离是 d，向前走 d 不应跨过表面。",
    "detail": "设定最大步数、最大行程以及命中阈值 epsilon。只有当距离小于阈值时才宣告命中；达到步数上限不是命中。入门先让相机位于物体外部，内部追踪需额外处理。",
    "formula": "p = ro + rd × t\nif d < epsilon: hit\nt = t + d",
    "pitfall": "步长函数高估真实距离时可能漏掉薄物体；盲目设固定最小步长也会穿透表面。",
    "exercise": "打开三维练习，把最大步数减到 12，再增至 80，观察轮廓缺失与性能变化。",
    "references": [
      "hart",
      "iq-ray"
    ]
  },
  {
    "id": "normals",
    "title": "梯度、法线与命中调试",
    "stage": 4,
    "goal": "让不可见的空间计算变成可检查的颜色。",
    "intro": "表面法线指向距离增加最快的方向。可以在命中位置的 x、y、z 两侧采样场，使用中心差分估算梯度，再归一化。",
    "detail": "先把法线从 −1–1 映射到 0–1 作为 RGB 显示，确认朝向连续。法线 epsilon 太大丢失细节，太小会放大浮点误差；它与射线命中阈值相关，但不必完全相同。",
    "formula": "normal = normalize(vec3f(d(p+ex)−d(p−ex), d(p+ey)−d(p−ey), d(p+ez)−d(p−ez)))",
    "pitfall": "不要在未命中的点计算并显示表面法线；背景应单独着色。",
    "exercise": "把三维练习的输出改为 normal × 0.5 + 0.5，检查切割面的朝向。",
    "references": [
      "iq-ray"
    ]
  },
  {
    "id": "lighting",
    "title": "漫反射、高光与材质分层",
    "stage": 5,
    "goal": "让法线与光照方向共同解释形体。",
    "intro": "漫反射强度可从 max(dot(normal,lightDir),0) 开始。加入少量环境项使背光面可读，再通过材质底色控制表面颜色。",
    "detail": "高光还依赖观察方向。入门可用光线与视线的半角向量建立高光模型；它便于观察曲率，但不等同于完整的物理材质。先确认方向都归一化，再调整参数。",
    "formula": "diffuse = max(dot(n, lightDir), 0.0)\nhalfDir = normalize(lightDir + viewDir)",
    "pitfall": "改变物体颜色时不要把距离函数也一起改掉；材质与几何应分离。",
    "exercise": "设置一个固定侧光，用球观察亮面与高光；再换成盒子比较平面变化。",
    "references": []
  },
  {
    "id": "shadows",
    "title": "硬阴影与软阴影近似",
    "stage": 5,
    "goal": "从表面再向光源走一次。",
    "intro": "从命中点沿法线略微偏移，再向光源发射阴影射线。如果光源之前遇到另一个表面，该位置被遮挡。偏移用于避免把自己的表面误认为遮挡物。",
    "detail": "软阴影近似可以在步进中跟踪场距离相对行程的比例，将靠近遮挡边缘的射线变暗。它是启发式近似，不是对真实面积光源的完整积分。",
    "formula": "shadowOrigin = hitPoint + normal × bias",
    "pitfall": "bias 太小会出现自阴影条纹，太大则让物体看起来悬浮；点光源需要限制阴影行程。",
    "exercise": "把一个球抬离地面，先观察硬阴影，再尝试减小光源的方向变化。",
    "references": [
      "iq-shadows"
    ]
  },
  {
    "id": "occlusion",
    "title": "环境遮蔽与空间层次",
    "stage": 5,
    "goal": "用局部遮挡强调凹槽与接触。",
    "intro": "环境遮蔽估计周围方向的遮挡程度。一个简单的近似沿表面法线向外取多个样本，把预期距离 h 与场返回距离 d 的差作为遮挡信号，再加权累积。",
    "detail": "这种近似擅长强调接触处和狭缝，但无法代替直接光照或真实全局光照。采样半径决定它解释的是局部纹理还是大范围结构，应该与场景尺寸一起调节。",
    "formula": "occlusion += weight × max(0, sampleDistance − map(p+n×sampleDistance))",
    "pitfall": "AO 不是把所有阴面再涂黑；过强的 AO 会掩盖材质和光照。",
    "exercise": "在球与地面的接触位置加入局部 AO，比较只加环境色的结果。",
    "references": [
      "iq-ray"
    ]
  },
  {
    "id": "reflection",
    "title": "反射、Fresnel 与 Cubemap",
    "stage": 5,
    "goal": "让观察方向影响表面的反光程度。",
    "intro": "reflect(rd,n) 得到反射射线方向。环境贴图以方向查询颜色，所以 Cubemap 的坐标是 vec3f，而不是二维 UV；应在通道中绑定六面立方体贴图。",
    "detail": "Fresnel 描述掠射角反射更强的趋势。Schlick 近似可用 F0 +(1−F0)(1−cosθ)^5 建立直觉。若再追踪反射射线，要设反弹上限并处理起点偏移。",
    "formula": "let reflected = reflect(rd, normal);\nlet fresnel = f0 + (1.0-f0) * pow(1.0-cosTheta, 5.0);",
    "pitfall": "环境贴图与场景里的其他物体不是同一信息；贴图不能自动反射近处动态物体。",
    "exercise": "给三维物体绑定自己的 Cubemap，对比正面与边缘的反射强度。",
    "references": []
  },
  {
    "id": "animation",
    "title": "时间、节奏与可控运动",
    "stage": 6,
    "goal": "把动画写成可重置、可推导的函数。",
    "intro": "先使用 iTime 构造周期运动，例如 center.x = amplitude·sin(speed·iTime)。幅度控制范围，频率控制速度，相位控制多个元素之间的错位。",
    "detail": "移动形状时把时间放进形状变换；流动材质时把时间放进纹理坐标。积累状态时使用 iTimeDelta，避免帧率改变速度。重置后能回到相同起点，动画才容易调试。",
    "formula": "let offset = 0.3 * sin(iTime * 1.5);",
    "pitfall": "每帧固定加一个数会依赖帧率；直接用 iTime 求位置则不需要再乘 iTimeDelta。",
    "exercise": "给两个圆设置相同频率、不同相位，做一次周期性平滑融合。",
    "references": []
  },
  {
    "id": "textures",
    "title": "图片、视频与采样坐标",
    "stage": 6,
    "goal": "让素材输入成为计算的一部分。",
    "intro": "通道可绑定内置 Noise、MSDF、普通图片、视频或 Cubemap。二维 channel0(uv) 使用左下角 UV，并由编辑器完成翻转；原生 textureSampleLevel 使用左上角 UV。",
    "detail": "纹理可以提供颜色，也可以存放距离、法线或任意数值。用途决定如何解释通道；例如本项目 msdf.png 的 Alpha 是可用的字形距离数据，不能把任何 RGB 图都按同一种 MSDF 规则解码。",
    "formula": "let texel = channel0(fragCoord / iResolution.xy);",
    "pitfall": "不要重复翻转 Y；视频播放时间可以从 iChannelTime 查询，不必假设它和 iTime 完全一致。",
    "exercise": "选择内置城市图片，做一半原图、一半灰度；再换成视频验证同一采样代码。",
    "references": []
  },
  {
    "id": "interaction",
    "title": "鼠标、键盘与字体距离纹理",
    "stage": 6,
    "goal": "用输入改变图形，而不是只改变颜色。",
    "intro": "iMouse.xy 表示拖动位置；zw 的符号可用于判断按钮状态。键盘通道是 256×3 的纹理，三行依次表示按住、本帧按下和切换状态。点击预览后才接收键盘，编辑代码不会触发。",
    "detail": "A–Z 对应键码 65–90。读取图集时先把字符编码转换成 16×16 网格坐标，再用 Alpha 距离构造字形覆盖率。Gallery 的 Key light 是这个流程的完整示例。",
    "formula": "let held = channel0(vec2f((65.0+0.5)/256.0, 0.5/3.0)).r;",
    "pitfall": "本帧按下只持续一个渲染帧；想记住最后一个字符，需要存入 Buffer。",
    "exercise": "打开 Gallery 的 Key light，改成只有按住按键时才发光，松开后保留字形。",
    "references": []
  },
  {
    "id": "feedback",
    "title": "Buffer、历史帧与反馈",
    "stage": 6,
    "goal": "让画面拥有记忆。",
    "intro": "Buffer A 读取自己时拿到上一帧；Image 读取已经执行过的 Buffer A 时拿到当前帧。这种双缓冲避免同时读取和写入同一纹理，是拖尾与模拟的基础。",
    "detail": "把旧颜色乘衰减再加入新信号，会形成残影。使用 exp(−rate·iTimeDelta) 可让衰减接近帧率无关。反馈采样发生位移时要考虑插值模糊；相机数据等精密信息应使用足够精度的格式。",
    "formula": "newColor = oldColor × exp(−decayRate × deltaTime) + newSignal",
    "pitfall": "编译、重置或分辨率变化会清空历史；不要把未初始化历史当成有效状态。",
    "exercise": "打开反馈练习，比较每帧乘 0.98 与按秒指数衰减的差异。",
    "references": []
  },
  {
    "id": "atmosphere",
    "title": "雾、深度与体积步进",
    "stage": 7,
    "goal": "区分表面着色与沿路径积累。",
    "intro": "表面雾可以按命中距离把颜色混向雾色，例如透射率 T=exp(−density·distance)。它便宜、易控，但并没有真的在空间里采样烟雾密度。",
    "detail": "真正的体积渲染沿射线逐段采样密度，更新透射率并累积散射光；密度场不是 SDF，不能直接拿它作安全步长。这里把体积云作为进阶练习，先掌握表面雾再扩展。",
    "formula": "T = exp(−density × distance)\ncolor = surface × T + fogColor × (1−T)",
    "pitfall": "把彩色噪声覆盖在屏幕上并不等于体积云；后者要沿深度积分。",
    "exercise": "在综合练习中改变雾密度，观察远处地面怎样融入背景。",
    "references": []
  },
  {
    "id": "glow",
    "title": "发光、色调映射与后期",
    "stage": 7,
    "goal": "在亮部细节和视觉冲击之间取得平衡。",
    "intro": "发光可以先从距离衰减开始，例如 exp(−k·abs(d)) 在轮廓附近形成光晕。更接近镜头泛光的 Bloom 则需要提取亮部、模糊并加回原图，通常放在多个 Pass 中。",
    "detail": "HDR 计算可能产生大于 1 的数值。Image 输出最终受显示范围限制，因此应在最后进行色调映射，再明确处理显示编码。当前 Buffer 能保留高动态范围，Image 的 rgba8 输出会截断超出范围的值。",
    "formula": "mapped = hdrColor / (vec3f(1.0) + hdrColor)",
    "pitfall": "先把 HDR 裁到 0–1 再做 Bloom 会丢掉强光信息；避免无意中重复做 Gamma 变换。",
    "exercise": "给圆环加距离光晕；先看未经映射的输出，再比较映射后的亮部层次。",
    "references": []
  },
  {
    "id": "scene",
    "title": "程序化场景：从零件到画面",
    "stage": 7,
    "goal": "用一个小场景串联建模、光照与构图。",
    "intro": "先选择少量轮廓明确的图元，再用布尔、平滑连接和重复搭出主体。把场景拆成距离查询、材质选择、光照和后期四部分，每一步都能单独可视化。",
    "detail": "综合练习提供一个圆环与球体组成的微型雕塑，加入地面、阴影和雾。可以逐步改造成机械装置、抽象生物或未来建筑；大场景还需要包围体与层级裁剪，不能无限堆叠 map 调用。",
    "formula": "构图 → 大形 → 中尺度结构 → 材质 → 灯光 → 后期",
    "pitfall": "不要先用噪声掩盖轮廓问题；在纯色和法线视图里读得清，细节才有意义。",
    "exercise": "把综合练习改造成三栋未来建筑，分别限制轮廓、配色和光源数量。",
    "references": [
      "iq-3d"
    ]
  },
  {
    "id": "performance",
    "title": "调试、性能与毕业作品",
    "stage": 7,
    "goal": "用可验证的步骤完成一件可分享的效果。",
    "intro": "先检查图像正确，再检查性能。可把步进次数、命中距离、法线或材质编号显示为颜色，定位瓶颈和伪影。一次只改一个参数，用相同分辨率和相同时间比较。",
    "detail": "成本通常来自每像素查询次数、阴影与反射的额外射线、噪声层数及重复纹理采样。降低分辨率适合诊断填充成本，但不能修复数学错误。记录限制、保存工程和预览图，作品才方便复现。",
    "formula": "像素总数 × 每像素步数 × 每次 map 成本 ≈ 主要渲染开销",
    "pitfall": "单帧 FPS 不是稳定性能结论；隐藏页面、缓存和 GPU 降频都会干扰比较。",
    "exercise": "完成一个包含 SDF 组合、动态输入和至少一种光照/后期的作品，附效果截图与参数说明。",
    "references": [
      "hart"
    ]
  }
];
export function findTutorial(id: string) { return TUTORIAL_CHAPTERS.find(chapter => chapter.id === id) ?? TUTORIAL_CHAPTERS[0]!; }
export function searchTutorials(query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return TUTORIAL_CHAPTERS.filter(chapter => words.every(word =>
    [chapter.title, chapter.goal, chapter.intro, chapter.detail, chapter.pitfall, chapter.exercise, TUTORIAL_STAGES[chapter.stage]!.title,
      ...chapter.references.map(id => TUTORIAL_REFERENCES[id]!.author)].join(' ').toLocaleLowerCase().includes(word)));
}

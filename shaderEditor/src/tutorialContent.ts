export interface TutorialChapter {
  id: string; title: string; stage: number; goal: string; intro: string; detail: string;
  formula: string; pitfall: string; exercise: string; references: string[];
  change: string; expected: string; steps: {title: string; body: string}[];
  experiment: {parameter: string; before: string; after: string; expected: string};
}
export const TUTORIAL_STAGES = [
  {
    "title": "看懂每一个像素",
    "description": "从零建立坐标、颜色和函数的直觉。"
  },
  {
    "title": "用解析式画图",
    "description": "从圆、椭圆到线段与曲线，理解图形如何成为函数。"
  },
  {
    "title": "2D 距离场建模",
    "description": "把轮廓变成可计算的距离，再组合成复杂形状。"
  },
  {
    "title": "让图形生长",
    "description": "重复、噪声、分形叠加与域变形，生成丰富细节。"
  },
  {
    "title": "走进三维",
    "description": "建立相机与 3D 距离场，用光线步进寻找表面。"
  },
  {
    "title": "让表面可信",
    "description": "从法线出发加入光照、阴影、遮蔽与反射。"
  },
  {
    "title": "让画面响应",
    "description": "时间、纹理、键盘和反馈，把静态图像变成系统。"
  },
  {
    "title": "完成一件作品",
    "description": "整合雾、发光、程序化场景与性能诊断。"
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
  "book-noise": {
  "title": "The Book of Shaders · Noise",
  "author": "Patricio Gonzalez Vivo / Jen Lowe",
  "url": "https://thebookofshaders.com/11/"
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
  "pbrt-transmittance": {
  "title": "PBRT · Transmittance",
  "author": "Matt Pharr / Wenzel Jakob / Greg Humphreys",
  "url": "https://pbr-book.org/4ed/Volume_Scattering/Transmittance"
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
    ],
    "change": "去掉坐标、网格和函数，只保留一种固定输出颜色。",
    "expected": "整个画布是均匀蓝色，不应该出现渐变或图形。",
    "steps": [
      {
        "title": "确定输入与输出",
        "body": "fragCoord 是当前像素坐标，但本章刻意不读取它。mainImage 对每个像素返回相同结果，因此输出必须一致；先建立这个可预测的基线。"
      },
      {
        "title": "拆开四个分量",
        "body": "vec4f(0.12,0.55,0.82,1.0) 的前三项分别控制红绿蓝，最后一项保持不透明。只修改一个分量，观察颜色，而不是一次改完四个值。"
      },
      {
        "title": "验证并行执行",
        "body": "任意改变预览尺寸，颜色都不应变化。若尝试用普通 var 计数像素，它不会跨片元累加；后面会用纹理保存共享结果。"
      }
    ],
    "experiment": {
      "parameter": "返回颜色的 R",
      "before": "0.12",
      "after": "0.8",
      "expected": "画布变暖，仍然完全均匀。"
    }
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
    "references": [],
    "change": "在固定颜色上加入归一化像素坐标，将位置映射到颜色。",
    "expected": "左下角红绿较暗，向右红色增加，向上绿色增加。",
    "steps": [
      {
        "title": "从像素到比例",
        "body": "左侧像素 x 接近 0，右侧接近画布宽度。用 x/width 得到与窗口大小无关的水平比例；y/height 同理。"
      },
      {
        "title": "直接显示坐标",
        "body": "将 uv.x 放入 R、uv.y 放入 G，不添加噪声或形状。颜色此时是一张坐标调试图，哪个方向变亮就代表哪个分量增加。"
      },
      {
        "title": "准备等比例空间",
        "body": "p 使用同一个 resolution.y 除横纵分量，使横向和纵向一单位对应相同像素数。当前画面仍显示 uv；后续圆形绘制将实际使用 p。"
      }
    ],
    "experiment": {
      "parameter": "蓝色分量",
      "before": "0.25",
      "after": "0.0",
      "expected": "去掉蓝色后更容易辨认红、绿坐标方向。"
    }
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
    "references": [],
    "change": "保留 UV，把直接输出分量改成两种配色之间的插值。",
    "expected": "从左侧深蓝平滑过渡到右侧薄荷绿。",
    "steps": [
      {
        "title": "固定两个端点",
        "body": "先单独输出 background，再单独输出 foreground，确认两种颜色。这样可以区分配色问题与插值公式问题。"
      },
      {
        "title": "展开 mix",
        "body": "mix(a,b,t) 等于 a×(1−t)+b×t。t=0、0.5、1 分别得到起点、中点和终点；用 uv.x 当 t 就形成横向渐变。"
      },
      {
        "title": "把颜色与几何分离",
        "body": "后续只需把 uv.x 替换为图形遮罩，background 和 foreground 可保持不变。先让代码中颜色参数与遮罩计算处于不同语句。"
      }
    ],
    "experiment": {
      "parameter": "mix 的权重",
      "before": "uv.x",
      "after": "uv.y",
      "expected": "渐变从横向变为纵向，颜色端点不变。"
    }
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
    ],
    "change": "保留前背景混色，让正弦边界决定遮罩，比较硬阈值与导数抗锯齿。",
    "expected": "正弦分界线两侧颜色不同；左半使用 step，右半使用平滑覆盖。",
    "steps": [
      {
        "title": "构造有符号边界",
        "body": "d=p.y−0.35*sin(p.x*4) 在曲线上为零，下方为负，上方为正。它不是精确距离，但足以做本章的覆盖率演示。"
      },
      {
        "title": "先做二值判断",
        "body": "1−step(0,d) 让负侧为 1。靠近边界的像素只有全开或全关，低分辨率时容易看见台阶。"
      },
      {
        "title": "让过渡跟像素走",
        "body": "fwidth(d) 估计像素邻域的 d 变化量。用它构造 −aa 到 aa 的过渡，最后通过 p.x 选择对照输出；导数在分支外计算。"
      }
    ],
    "experiment": {
      "parameter": "曲线频率",
      "before": "4.0",
      "after": "12.0",
      "expected": "曲线更密；切到 25% 分辨率后更容易看出左右抗锯齿差异。"
    }
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
    ],
    "change": "把正弦分界替换成圆距离，叠加填充和等宽圆环。",
    "expected": "深色背景上出现青绿色圆盘和浅黄色圆环。",
    "steps": [
      {
        "title": "先只求边界",
        "body": "圆上各点满足 length(p)=r。减去 r 后，零集合不变，内部变为负值，外部变为正值。"
      },
      {
        "title": "复用覆盖函数",
        "body": "coverage(d) 对整个内部填充。画面颜色仍用前章的 mix；只替换产生遮罩的函数。"
      },
      {
        "title": "从填充得到描边",
        "body": "abs(d) 把内外两侧折叠到一起；再减 thickness，得到以原圆周为中线的条带。这里 thickness 是半宽，总宽约为它的两倍。"
      }
    ],
    "experiment": {
      "parameter": "圆半径",
      "before": "0.5",
      "after": "0.7",
      "expected": "圆变大；圆环半宽仍是 0.035。"
    }
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
    ],
    "change": "将圆坐标按两个半轴缩放，展示椭圆隐式填充与非等宽轮廓。",
    "expected": "一个横向椭圆，使用隐式值描出的线宽在不同位置有所变化。",
    "steps": [
      {
        "title": "从单位圆替换坐标",
        "body": "令 q=(x/a,y/b)，dot(q,q)=1 描述椭圆。a、b 必须为正，它们分别是左右半宽与上下半高。"
      },
      {
        "title": "做填充与导数过渡",
        "body": "f=dot(q,q)−1 的正负能判断内外，coverage(f) 能沿正确轮廓抗锯齿。正确轮廓不意味着 f 的单位是长度。"
      },
      {
        "title": "故意暴露线宽问题",
        "body": "abs(f)−0.08 使用固定隐式阈值，椭圆不同方向的梯度不同，因此线宽会变化。保留这个现象，到椭圆距离专章再用最近边近似替换它。"
      }
    ],
    "experiment": {
      "parameter": "椭圆半轴",
      "before": "vec2f(0.75,0.35)",
      "after": "vec2f(0.6,0.6)",
      "expected": "椭圆变成圆；隐式值仍不是长度距离。"
    }
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
    ],
    "change": "用投影求线段的最近点，并把两个端点单独标出。",
    "expected": "一根斜线，端点处有黄色圆点，线不会延伸越过端点。",
    "steps": [
      {
        "title": "先看无限直线",
        "body": "p−a 沿 b−a 的投影比例为 dot(p−a,ab)/dot(ab,ab)。不限制 t 时，最近点可以落到线段外。"
      },
      {
        "title": "限制到实际端点",
        "body": "clamp(t,0,1) 将负比例归到 a，大于 1 的比例归到 b。中间保持投影点不变。"
      },
      {
        "title": "计算剩余向量",
        "body": "p−(a+t·ab) 指向查询点，长度就是无符号最近距离。本章用很小的线宽显示骨架，后面胶囊章节再给它明显厚度。"
      }
    ],
    "experiment": {
      "parameter": "端点 b",
      "before": "vec2f(0.6,0.4)",
      "after": "vec2f(0.6,-0.3)",
      "expected": "斜线变成水平线，端点标记跟随移动。"
    }
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
    ],
    "change": "把笛卡尔坐标转成半径与角度，用周期半径画花瓣。",
    "expected": "五瓣花及其亮色轮廓；这只是隐式轮廓，不声称精确距离。",
    "steps": [
      {
        "title": "把位置拆成两个量",
        "body": "length(p) 表示离中心多远，atan2(p.y,p.x) 表示朝哪个方向。不要用 atan(p.y/p.x)，它无法完整区分象限。"
      },
      {
        "title": "让目标半径依角度变化",
        "body": "0.46+0.12*cos(5·angle) 在一圈内起伏五次。0.46 是基础半径，0.12 是花瓣深度。"
      },
      {
        "title": "重复使用遮罩框架",
        "body": "当前半径减去目标半径形成隐式函数，仍能经 coverage 画填充和轮廓。由于边界斜率改变，abs(radial) 的条带不是严格等宽。"
      }
    ],
    "experiment": {
      "parameter": "花瓣数",
      "before": "5.0",
      "after": "7.0",
      "expected": "花瓣从五个变为七个，基础半径不变。"
    }
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
    ],
    "change": "回到圆的真实距离，加入正负颜色、等距带与零边界。",
    "expected": "圆内偏绿、圆外偏蓝；亮边对应 d=0，明暗带每隔约 0.1 单位重复。",
    "steps": [
      {
        "title": "把数值映射为可读信息",
        "body": "先用 d<0 区分内部与外部，不要马上叠加材质。符号错误通常会表现为内外颜色互换。"
      },
      {
        "title": "标记零等值线",
        "body": "coverage(abs(d)−0.006) 给 d=0 附近加窄条带。0.006 是世界坐标半宽，不是像素数。"
      },
      {
        "title": "画连续等距带",
        "body": "cos(d×2π/0.1) 每隔 0.1 重复一次。若相邻带在世界空间的厚度异常变化，可能用到了隐式值或错误缩放。"
      }
    ],
    "experiment": {
      "parameter": "等距带角频率",
      "before": "62.83185",
      "after": "31.415925",
      "expected": "条带间隔从 0.1 增加到约 0.2。"
    }
  },
  {
    "id": "circle-distance",
    "title": "圆的距离：径向最近点",
    "stage": 2,
    "goal": "从查询点沿半径方向找到圆上的最近点。",
    "intro": "设圆心位于原点，半径为 r。任何非零查询点 p 都可以写成长度乘方向；圆上与 p 同方向的点是 r·normalize(p)。这是外部与内部点到圆周的最近点。",
    "detail": "两点距离为 abs(length(p)−r)。再依据点在圆内还是圆外添加符号，得到 length(p)−r。中心点有无穷多个最近点，但距离仍唯一等于 −r；公式不需要除以 length(p)。",
    "formula": "closest = r × p / length(p), p ≠ 0\nd = length(p) − r",
    "pitfall": "为了可视化最近点才需要 normalize；真正的圆距离函数在 p=0 时仍然安全。",
    "exercise": "移动黄色查询点，计算它到白色最近点的距离；再改变半径检查等距线。",
    "references": [
      "iq-2d"
    ],
    "change": "保留圆的距离可视化，增加测试点与最近点，直观看到 length(p)-r 的几何含义。",
    "expected": "圆外的黄色测试点由白色线段连向圆周，线段长度等于该点的正距离。",
    "steps": [
      {
        "title": "最短路径沿半径",
        "body": "圆具有旋转对称性。对圆心以外的点 p，最近边界点在从圆心指向 p 的射线上，方向是 normalize(p)。"
      },
      {
        "title": "构造最近点",
        "body": "半径为 r 的圆上最近点 q=r*p/length(p)。圆外 length(p-q)=length(p)-r；圆内用负号表达内部。"
      },
      {
        "title": "处理圆心特例",
        "body": "p=0 时没有唯一最近点，不能直接除以 length(p)。距离仍为 -r；本例固定测试点远离圆心，公式函数本身不需要归一化。"
      }
    ],
    "experiment": {
      "parameter": "测试点",
      "before": "vec2f(0.88,0.38)",
      "after": "vec2f(0.7,0.0)",
      "expected": "最近点移动到圆的最右侧，连接线水平，更容易手算距离。"
    }
  },
  {
    "id": "plane-distance",
    "title": "半平面：投影就是有符号距离",
    "stage": 2,
    "goal": "用单位法线和点积推导直线两侧的距离。",
    "intro": "把直线写成 dot(p,n)=h，其中 n 是单位法线、h 是直线沿法线方向到原点的位移。p 在 n 上的投影长度是 dot(p,n)，减掉 h 就得到相对边界的有符号距离。",
    "detail": "选取 n 指向外侧，就得到负侧为内部的半平面。查询点的最近点是 p−d·n。与线段不同，这个图元没有端点；相交半平面可定义凸形状，但 max 后的距离通常只是界。",
    "formula": "d = dot(p,n) − h, length(n)=1\nclosest = p − d × n",
    "pitfall": "如果 n 的长度不是 1，点积会同时缩放距离。旋转法线之前或之后都要保持单位长度。",
    "exercise": "将法线从 vec2f(0.6,1.0) 改成 vec2f(1.0,0.0)，观察直线方向与等距带。",
    "references": [
      "iq-2d"
    ],
    "change": "把圆形场替换为无限半平面，建立投影距离的基础。",
    "expected": "一条倾斜直线分开内外颜色，等距离条纹与边界平行。",
    "steps": [
      {
        "title": "用法线定义直线",
        "body": "单位向量 n 指定边界朝外的方向，直线满足 dot(p,n)=h。h 是从原点沿法线测得的位置。"
      },
      {
        "title": "投影得到距离",
        "body": "dot(p,n) 是点在 n 上的投影；减去 h 得到到边界的有符号距离，负侧为内部。"
      },
      {
        "title": "为什么必须归一化",
        "body": "如果 n 长度为 2，点积也扩大 2 倍，边界位置或距离刻度将失真。先 normalize(vec2f(0.6,1.0)) 再使用。"
      }
    ],
    "experiment": {
      "parameter": "边界偏移",
      "before": "0.15",
      "after": "0.4",
      "expected": "边界沿法线移动 0.25，倾角与条纹间距不变。"
    }
  },
  {
    "id": "primitives",
    "title": "矩形距离：内部、边外与角外",
    "stage": 2,
    "goal": "搭建自己的二维距离函数工具箱。",
    "intro": "对于以原点为中心、半尺寸为 b 的矩形，q=abs(p)−b 表示相对各边的位置。外部距离由正分量的向量长度给出；内部距离由最接近零的负分量给出。",
    "detail": "将一个较小矩形的距离减去圆角半径，可以得到圆角框。构建工具函数时统一约定：中心放在原点，尺寸是半尺寸，距离单位与 p 相同；后续组合会更容易。",
    "formula": "let q = abs(p) - halfSize;\nlet d = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);",
    "pitfall": "只用 max(q.x,q.y) 会在矩形外部角落低估欧氏距离。",
    "exercise": "将布尔练习里的圆替换为矩形，再制作圆角卡片轮廓。",
    "references": [
      "iq-2d"
    ],
    "change": "用矩形替换圆，统一处理内部、边外和角外的最近距离。",
    "expected": "矩形外部角落的等距带呈四分之一圆，内部逐渐缩向中轴。",
    "steps": [
      {
        "title": "利用对称性折叠空间",
        "body": "abs(p) 把四个象限叠到第一象限。再减 halfSize，q 的符号告诉我们越过了哪些边。"
      },
      {
        "title": "分离内外两种贡献",
        "body": "外部项 length(max(q,0)) 保留超出边界的分量；内部项 min(max(q.x,q.y),0) 选择距最近边的负距离。"
      },
      {
        "title": "用三个点验算",
        "body": "半尺寸为 (0.65,0.38) 时，中心距离 −0.38；点 (0.85,0) 距离 0.2；角外点 (0.85,0.58) 距离约 0.28284。"
      }
    ],
    "experiment": {
      "parameter": "halfSize",
      "before": "vec2f(0.65,0.38)",
      "after": "vec2f(0.4,0.4)",
      "expected": "矩形变成正方形，角外等距线仍是圆弧。"
    }
  },
  {
    "id": "rounded-box",
    "title": "圆角矩形：内缩骨架再膨胀",
    "stage": 2,
    "goal": "在保持外轮廓尺寸不变的前提下构建圆角。",
    "intro": "给矩形距离直接减 r，会把每条边向外推 r；它得到圆角，但外尺寸也增加。如果目标外半尺寸仍是 b，先把矩形缩小为 b−r，再减去 r。",
    "detail": "几何上，这是小矩形与半径 r 的圆盘做 Minkowski 和。直边长度随 r 缩短，四角变成圆弧，轮廓仍落在 ±b 的范围内。r 必须位于 0 到最小半尺寸之间。",
    "formula": "d = sdBox(p, b − vec2f(r)) − r\n0 ≤ r ≤ min(b.x,b.y)",
    "pitfall": "将 sdBox(p,b)−r 当作固定尺寸的圆角框，会比指定宽高大 2r。",
    "exercise": "把圆角从 0.15 改到 0.03、0.3，测量最右边仍在 x=0.65。",
    "references": [
      "iq-2d"
    ],
    "change": "保留矩形精确距离，通过缩小核心矩形再外扩得到圆角。",
    "expected": "外尺寸仍为 1.3×0.76 的矩形，四角变为半径 0.15 的圆弧。",
    "steps": [
      {
        "title": "把圆角视作膨胀",
        "body": "对核心形状距离减 r，相当于把零边界向外扩张 r。原矩形棱角向外扩张后自然形成圆弧。"
      },
      {
        "title": "补偿外尺寸",
        "body": "若直接 sdBox(p,b)-r，总宽高会各增加 2r。使用核心半尺寸 b-r，再减 r，就能保持最终外尺寸为 2b。"
      },
      {
        "title": "限制可用参数",
        "body": "r≥0 且 r≤min(b.x,b.y)，否则核心半尺寸变为负数，公式不再对应预期圆角框。r=0 应退化为上一章矩形。"
      }
    ],
    "experiment": {
      "parameter": "圆角半径",
      "before": "0.15",
      "after": "0.0，再试 0.3",
      "expected": "先退化为直角矩形，再变成明显圆角，左右上下的外边界不动。"
    }
  },
  {
    "id": "capsule-distance",
    "title": "胶囊：从线段膨胀出厚度",
    "stage": 2,
    "goal": "把最近线段距离变成有内部的实心图元。",
    "intro": "前面得到的 segmentDistance 永远非负，因为线段没有面积。让所有距线段不超过 r 的点成为内部，相当于以线段为骨架扫过一个半径 r 的圆。",
    "detail": "投影在线段中部时最近边界是平行直线；投影被 clamp 到端点时最近边界是圆弧。二者无需 if 切换，clamp 已完成区域划分。",
    "formula": "t = clamp(dot(p−a,b−a)/dot(b−a,b−a),0,1)\nd = length(p−a−t(b−a)) − r",
    "pitfall": "端点重合时分母为零。示例保护分母，结果退化为以端点为圆心的圆。",
    "exercise": "将半径从 0.18 改到 0.05，再把两个端点设为相同坐标验证退化情形。",
    "references": [
      "iq-2d"
    ],
    "change": "复用线段的最近点投影，将线段向外扩张固定半径。",
    "expected": "斜线段周围形成等宽胶囊，两端为半圆，外侧条纹连续。",
    "steps": [
      {
        "title": "复用投影参数",
        "body": "t=clamp(dot(p-a,b-a)/dot(b-a,b-a),0,1)。限制到 [0,1] 后，最近点既可能在线段内部，也可能是端点。"
      },
      {
        "title": "线段距离变实体距离",
        "body": "先求 length(p-(a+t*(b-a)))，再减 r。所有距离线段小于 r 的点变为内部，恰好构成胶囊。"
      },
      {
        "title": "验证端点退化",
        "body": "当 a=b，形状应退化为一个圆。分母用很小的正数保护；零方向使投影位移为零，最终得到 length(p-a)-r。"
      }
    ],
    "experiment": {
      "parameter": "胶囊半径",
      "before": "0.18",
      "after": "0.08",
      "expected": "整体变细而中轴与两端圆心不变，端帽始终保持圆形。"
    }
  },
  {
    "id": "triangle-distance",
    "title": "三角形：边距离与内部判定分开",
    "stage": 2,
    "goal": "理解为什么最小线段距离还需要额外添加符号。",
    "intro": "分别求查询点到三条边线段的最近距离，最小值就是到三角形边界的无符号距离。边内部、端点以及三条边之间的切换，都由投影 clamp 和 min 处理。",
    "detail": "顶点按逆时针排列时，内部点位于每条有向边的左侧。计算二维叉积 ab.x·ap.y−ab.y·ap.x；若三条边的结果都非负，就把最近距离取负。",
    "formula": "unsigned = min(distanceToEdge0, distanceToEdge1, distanceToEdge2)\ninside = 所有 cross(edge, p−vertex) ≥ 0",
    "pitfall": "只有对无限边直线求 max，三角形外部角落的数值不等于真正的最近边界距离。",
    "exercise": "找到一个角外的点，比较到顶点的欧氏距离与到边所在直线的距离。",
    "references": [
      "iq-2d"
    ],
    "change": "将胶囊的线段投影复用到三条边，独立求距离大小与内部符号。",
    "expected": "出现边长相等的三角形，内部为负距离，角外条纹呈圆弧。",
    "steps": [
      {
        "title": "列出顶点",
        "body": "令三个角度相差 2π/3，顶点位于半径 0.7 的圆上。统一按逆时针排列，方便用叉积判断每条边的内侧。"
      },
      {
        "title": "距离大小取最小",
        "body": "分别求点到三条有限线段的距离，取最小值。不能只用到无限直线的距离，否则角外会选到边的延长线。"
      },
      {
        "title": "再决定正负",
        "body": "对每条有向边计算 cross(b-a,p-a)。逆时针凸多边形内部在所有边的左侧；全部非负则把最近距离取负。"
      }
    ],
    "experiment": {
      "parameter": "三角形外接圆半径",
      "before": "0.7",
      "after": "0.45",
      "expected": "三角形均匀缩小；角外距离条纹仍表示真实的世界距离。"
    }
  },
  {
    "id": "polygon-distance",
    "title": "正多边形：把三条边推广到 N 条",
    "stage": 2,
    "goal": "把三角形算法参数化为可重复使用的图元。",
    "intro": "先在半径 r 的圆上按 2π/N 均匀取顶点，再连接相邻顶点。最后一条边连接到第一个顶点。循环中持续更新最近线段距离，同时累计各边左侧的判断。",
    "detail": "三角形只需把 N 设为 3，正六边形为 6。这里 r 是外接圆半径，不是边心距；后者等于 r·cos(π/N)。N 很大时成本上升，此时圆公式更划算。",
    "formula": "vertex(j) = r × vec2f(cos(θ0+2πj/N), sin(θ0+2πj/N))\nN ≥ 3",
    "pitfall": "同样的外接圆半径，不同 N 的平边到中心距离不同，不代表距离函数出错。",
    "exercise": "将边数 6 改成 3、5、8，对比轮廓与角外等距线。",
    "references": [
      "iq-2d"
    ],
    "change": "不改变距离算法，只把三条边推广为 n 条边，得到可调正多边形。",
    "expected": "六边形替代三角形，直边与角外圆弧仍正确连接。",
    "steps": [
      {
        "title": "参数化边数",
        "body": "第 j 个顶点角度为 2π*j/n 加固定朝向。循环 j=0…n-1，下一顶点用 j+1 的角度即可闭合。"
      },
      {
        "title": "沿用两部分计算",
        "body": "最小线段距离负责大小，所有边半平面交集负责符号。这个内部判定依赖凸性，对凹多边形不能直接复用。"
      },
      {
        "title": "理解半径定义",
        "body": "这里 r 是外接圆半径，即圆心到顶点的距离。圆心到边的距离为 r*cos(π/n)，边数增加后逐渐接近圆。"
      }
    ],
    "experiment": {
      "parameter": "边数",
      "before": "6",
      "after": "12",
      "expected": "轮廓更接近圆，但每次距离查询需要遍历更多边。"
    }
  },
  {
    "id": "star-distance",
    "title": "凹多边形与星形：奇偶交点规则",
    "stage": 2,
    "goal": "替换只适用于凸多边形的内部测试。",
    "intro": "星形包含凹角，内部点不一定在每条边的同一侧，因此前章的全部叉积同号测试不再适用。仍然保留最近线段距离；只替换计算符号的方法。",
    "detail": "从查询点向右发射水平射线，数它穿过多少条边。奇数次在内部，偶数次在外部。只有边两端分处查询高度两侧时才求交，这样避开水平边的除零，并避免顶点被计两次。",
    "formula": "inside = (右向水平射线与边界的交点数 % 2 == 1)\nd = select(nearest, −nearest, inside)",
    "pitfall": "示例轮廓不自交。若改成自交多边形，先选择奇偶规则或非零绕数规则，它们对内部的定义可能不同。",
    "exercise": "把星形内半径从 0.29 改为 0.15，观察凹槽处等距线是否仍贴合。",
    "references": [
      "iq-2d"
    ],
    "change": "增加交替内外半径以形成凹星形，同时把凸多边形内外测试换成奇偶规则。",
    "expected": "五角星轮廓包含五个凹角，内部连续填色，凹处的距离条纹也可观察。",
    "steps": [
      {
        "title": "生成十个顶点",
        "body": "五个外顶点半径 0.65，五个内顶点半径 0.29，角度等间隔交替排列，相邻顶点组成边界。"
      },
      {
        "title": "最近边仍适用",
        "body": "点到多边形边界的最短距离仍是所有有限线段距离的最小值，凹性不会改变这一步。"
      },
      {
        "title": "替换符号判定",
        "body": "从点向右发射水平线，统计穿越边界的次数。奇数次在内部，偶数次在外部；用边的端点高度是否跨过 p.y 避免水平边除零和顶点重复计数。"
      }
    ],
    "experiment": {
      "parameter": "内顶点半径",
      "before": "0.29",
      "after": "0.5",
      "expected": "凹陷变浅，星形逐渐接近十边形；奇偶内部测试仍然适用。"
    }
  },
  {
    "id": "ellipse-distance",
    "title": "椭圆距离：最近点为何不在径向上",
    "stage": 2,
    "goal": "从正确轮廓进一步获得更接近等宽的距离。",
    "intro": "椭圆不是均匀缩放的圆，径向连接通常不垂直于边界。因此 length(p/axes)−1 只有正确的零轮廓，不能直接当作原空间的欧氏距离。",
    "detail": "本章用参数式生成 64 段短弦，计算到所有弦的最小距离，并用椭圆方程判断符号。它比随意缩放隐式值更有几何意义，但仍有离散误差。精确方法需要求解最近点条件，并正确处理轴上与中心等退化情况。",
    "formula": "ellipse(t) = axes × vec2f(cos(t),sin(t))\ndApprox = min(distanceToChord[j]) × sign(ellipseImplicit(p))",
    "pitfall": "曲率大的位置需要更多线段。该近似不宣称精确 SDF，也不应直接充当严格安全的三维步进距离。",
    "exercise": "分别使用 16、32、64 段，放大椭圆端部比较边缘误差和渲染成本。",
    "references": [
      "iq-ellipse"
    ],
    "change": "返回解析式椭圆的问题，用轮廓线段近似最近距离，改善非均匀描边。",
    "expected": "长轴 0.75、短轴 0.32 的椭圆带有近似等间距条纹，远比直接 length(p/axes)-1 均匀。",
    "steps": [
      {
        "title": "参数化轮廓",
        "body": "q(t)=(a*cos(t),b*sin(t))。非均匀缩放圆虽然能得到边界，但到缩放空间的距离不是原空间的欧氏距离。"
      },
      {
        "title": "离散为有限线段",
        "body": "把一周分成 64 段，对相邻采样点组成的每条弦求最近距离，取最小值。增加段数降低近似误差，同时线性增加查询成本。"
      },
      {
        "title": "明确近似误差",
        "body": "内部符号使用 dot(p/axes,p/axes)<1 的解析判断，距离大小来自内接折线；很靠近边界时二者会存在细小误差。本章不把该值当成精确椭圆 SDF，精确推导见延伸阅读。"
      }
    ],
    "experiment": {
      "parameter": "轮廓段数",
      "before": "循环上限 64；角度分母 64.0",
      "after": "循环上限 16；两个角度分母都改为 16.0",
      "expected": "角度较大处可能看到折线误差；再提高到 128 可比较精度与成本。"
    }
  },
  {
    "id": "arc-distance",
    "title": "圆弧：限制角度并补上圆头端点",
    "stage": 2,
    "goal": "把完整圆周的最近点限制在一个角度区间内。",
    "intro": "对以正 x 方向为中线、半角为 a 的圆弧，先用 atan2 得到查询点的方向，再把角度限制在 [−a,a]。范围内最近点在圆上，范围外最近点会落到两端之一。",
    "detail": "算出圆弧上的最近点 r·(cosθ,sinθ)，取查询点到它的距离，再减去笔画半宽。这样能得到有圆头端点的粗圆弧，而不是用一个角度遮罩把圆环切出平头。",
    "formula": "θ = clamp(atan2(p.y,p.x),−a,a)\nd = length(p − r×vec2f(cosθ,sinθ)) − thickness",
    "pitfall": "本实现区间围绕正 x 轴，要求 0<a<π。任意跨越 ±π 接缝的角区间需要先旋转到局部坐标。",
    "exercise": "把半角从 2.2 改到 0.8，再加粗笔画，观察端点是否保持圆头。",
    "references": [
      "iq-2d"
    ],
    "change": "从完整圆周限制角度范围，再把圆弧扩张成有厚度的笔画。",
    "expected": "右侧为主的圆弧带有圆形端帽，左侧留有缺口。",
    "steps": [
      {
        "title": "选择圆周最近方向",
        "body": "atan2(p.y,p.x) 得到点相对圆心的角度。完整圆的最近点位于这个方向。"
      },
      {
        "title": "把角度限制到弧段",
        "body": "本章弧段围绕 +X，范围为 [-a,a]，且 0<a<π。clamp(angle,-a,a) 会把超出范围的点投影到最近端点。"
      },
      {
        "title": "由曲线变笔画",
        "body": "用 r*(cos(angle),sin(angle)) 得到最近点，距离 length(p-q) 再减 thickness。端点外扩后自然成为半圆端帽。"
      }
    ],
    "experiment": {
      "parameter": "半张角",
      "before": "2.2",
      "after": "1.2",
      "expected": "弧段总角度从 4.4 弧度缩短到 2.4 弧度，半径与厚度不变。"
    }
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
    ],
    "change": "保留圆角框函数，增加逆平移、逆旋转、均匀缩放和距离还原。",
    "expected": "向右平移、逆时针旋转的圆角矩形，等距带仍保持世界空间尺度。",
    "steps": [
      {
        "title": "先回到形状中心",
        "body": "查询世界点 p 时先减去 center。直觉上物体向右移动，代码中的查询点却要向左减，这是逆变换。"
      },
      {
        "title": "把坐标逆旋转",
        "body": "矩阵乘查询点，应使用物体旋转的反角度。WGSL 构造矩阵按列填充，必须核对正负号。"
      },
      {
        "title": "还原距离单位",
        "body": "局部坐标除以 scale 后，函数返回局部距离；再乘 scale 才得到世界距离。只变换输入会让描边和步长比例出错。"
      }
    ],
    "experiment": {
      "parameter": "scale",
      "before": "1.25",
      "after": "0.75",
      "expected": "物体缩小，等距带世界间距不随之缩小。"
    }
  },
  {
    "id": "boolean",
    "title": "布尔并集：从符号逻辑得到 min",
    "stage": 2,
    "goal": "把多个简单 SDF 组合成可读的复杂轮廓。",
    "intro": "在内部为负的约定下，并集用 min(dA,dB)，交集用 max(dA,dB)，A 减 B 用 max(dA,−dB)。先画两个相交圆，再观察哪一侧的符号决定最后的轮廓。",
    "detail": "这些运算精确表达集合边界，但组合后的场在整个空间不一定仍是精确距离。对外部 Sphere Tracing，正确的保守距离界仍然有价值；不要把组合公式与全局精确距离混为一谈。",
    "formula": "union = min(a, b)\nintersection = max(a, b)\nA_minus_B = max(a, -b)",
    "pitfall": "差集不满足交换律；max(b,−a) 表示 B 减 A。",
    "exercise": "用圆减去偏移圆画月牙，再用矩形和圆做一个钥匙孔。",
    "references": [
      "iq-3d"
    ],
    "change": "使用同一对圆角矩形和圆，先实现并集，作为后续布尔实验的共同起点。",
    "expected": "两个图形连接成一个整体；外侧边界可见，重叠区域不会挖空。",
    "steps": [
      {
        "title": "同时计算两张距离场",
        "body": "a 来自偏左的圆角框，b 来自偏右的圆。先临时分别输出 a、b，确认位置与尺寸。"
      },
      {
        "title": "从逻辑条件推 min",
        "body": "只要 a 或 b 之一为负，点就在并集内；min(a,b) 恰好满足这一条件。"
      },
      {
        "title": "观察距离的切换线",
        "body": "两个距离相等处会切换最近图形。硬 min 可能产生梯度接缝，这不是抗锯齿能解决的问题，之后用平滑并集建模。"
      }
    ],
    "experiment": {
      "parameter": "圆的水平中心",
      "before": "0.25",
      "after": "0.75",
      "expected": "两个图形逐渐分离；并集保留两者，不会只剩一个。"
    }
  },
  {
    "id": "intersection",
    "title": "交集：保留同时在内部的区域",
    "stage": 2,
    "goal": "在同一对图形上把 min 改为 max，并检查符号。",
    "intro": "一个点属于交集，要求它同时在 A 内和 B 内，即两个距离都为负。max(a,b) 只有在两者都为负时才为负，因此它表达交集的内部。",
    "detail": "保留前章完全相同的圆与圆角框，只修改组合表达式。这样画面差异直接来自 max，而不是同时移动物体造成的干扰。",
    "formula": "dIntersection = max(dA,dB)",
    "pitfall": "交集很容易消失：两个形状没有重叠时，没有任何点能同时使两个距离为负。",
    "exercise": "先只改 min 为 max，再把圆向右移到完全不相交，观察结果变空。",
    "references": [
      "iq-3d"
    ],
    "change": "保留并集章节的两个图元，只把 min(a,b) 改成 max(a,b)。",
    "expected": "仅留下圆和圆角矩形重叠的区域，任意一个图形外的点都被排除。",
    "steps": [
      {
        "title": "先从符号推导",
        "body": "重叠区域要求 a<0 且 b<0。两个数的最大值仍为负，当且仅当两个数都为负。"
      },
      {
        "title": "因此选择 max",
        "body": "d=max(a,b) 的零边界与交集一致。只改一行就能看到形状由整体组合变为共同部分。"
      },
      {
        "title": "区分符号正确与精确距离",
        "body": "在拐角和复合边界附近，布尔组合不保证处处是真正的欧氏 SDF。它对建模很有用，但不要把所有等值线都解释为精确最近距离。"
      }
    ],
    "experiment": {
      "parameter": "圆的横向偏移",
      "before": "0.25",
      "after": "0.6",
      "expected": "重叠部分减小，分离到足够远时交集消失。"
    }
  },
  {
    "id": "difference",
    "title": "差集：翻转被减图形的符号",
    "stage": 2,
    "goal": "把 A 内、B 外两个条件写成一个场。",
    "intro": "A 减 B 的内部要求 a<0 且 b>0。先把 B 的符号翻转为 −b，再与 A 做交集，得到 max(a,−b)。",
    "detail": "同样保留前章的图形位置，只在 max 的第二个参数前加负号。圆原本覆盖的部分现在变成缺口；移走圆后圆角框应恢复完整。",
    "formula": "A − B = max(a,−b)\nB − A = max(b,−a)",
    "pitfall": "差集有顺序。对两个字段同时取负再做 min，并不等于 A 减 B。",
    "exercise": "交换 a 与 b，预测剩下哪部分后再运行；最后用差集做一个月牙或钥匙孔。",
    "references": [
      "iq-3d"
    ],
    "change": "沿用相同图元，把圆的符号翻转后与矩形求交，形成挖孔。",
    "expected": "矩形右侧被圆切去一个弧形缺口，而不是只留下重叠区域。",
    "steps": [
      {
        "title": "用负号表示补集",
        "body": "圆内 b<0，翻转后 -b>0；圆外变为负。-b 因此描述圆外的区域。"
      },
      {
        "title": "与主体求交",
        "body": "保留矩形内部且位于圆外，使用 max(a,-b)。被减图形只影响相交部分，远离主体时不会产生新物体。"
      },
      {
        "title": "检验顺序",
        "body": "A-B 与 B-A 不相同。交换为 max(b,-a) 应得到圆被矩形切剩的部分，能直接验证逻辑而非记忆公式。"
      }
    ],
    "experiment": {
      "parameter": "差集顺序",
      "before": "max(a,-b)",
      "after": "max(b,-a)",
      "expected": "从矩形挖圆改为从圆挖矩形，结果位置与轮廓明显不同。"
    }
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
    ],
    "change": "保持图形位置不变，用带宽参数的平滑最小值替换硬并集。",
    "expected": "圆和圆角框在交界处形成圆润连接，形状比硬并集略饱满。",
    "steps": [
      {
        "title": "先限定混合区间",
        "body": "h=clamp(0.5+0.5(b−a)/k,0,1)。距离差大于 k 时 h 饱和，远离接缝仍取原来的图元距离。"
      },
      {
        "title": "补偿中间区域",
        "body": "只 mix 两个距离会改变选择方式但不足以形成期望的平滑轮廓；减去 k·h(1−h)，在中心提供最大圆滑扩张。"
      },
      {
        "title": "检查退化与尺度",
        "body": "k 必须大于零。将 k 减小会接近硬并集，但过小可能低于像素尺度；扩大 k 会明显改变造型，不仅改变边缘颜色。"
      }
    ],
    "experiment": {
      "parameter": "平滑宽度",
      "before": "0.28",
      "after": "0.06",
      "expected": "接缝逐渐接近硬并集的锐利形状。"
    }
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
    ],
    "change": "复用圆角框，将查询坐标折回重复单元，并令隔行错位。",
    "expected": "规则的圆角砖墙；每隔一行水平偏移半个砖格。",
    "steps": [
      {
        "title": "分开单元编号与局部位置",
        "body": "floor(p/period) 用于判断所在格子，fract(p/period) 用于在该格内部查询同一个图元。"
      },
      {
        "title": "把中心放回原点",
        "body": "fract 结果在 0–1，减 0.5 后乘 period，得到居中局部坐标。halfSize 应小于半周期，给相邻砖留间隔。"
      },
      {
        "title": "利用行编号错位",
        "body": "奇偶行决定是否多加半个水平周期。这里所有砖同尺寸且不跨单元，才可以只查询当前单元；不规则大砖需看邻格。"
      }
    ],
    "experiment": {
      "parameter": "水平周期",
      "before": "0.62",
      "after": "0.8",
      "expected": "砖之间的水平空隙变宽，砖本身半尺寸不变。"
    }
  },
  {
    "id": "noise",
    "title": "随机值与噪声：从可复现哈希开始",
    "stage": 3,
    "goal": "先区分无关联的随机格子和连续噪声，再理解种子如何控制结果。",
    "intro": "噪声函数通常是确定性的：同一坐标和同一种子总得到同一个值。独立哈希值没有相邻连续性，因此直接把它们画成高度，会得到一格一格的跳变。后续章节将保留这些格点，只逐步改变格点之间的计算。",
    "detail": "本章用整数位运算生成 [0,1) 的格点值，避免以时间作为随机来源。x 先 floor 成整数，整数再参与哈希；NOISE_SEED 用来选择另一套可复现图案。这只是教学哈希，不是用于安全或密码的随机数。",
    "formula": "i = floor(x)\ny = hash(i, seed)\nheight = y * 1.4 - 0.7",
    "pitfall": "哈希输出是伪随机值，不等于平滑噪声。把 seed 改成每帧变化的时间，会让后续地形跳动；改变坐标与改变随机种子也不是同一件事。",
    "exercise": "修改 NOISE_SEED 后记住图案，再恢复 17u；验证原来的阶梯逐格回到同样位置。",
    "change": "将复杂噪声拆回最小起点：整数格点、固定种子和分段常量高度。",
    "expected": "画面是一条绿色阶梯高度线，每个整数格子内保持常量，格子之间突然跳变。",
    "references": [
      "book-noise"
    ],
    "steps": [
      {
        "title": "分离格子与局部位置",
        "body": "用 floor(x) 找到整数格子。负坐标也应使用 floor，直接转整数会向零截断，导致原点左边的格子划分与右边不同。"
      },
      {
        "title": "把坐标映射为固定值",
        "body": "格点整数与 NOISE_SEED 组合后进行整数混合，取低 24 位除以 2²⁴，得到 [0,1) 数值。坐标和种子相同，结果就不随帧变化。"
      },
      {
        "title": "先观察不连续性",
        "body": "每格只使用自己的格点值，所以边界会跳变。保留这份数据，下一章仅在相邻格点之间加入插值，便可看清随机值如何变成连续曲线。"
      }
    ],
    "experiment": {
      "parameter": "NOISE_SEED",
      "before": "17u",
      "after": "29u，再恢复 17u",
      "expected": "整条阶梯换成另一套确定图案；恢复种子会恢复原图。"
    }
  },
  {
    "id": "noise-1d-linear",
    "title": "1D 噪声Ⅰ：两个端点与线性插值",
    "stage": 3,
    "goal": "在一条轴上连接随机格点，获得连续但有折角的噪声曲线。",
    "intro": "一维噪声输入一个标量坐标，输出一个标量值。令 i=floor(x)、f=fract(x)，只需要 i 与 i+1 两个格点值；f 从 0 到 1 表示当前点在区间内的位置。",
    "detail": "沿用上一章的种子、采样范围和画图方式，只把每格常量替换为 mix(a,b,f)。曲线经过所有原格点，值在边界处连续，但不同区间的斜率通常不同，因此会出现折角。",
    "formula": "i = floor(x), f = fract(x)\na = hash(i), b = hash(i+1)\nnoise1(x) = (1-f)*a + f*b",
    "pitfall": "一维指的是输入坐标的维度，不是画面只有一行像素。这里只插值随机值，属于 value noise；没有实现经典 Perlin 的梯度噪声算法。",
    "exercise": "把 x 的频率从 3.0 改为 6.0，观察单位画面内的区间数翻倍，同时单段高度仍保持同一范围。",
    "change": "复用随机格点，把阶梯边界替换成连接端点的直线。",
    "expected": "原阶梯变成连续折线，所有原格点的高度保留，相邻线段交接处仍有折角。",
    "references": [
      "book-noise"
    ],
    "steps": [
      {
        "title": "找到两侧端点",
        "body": "floor 得到左端点 i，右端点就是 i+1。即使 x<0，fract(x) 仍在 [0,1) 内，可以保持同一套左右端点定义。"
      },
      {
        "title": "按局部位置加权",
        "body": "f=0 时完整采用左端点，f 趋近 1 时趋近右端点。跨入下一个格子后，该右端点变成新的左端点，所以函数值连续。"
      },
      {
        "title": "检查值与斜率的区别",
        "body": "相邻段共享端点值，却不共享两端差值，因此斜率会跳变。用它驱动物体速度或表面法线可能出现突变，下一章改用平滑权重。"
      }
    ],
    "experiment": {
      "parameter": "横向频率",
      "before": "3.0",
      "after": "6.0",
      "expected": "画面内的折线起伏更密，噪声振幅不变。"
    }
  },
  {
    "id": "noise-1d-smooth",
    "title": "1D 噪声Ⅱ：平滑权重与连续斜率",
    "stage": 3,
    "goal": "保留格点值，用平滑插值消除线性噪声的折角。",
    "intro": "把 mix 的权重 f 替换为 u=f²(3-2f)。u(0)=0、u(1)=1，且 u 在两端的导数为零，所以相邻区间可以以相同的零斜率相接。",
    "detail": "本章与上一章使用完全相同的哈希值，仅更换一处插值权重。它仍经过原来的随机格点，但连接方式从直线变成平滑的 S 形。若需要更高阶光滑性，可以继续使用五次权重 6f⁵-15f⁴+10f³。",
    "formula": "u = f*f*(3.0-2.0*f)\nnoise1(x) = mix(hash(i),hash(i+1),u)\nu'(f) = 6f(1-f)",
    "pitfall": "三次权重使一阶导数在边界连续，但不保证二阶导数连续。平滑不等于增加细节，也不代表噪声一定更随机；端点处变平是这一权重的明确特征。",
    "exercise": "替换为 f*f*f*(f*(f*6.0-15.0)+10.0)，比较五次权重与三次权重的曲线过渡。",
    "change": "只修改插值权重，让同一组随机高度以连续斜率连接。",
    "expected": "绿色折线变为平滑曲线，格点位置与高度保持不变，各格点附近的斜率趋于零。",
    "references": [
      "book-noise"
    ],
    "steps": [
      {
        "title": "给插值权重加边界条件",
        "body": "希望函数仍准确经过两个端点，同时在端点附近减速。使用三次多项式，约束 u(0)=0、u(1)=1 和两个端点导数为零，可解得 3f²-2f³。"
      },
      {
        "title": "保留哈希与采样方式",
        "body": "a、b、i 和 f 都不改，只把 mix(a,b,f) 改成 mix(a,b,u)。这种单一变化方便与前一章逐行对比，而不是同时换一整套算法。"
      },
      {
        "title": "把平滑曲线用于连续变化",
        "body": "曲线可用于位置偏移、风力或亮度起伏。提高输入频率使变化更快，乘输出振幅使变化更强；这两种控制需要分别理解。"
      }
    ],
    "experiment": {
      "parameter": "插值权重",
      "before": "f*f*(3.0-2.0*f)",
      "after": "f",
      "expected": "恢复为线性折角，可直接观察平滑权重解决的问题。"
    }
  },
  {
    "id": "noise-2d",
    "title": "2D 噪声：四个角点与双线性插值",
    "stage": 3,
    "goal": "把一维的两端插值推广到二维四角，生成连续灰度纹理。",
    "intro": "二维值噪声在每个网格单元使用四个角点。先沿 X 分别插值上下两条边，再沿 Y 混合这两条边的结果；两个轴都使用上一章的平滑权重。",
    "detail": "示例左半边只显示格点哈希，右半边显示四角插值后的连续结果。两边使用同一个坐标与种子，因此可以看到插值怎样把没有关联的格子过渡为连续区域。",
    "formula": "i = floor(p), f = fract(p), u = f*f*(3-2*f)\na = mix(h(i),h(i+(1,0)),u.x)\nb = mix(h(i+(0,1)),h(i+(1,1)),u.x)\nnoise2(p) = mix(a,b,u.y)",
    "pitfall": "二维输入不代表必须返回 vec2；这里每个位置返回一个 f32 灰度。四角值噪声与在四角生成梯度向量再点积的 Perlin 噪声不同。",
    "exercise": "只增加 q.x 的频率，保持 q.y 不变，观察噪声怎样被压成沿一个方向拉长的纹理。",
    "change": "从两个端点扩展为四个角点，增加左右分屏来比较独立格子与连续噪声。",
    "expected": "左半是没有平滑过渡的灰色方格，右半是连续的明暗起伏，没有格子间突然跳变。",
    "references": [
      "book-noise"
    ],
    "steps": [
      {
        "title": "定位二维单元",
        "body": "对 p 的两个分量分别 floor 和 fract，得到左下角格点与单元内坐标。相邻单元必须共享边上的哈希值，否则会出现接缝。"
      },
      {
        "title": "按轴分两次插值",
        "body": "先沿 X 得到下边和上边的两个中间值，再沿 Y 插值它们。四角共享同一个哈希函数，不要给每个单元重新生成互不相干的四个角点。"
      },
      {
        "title": "把数值显示成纹理",
        "body": "将 noise2 返回值复制到 RGB 得到灰度图。输入 p*4 控制空间频率，固定种子保证图案静止；纹理坐标随时间平移则可以让图案移动。"
      }
    ],
    "experiment": {
      "parameter": "输入空间频率",
      "before": "p*4.0",
      "after": "p*8.0",
      "expected": "右侧起伏更细、左侧格子更小，数值范围保持不变。"
    }
  },
  {
    "id": "noise-fbm",
    "title": "2D fBM：大轮廓与细节分层",
    "stage": 3,
    "goal": "叠加多层二维噪声，分别控制频率、振幅和细节层数。",
    "intro": "单层噪声只覆盖一种主要尺度。fBM 将多层噪声相加，每层提高频率并降低振幅：低频形成大轮廓，高频补充小细节。本例使用四层，每层频率翻倍，振幅减半。",
    "detail": "为了让不同层数更容易比较，本例同时累计权重，最终用 sum/weight 归一化。每层添加固定坐标偏移以减弱相同格点的对齐现象；固定偏移与种子都保持确定性。",
    "formula": "sum += amplitude * noise2(q)\nweight += amplitude\nq = q*2.0 + offset\namplitude *= 0.5\nresult = sum / weight",
    "pitfall": "层数越多成本越高，也可能生成小于像素的细节而发生闪烁。归一化保证范围可比较，不保证不同层数的每一个位置亮度相同。",
    "exercise": "将 octave<4 改为 octave<1、2、6，逐次比较轮廓和细节，不同时改频率与振幅。",
    "change": "保留二维连续噪声，增加多尺度累加与权重归一化。",
    "expected": "灰度图同时出现大块明暗与细小起伏；减少到一层时细节消失，大轮廓更明显。",
    "references": [
      "book-noise",
      "book-fbm"
    ],
    "steps": [
      {
        "title": "保留第一层大形",
        "body": "初始 q=p、amplitude=0.5，把低频噪声作为轮廓基础。先看这一层，再加入更高频率，才能分辨每层对画面的贡献。"
      },
      {
        "title": "提高频率并减小振幅",
        "body": "每层 q 乘 2，amplitude 乘 0.5，让更细的细节拥有更小的权重。频率倍率常称 lacunarity，振幅倍率常称 gain。"
      },
      {
        "title": "归一化后比较参数",
        "body": "将累加值除以全部振幅之和，输出仍位于 [0,1]。层数必须是正数；零层时没有有效权重，不能继续除以 weight。"
      }
    ],
    "experiment": {
      "parameter": "octave 上限",
      "before": "4",
      "after": "1，再试 6",
      "expected": "一层只有粗起伏；六层增加细节与计算成本，不会简单把整个画面叠得更亮。"
    }
  },
  {
    "id": "noise-heightmap",
    "title": "2D 高度图：海岸、山地与等高线",
    "stage": 3,
    "goal": "将二维噪声解释为地表高度，为体素地形准备同一个高度函数。",
    "intro": "把二维输入理解成世界的水平 XZ 坐标，把输出解释为高度 H(x,z)。画面颜色区分海水、沙地、草地和高山，等高线标出相同高度；它是俯视的高度数据，不是已经建立三维网格。",
    "detail": "这一表示对每个 XZ 位置只保存一个表面高度。因此它能表达山谷，却不能表达同一列里的洞穴、天然桥或悬挑。后面的体素练习会先用 y<H 填充方块，再让三维密度决定内部是否为空。",
    "formula": "H(x,z) = baseHeight + amplitude * fbm2(vec2f(x,z)*frequency)\nsolid(x,y,z) = y < H(x,z)",
    "pitfall": "把二维噪声画在立体物体表面并不会自动变成三维噪声。这里 y 是高度结果而非噪声输入；同一 XZ 上不能同时保存两个互相分离的表面。",
    "exercise": "把海岸阈值从 0.4 调高，观察陆地面积减少；然后只改输入频率，比较岛屿数量与高度分层的差别。",
    "change": "在同一张 fBM 数据上增加高度配色和等高线，开始解释地形含义。",
    "expected": "俯视图出现海岸、绿色地表与浅色高地，细线围绕相近高度区域形成等高线。",
    "references": [
      "book-noise",
      "book-fbm"
    ],
    "steps": [
      {
        "title": "明确坐标与数据的关系",
        "body": "noise2 仍只接收两个数，但把它们命名为世界 X 与 Z。输出乘振幅并加基准高度，才获得以方块或世界单位衡量的地表高度。"
      },
      {
        "title": "用阈值映射地貌颜色",
        "body": "在不同高度区间平滑混合水、沙、草和岩石颜色。颜色只是观察数据的方式，改变配色不应该反过来改变地表高度本身。"
      },
      {
        "title": "认识单值高度的限制",
        "body": "对固定的 xz，只要 y 低于 H 就是实体，上方全为空。想在地表下面挖空但保留上面的方块，就必须让判定额外依赖 y；三维噪声正好提供这样的输入。"
      }
    ],
    "experiment": {
      "parameter": "等高线密度",
      "before": "h*12.0",
      "after": "h*6.0（两个位置一起修改）",
      "expected": "等高线数量减少，高度数据与地貌配色不变。"
    }
  },
  {
    "id": "noise-3d",
    "title": "3D 噪声：八个角点与移动切片",
    "stage": 3,
    "goal": "把二维四角插值推广到三维八角，观察体数据内部的连续变化。",
    "intro": "三维值噪声接收 (x,y,z)，每个立方单元有八个角点。先分别在前后两层完成二维插值，再沿第三个轴混合，得到空间中的一个连续标量场。",
    "detail": "示例用屏幕 p 表示 X、Y，把 z=iTime*0.25 当作切片深度。播放时图案逐渐变形，是在穿过一个固定的三维场；暂停时切片停住。这里 z 只是数据轴，不一定是场景中的水平轴。",
    "formula": "z0 = bilinear(four corners at z, u.xy)\nz1 = bilinear(four corners at z+1, u.xy)\nnoise3(p) = mix(z0,z1,u.z)",
    "pitfall": "将噪声值复制成 RGB 不会增加输入维度。第三维也不一定是时间：体素地形中三个输入都是空间坐标；切片动画只是把三维数据展示在二维画布上的方法。",
    "exercise": "把 z 改成固定 0.0、0.5、1.0，观察三张相关但不同的截面，再交换 XZ 轴查看另一个切片方向。",
    "change": "在二维四角插值基础上增加前后两层与第三次插值，并让切片深度随时间推进。",
    "expected": "彩色噪声图案随播放连续生长、消退和变形，而不是整张图向同一个方向平移。",
    "references": [
      "book-noise"
    ],
    "steps": [
      {
        "title": "生成八个共享角点",
        "body": "floor(p) 找到立方单元低端角点，三个轴各偏移 0 或 1，共有八种组合。所有角点用坐标哈希，邻接立方体就能共享同一面上的值。"
      },
      {
        "title": "沿三轴逐级插值",
        "body": "先沿 X 得到四个值，再沿 Y 得到前后层的两个值，最后沿 Z 合成一个值。三个轴都使用相同平滑权重，保证跨单元边界连续。"
      },
      {
        "title": "用切片观察空间场",
        "body": "固定一个坐标就能得到二维截面。缓慢改变 z 会连续穿过密度结构；如果改 seed，则是在换整个场，会产生跳变而不是连续移动。"
      }
    ],
    "experiment": {
      "parameter": "切片速度",
      "before": "iTime*0.25",
      "after": "iTime*0.75",
      "expected": "切片穿过三维场的速度增至三倍，空间频率与种子保持不变。"
    }
  },
  {
    "id": "noise-fbm3d",
    "title": "3D fBM：空间中的粗细结构",
    "stage": 3,
    "goal": "把多尺度叠加推广到三维，为密度场、岩石和洞穴细节建立基础。",
    "intro": "三维 fBM 与二维版本的循环相同，只是每一层采样 noise3(q)。大尺度可以决定洞室与岩层走势，小尺度补充不规则细节；输出依然是一个标量，可以被解释成密度或形状偏移。",
    "detail": "示例左侧显示单层三维噪声，右侧显示四层归一化 fBM，使用相同切片深度与坐标。后面的洞穴示例先用单层 3D 噪声保持孔洞清楚和成本可控，再把这里的多层版本作为升级练习。",
    "formula": "fbm3(p) = Σ amplitude[k]*noise3(p*frequency[k]+offset[k]) / Σ amplitude[k]",
    "pitfall": "噪声或 fBM 值通常不是到表面的真实距离，不能直接当成 SDF 的安全步长。体素示例按网格逐格判断密度，避免大步跨过薄墙。",
    "exercise": "将高频权重衰减从 0.5 改为 0.7，观察细节增强；再降低采样层数比较渲染成本。",
    "change": "沿用移动切片，把单层三维噪声与多层 fBM 放在左右两侧比较。",
    "expected": "左侧结构较粗，右侧在大形里叠加细碎空间纹理，播放时两侧都随深度连续变化。",
    "references": [
      "book-noise",
      "book-fbm"
    ],
    "steps": [
      {
        "title": "每层缩放三个坐标",
        "body": "q 是 vec3，因此频率提高会同时缩小 X、Y、Z 三个方向上的结构。只缩放其中两个轴会得到被拉长的各向异性纹理。"
      },
      {
        "title": "限制细节的贡献",
        "body": "通过振幅衰减让高频层不覆盖整体轮廓，并用权重总和归一化。要形成洞穴，还需要选择阈值、合并地表约束并限制世界范围。"
      },
      {
        "title": "决定如何解释输出",
        "body": "noise3 返回的数既可以表示密度，也可以用于颜色或坐标变形。作为体素密度时，对阈值做布尔判定；作为连续体积时，需要沿射线积分而不是只取表面颜色。"
      }
    ],
    "experiment": {
      "parameter": "高频振幅衰减",
      "before": "0.5",
      "after": "0.7（修改循环内 amplitude 倍率）",
      "expected": "右侧细节贡献增大，归一化后不会简单提高整张图的亮度。"
    }
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
    ],
    "change": "不再直接显示噪声，而是用两个噪声值偏移条纹的采样坐标。",
    "expected": "原本竖直的条纹被扭曲成流动的弯曲纹路。",
    "steps": [
      {
        "title": "先准备未经扭曲的条纹",
        "body": "令 q=p，sin(q.x×20) 就是规律平行条纹。这是所有域变形效果的对照基线。"
      },
      {
        "title": "构造二维位移",
        "body": "分别在不同偏移处采样 fBM，避免 x、y 位移总相同。减去 0.5 让位移大致围绕零分布。"
      },
      {
        "title": "把位移放到输入端",
        "body": "q=p+strength·field 后再计算条纹。把噪声加到最终颜色只会变亮变暗，不能把原来的线条推弯。"
      }
    ],
    "experiment": {
      "parameter": "扭曲强度",
      "before": "0.5",
      "after": "0.0",
      "expected": "弯曲完全消失，恢复等间隔竖直条纹。"
    }
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
    ],
    "change": "把二维 p 提升为从相机出发的三维方向，暂不寻找物体。",
    "expected": "画面连续显示射线方向的 RGB，中心与四角的方向不同。",
    "steps": [
      {
        "title": "确定相机",
        "body": "光线写成 ro+t·rd。ro 是所有像素共享的相机位置，t≥0 表示沿光线前进的距离。"
      },
      {
        "title": "把屏幕放入空间",
        "body": "用 vec3f(p,-1.8) 表示像素指向虚拟屏幕的位置。负 Z 约定相机朝前的方向，1.8 是焦距。"
      },
      {
        "title": "归一化并观察",
        "body": "normalize 后 rd 的长度为 1，步进参数 t 才具有距离单位。把方向从 [-1,1] 映射到 [0,1] 即可检查相机。"
      }
    ],
    "experiment": {
      "parameter": "焦距",
      "before": "1.8",
      "after": "1.0",
      "expected": "边缘射线更倾斜，视野更宽；颜色变化增强。"
    }
  },
  {
    "id": "sdf3d",
    "title": "3D 距离场：先观察空间切片",
    "stage": 4,
    "goal": "把二维距离场工具迁移到三维空间。",
    "intro": "球的距离仍是 length(p)−r，只是 p 变成了 vec3f。盒子公式也沿用二维思路。圆环则先把 xz 平面到主圆的距离与 y 高度组成 vec2，再计算到小圆的距离。",
    "detail": "二维轮廓沿一个轴拉伸，可以产生立体字、徽标或机械零件。场景函数 map(p) 应只回答距离；将材质编号或颜色作为额外结果返回，避免把它们混进距离本身。",
    "formula": "torus(p) = length(vec2f(length(p.xz) − majorRadius, p.y)) − minorRadius",
    "pitfall": "圆环的主半径与管半径不是同一尺寸；返回颜色长度不能替代距离。",
    "exercise": "把球替换成圆环，再用盒子减去一部分，得到开口机械环。",
    "references": [
      "iq-3d"
    ],
    "change": "沿用圆的距离，把二维 length 换成三维 length；先画 z 固定的切片。",
    "expected": "中心为半径约 0.6 的圆形切片，周围距离等值线不再等间隔。",
    "steps": [
      {
        "title": "从圆推广到球",
        "body": "二维圆用 sqrt(x²+y²)-r；加入 z² 后得到 sqrt(x²+y²+z²)-r。三维空间中沿任意径向都一样。"
      },
      {
        "title": "固定一个维度",
        "body": "令 z=0.25、r=0.65，把平面 p 嵌入 vec3f(p,0.25)。零等值线满足 x²+y²=0.65²-0.25²=0.36。"
      },
      {
        "title": "区分空间距离与切片距离",
        "body": "函数返回到球面的三维最短距离，并非到截面圆的二维最短距离。切片内部符号正确，但沿切片移动时梯度长度可小于 1。"
      }
    ],
    "experiment": {
      "parameter": "切片 z",
      "before": "0.25",
      "after": "0.55",
      "expected": "截面半径缩至约 0.346；当 |z|>0.65 时不再与球相交。"
    }
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
    ],
    "change": "用已有球体距离函数加入命中循环，得到第一个真正的三维物体。",
    "expected": "背景中出现一个青绿色球体轮廓；此时没有真实光照。",
    "steps": [
      {
        "title": "逐次查询",
        "body": "从 t=0 开始，当前位置是 ro+rd*t，查询 d=map(position)。相机处于物体外时 d 为正，可安全向前走近表面。"
      },
      {
        "title": "判定与退出",
        "body": "d<0.001 认为命中；t>20 或迭代达到 80 次认为未命中。最大步数限制成本，最大距离限制场景范围。"
      },
      {
        "title": "保留调试量",
        "body": "trace 返回命中距离和使用的步数。现在先用距离调色，之后在同一个命中点计算法线和光照，不必更换建模方式。"
      }
    ],
    "experiment": {
      "parameter": "命中阈值",
      "before": "0.001",
      "after": "0.02",
      "expected": "边缘精度下降，物体可能略膨胀；恢复小阈值后轮廓更准确。"
    }
  },
  {
    "id": "sphere-distance",
    "title": "球体距离：增加地面与第二个球",
    "stage": 4,
    "goal": "将二维圆的径向推导原样拓展到三维。",
    "intro": "球面上的最近点仍沿中心到查询点的方向，因此 length(p−center)−radius 在三维仍然精确。与圆相比，新增的维度只改变向量长度计算，不改变推导逻辑。",
    "detail": "在上一章的单球步进中添加第二个球和地面半空间，用 min 组合。第一次有多个表面竞争成为最近点，主射线仍只调用一个 sceneDistance。",
    "formula": "sphere = length(p−center)−radius\nfloor = p.y−floorHeight\nscene = min(sphere,floor)",
    "pitfall": "场景中的地面使用半空间，表面以下都是内部；相机应放在地面上方、物体之外。",
    "exercise": "把小球沿 y 轴下移，观察它与大球相交时轮廓怎样切换。",
    "references": [
      "iq-3d"
    ],
    "change": "保留步进器，把一个球扩为大小球与地面的场景，为后续图元提供参照。",
    "expected": "左侧出现一个大球和上方小球，下面有平面；仍使用深度颜色。",
    "steps": [
      {
        "title": "移动球心",
        "body": "球体距离为 length(p-center)-radius。平移影响采样点，不需要改变 length 的公式。"
      },
      {
        "title": "加入地面",
        "body": "y=-0.7 的水平面距离为 p.y+0.7，法线朝 +Y。相机在平面上方，查询为正。"
      },
      {
        "title": "用并集合场景",
        "body": "对两个球与平面取 min 得到 sceneDistance。保留同一相机、命中阈值和着色，让新增几何的影响可以单独比较。"
      }
    ],
    "experiment": {
      "parameter": "上方小球半径",
      "before": "0.17",
      "after": "0.25",
      "expected": "小球膨胀并更接近大球；观察它与地面之间的遮挡关系。"
    }
  },
  {
    "id": "box-distance-3d",
    "title": "盒子距离：面、棱与角的统一公式",
    "stage": 4,
    "goal": "把二维矩形的内外分支推广到三维。",
    "intro": "令 q=abs(p)−halfSize。只有一个正分量时，最近点位于面；两个正分量对应棱；三个正分量对应角。length(max(q,0)) 一次性覆盖这些外部区域。",
    "detail": "内部所有分量非正，距离由最接近零的分量给出，即 max(q.x,q.y,q.z)。把内部项限制为非正，与外部项相加，就得到完整盒子 SDF。",
    "formula": "d = length(max(q,0)) + min(max(q.x,max(q.y,q.z)),0)",
    "pitfall": "只取最大分量是另一种距离度量，不能替代盒角外部的欧氏距离。",
    "exercise": "让三个半尺寸不同，制作长方体；观察对角方向与正面方向的步进差别。",
    "references": [
      "iq-3d"
    ],
    "change": "保留球和平面，在右侧加入盒子，把二维矩形公式推广到三个轴。",
    "expected": "球右侧出现立方体，平面边缘与球的圆轮廓形成明显对照。",
    "steps": [
      {
        "title": "折叠八个象限",
        "body": "q=abs(p-center)-halfSize。三个分量分别表示到每对平行面的超出量。"
      },
      {
        "title": "外部距离",
        "body": "length(max(q,0)) 自动区分面外、棱外与角外：只有超出部分参与平方和。"
      },
      {
        "title": "内部距离",
        "body": "在盒内 q 的三个分量都为负，max(q.x,q.y,q.z) 选择最近的面。用 min(...,0) 把内部项限制在内部，再与外部项相加。"
      }
    ],
    "experiment": {
      "parameter": "盒半尺寸",
      "before": "vec3f(0.35)",
      "after": "vec3f(0.35,0.6,0.2)",
      "expected": "盒子变高且变薄；中心位置不变，下端可能进入地面。"
    }
  },
  {
    "id": "torus-distance",
    "title": "圆环距离：先降维，再求小圆距离",
    "stage": 4,
    "goal": "把到三维圆环的距离转成二维问题。",
    "intro": "圆环绕 y 轴旋转对称。先计算 xz 平面到轴的径向距离 length(p.xz)，减去主半径 R，就把大圆骨架附近的位置展开为一条轴。",
    "detail": "把该值与高度 p.y 组成 vec2f，再到半径 r 的小圆求距离。R 决定孔与整体尺寸，r 决定管粗。示例将圆环放到盒子上方，仍用 min 加入同一场景。",
    "formula": "d = length(vec2f(length(p.xz)−R,p.y))−r",
    "pitfall": "交换 xz 与 xy 会改变圆环朝向。常规不自交圆环要求 R>r>0。",
    "exercise": "只增大管半径，先预测孔会变大还是变小，再改变主半径比较。",
    "references": [
      "iq-3d"
    ],
    "change": "保留球、盒和地面，在盒上方加入圆环，用降维理解公式。",
    "expected": "右上方出现中空圆环，可以通过环孔看到后方背景或其他物体。",
    "steps": [
      {
        "title": "围绕轴旋转",
        "body": "圆环绕 Y 轴对称。先把 xz 平面压缩成径向长度 ρ=length(p.xz)，方向信息对圆环距离没有影响。"
      },
      {
        "title": "移到管截面中心",
        "body": "vec2f(ρ-R,p.y) 表示相对于管截面圆心的二维位置。R 是圆环主半径。"
      },
      {
        "title": "回到圆公式",
        "body": "length(vec2f(ρ-R,p.y))-r 就是到小圆管表面的距离。R>r>0 时保留清晰中心孔。"
      }
    ],
    "experiment": {
      "parameter": "圆管半径",
      "before": "0.10",
      "after": "0.18",
      "expected": "圆环变粗、孔变小，但管中心形成的主圆半径仍为 0.37。"
    }
  },
  {
    "id": "cylinder-distance",
    "title": "有限圆柱：圆盘与高度区间的乘积",
    "stage": 4,
    "goal": "同时处理侧面、端盖和端盖外缘。",
    "intro": "无限圆柱只需要 length(p.xz)−r，但它没有上下端盖。有限圆柱还需一个高度距离 abs(p.y)−h，其中 h 是半高。",
    "detail": "把径向距离与高度距离组成 vec2f q，再使用矩形的内外合并形式。圆柱角外同时存在径向和竖直偏移，应使用二者的欧氏长度。",
    "formula": "q = vec2f(length(p.xz)−r, abs(p.y)−h)\nd = length(max(q,0)) + min(max(q.x,q.y),0)",
    "pitfall": "只用 max(径向距离,高度距离) 会在端盖外缘低估实际距离。",
    "exercise": "把圆柱半高减到 0.05，变成薄圆盘；随后增加半径，检查端盖仍平整。",
    "references": [
      "iq-3d"
    ],
    "change": "在已有球、盒、环旁添加有限高圆柱，区分侧面与端盖距离。",
    "expected": "靠前位置多出一根竖直圆柱，侧面弯曲而上下端面平坦。",
    "steps": [
      {
        "title": "先求两个限制",
        "body": "径向超出量是 length(p.xz)-r，高度超出量是 abs(p.y)-h；h 是半高。"
      },
      {
        "title": "转成二维矩形组合",
        "body": "令 q=(径向超出,高度超出)，外部距离 length(max(q,0)) 处理端盖外侧棱角。"
      },
      {
        "title": "加回内部距离",
        "body": "min(max(q.x,q.y),0) 选择靠近侧壁还是端盖。不能简单只取 max 当成所有位置的精确距离，端盖与侧壁都超出时需平方和。"
      }
    ],
    "experiment": {
      "parameter": "圆柱半高",
      "before": "0.43",
      "after": "0.65",
      "expected": "圆柱上下延伸，底端可能进入地面，顶端更高；半径保持 0.17。"
    }
  },
  {
    "id": "extrusion-distance",
    "title": "拉伸：让二维多边形获得厚度",
    "stage": 4,
    "goal": "把已经实现的二维 SDF 作为三维造型模块复用。",
    "intro": "先在 xy 平面计算轮廓距离 d2，再沿 z 轴限制厚度 dz=abs(p.z)−h。对于正确的二维有符号距离，轮廓与区间的笛卡尔积可以使用二维 q 的内外合并公式。",
    "detail": "示例直接复用正六边形的最近边算法，把轮廓拉伸成一个小棱柱。这样之前的二维推导、投影和符号判断都真正成为三维代码的一部分。",
    "formula": "q = vec2f(sdf2d(p.xy),abs(p.z)−halfDepth)\nd = length(max(q,0)) + min(max(q.x,q.y),0)",
    "pitfall": "二维输入若只是具有正确零轮廓的任意函数，拉伸后的场也不能自动变成精确距离。",
    "exercise": "将六边形改为三角形，再把深度减半；比较只改变轮廓与只改变厚度。",
    "references": [
      "iq-3d"
    ],
    "change": "复用二维正多边形距离，在 Z 方向挤出一个六边形实体。",
    "expected": "场景上方出现带平面端盖的六边形块，前面学过的二维轮廓成为立体零件。",
    "steps": [
      {
        "title": "从平面轮廓出发",
        "body": "先计算 d2=sdPolygon(p.xy,0.34,6)。它描述到二维边界的距离与内部符号。"
      },
      {
        "title": "加入厚度限制",
        "body": "zDistance=abs(p.z)-0.13 定义前后两个端盖。将 (d2,zDistance) 视为两个独立的超出量。"
      },
      {
        "title": "复用组合结构",
        "body": "与有限圆柱相同，length(max(q,0))+min(max(q.x,q.y),0) 同时处理侧壁、端盖和棱角。这里二维轮廓为精确多边形距离，任意近似函数挤出时也会继承其误差。"
      }
    ],
    "experiment": {
      "parameter": "挤出半深度",
      "before": "0.13",
      "after": "0.4",
      "expected": "六边形端面轮廓保持不变，前后厚度增加；改变视角时更容易观察。"
    }
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
    ],
    "change": "保留前面累积的三维图元，把深度颜色换成距离梯度的方向颜色。",
    "expected": "球、盒、环、圆柱和六边形挤出体各自显露不同的彩色表面方向。",
    "steps": [
      {
        "title": "寻找最大增长方向",
        "body": "表面附近距离增长最快的方向就是外法线。沿 x、y、z 各采样正负一个小偏移，构造中心差分。"
      },
      {
        "title": "统一采样尺度",
        "body": "epsilon=0.001。差分中共同的 2·epsilon 因子会被 normalize 消去；过大将抹平细节，过小易受浮点误差影响。"
      },
      {
        "title": "从方向变成颜色",
        "body": "normal*0.5+0.5 将 [-1,1] 映射为 RGB。盒子同一平面颜色近似相同，球面连续变化，这比直接上灯光更容易查错。"
      }
    ],
    "experiment": {
      "parameter": "差分偏移",
      "before": "0.001",
      "after": "0.05",
      "expected": "棱边法线被平均得更圆，细小图元的方向精度下降。"
    }
  },
  {
    "id": "volume-sphere",
    "title": "体积渲染Ⅰ：半透明球与路径厚度",
    "stage": 4,
    "goal": "让球的边缘透出背景、中心更浓，理解透明度来自介质中的路径长度。",
    "intro": "此前的 Sphere Tracing 找到表面后就停止，得到的是表面着色。体积渲染还要看光线穿过内部多长：均匀介质的透射率 T=exp(-σ·L)，不透明度 alpha=1-T。同一密度下，路径短则 alpha 小、背景清楚；路径长则 alpha 大、介质颜色更明显。",
    "detail": "本章先用球的解析交点得到精确厚度，再合成棋盘背景作为可核对的基准。常量颜色代表教学用体积源颜色，暂不计算灯光散射、折射或玻璃表面的 Fresnel。最终画布 alpha 为 1，因为透明体与背景已在 Shader 内合成；只修改输出 alpha 不能替代这一步。",
    "formula": "b = dot(ro, rd), c = dot(ro, ro) - r*r  // rd 已归一化\nh = b*b - c\ntEnter = max(-b - sqrt(h), 0), tExit = -b + sqrt(h)\nL = max(tExit - tEnter, 0)\nT = exp(-σ * L), alpha = 1 - T\ncolor = volumeColor * alpha + background * T",
    "pitfall": "求解前先排除 h<0；出射点在身后或 tExit≤tEnter 都视为无有效体积路径。相机在球内时把起点截到 t=0。这里渲染的是有色介质，不是模拟带折射的玻璃壳。",
    "exercise": "将 DISPLAY_MODE 从 0 改为 1 观察 alpha，再改为 2 观察厚度（显示 L/2）。比较两个灰度图的关系，最后把相机移入球内验证截断。",
    "change": "从首次表面命中的分支继续，新增球的入射/出射交点与随厚度变化的半透明合成。",
    "expected": "棋盘前出现青蓝色半透明球：边缘背景较清楚，中心更浓。增加 EXTINCTION 后整颗球更不透明，外部背景不变。",
    "references": [
      "pbrt-transmittance"
    ],
    "steps": [
      {
        "title": "由球方程得到两个交点",
        "body": "将 ro+t*rd 代入 |p|²=r²，rd 为单位向量时得到 t²+2bt+c=0。判别式 h=b²-c 为负表示没有交点；否则两根分别为 -b±sqrt(h)。"
      },
      {
        "title": "将交区间转换为厚度",
        "body": "只保留相机前方的区间 [max(tEnter,0),tExit]，两端差就是实际经过介质的长度。半径 0.75 的球，正中穿过球心时 L=1.5，切线处 L 趋近于零。"
      },
      {
        "title": "按透射率合成背景",
        "body": "使用 T=exp(-1.2*L) 得到每个像素的剩余透射率。返回预乘颜色 volumeColor*(1-T)，再加 background*T；不能再给这份预乘颜色乘一次 alpha，否则边缘会偏暗。"
      }
    ],
    "experiment": {
      "parameter": "消光系数 EXTINCTION",
      "before": "1.2",
      "after": "0.4，再试 2.4",
      "expected": "系数越小越通透，越大越浓；设为 0 时物体完全消失，只留下棋盘背景。"
    }
  },
  {
    "id": "volume-box",
    "title": "体积渲染Ⅱ：半透明立方体与 Slab 求交",
    "stage": 4,
    "goal": "用三个坐标轴的交区间求立方体厚度，观察视角如何改变透光。",
    "intro": "保持上一章的指数透射率和背景合成，只更换交区间计算。轴对齐盒子的每一对平行面构成一个 slab，光线需同时处于 X、Y、Z 三个 slab 内，才能位于立方体内部。",
    "detail": "示例把立方体旋转后观察，先把光线原点和方向一起逆旋转到局部空间，再对半尺寸 0.6 的盒子求交。旋转不改变长度，因此局部的 t 差仍是实际路径厚度。不同位置的射线可能从不同面进出，所以不透明度会出现棱线和面之间的变化。",
    "formula": "t0 = (-halfSize[axis] - ro[axis]) / rd[axis]\nt1 = ( halfSize[axis] - ro[axis]) / rd[axis]\ntEnter = max(tEnter, min(t0,t1))\ntExit  = min(tExit,  max(t0,t1))\nL = max(tExit - tEnter, 0), alpha = 1 - exp(-σ*L)",
    "pitfall": "rd 某个分量为零时不能直接相除；平行且在 slab 外即无交点，在内部则这一轴不限制区间。正对立方体使用正交射线时，各内部射线厚度可以相同，不一定像球那样总是中心深、边缘浅。",
    "exercise": "将 yaw、pitch 都改成 0 比较正面视角，再改其中一个角度观察出射面切换。把 halfSize 改成非等长尺寸，可扩展为半透明长方体。",
    "change": "沿用球体的透射率和合成函数，替换为稳健的盒子求交，并加入局部空间逆旋转。",
    "expected": "棋盘前出现旋转的半透明立方体。经过较长路径的区域颜色更浓，经过短路径的边角透光更多；棱线来自路径长度变化，不依赖表面灯光。",
    "references": [
      "pbrt-transmittance"
    ],
    "steps": [
      {
        "title": "计算每个轴的区间",
        "body": "在第 k 轴分别与 -h 和 +h 平面求交。方向可能为负，因此必须用 min/max 排序两个 t 值。与该轴平行时单独判断原点是否处于两个平面之间。"
      },
      {
        "title": "求三个区间的公共部分",
        "body": "把进入时间取最大值、离开时间取最小值，得到同时满足三个轴约束的区间。进入时间从 0 开始，支持相机位于盒内；一旦 exit≤enter 就可以返回无交。"
      },
      {
        "title": "观察局部空间中的厚度",
        "body": "逆旋转应用到 ro 与 rd，不能只旋转方向或只旋转原点。旋转是保长度变换，所以沿用上一章的指数公式即可；若加入非均匀缩放，必须额外处理长度尺度。"
      }
    ],
    "experiment": {
      "parameter": "旋转 yaw",
      "before": "-0.55",
      "after": "-1.0",
      "expected": "立方体的入射面与出射面改变，厚度和透光分布跟着变化，材质系数保持不变。"
    }
  },
  {
    "id": "volume-march",
    "title": "体积渲染Ⅲ：逐段采样与密度累积",
    "stage": 4,
    "goal": "在体积内部步进，合成非均匀密度，并避免透明度随步数变化。",
    "intro": "均匀介质可以直接用总厚度求透射率；密度随位置变化时，需要积累光学厚度 τ=∫σ·ρ(p)ds。本章沿用立方体交区间，只在内部走 64 小段，中点采样空间密度，得到带层次的半透明体积。",
    "detail": "每段长度 Δs=L/N，单段不透明度为 1-exp(-σ·ρ·Δs)。从近到远，先按当前透射率累加这一段的颜色，再更新剩余透射率。示例使用确定性的中点积分和常量源颜色，没有多次散射；把密度改为常量 1，应退化为上一章的均匀立方体结果。",
    "formula": "stepLength = (tExit-tEnter) / N\nstepAlpha = 1 - exp(-σ * density * stepLength)\naccumulated += transmittance * stepAlpha * volumeColor\ntransmittance *= 1 - stepAlpha\nfinalColor = accumulated + transmittance * background",
    "pitfall": "不能每走一步都加一个固定 alpha，否则增加步数会让体积无故变浓。SDF 给的是到表面的距离，不是内部介质密度；本章在交区间内积分，不能遇到表面就停止。",
    "exercise": "将 volumeDensity 改为 return 1.0，对比 16、64、128 步与上一章的均匀结果；再恢复变化密度，观察提高采样数对内部层次精度的影响。",
    "change": "保留立方体求交、旋转和背景，将闭式合成替换为前向体积步进与空间密度函数。",
    "expected": "同一个立方体内部出现疏密层次，透过背景的程度随路径与密度一起变化。切到 DISPLAY_MODE=1 可直接观察不透明度分布。",
    "references": [
      "pbrt-transmittance"
    ],
    "steps": [
      {
        "title": "只步进有效的内部区间",
        "body": "先求立方体入射点和出射点，无交时直接输出背景。将有效厚度均分为 N 段，在每段中心取样，避免采样越过出射面，并保证整个路径都被覆盖。"
      },
      {
        "title": "每步包含真实路径长度",
        "body": "在采样点计算非负密度，乘以消光系数和 Δs，再指数化得到 stepAlpha。均匀介质下，各段透射率相乘恰好等于 exp(-σ*L)，因此结果不会因为步数变多而变浓。"
      },
      {
        "title": "先累积再更新透射率",
        "body": "当前段颜色先乘已有透射率加入 accumulated，然后再乘本段透射率更新 T。T<0.005 时可以提前结束，忽略的后续透光量最多约 0.5%；最后只把背景乘剩余 T。"
      }
    ],
    "experiment": {
      "parameter": "步进次数 VOLUME_STEPS",
      "before": "64",
      "after": "16，再试 128（保持正整数）",
      "expected": "非均匀密度的积分精度改变，平均浓度应趋于稳定；均匀密度时三种步数应几乎一致。"
    }
  },
  {
    "id": "voxel-height",
    "title": "体素地形Ⅰ：把高度图堆成方块",
    "stage": 4,
    "goal": "把 H(x,z) 变为真实立体方块地形，并用逐格射线遍历找到可见表面。",
    "intro": "把每个整数网格单元看作一个单位方块，在其中心判断 y<H(x,z) 是否成立。高度函数来自前面的二维 fBM，因此同一列实体连续，表面呈阶梯状。它是一个有限的程序化体素世界，不是贴在平面上的地形图片。",
    "detail": "示例在 48×24×48 的范围中生成地形，用 DDA 沿射线依次走过网格单元。命中第一个实心格子后，根据跨过的网格面计算法线与材质，显示草皮、泥土和岩石。相机与射线部分可对照前面的 Ray Marching 章节；此处步长由下一个网格边界决定。",
    "formula": "p = vec3f(cell) + 0.5\nH = 3 + 18 * fbm2(p.xz * 0.065)\nsolid = p.y < H\nnextBoundaryDistance = min(next.x, next.y, next.z)",
    "pitfall": "DDA 按网格边界前进，与根据 SDF 距离步进不同。先与世界包围盒求交，并为零方向分量单独处理，避免无穷值参与错误计算。此示例没有区块存储、挖掘建造或游戏物理。",
    "exercise": "调整相机 ro 和目标点观察地形四周；把高度振幅 18 改为 8，比较地形起伏，同时保持方块尺寸为 1。",
    "change": "从俯视高度图进入三维：新增实心方块判定、有限世界包围盒、逐格遍历和面法线着色。",
    "expected": "画面中出现一块立体的方块山地，顶面为草色，侧面可看到泥土和石层；每列从底部连续填满，没有悬空洞穴。",
    "references": [
      "book-noise",
      "book-fbm"
    ],
    "steps": [
      {
        "title": "在格子中心判断实体",
        "body": "对 cell 加 0.5 得到中心，读取对应 XZ 的高度并比较中心 Y。只在整数格子中心做判定，让占据状态在整块内保持一致，边界才是真正的方块面。"
      },
      {
        "title": "逐格寻找第一处实体",
        "body": "射线进入世界后，分别计算到下一个 X/Y/Z 网格面的距离，选择最近的边界推进。若同时跨过棱或角，推进所有相同时间的轴，避免错误访问仅擦过边界的格子。"
      },
      {
        "title": "把命中面用于着色",
        "body": "最后跨过哪个轴的面，就得到哪一个轴向法线。顶层使用草色、侧边使用泥土、深处使用岩石，并在面内坐标上画细网格线，帮助分辨单个方块。"
      }
    ],
    "experiment": {
      "parameter": "高度振幅",
      "before": "18.0",
      "after": "8.0",
      "expected": "山体整体变矮，方块大小不变；同一竖列的实体仍连续。"
    }
  },
  {
    "id": "voxel-caves",
    "title": "体素地形Ⅱ：3D 噪声洞穴与悬挑",
    "stage": 4,
    "goal": "给地形内部增加三维密度判定，生成洞穴、天然桥和悬挑结构。",
    "intro": "高度图只决定地表上限，三维噪声进一步决定上限以下哪些方块保留。噪声同时依赖 x、y、z，因此同一个水平位置可以在低处有实体、中间为空、上面再次有实体，从而产生二维高度图无法表达的结构。",
    "detail": "与上一章使用完全相同的相机、种子、表面高度和遍历器，只启用洞穴分支。密度大于 CAVE_THRESHOLD 的单元保留，其余挖空，底部两层保留作为基底。有限世界的侧面相当于自然剖面，能直接看到内部孔洞。",
    "formula": "solid = insideWorld && y < H(x,z)\nif (y >= 2) { solid = solid && noise3(p*0.19+offset) > CAVE_THRESHOLD; }",
    "pitfall": "阈值越高，保留的实体越少，洞穴也可能变成大面积敞口或孤立块。这个程序化教学示例不保证所有洞穴连通、地形可行走，也没有复刻《我的世界》的完整生成算法。",
    "exercise": "先调 CAVE_THRESHOLD，再调 0.19 的空间频率。之后引入 fbm3 替换单层 noise3，比较复杂度和成本，必要时降低层数。",
    "change": "保留方块地形，只开启三维噪声雕刻；通过代码差异可看到从纯高度图到洞穴地形的关键开关。",
    "expected": "原有山体中出现孔洞、天然桥式连接和局部悬挑；世界边缘的剖面能看到一列内交替出现的岩石与空洞。",
    "references": [
      "book-noise",
      "book-fbm"
    ],
    "steps": [
      {
        "title": "分开地表与内部结构",
        "body": "先用 y<H 限制地形的总体高度，再用三维密度筛选内部。这样可以单独调整山体轮廓与洞穴，不会把噪声配色误当成真正的几何挖空。"
      },
      {
        "title": "选择三维密度阈值",
        "body": "在每个体素中心采样 noise3，值大于 0.46 保留方块，否则移除。由于密度沿 Y 也变化，上方实体可以跨过下方空洞形成顶板，这正是悬挑产生的原因。"
      },
      {
        "title": "控制尺度、连通性与成本",
        "body": "提高输入频率会生成更细小的孔洞，增加阈值会移除更多方块。多个噪声层可以增强细节，但不自动保证洞穴连通；实际游戏还需额外处理区块边界、可玩性和数据保存。"
      }
    ],
    "experiment": {
      "parameter": "CAVE_THRESHOLD",
      "before": "0.46",
      "after": "0.35，再试 0.55",
      "expected": "较低阈值保留更多岩石；较高阈值挖出更多空间，可能让顶层变成离散岛块。"
    }
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
    "references": [],
    "change": "保留法线计算，新增底色、漫反射与高光，首次让表面具有材质感。",
    "expected": "青绿色雕塑立于灰色地面，朝向光源的一侧明亮，并带有局部高光。",
    "steps": [
      {
        "title": "漫反射",
        "body": "单位法线 n 与单位光线 l 点积得到入射余弦。max(dot(n,l),0) 排除背光面的负值，乘底色得到漫反射。"
      },
      {
        "title": "视角相关高光",
        "body": "用视线与光线构造半程方向，再取 max(dot(n,h),0) 的 48 次幂。指数越大，高光越窄；这是一种教学用近似材质。"
      },
      {
        "title": "组合而不改几何",
        "body": "底色乘环境项与漫反射，再加高光。所有几何仍来自同一个 sceneDistance，光照改变外观，不会改变轮廓。"
      }
    ],
    "experiment": {
      "parameter": "高光指数",
      "before": "48.0",
      "after": "12.0",
      "expected": "高光变宽、表面更柔和；轮廓与物体位置保持不变。"
    }
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
    ],
    "change": "在命中点朝灯光再走一条射线，用遮挡衰减上一章的直接光。",
    "expected": "小球、盒子和圆柱在地面及其他表面留下阴影，边缘存在柔和过渡。",
    "steps": [
      {
        "title": "避免照到自己",
        "body": "从 position+normal*偏移 开始阴影射线，避开已命中的表面。偏移过大会使阴影与物体分离。"
      },
      {
        "title": "记录沿途间隙",
        "body": "对光线上的距离 d 与行进距离 t 取 12*d/t 的最小值。越靠近遮挡物，这个比值越小，近似形成半影。"
      },
      {
        "title": "只衰减直接光",
        "body": "把阴影系数乘到直接光照上，环境项保留。最多 32 次采样使成本有上界；这是软阴影近似，不是面积光源积分。"
      }
    ],
    "experiment": {
      "parameter": "软阴影系数",
      "before": "12.0",
      "after": "5.0",
      "expected": "阴影更柔和、半影更宽，但不等同于修改真实光源面积。"
    }
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
    ],
    "change": "在已有阴影之外，沿法线检查邻近遮挡，强化接触关系。",
    "expected": "物体与地面的接触处、相邻图元的缝隙更暗，远离遮挡的表面变化较小。",
    "steps": [
      {
        "title": "沿法线取样",
        "body": "在表面外 n*h 的位置查询距离。空旷处到表面距离约为 h，附近有其他物体时查询距离会比 h 小。"
      },
      {
        "title": "累积距离缺口",
        "body": "用 h-sceneDistance(p+n*h) 衡量遮蔽；采样距离按 0.06 递增，权重逐步乘 0.65，让近处贡献更明显。"
      },
      {
        "title": "与阴影分工",
        "body": "阴影对应特定灯光方向；AO 对局部环境可见度做近似。AO 系数限制到 [0,1]，不要用它代替所有照明。"
      }
    ],
    "experiment": {
      "parameter": "AO 采样间距",
      "before": "0.06",
      "after": "0.12",
      "expected": "遮蔽覆盖更大范围；细小接触处可能被过度压暗。"
    }
  },
  {
    "id": "reflection",
    "title": "反射、Fresnel 与 Cubemap",
    "stage": 5,
    "goal": "让观察方向影响表面的反光程度。",
    "intro": "reflect(rd,n) 得到反射射线方向。环境贴图以方向查询颜色，所以 Cubemap 的坐标是 vec3f，而不是二维 UV；应在通道中绑定六面立方体贴图。",
    "detail": "本章先用解析天空环境实现反射，避免依赖外部资源。再引入 Schlick Fresnel 近似，让掠射角比正视角反射更强。以后可把 environment 替换为 Cubemap 采样；这与再发射射线反射场景内物体是不同的扩展。",
    "formula": "let reflected = reflect(rd, normal);\nlet fresnel = f0 + (1.0-f0) * pow(1.0-cosTheta, 5.0);",
    "pitfall": "环境贴图与场景里的其他物体不是同一信息；贴图不能自动反射近处动态物体。",
    "exercise": "给三维物体绑定自己的 Cubemap，对比正面与边缘的反射强度。",
    "references": [],
    "change": "在漫反射、阴影和 AO 基础上增加环境反射与 Fresnel 权重。",
    "expected": "表面出现天空色与太阳方向的反光，掠射角的反射比正视更强。",
    "steps": [
      {
        "title": "计算反射方向",
        "body": "reflect(rd,n) 将入射方向关于法线镜像。rd 指向表面，法线必须朝外且归一化。"
      },
      {
        "title": "先用解析环境",
        "body": "本章 environment(direction) 直接按方向生成天空和太阳，无需外部贴图。以后可以替换为 Cubemap 采样；它暂不反射场景内其他物体。"
      },
      {
        "title": "加入角度权重",
        "body": "使用 Schlick 近似 F=F0+(1-F0)*(1-cosθ)^5。用 F 混合表面颜色与环境颜色，掠射角更接近镜面。"
      }
    ],
    "experiment": {
      "parameter": "环境太阳指数",
      "before": "64.0",
      "after": "16.0",
      "expected": "若调整 environment 中的太阳幂指数，反射亮斑会扩大；物体几何保持不变。"
    }
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
    "references": [],
    "change": "回到二维平滑组合分支，只让圆的位置随时间移动。",
    "expected": "圆与圆角矩形周期性靠近、融合再分开，连接处保持平滑。",
    "steps": [
      {
        "title": "把时间当输入",
        "body": "iTime 是秒数。sin(iTime) 产生 [-1,1] 的连续周期信号，乘幅度后成为位移。"
      },
      {
        "title": "只改采样坐标",
        "body": "将移动圆写作 sdCircle(p-center(t),r)，矩形不动。图元函数和 smoothMin 保持前面的实现。"
      },
      {
        "title": "分开速度与幅度",
        "body": "sin(ω*t) 内的 ω 控制速度，外面的系数控制移动距离。不要把每帧累计位移当作绝对时间动画。"
      }
    ],
    "experiment": {
      "parameter": "圆心运动速度",
      "before": "sin(iTime*1.5)",
      "after": "sin(iTime*3.0)",
      "expected": "周期缩短一半，融合与分离加快，但运动范围不变。"
    }
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
    "references": [],
    "change": "保留随时间移动的圆形遮罩，在内部显示通用城市图片。",
    "expected": "城市图片被一个左右移动的圆形窗口裁切，窗口外为深色背景。",
    "steps": [
      {
        "title": "准备两个坐标",
        "body": "p 用高度归一化保持圆形，uv=fragCoord/iResolution.xy 用 [0,1] 采样图片。两者用途不同。"
      },
      {
        "title": "绑定并采样",
        "body": "Image 的 iChannel0 绑定 future-city。channel0(uv) 获取图片颜色，内置函数遵循 Shader Lab 的纹理坐标约定。"
      },
      {
        "title": "用距离混合",
        "body": "coverage(length(p-center)-0.65) 将带符号距离转为覆盖率，再 mix 背景与图片；边缘仍由距离导数抗锯齿。"
      }
    ],
    "experiment": {
      "parameter": "圆半径",
      "before": "0.65",
      "after": "0.35",
      "expected": "窗口缩小而图片仍铺满原屏幕范围，说明遮罩与纹理坐标互相独立。"
    }
  },
  {
    "id": "mouse-position",
    "title": "鼠标位置：从像素到图形坐标",
    "stage": 6,
    "goal": "把鼠标位置转换到画图坐标，让圆形图片窗口跟随拖动。",
    "intro": "iMouse.xy 是画布内的渲染像素坐标，原点在左下角。它与 fragCoord 使用相同单位，但不同于浏览器事件使用的页面坐标；编辑器已经处理画布位置、缩放和 Y 轴翻转。",
    "detail": "沿用上一章城市图片与圆形遮罩，用鼠标位置替换时间动画。按住左键拖动时 xy 更新，松开后保留最后位置；单纯悬停不会改变 xy。初次进入、尚未点击时使用中心位置。",
    "formula": "mouseP = (2.0 * iMouse.xy - iResolution.xy) / iResolution.y\nmask = coverage(length(p - mouseP) - 0.35)",
    "pitfall": "不要把 CSS 页面坐标直接传给距离函数，也不要分别用宽、高归一化后误以为两个轴的单位相同。本文示例在 Canvas 模式下操作；3D 模式的拖动同时用于 Orbit 相机。",
    "exercise": "把窗口半径改为 0.2，再切换预览分辨率，验证鼠标仍能准确定位中心。",
    "change": "把自动移动改为鼠标定位，并增加十字光标帮助核对坐标。",
    "expected": "点击画布后按住左键拖动，圆形城市窗口和十字跟随指针；松开后停在最后位置。",
    "references": [],
    "steps": [
      {
        "title": "统一坐标尺度",
        "body": "与片元相同，把鼠标坐标乘 2、减分辨率，然后统一除以高度。这样屏幕中央是 (0,0)，且 X、Y 每单位对应同样多的像素。"
      },
      {
        "title": "区分初始与释放",
        "body": "iMouse.z 初始为 0，点击后为正，释放后为负。因此 abs(iMouse.z)>0 可以检测是否有过点击；不能只在 z>0 时设置中心，否则释放会跳回默认值。"
      },
      {
        "title": "保持纹理坐标独立",
        "body": "圆形窗口在 p 坐标中移动，城市仍用 fragCoord/iResolution.xy 采样。窗口移动是在图片上取景，不是把整张图片拖走；半径 0.35 也使用 p 的单位。"
      }
    ],
    "experiment": {
      "parameter": "鼠标映射",
      "before": "(2.0*iMouse.xy-iResolution.xy)/iResolution.y",
      "after": "iMouse.xy/iResolution.xy",
      "expected": "故意换成 UV 后，光标与窗口会错位，帮助理解两套坐标的取值范围。"
    }
  },
  {
    "id": "mouse-drag",
    "title": "点击与拖动：起点、当前位置和释放",
    "stage": 6,
    "goal": "读取 iMouse.zw 保存的点击起点，画出拖动向量。",
    "intro": "iMouse.xy 表示当前或最后拖动位置；zw 保存这次点击的起点。按住时 zw 为正，释放后它们变为负数，因此 abs(iMouse.zw) 可恢复起点坐标。",
    "detail": "沿用鼠标窗口，再加入起点圆环和起终点之间的线段。线条按住时为橙色，松开后转为灰蓝色，并保留位置。再次点击会开始一条新线，不会自动连接前一次终点。",
    "formula": "start = (2.0 * abs(iMouse.zw) - iResolution.xy) / iResolution.y\ndrag = mouseP - start\npressed = iMouse.z > 0.0",
    "pitfall": "zw 的符号表示状态，不是负坐标位置；先取绝对值再做坐标转换。按住状态以 z>0 判断即可，不要把初始零值误判为一次点击。",
    "exercise": "用 length(mouseP-start) 控制圆的半径，尝试制作一个拖拽画圆工具。",
    "change": "保留定位十字，增加点击起点、拖动线段及按下/释放配色。",
    "expected": "按下鼠标出现起点圆环，拖动时橙线伸向当前十字；松开线条变灰蓝，再点击会重设起点。",
    "references": [],
    "steps": [
      {
        "title": "恢复起点",
        "body": "对 zw 取绝对值，用与 xy 相同的公式转换到 p 坐标。这样松开后仍能恢复原点击位置，边界点击也由引擎的小正值保护按住状态。"
      },
      {
        "title": "重用线段距离",
        "body": "把起点和当前位置传给 segmentDistance，距离减去 0.006 得到细线。前面已处理零长度线段，因此刚按下、起终点相同时也不会除零。"
      },
      {
        "title": "用布尔状态选择颜色",
        "body": "iMouse.z>0 表示按住，选择橙色；释放后选择灰蓝色。只改变颜色不丢掉坐标。即使暂停时间，鼠标事件也能刷新位置和状态。"
      }
    ],
    "experiment": {
      "parameter": "拖动线半宽",
      "before": "0.006",
      "after": "0.02",
      "expected": "连线更粗，但起点、终点和点击语义保持不变。"
    }
  },
  {
    "id": "keyboard-held",
    "title": "键盘纹理：按住状态与方向控制",
    "stage": 6,
    "goal": "学会绑定键盘、采样键值，并把方向键组合成二维输入。",
    "intro": "键盘输入以 256×3 的纹理提供。第 0 行为按住，第 1 行为本帧按下，第 2 行为切换状态，均从左下角计数。本章只读第 0 行；左、上、右、下键的编码分别为 37、38、39、40。",
    "detail": "Image 的 iChannel0 保留城市图片，iChannel1 改为键盘。先点击预览画布获取键盘焦点，再按方向键；在代码编辑器中打字不会驱动 Shader。离开画布或窗口会释放按住状态。",
    "formula": "uv = vec2f((f32(key)+0.5)/256.0, (f32(row)+0.5)/3.0)\ndir = vec2f(right-left, up-down)\ndir = dir / max(length(dir), 1.0)",
    "pitfall": "按住状态是 0 或 1，不是已按住的秒数。本章将输入乘以固定偏移量，松开会归位；持续移动需要存储上一帧位置，后面的 Buffer 章节会实现。",
    "exercise": "把方向键换成 W/A/S/D：W=87、A=65、S=83、D=68，并验证相反方向同时按下互相抵消。",
    "change": "沿用鼠标定位示例，增加键盘采样函数和相对鼠标锚点的方向偏移。",
    "expected": "点击画布后，按方向键让窗口沿对应方向偏移，松开回到鼠标锚点；斜向偏移与单轴距离一致。",
    "references": [],
    "steps": [
      {
        "title": "采样像素中心",
        "body": "key 和 row 都加 0.5 后除以纹理尺寸，避开线性过滤混合相邻键值。channel1 使用左下角原点，所以 row=0 对应按住状态。"
      },
      {
        "title": "组合并规范化方向",
        "body": "右减左得到 X，上减下得到 Y，同时按左右会得到 0。用 direction/max(length(direction),1) 限制斜向长度，也避免零向量归一化产生非法值。"
      },
      {
        "title": "区分输入与位置",
        "body": "本章 center += direction*0.4 只在当前帧计算偏移，没有历史累积。鼠标提供锚点、按键提供瞬时偏移；松开时方向归零，所以不会停留在偏移位置。"
      }
    ],
    "experiment": {
      "parameter": "方向偏移幅度",
      "before": "0.4",
      "after": "0.15",
      "expected": "按键产生的偏移变小，松开仍回到鼠标锚点，不会变成缓慢移动。"
    }
  },
  {
    "id": "keyboard-toggle",
    "title": "单次按下与切换：三个状态各司其职",
    "stage": 6,
    "goal": "区分持续按住、单帧事件和跨帧开关，避免一按就反复切换。",
    "intro": "沿用方向控制，增加空格键（32）的三种读取方式。第 0 行适合持续动作；第 1 行在首次按下后的一个 Shader 帧为 1；第 2 行每次新的按下都翻转，在松开后保留。",
    "detail": "画面上方从左到右三盏灯分别显示按住、脉冲和切换。用第 2 行控制窗口边缘的冷暖配色。键盘长按产生的系统重复事件不会反复生成脉冲或翻转；重新编译或重置运行会清空切换状态。",
    "formula": "held = keyState(32u, 0u)\npressed = keyState(32u, 1u)\ntoggled = keyState(32u, 2u)",
    "pitfall": "单帧脉冲在正常帧率下很短，肉眼可能看不到。不要因为灯不持续亮而改读按住状态：计数、触发和重置需要单次事件；主题开关直接使用第 2 行即可。",
    "exercise": "把切换键改为 T（84），并让切换同时影响背景配色；保持方向键行为不变。",
    "change": "在方向键练习上加三种空格状态的指示灯，以及松开后保留的主题切换。",
    "expected": "按住空格时左灯持续亮，中灯仅闪一帧；右灯与边缘配色切换一次。松开后左灯灭，主题保留，再按空格切回。",
    "references": [],
    "steps": [
      {
        "title": "持续动作读取第 0 行",
        "body": "held 从按下到松开期间保持为 1，适合加速、蓄力或持续发射。这里直接控制左灯，让按住和释放的区别清晰可见。"
      },
      {
        "title": "一次动作读取第 1 行",
        "body": "pressed 只在首次按下后的一帧为 1，系统自动重复不重新触发。它适合重置位置或增加计数；如果要显示累计次数，必须把结果存进 Buffer。"
      },
      {
        "title": "开关直接读取第 2 行",
        "body": "toggled 从 0 开始，每次新按下切换 0/1。用它 mix 冷暖两色，不必自己再写一个按帧反转的变量；离开焦点释放按住状态，但不会重置这个开关。"
      }
    ],
    "experiment": {
      "parameter": "主题的输入行",
      "before": "keyState(32u,2u)",
      "after": "keyState(32u,0u)",
      "expected": "改后暖色仅在按住时出现，释放立即恢复，直观比较持久开关与按住状态。"
    }
  },
  {
    "id": "keyboard-movement",
    "title": "持续移动：用 Buffer 保存交互状态",
    "stage": 6,
    "goal": "用上一帧位置与时间步长积分，实现松手停留、斜向等速和单次重置。",
    "intro": "片元函数中的局部变量每帧都会重新计算。要让位置持续变化，必须读取上一帧状态。本章将状态放进 Buffer A，再由 Image 按该位置绘制城市窗口。",
    "detail": "Buffer A 的 iChannel0 接自身，iChannel1 接键盘；Image 的 iChannel0 接城市，iChannel1 接 Buffer A。每个状态纹素的 RG 存位置、B 存主题，所有纹素写同一份值，因此可固定采样中心。",
    "formula": "position = previousPosition + direction * speed * iTimeDelta\nif (keyState(82u,1u)>0.5) { position = vec2f(0.0); }",
    "pitfall": "使用浮点 Buffer 保存带负号的位置，不要先映射成 8 位颜色。暂停时 iTimeDelta=0，按住方向键不会继续运动；点击单步前进一帧。重置键 R 读单次按下行，所以暂停时也能触发归中。",
    "exercise": "把移动速度从 0.6 改为 1.2，比较直走和斜走的路程；再为 Buffer 增加速度分量，实现松手减速的惯性。",
    "change": "将上一章的固定偏移改为按秒积分，并增加位置历史、边界限制与 R 键重置。",
    "expected": "点击画布并保持播放，方向键持续移动窗口，松开停在当前位置；空格切换边缘主题，R 键让位置回到中心。",
    "references": [],
    "steps": [
      {
        "title": "初始化并读取历史",
        "body": "iFrame=0 时从原点开始，之后从自身上一帧纹理读取 RG。引擎为自引用提供双缓冲，这一帧不能同时读取自己正在写入的目标纹理。"
      },
      {
        "title": "按秒积分并限制范围",
        "body": "归一化方向乘速度 0.6 和 iTimeDelta 后累加位置，避免固定每帧位移随帧率变化。用画布宽高比和半径 0.35 计算范围，再 clamp 让窗口留在画布内。"
      },
      {
        "title": "把状态交给显示 Pass",
        "body": "Image 读取 Buffer A 当前帧的 RG 作为中心、B 作为主题。R=82 的第 1 行触发归中；只改 Image 的配色不会改变存储状态的语义。"
      }
    ],
    "experiment": {
      "parameter": "移动速度",
      "before": "0.6",
      "after": "1.2",
      "expected": "单位时间移动距离约翻倍，松开仍停留；暂停时速度再大也不会自动移动。"
    }
  },
  {
    "id": "interaction",
    "title": "键盘字形：把按键映射到 MSDF",
    "stage": 6,
    "goal": "用输入改变图形，而不是只改变颜色。",
    "intro": "iMouse.xy 表示拖动位置；zw 的符号可用于判断按钮状态。键盘通道是 256×3 的纹理，三行依次表示按住、本帧按下和切换状态。点击预览后才接收键盘，编辑代码不会触发。",
    "detail": "本章把城市图片、键盘和 MSDF 图集分别连接到三个通道。按住 A–Z 时选择对应字形，松开后回到默认 A；按住鼠标时窗口跟随位置。字形图集的 alpha 保存距离，因此使用 alpha 而非 RGB 中值。下一章再加入历史反馈。",
    "formula": "let held = channel0(vec2f((65.0+0.5)/256.0, 0.5/3.0)).r;",
    "pitfall": "本帧按下只持续一个渲染帧；想记住最后一个字符，需要存入 Buffer。 先点击预览画布获得键盘焦点，在代码区域打字不会触发字形。",
    "exercise": "打开 Gallery 的 Key light，改成只有按住按键时才发光，松开后保留字形。",
    "references": [],
    "change": "沿用键盘按住状态，在鼠标窗口中把 A–Z 编码映射成 MSDF 字形；本章使用即时位置，持续移动的 Buffer 保留在前一练习中。",
    "expected": "默认显示 A；按住 B–Z 显示对应字母，释放后回到 A；按住鼠标可移动窗口与字母。",
    "steps": [
      {
        "title": "先迁移控制来源",
        "body": "保留时间动画作为默认状态，iMouse.z>0 时把鼠标像素坐标转换成 p 的坐标覆盖 center。"
      },
      {
        "title": "读取键盘纹理",
        "body": "iChannel1 绑定键盘，第一行表示按住状态。以 (key+0.5)/256 和 0.5/3 采样像素中心，循环查找 A–Z；本例不保存释放后的按键。"
      },
      {
        "title": "定位字形单元",
        "body": "iChannel2 绑定 16×16 字形图集，用 key%16、key/16 计算格子，再把局部坐标映射进去。此图集 alpha 保存可用距离，使用 a-0.5 得到文字覆盖率。"
      }
    ],
    "experiment": {
      "parameter": "扫描按键范围",
      "before": "65u…90u",
      "after": "48u…57u（并把默认 key 改为 48u）",
      "expected": "改为按住数字键显示 0–9，验证编码与图集格子的映射。"
    }
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
    "references": [],
    "change": "把上一章绘制移入 Buffer A，加入自身上一帧并让 Image 展示结果。",
    "expected": "运动的城市窗口和字母留下逐渐衰减的拖尾；静止时新画面维持亮度。",
    "steps": [
      {
        "title": "整理通道",
        "body": "Buffer A 的 0 通道接自身历史，1 接城市，2 接键盘，3 接 MSDF。原来的三个图片输入因此全部后移一位。"
      },
      {
        "title": "按时间衰减",
        "body": "old*exp(-1.4*iTimeDelta) 按秒衰减历史值，而不是每帧固定乘一个数。不同帧率下拖尾寿命因此更接近。"
      },
      {
        "title": "合成并显示",
        "body": "max(history,fresh) 保留较亮的历史和本帧图像；Image 只采样 Buffer A。自引用通过引擎双缓冲读取上一帧，不能在同一纹理上同时读写。"
      }
    ],
    "experiment": {
      "parameter": "衰减速率",
      "before": "1.4",
      "after": "4.0",
      "expected": "拖尾更快消失；设为较小正数会留下更长的历史。"
    }
  },
  {
    "id": "atmosphere",
    "title": "距离雾与透射率",
    "stage": 7,
    "goal": "区分表面着色与沿路径积累。",
    "intro": "表面雾可以按命中距离把颜色混向雾色，例如透射率 T=exp(−density·distance)。它便宜、易控，但并没有真的在空间里采样烟雾密度。",
    "detail": "本章实现均匀介质的表面距离雾，使用命中距离计算透射率并与雾色混合。它并不是逐段体积积分；云、体积阴影和不均匀密度需要进一步沿视线累积采样。",
    "formula": "T = exp(−density × distance)\ncolor = surface × T + fogColor × (1−T)",
    "pitfall": "把彩色噪声覆盖在屏幕上并不等于体积云；后者要沿深度积分。",
    "exercise": "在综合练习中改变雾密度，观察远处地面怎样融入背景。",
    "references": [],
    "change": "返回三维反射分支，按命中距离混入天空雾色。",
    "expected": "雕塑和地面随距离变得更接近天空色，远处对比下降。",
    "steps": [
      {
        "title": "得到路径长度",
        "body": "相机射线已归一化，trace 返回的 t 就是从相机到命中点的距离，可直接用于雾的衰减。"
      },
      {
        "title": "从透射率推导",
        "body": "均匀介质的透射率 T=exp(-density*t)，雾的混合权重是 1-T。密度和距离都为非负时结果自然在 [0,1]。"
      },
      {
        "title": "保持模型边界",
        "body": "混合 surface*T+fogColor*(1-T)。本章只做表面距离雾，没有逐段体积积分、云层或体积阴影，后续可在此扩展。"
      }
    ],
    "experiment": {
      "parameter": "雾密度",
      "before": "0.12",
      "after": "0.15",
      "expected": "远处物体更接近雾色，地面与天空的过渡更强。"
    }
  },
  {
    "id": "glow",
    "title": "自发光与色调映射",
    "stage": 7,
    "goal": "在亮部细节和视觉冲击之间取得平衡。",
    "intro": "发光可以先从距离衰减开始，例如 exp(−k·abs(d)) 在轮廓附近形成光晕。更接近镜头泛光的 Bloom 则需要提取亮部、模糊并加回原图，通常放在多个 Pass 中。",
    "detail": "本章在上一章的三维场景中加入程序化自发光条带，再用 Reinhard 映射压缩亮部。代码没有实现 Bloom；要产生轮廓外光晕，需要另加亮部提取、水平模糊、垂直模糊与合成 Pass。可作为后续扩展练习。",
    "formula": "mapped = hdrColor / (vec3f(1.0) + hdrColor)",
    "pitfall": "先把 HDR 裁到 0–1 再做 Bloom 会丢掉强光信息；避免无意中重复做 Gamma 变换。",
    "exercise": "给圆环加距离光晕；先看未经映射的输出，再比较映射后的亮部层次。",
    "references": [],
    "change": "在已有三维光照与雾上加入发光条纹，并压缩过亮颜色。",
    "expected": "雕塑表面出现明亮色带，亮部渐变经过色调映射后保留层次。",
    "steps": [
      {
        "title": "定义发光区域",
        "body": "用表面位置的周期函数生成条纹遮罩，使发光随几何表面分布，而不是贴在屏幕上。"
      },
      {
        "title": "加入自发光",
        "body": "发光项独立于漫反射方向，可以让背光处也明亮。它没有照亮其他物体，因为当前没有计算间接光。"
      },
      {
        "title": "压缩动态范围",
        "body": "使用 color/(1+color) 的 Reinhard 映射压缩大于 1 的值。本章实现自发光而非 Bloom；跨越轮廓的光晕需要后续亮部提取和模糊 Buffer。"
      }
    ],
    "experiment": {
      "parameter": "发光强度",
      "before": "代码中的发光颜色倍数",
      "after": "增加至原值的 2 倍",
      "expected": "色带变亮但被色调映射压缩；轮廓外不会凭空出现模糊光晕。"
    }
  },
  {
    "id": "scene",
    "title": "程序化场景：从零件到画面",
    "stage": 7,
    "goal": "用一个小场景串联建模、光照与构图。",
    "intro": "先选择少量轮廓明确的图元，再用布尔、平滑连接和重复搭出主体。把场景拆成距离查询、材质选择、光照和后期四部分，每一步都能单独可视化。",
    "detail": "沿用包含球、盒、圆环、圆柱、六边形挤出体和地面的雕塑，保留光照、阴影、AO、反射、雾与自发光，并加入相机轨迹。可逐步改造成机械装置、抽象生物或未来建筑；大场景再考虑包围体与层级裁剪。",
    "formula": "构图 → 大形 → 中尺度结构 → 材质 → 灯光 → 后期",
    "pitfall": "不要先用噪声掩盖轮廓问题；在纯色和法线视图里读得清，细节才有意义。",
    "exercise": "把综合练习改造成三栋未来建筑，分别限制轮廓、配色和光源数量。",
    "references": [
      "iq-3d"
    ],
    "change": "保留上一章所有材质和后期，新增围绕雕塑的相机运动。",
    "expected": "相机缓慢左右环绕，前后遮挡关系改变，表面反射也随视角变化。",
    "steps": [
      {
        "title": "定义相机轨迹",
        "body": "让相机位置沿正弦轨迹改变，以目标点为中心构造视线，所有模型仍在原世界坐标中。"
      },
      {
        "title": "建立正交基",
        "body": "forward 指向目标，right 来自 forward 与世界上方向的叉积，up 由 right 与 forward 得到。使用单位向量避免相机缩放画面。"
      },
      {
        "title": "重新生成射线",
        "body": "用 right*p.x+up*p.y+forward*焦距 得到每个像素方向。视点变化后继续使用同一套 trace、法线、灯光和后期。"
      }
    ],
    "experiment": {
      "parameter": "相机角度幅度",
      "before": "0.25",
      "after": "0.5",
      "expected": "观察范围加大，可以看到更多侧面和遮挡关系。"
    }
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
    ],
    "change": "在运动场景右半边显示步进成本热力图，左半边保持完整渲染。",
    "expected": "左边是成品效果，右边用颜色显示主射线查询次数；轮廓附近通常成本更高。",
    "steps": [
      {
        "title": "复用计数",
        "body": "trace 的第二个返回值记录步进次数，无需为了统计再走一遍光线。用 stepCount/80 归一化。"
      },
      {
        "title": "把成本变为颜色",
        "body": "将低次数与高次数映射到不同颜色，并按 uv.x 分屏。注意未命中也可能耗尽步数，不要把背景都理解为零成本。"
      },
      {
        "title": "控制比较条件",
        "body": "保持分辨率、时间和相机一致再调阈值或最大步数。此热图只反映主射线，阴影、AO、纹理和着色开销仍需单独分析。"
      }
    ],
    "experiment": {
      "parameter": "步进上限",
      "before": "80",
      "after": "40（同步调整热力图归一化分母）",
      "expected": "成本上限降低，复杂轮廓可能漏掉；对比画面正确性后再决定是否保留。"
    }
  }
];
export function findTutorial(id: string) { return TUTORIAL_CHAPTERS.find(chapter => chapter.id === id) ?? TUTORIAL_CHAPTERS[0]!; }
export function searchTutorials(query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return TUTORIAL_CHAPTERS.filter(chapter => words.every(word =>
    [chapter.title, chapter.goal, chapter.intro, chapter.detail, chapter.pitfall, chapter.exercise, chapter.change, chapter.expected, ...chapter.steps.map(step=>step.title+step.body), chapter.experiment.parameter, TUTORIAL_STAGES[chapter.stage]!.title,
      ...chapter.references.map(id => TUTORIAL_REFERENCES[id]!.author)].join(' ').toLocaleLowerCase().includes(word)));
}

import { createProject, passOf } from './model.js';
export const TUTORIAL_LABS = [
  {
    "id": "coordinates",
    "title": "坐标与颜色",
    "code": "\nfn mainImage(fragCoord: vec2f) -> vec4f {\n  let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;\n  let uv = fragCoord / iResolution.xy;\n  let grid = step(0.96, fract(uv.x * 10.0)) + step(0.96, fract(uv.y * 10.0));\n  let color = vec3f(uv, 0.35) * 0.7 + vec3f(grid * 0.12);\n  return vec4f(color, 1.0);\n}"
  },
  {
    "id": "analytic",
    "title": "圆与椭圆",
    "code": "fn ink(d: f32) -> f32 {\n  let aa = max(fwidth(d), 0.0001);\n  return 1.0 - smoothstep(-aa, aa, d);\n}\n\nfn mainImage(fragCoord: vec2f) -> vec4f {\n  let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;\n  // 左边：精确圆距离；右边：椭圆隐式方程（不是精确距离）。\n  let circle = length(p - vec2f(-0.65, 0.0)) - 0.42;\n  let q = (p - vec2f(0.65, 0.0)) / vec2f(0.52, 0.30);\n  let ellipse = dot(q, q) - 1.0;\n  let a = ink(circle);\n  let b = ink(ellipse);\n  var color = vec3f(0.025, 0.035, 0.06);\n  color = mix(color, vec3f(0.3, 0.85, 0.95), a);\n  color = mix(color, vec3f(0.75, 0.95, 0.3), b);\n  return vec4f(color, 1.0);\n}"
  },
  {
    "id": "boolean",
    "title": "三种布尔运算",
    "code": "fn ink(d: f32) -> f32 {\n  let aa = max(fwidth(d), 0.0001);\n  return 1.0 - smoothstep(-aa, aa, d);\n}\n\nfn mainImage(fragCoord: vec2f) -> vec4f {\n  let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;\n  // 从左到右：并集、交集、A 减 B。\n  let aspect = iResolution.x / iResolution.y;\n  let cell = clamp(i32(floor(fragCoord.x / iResolution.x * 3.0)), 0, 2);\n  let local = p - vec2f((f32(cell) - 1.0) * aspect * 2.0 / 3.0, 0.0);\n  let a = length(local + vec2f(0.17, 0.0)) - 0.36;\n  let b = length(local - vec2f(0.17, 0.0)) - 0.36;\n  var d = min(a, b);\n  if (cell == 1) { d = max(a, b); }\n  if (cell == 2) { d = max(a, -b); }\n  let mask = ink(d);\n  let lines = 0.06 * (0.5 + 0.5 * cos(d * 80.0));\n  let base = vec3f(0.025, 0.04, 0.055) + vec3f(lines);\n  return vec4f(mix(base, vec3f(0.3, 0.9, 0.7), mask), 1.0);\n}"
  },
  {
    "id": "warp",
    "title": "流动纹路",
    "code": "fn hash(p: vec2f) -> f32 {\n  return fract(sin(dot(p, vec2f(113.7, 291.3))) * 43758.54);\n}\nfn noise(p: vec2f) -> f32 {\n  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);\n  return mix(mix(hash(i), hash(i+vec2f(1.0,0.0)), u.x),\n    mix(hash(i+vec2f(0.0,1.0)), hash(i+vec2f(1.0)), u.x), u.y);\n}\nfn fbm(p: vec2f) -> f32 {\n  var q = p; var sum = 0.0; var amplitude = 0.5;\n  for (var octave = 0; octave < 4; octave++) {\n    sum += amplitude * noise(q); q = q * 2.03 + vec2f(2.7, 5.1); amplitude *= 0.5;\n  }\n  return sum;\n}\n\nfn mainImage(fragCoord: vec2f) -> vec4f {\n  let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;\n  let drift = vec2f(iTime * 0.08, -iTime * 0.05);\n  let field = vec2f(fbm(p * 2.0 + drift), fbm(p * 2.0 + vec2f(4.1, 9.2) - drift));\n  let q = p + 0.4 * field;\n  let bands = 0.5 + 0.5 * sin(q.x * 18.0 + fbm(q * 3.0) * 8.0);\n  return vec4f(mix(vec3f(0.03, 0.07, 0.16), vec3f(0.25, 0.9, 0.72), bands), 1.0);\n}"
  },
  {
    "id": "march",
    "title": "三维法线视图",
    "code": "fn sceneDistance(p: vec3f) -> f32 {\n  let ball = length(p - vec3f(-0.48, 0.0, 0.0)) - 0.65;\n  let q = p - vec3f(0.45, 0.0, 0.0);\n  let ring = length(vec2f(length(q.xy) - 0.62, q.z)) - 0.18;\n  return min(min(ball, ring), p.y + 0.85);\n}\nfn sceneNormal(p: vec3f) -> vec3f {\n  let e = 0.001;\n  let gradient = vec3f(\n    sceneDistance(p+vec3f(e,0,0))-sceneDistance(p-vec3f(e,0,0)),\n    sceneDistance(p+vec3f(0,e,0))-sceneDistance(p-vec3f(0,e,0)),\n    sceneDistance(p+vec3f(0,0,e))-sceneDistance(p-vec3f(0,0,e)));\n  return normalize(gradient);\n}\nfn trace(ro: vec3f, rd: vec3f) -> f32 {\n  var t = 0.0;\n  for (var stepIndex = 0; stepIndex < 80; stepIndex++) {\n    let d = sceneDistance(ro + rd * t);\n    if (d < 0.001) { return t; }\n    t += d;\n    if (t > 20.0) { break; }\n  }\n  return -1.0; // 未命中，不能把步数耗尽当作表面。\n}\n\nfn mainImage(fragCoord: vec2f) -> vec4f {\n  let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;\n  let ro = vec3f(0.0, 0.35, 3.5);\n  let rd = normalize(vec3f(p.x, p.y - 0.1, -1.8));\n  let t = trace(ro, rd);\n  var color = vec3f(0.03, 0.055, 0.09);\n  if (t > 0.0) {\n    let hit = ro + rd * t;\n    let n = sceneNormal(hit);\n    color = n * 0.5 + 0.5;\n  }\n  return vec4f(color, 1.0);\n}"
  },
  {
    "id": "light",
    "title": "光照与阴影",
    "code": "fn sceneDistance(p: vec3f) -> f32 {\n  let ball = length(p - vec3f(-0.48, 0.0, 0.0)) - 0.65;\n  let q = p - vec3f(0.45, 0.0, 0.0);\n  let ring = length(vec2f(length(q.xy) - 0.62, q.z)) - 0.18;\n  return min(min(ball, ring), p.y + 0.85);\n}\nfn sceneNormal(p: vec3f) -> vec3f {\n  let e = 0.001;\n  let gradient = vec3f(\n    sceneDistance(p+vec3f(e,0,0))-sceneDistance(p-vec3f(e,0,0)),\n    sceneDistance(p+vec3f(0,e,0))-sceneDistance(p-vec3f(0,e,0)),\n    sceneDistance(p+vec3f(0,0,e))-sceneDistance(p-vec3f(0,0,e)));\n  return normalize(gradient);\n}\nfn trace(ro: vec3f, rd: vec3f) -> f32 {\n  var t = 0.0;\n  for (var stepIndex = 0; stepIndex < 80; stepIndex++) {\n    let d = sceneDistance(ro + rd * t);\n    if (d < 0.001) { return t; }\n    t += d;\n    if (t > 20.0) { break; }\n  }\n  return -1.0; // 未命中，不能把步数耗尽当作表面。\n}\nfn shadow(p: vec3f, light: vec3f) -> f32 {\n  var t = 0.01; var shade = 1.0;\n  for (var j = 0; j < 32; j++) {\n    let d = sceneDistance(p + light * t);\n    if (d < 0.001) { return 0.0; }\n    shade = min(shade, 12.0 * d / t);\n    t += d;\n    if (t > 8.0) { break; }\n  }\n  return clamp(shade, 0.0, 1.0);\n}\n\nfn mainImage(fragCoord: vec2f) -> vec4f {\n  let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;\n  let ro = vec3f(0.0, 0.35, 3.5);\n  let rd = normalize(vec3f(p.x, p.y - 0.1, -1.8));\n  let t = trace(ro, rd);\n  var color = vec3f(0.03, 0.055, 0.09);\n  if (t > 0.0) {\n    let hit = ro + rd * t;\n    let n = sceneNormal(hit);\n    let light = normalize(vec3f(-0.6, 0.9, 0.7));\n    let diffuse = max(dot(n, light), 0.0);\n    let shade = shadow(hit + n * 0.004, light);\n    let halfDir = normalize(light - rd);\n    let specular = pow(max(dot(n, halfDir), 0.0), 48.0);\n    let base = select(vec3f(0.18, 0.23, 0.30), vec3f(0.22, 0.75, 0.68), hit.y > -0.83);\n    color = base * (0.14 + diffuse * shade) + vec3f(specular * shade * 0.6);\n  }\n  return vec4f(color, 1.0);\n}"
  },
  {
    "id": "feedback",
    "title": "时间与历史帧",
    "code": "\nfn mainImage(fragCoord: vec2f) -> vec4f {\n  let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;\n  return vec4f(channel0(fragCoord / iResolution.xy).rgb, 1.0);\n}"
  },
  {
    "id": "scene",
    "title": "有雾的微型雕塑",
    "code": "fn sceneDistance(p: vec3f) -> f32 {\n  let ball = length(p - vec3f(-0.48, 0.0, 0.0)) - 0.65;\n  let q = p - vec3f(0.45, 0.0, 0.0);\n  let ring = length(vec2f(length(q.xy) - 0.62, q.z)) - 0.18;\n  let k = 0.24;\n  let h = clamp(0.5 + 0.5 * (ring - ball) / k, 0.0, 1.0);\n  let sculpture = mix(ring, ball, h) - k * h * (1.0 - h);\n  return min(sculpture, p.y + 0.85);\n}\nfn sceneNormal(p: vec3f) -> vec3f {\n  let e = 0.001;\n  let gradient = vec3f(\n    sceneDistance(p+vec3f(e,0,0))-sceneDistance(p-vec3f(e,0,0)),\n    sceneDistance(p+vec3f(0,e,0))-sceneDistance(p-vec3f(0,e,0)),\n    sceneDistance(p+vec3f(0,0,e))-sceneDistance(p-vec3f(0,0,e)));\n  return normalize(gradient);\n}\nfn trace(ro: vec3f, rd: vec3f) -> f32 {\n  var t = 0.0;\n  for (var stepIndex = 0; stepIndex < 80; stepIndex++) {\n    let d = sceneDistance(ro + rd * t);\n    if (d < 0.001) { return t; }\n    t += d;\n    if (t > 20.0) { break; }\n  }\n  return -1.0; // 未命中，不能把步数耗尽当作表面。\n}\nfn shadow(p: vec3f, light: vec3f) -> f32 {\n  var t = 0.01; var shade = 1.0;\n  for (var j = 0; j < 32; j++) {\n    let d = sceneDistance(p + light * t);\n    if (d < 0.001) { return 0.0; }\n    shade = min(shade, 12.0 * d / t);\n    t += d;\n    if (t > 8.0) { break; }\n  }\n  return clamp(shade, 0.0, 1.0);\n}\n\nfn mainImage(fragCoord: vec2f) -> vec4f {\n  let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;\n  let ro = vec3f(0.0, 0.35, 3.5);\n  let rd = normalize(vec3f(p.x, p.y - 0.1, -1.8));\n  let t = trace(ro, rd);\n  var color = vec3f(0.03, 0.055, 0.09);\n  if (t > 0.0) {\n    let hit = ro + rd * t;\n    let n = sceneNormal(hit);\n    let light = normalize(vec3f(-0.6, 0.9, 0.7));\n    let diffuse = max(dot(n, light), 0.0);\n    let shade = shadow(hit + n * 0.004, light);\n    let halfDir = normalize(light - rd);\n    let specular = pow(max(dot(n, halfDir), 0.0), 48.0);\n    let base = select(vec3f(0.18, 0.23, 0.30), vec3f(0.22, 0.75, 0.68), hit.y > -0.83);\n    color = base * (0.14 + diffuse * shade) + vec3f(specular * shade * 0.6);\n    let fog = 1.0 - exp(-0.06 * t);\n    color = mix(color, vec3f(0.15, 0.21, 0.3), fog);\n    color = color / (vec3f(1.0) + color);\n  }\n  return vec4f(color, 1.0);\n}"
  }
] as const;
export function tutorialProject(id: string) {
  const lab = TUTORIAL_LABS.find(item => item.id === id);
  if (!lab) throw new Error('教程练习不存在。');
  const project = createProject('教程 · ' + lab.title);
  project.description = 'Shader Lab 教程练习。修改参数后观察画面，点击保存才加入我的作品。';
  passOf(project, 'image').code = lab.code;
  if (id === 'feedback') {
    const buffer = passOf(project, 'buffer-a'); buffer.enabled = true;
    buffer.channels[0] = { kind: 'buffer', pass: 'buffer-a' };
    buffer.code = "\nfn mainImage(fragCoord: vec2f) -> vec4f {\n  let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;\n  let uv = fragCoord / iResolution.xy;\n  let old = channel0(uv).rgb * exp(-1.3 * iTimeDelta);\n  let center = vec2f(sin(iTime * 1.2), cos(iTime * 1.7)) * 0.45;\n  let d = length(p - center);\n  let glow = exp(-120.0 * d * d);\n  let fresh = vec3f(0.25, 0.85, 0.7) * glow;\n  return vec4f(max(old, fresh), 1.0);\n}";
    passOf(project, 'image').channels[0] = { kind: 'buffer', pass: 'buffer-a' };
  }
  return project;
}

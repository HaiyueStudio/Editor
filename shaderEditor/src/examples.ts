import { createProject, passOf, type ShaderProject } from './model.js';

export interface Example { id: string; label: string; category: string; accent: string; project: ShaderProject }
const make = (id: string, name: string, description: string, code: string): ShaderProject => {
  const p = createProject(name); p.id = `example-${id}`; p.description = description; passOf(p, 'image').code = code; return p;
};
export function examples(): Example[] {
  const aurora = make('aurora', 'Aurora ribbons', '流动的光带与颗粒夜空。用正弦叠加探索程序化色彩。', `fn mainImage(fragCoord: vec2f) -> vec4f {
  let uv = fragCoord / iResolution.xy;
  let p = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
  var color = vec3f(0.012, 0.022, 0.045);
  for (var j = 0; j < 7; j++) {
    let f = f32(j);
    let wave = 0.25 * sin(p.x * 1.5 + iTime * 0.35 + f * 0.18)
             + 0.10 * sin(p.x * 4.0 - iTime * 0.2 + f);
    let ribbon = exp(-abs(p.y - wave - f * 0.04) * (16.0 + f * 3.0));
    let tint = mix(vec3f(0.06, 0.85, 0.6), vec3f(0.45, 0.18, 0.85), f / 6.0);
    color += ribbon * tint * 0.24;
  }
  let star = pow(fract(sin(dot(floor(fragCoord / 2.0), vec2f(12.9898, 78.233))) * 43758.5453), 180.0);
  color += vec3f(star * 0.3 * smoothstep(0.35, 0.9, uv.y));
  color *= 0.5 + 0.5 * pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.2);
  return vec4f(color, 1.0);
}`);
  const marble = make('marble', 'Liquid chrome', '用极坐标和多层波纹制作流体金属。切到 3D，观察球面上的纹理。', `fn mainImage(fragCoord: vec2f) -> vec4f {
  var p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  for (var j = 1; j < 6; j++) {
    let f = f32(j);
    p += 0.23 * sin(p.yx * f + vec2f(iTime * 0.18 + f));
  }
  let bands = 0.5 + 0.5 * sin(p.x * 8.0 + p.y * 5.0);
  let base = mix(vec3f(0.03, 0.08, 0.14), vec3f(0.58, 0.78, 0.87), bands);
  let edge = pow(bands, 18.0);
  return vec4f(base + vec3f(edge * 0.7), 1.0);
}`);
  const tunnel = make('tunnel', 'Neon passage', '无限延伸的发光隧道。时间驱动的极坐标实验。', `fn mainImage(fragCoord: vec2f) -> vec4f {
  let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  let r = max(length(p), 0.02);
  let a = atan2(p.y, p.x);
  let z = 1.0 / r + iTime * 0.9;
  let ring = pow(0.5 + 0.5 * cos(z * 8.0), 16.0);
  let spoke = pow(0.5 + 0.5 * cos(a * 10.0 + z * 0.2), 30.0);
  let color = vec3f(0.55, 0.18, 1.0) * ring + vec3f(0.05, 0.7, 0.85) * spoke;
  return vec4f(color * smoothstep(0.02, 0.5, r), 1.0);
}`);
  const feedback = make('feedback', 'Afterglow', 'Buffer A 读取自身上一帧，留下缓慢消散的轨迹。拖动鼠标可以绘制光点。', `fn mainImage(fragCoord: vec2f) -> vec4f {
  return vec4f(channel0(fragCoord / iResolution.xy).rgb, 1.0);
}`);
  const buffer = passOf(feedback, 'buffer-a'); buffer.enabled = true; buffer.channels[0] = { kind: 'buffer', pass: 'buffer-a' };
  buffer.code = `fn mainImage(fragCoord: vec2f) -> vec4f {
  let uv = fragCoord / iResolution.xy;
  let old = channel0((uv - vec2f(0.5)) * 1.004 + vec2f(0.5)).rgb * 0.982;
  var center = vec2f(0.5) + 0.25 * vec2f(sin(iTime * 1.3), cos(iTime * 1.7));
  if (iMouse.z > 0.0) { center = iMouse.xy / iResolution.xy; }
  let d = (uv - center) * vec2f(iResolution.x / iResolution.y, 1.0);
  let glow = exp(-dot(d, d) * 900.0);
  let tint = vec3f(0.5) + 0.5 * cos(vec3f(iTime) + vec3f(0.0, 2.0, 4.0));
  return vec4f(max(old, tint * glow), 1.0);
}`;
  passOf(feedback, 'image').channels[0] = { kind: 'buffer', pass: 'buffer-a' };
  const keyboard = make('keyboard', 'Key light', '点击预览画布，再按 A–Z 或 0–9。MSDF 图集绘制对应字符，Buffer A 记住最后一次按键。', `// iChannel0: Buffer A · iChannel1: 内置 MSDF · iChannel2: 键盘
// MSDF 的 16×16 字符按编码从左到右、从上到下排列。
fn glyph(code: u32, uv: vec2f) -> f32 {
  let tile = vec2f(f32(code % 16u), f32(code / 16u));
  let atlas = (tile + clamp(uv, vec2f(0.008), vec2f(0.992))) / 16.0;
  // 此图集的 Alpha 保存有符号距离：小于 0.5 为字形内部。
  let distance = 1.0 - textureSampleLevel(iChannel1, iSampler, atlas, 0.0).a;
  let width = max(fwidth(distance), 0.001);
  let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
  return select(0.0, smoothstep(0.5 - width, 0.5 + width, distance), inside);
}
fn mainImage(fragCoord: vec2f) -> vec4f {
  let uv = fragCoord / iResolution.xy;
  let key = u32(round(channel0(vec2f(0.5)).r * 255.0));
  let held = channel2(vec2f((f32(key) + 0.5) / 256.0, 0.5 / 3.0)).r;
  let p = (fragCoord - iResolution.xy * vec2f(0.5, 0.56)) / iResolution.y;
  let big = glyph(key, vec2f(p.x, -p.y) / 0.76 + vec2f(0.5));
  let tint = mix(vec3f(0.32, 0.85, 0.95), vec3f(0.75, 1.0, 0.32), held);
  var color = vec3f(0.025, 0.038, 0.065) + tint * 0.1 * exp(-length(p) * 4.0);
  let grid = step(0.97, fract(uv.x * 32.0)) + step(0.97, fract(uv.y * 20.0));
  color += vec3f(grid * 0.009);
  color = mix(color, tint, big);
  let column = clamp(u32(uv.x * 26.0), 0u, 25u);
  let letter = glyph(65u + column, vec2f(fract(uv.x * 26.0), 1.0 - (uv.y - 0.02) / 0.12));
  let highlight = select(0.25, 1.0, key == 65u + column);
  color = mix(color, tint * highlight, letter);
  return vec4f(color, 1.0);
}`);
  const keyBuffer = passOf(keyboard, 'buffer-a');
  keyBuffer.enabled = true;
  keyBuffer.channels[0] = { kind: 'keyboard' };
  keyBuffer.channels[1] = { kind: 'buffer', pass: 'buffer-a' };
  keyBuffer.code = `// 键盘第 1 行：本帧按下。保存字符，松开后也能显示。
fn mainImage(fragCoord: vec2f) -> vec4f {
  var key = select(channel1(vec2f(0.5)).r * 255.0, 65.0, iFrame == 0);
  for (var code = 48; code <= 90; code++) {
    if (code > 57 && code < 65) { continue; }
    if (channel0(vec2f((f32(code) + 0.5) / 256.0, 1.5 / 3.0)).r > 0.5) { key = f32(code); }
  }
  return vec4f(key / 255.0, 0.0, 0.0, 1.0);
}`;
  passOf(keyboard, 'image').channels[0] = { kind: 'buffer', pass: 'buffer-a' };
  passOf(keyboard, 'image').channels[1] = { kind: 'builtin', texture: 'msdf' };
  passOf(keyboard, 'image').channels[2] = { kind: 'keyboard' };
  return [
    { id: 'aurora', label: '01', category: 'PROCEDURAL', accent: 'aurora', project: aurora },
    { id: 'marble', label: '02', category: 'MATERIAL', accent: 'chrome', project: marble },
    { id: 'tunnel', label: '03', category: 'COORDINATES', accent: 'neon', project: tunnel },
    { id: 'feedback', label: '04', category: 'MULTIPASS', accent: 'feedback', project: feedback },
    { id: 'keyboard', label: '05', category: 'KEYBOARD · MSDF', accent: 'keyboard', project: keyboard },
  ];
}

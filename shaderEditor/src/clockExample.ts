import { createProject, passOf, type ShaderProject } from './model.js';

export function clockExample(previewSeconds = -1): ShaderProject {
  const p = createProject('Local time · 时钟');
  p.id = 'example-clock';
  p.description = '纯距离场时钟：本地时间驱动三根指针与数字显示。Common 可设置时差、12/24 小时制、平滑或跳秒；无需纹理。';
  p.tabs = ['image', 'common'];
  p.common = CLOCK_COMMON.replace('CLOCK_DEMO_SECONDS: f32 = -1.0', `CLOCK_DEMO_SECONDS: f32 = ${previewSeconds.toFixed(3)}`);
  passOf(p, 'image').code = CLOCK_IMAGE;
  return p;
}

export const CLOCK_COMMON = `// iDate.w：本地时间，从午夜起的秒数（包含小数秒）。
// 修改参数后点击运行。DEMO_SECONDS 为 -1 时显示真实时间。
const CLOCK_OFFSET_HOURS: f32 = 0.0;
const CLOCK_24_HOUR: bool = true;
const CLOCK_STEPPED_SECONDS: bool = false;
const CLOCK_DEMO_SECONDS: f32 = -1.0;
const CLOCK_ACCENT: vec3f = vec3f(0.42, 0.86, 0.72);
const CLOCK_SECOND_COLOR: vec3f = vec3f(1.0, 0.38, 0.22);
const CLOCK_TAU: f32 = 6.28318530718;

// 从 12 点方向起，按顺时针旋转。
fn clockDirection(angle: f32) -> vec2f { return vec2f(sin(angle), cos(angle)); }
fn clockTime() -> f32 {
  let base = select(iDate.w, CLOCK_DEMO_SECONDS, CLOCK_DEMO_SECONDS >= 0.0);
  let seconds = base + CLOCK_OFFSET_HOURS * 3600.0;
  return seconds - floor(seconds / 86400.0) * 86400.0;
}
fn clockCapsule(p: vec2f, a: vec2f, b: vec2f, radius: f32) -> f32 {
  let ab = b - a;
  let projection = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(p - a - projection * ab) - radius;
}
fn clockBox(p: vec2f, halfSize: vec2f) -> f32 {
  let q = abs(p) - halfSize;
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
}
fn clockInk(distance: f32, pixel: f32) -> f32 {
  return 1.0 - smoothstep(-pixel, pixel, distance);
}
// 七段数字同样由胶囊距离场绘制，不需要字体图片。
fn clockDigit(p: vec2f, digit: i32) -> f32 {
  let bits = array<u32, 10>(63u, 6u, 91u, 79u, 102u, 109u, 125u, 7u, 127u, 111u);
  let starts = array<vec2f, 7>(vec2f(-.30,.70), vec2f(.42,.58), vec2f(.42,-.12), vec2f(-.30,-.70), vec2f(-.42,-.58), vec2f(-.42,.12), vec2f(-.30,0.));
  let ends = array<vec2f, 7>(vec2f(.30,.70), vec2f(.42,.12), vec2f(.42,-.58), vec2f(.30,-.70), vec2f(-.42,-.12), vec2f(-.42,.58), vec2f(.30,0.));
  var distance = 10.0;
  for (var segment = 0; segment < 7; segment++) {
    if ((bits[clamp(digit, 0, 9)] & (1u << u32(segment))) != 0u) {
      distance = min(distance, clockCapsule(p, starts[segment], ends[segment], .075));
    }
  }
  return distance;
}
fn clockPair(p: vec2f, value: i32, size: f32) -> f32 {
  let left = clockDigit((p + vec2f(size*.62, 0.0)) / size, value / 10);
  let right = clockDigit((p - vec2f(size*.62, 0.0)) / size, value % 10);
  return min(left, right) * size;
}
fn clockHand(p: vec2f, angle: f32, extent: f32, width: f32) -> f32 {
  let direction = clockDirection(angle);
  return clockCapsule(p, -direction * .075, direction * extent, width);
}`;

export const CLOCK_IMAGE = `// Image：极坐标刻度 + 胶囊指针 + 七段数字，全部使用距离场。
fn mainImage(fragCoord: vec2f) -> vec4f {
  let side = min(iResolution.x, iResolution.y);
  let pixel = 1.3 / side;
  let p = (2.0 * fragCoord - iResolution.xy) / side;
  let q = p - vec2f(0.0, .035);
  let radius = length(q);
  let seconds = clockTime();
  let second = select(seconds % 60.0, floor(seconds % 60.0), CLOCK_STEPPED_SECONDS);
  let minute = floor(seconds / 60.0) % 60.0 + second / 60.0;
  let hour = floor(seconds / 3600.0) % 12.0 + minute / 60.0;
  let hourAngle = hour / 12.0 * CLOCK_TAU;
  let minuteAngle = minute / 60.0 * CLOCK_TAU;
  let secondAngle = second / 60.0 * CLOCK_TAU;

  var color = vec3f(.018, .028, .043) + vec3f(.016, .026, .029) * exp(-dot(p,p) * 1.3);
  // 表壳投影、黄铜倒角和深色表盘。
  color *= 1.0 - .75 * clockInk(length(q - vec2f(.018,-.03)) - .85, .014);
  let rimLight = .5 + .5 * dot(normalize(q + vec2f(.00001)), normalize(vec2f(-.7,1.0)));
  let metal = mix(vec3f(.16,.13,.085), vec3f(.73,.64,.43), rimLight);
  color = mix(color, metal, clockInk(radius-.835,pixel));
  color = mix(color, vec3f(.025,.041,.049), clockInk(radius-.806,pixel));
  color = mix(color, vec3f(.075,.105,.105), clockInk(abs(radius-.782)-.0018,pixel));
  color = mix(color, vec3f(.045,.065,.07), clockInk(abs(radius-.520)-.001,pixel));

  // 每个像素只计算距离它最近的刻度和数字。
  let angle = atan2(q.x,q.y);
  let tick = round(angle / CLOCK_TAU * 60.0);
  let direction = clockDirection(tick / 60.0 * CLOCK_TAU);
  let major = i32(tick) % 5 == 0;
  let tickPosition = vec2f(dot(q,vec2f(direction.y,-direction.x)),dot(q,direction)-.724);
  let tickDistance = clockBox(tickPosition,select(vec2f(.0021,.010),vec2f(.0047,.026),major));
  color = mix(color,select(vec3f(.30,.40,.41),vec3f(.83,.85,.75),major),clockInk(tickDistance,pixel));
  let hourIndex = (i32(round(angle / CLOCK_TAU * 12.0)) + 12) % 12;
  let number = select(hourIndex,12,hourIndex == 0);
  let labelPosition = q - clockDirection(f32(hourIndex) / 12.0 * CLOCK_TAU) * .606;
  var labelDistance = clockDigit(labelPosition/.033,number)*.033;
  if (number >= 10) { labelDistance = clockPair(labelPosition,number,.033); }
  color = mix(color,vec3f(.70,.76,.70),clockInk(labelDistance,pixel));

  // 数字窗的 HH:MM:SS 与指针读取相同的秒数。
  let display = q - vec2f(0.0,-.355);
  color = mix(color,vec3f(.014,.028,.034),clockInk(clockBox(display,vec2f(.255,.067))-.012,pixel));
  color = mix(color,vec3f(.11,.20,.20),clockInk(abs(clockBox(display,vec2f(.255,.067))-.012)-.0015,pixel));
  var digitalHour = i32(seconds / 3600.0);
  if (!CLOCK_24_HOUR) { digitalHour = (digitalHour + 11) % 12 + 1; }
  var digital = clockPair(display+vec2f(.17,0.0),digitalHour,.040);
  digital = min(digital,clockPair(display,i32(seconds/60.0)%60,.040));
  digital = min(digital,clockPair(display-vec2f(.17,0.0),i32(seconds)%60,.040));
  let dotLeft = abs(display - vec2f(-.085,0.0)) - vec2f(0.0,.020);
  let dotRight = abs(display - vec2f(.085,0.0)) - vec2f(0.0,.020);
  digital = min(digital,min(length(dotLeft),length(dotRight))-.004);
  color = mix(color,CLOCK_ACCENT*.95,clockInk(digital,pixel));

  // 先画投影，再叠加时针、分针、秒针和中心铆钉。
  let shadowPoint = q - vec2f(.012,-.016);
  let shadow = min(clockHand(shadowPoint,hourAngle,.34,.024),clockHand(shadowPoint,minuteAngle,.49,.014));
  color = mix(color,vec3f(.005,.012,.015),clockInk(shadow,pixel*2.0)*.75);
  color = mix(color,vec3f(.86,.87,.76),clockInk(clockHand(q,hourAngle,.34,.024),pixel));
  color = mix(color,CLOCK_ACCENT,clockInk(clockHand(q,minuteAngle,.49,.014),pixel));
  color = mix(color,CLOCK_SECOND_COLOR,clockInk(clockHand(q,secondAngle,.66,.0045),pixel));
  let counterweight = length(q+clockDirection(secondAngle)*.11);
  color = mix(color,CLOCK_SECOND_COLOR,clockInk(abs(counterweight-.021)-.004,pixel));
  color = mix(color,metal,clockInk(radius-.035,pixel));
  color = mix(color,vec3f(.06,.10,.11),clockInk(radius-.016,pixel));
  return vec4f(color,1.0);
}`;

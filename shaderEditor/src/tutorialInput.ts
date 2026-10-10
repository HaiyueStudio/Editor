
import { COVERAGE, SEGMENT, shader2d } from './tutorialGeometry.js';

const mouseCenter = `  // xy 仅在按住拖动时更新，松开后保留；z 的符号表示是否按住。
  var center = vec2f(0.0);
  if (abs(iMouse.z)>0.0) { center = (2.0*iMouse.xy-iResolution.xy)/iResolution.y; }`;
const picture = `  let mask = coverage(length(p-center)-0.35);
  let uv = fragCoord/iResolution.xy;
  var color = mix(vec3f(0.02,0.035,0.065),channel0(uv).rgb,mask);
`;
const crosshair = `  let q = abs(p-center);
  let crosshair = coverage(min(max(q.x-0.045,q.y-0.003),max(q.x-0.003,q.y-0.045)));
  color = mix(color,vec3f(0.9,1.0,0.4),crosshair);
`;
const keyHelper = `// 第一行：按住；第二行：本帧按下；第三行：每次按下翻转。
fn keyState(key: u32, row: u32) -> f32 {
  return channel1(vec2f((f32(key)+0.5)/256.0,(f32(row)+0.5)/3.0)).r;
}
fn keyDirection() -> vec2f {
  let direction = vec2f(keyState(39u,0u)-keyState(37u,0u),keyState(38u,0u)-keyState(40u,0u));
  return direction/max(length(direction),1.0);
}`;
const heldBody = mouseCenter+`
  // 本章只产生偏移；后续的持续移动章节用 Buffer 累积位置。
  center += keyDirection()*0.4;
`+picture+crosshair;
const toggleBody = heldBody+`
  let held = keyState(32u,0u);
  let pressed = keyState(32u,1u);
  let toggled = keyState(32u,2u);
  let accent = mix(vec3f(0.15,0.8,0.9),vec3f(1.0,0.35,0.15),toggled);
  let ring = coverage(abs(length(p-center)-0.35)-0.012);
  color = mix(color,accent,ring);
  // 左上：按住时常亮；中上：只亮一帧；右上：每次按下切换。
  let lamps = vec3f(
    coverage(length(p-vec2f(-0.25,0.72))-0.055),
    coverage(length(p-vec2f(0.0,0.72))-0.055),
    coverage(length(p-vec2f(0.25,0.72))-0.055));
  color += vec3f(dot(lamps,vec3f(held,pressed,toggled)));
`;

export const INPUT_CODES: Record<string,string> = {
  'mouse-position': shader2d(mouseCenter+'\n'+picture+crosshair+'  return vec4f(color,1.0);',COVERAGE),
  'mouse-drag': shader2d(mouseCenter+'\n'+picture+`
  var origin = vec2f(0.0);
  if (abs(iMouse.z)>0.0) { origin = (2.0*abs(iMouse.zw)-iResolution.xy)/iResolution.y; }
  let line = coverage(segmentDistance(p,origin,center)-0.006);
  let start = coverage(abs(length(p-origin)-0.055)-0.008);
  let accent = select(vec3f(0.25,0.45,0.55),vec3f(1.0,0.65,0.2),iMouse.z>0.0);
  color = mix(color,accent,max(line,start));
`+crosshair+'  return vec4f(color,1.0);',COVERAGE+'\n'+SEGMENT),
  'keyboard-held': shader2d(heldBody+'  return vec4f(color,1.0);',COVERAGE+'\n'+keyHelper),
  'keyboard-toggle': shader2d(toggleBody+'  return vec4f(color,1.0);',COVERAGE+'\n'+keyHelper),
  'keyboard-movement': shader2d(`  // Image: iChannel0 = 城市图片，iChannel1 = Buffer A。
  let state = channel1(vec2f(0.5));
  let center = state.xy;
`+picture+crosshair+`
  let accent = mix(vec3f(0.15,0.8,0.9),vec3f(1.0,0.35,0.15),state.z);
  let ring = coverage(abs(length(p-center)-0.35)-0.012);
  color = mix(color,accent,ring);
  return vec4f(color,1.0);`,COVERAGE)
};
export const MOVEMENT_BUFFER = keyHelper+`
// Buffer A: iChannel0 = 自身上一帧，iChannel1 = 键盘。
// 每个像素都保存同一份状态：RG 是位置，B 是主题，A 恒为 1。
fn mainImage(fragCoord: vec2f) -> vec4f {
  var position = vec2f(0.0);
  if (iFrame>0) { position = channel0(vec2f(0.5)).xy; }
  position += keyDirection()*0.6*iTimeDelta;
  let limit = max(vec2f(iResolution.x/iResolution.y,1.0)-vec2f(0.35),vec2f(0.0));
  position = clamp(position,-limit,limit);
  if (keyState(82u,1u)>0.5) { position = vec2f(0.0); }
  return vec4f(position,keyState(32u,2u),1.0);
}`;

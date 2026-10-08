
import { shader2d } from './tutorialGeometry.js';

const SETTINGS = `// 消光系数 × 路径长度 = 光学厚度；不是固定表面 alpha。
const EXTINCTION: f32 = 1.2;
const VOLUME_COLOR = vec3f(0.08,0.65,0.85);
// 0：合成棋盘背景；1：不透明度；2：几何厚度。
const DISPLAY_MODE: i32 = 0;
`;
const SPHERE = `fn volumeInterval(ro: vec3f, rd: vec3f) -> vec2f {
  // rd 已归一化，解 |ro+t*rd|² = radius²。
  let radius = 0.75;
  let b = dot(ro,rd);
  let c = dot(ro,ro)-radius*radius;
  let discriminant = b*b-c;
  if (discriminant<0.0) { return vec2f(-1.0); }
  let halfChord = sqrt(discriminant);
  let enter = max(-b-halfChord,0.0);
  let exit = -b+halfChord;
  if (exit<=enter) { return vec2f(-1.0); }
  return vec2f(enter,exit);
}
`;
const BOX = `fn volumeInterval(ro: vec3f, rd: vec3f) -> vec2f {
  let halfSize = vec3f(0.6);
  var enter = 0.0;
  var exit = 1000000.0;
  // Slab：依次求 X/Y/Z 两平面之间的区间，再取交集。
  for (var axis = 0; axis<3; axis++) {
    if (abs(rd[axis])<0.000001) {
      // 平行且在 slab 外没有交点；平行且在里面不限制区间。
      if (abs(ro[axis])>halfSize[axis]) { return vec2f(-1.0); }
    } else {
      let first = (-halfSize[axis]-ro[axis])/rd[axis];
      let second = (halfSize[axis]-ro[axis])/rd[axis];
      enter = max(enter,min(first,second));
      exit = min(exit,max(first,second));
      if (exit<=enter) { return vec2f(-1.0); }
    }
  }
  return vec2f(enter,exit);
}
fn toVolumeLocal(p: vec3f) -> vec3f {
  // 逆旋转同时用于射线原点和方向，旋转不改变长度单位。
  let yaw = -0.55;
  let pitch = -0.28;
  let q = vec3f(cos(yaw)*p.x+sin(yaw)*p.z,p.y,-sin(yaw)*p.x+cos(yaw)*p.z);
  return vec3f(q.x,cos(pitch)*q.y-sin(pitch)*q.z,sin(pitch)*q.y+cos(pitch)*q.z);
}
`;
const HOMOGENEOUS = `fn shadeVolume(ro: vec3f, rd: vec3f, segment: vec2f) -> vec4f {
  let thickness = max(segment.y-segment.x,0.0);
  if (thickness<=0.0) { return vec4f(0.0); }
  let transmittance = exp(-max(EXTINCTION,0.0)*thickness);
  let opacity = 1.0-transmittance;
  // 返回预乘颜色与不透明度；之后只把背景乘剩余透射率。
  return vec4f(VOLUME_COLOR*opacity,opacity);
}
`;
const MARCHING = `const VOLUME_STEPS: i32 = 64;
fn volumeDensity(p: vec3f) -> f32 {
  // 改成 return 1.0; 可与上一章的均匀体积闭式解对照。
  let wave = 0.5+0.5*sin(p.x*8.0+2.0*sin(p.y*5.0))*sin(p.z*7.0);
  return 0.25+0.75*wave*wave;
}
fn shadeVolume(ro: vec3f, rd: vec3f, segment: vec2f) -> vec4f {
  let thickness = max(segment.y-segment.x,0.0);
  if (thickness<=0.0) { return vec4f(0.0); }
  let stepLength = thickness/f32(VOLUME_STEPS);
  var transmittance = 1.0;
  var accumulated = vec3f(0.0);
  for (var stepIndex = 0; stepIndex<VOLUME_STEPS; stepIndex++) {
    // 中点采样，最后一段也严格落在出射点以内。
    let t = segment.x+(f32(stepIndex)+0.5)*stepLength;
    let density = max(volumeDensity(ro+rd*t),0.0);
    let stepOpacity = 1.0-exp(-max(EXTINCTION,0.0)*density*stepLength);
    accumulated += transmittance*stepOpacity*VOLUME_COLOR;
    transmittance *= 1.0-stepOpacity;
    if (transmittance<0.005) { break; }
  }
  return vec4f(accumulated,1.0-transmittance);
}
`;
const BACKGROUND = `fn volumeBackground(p: vec2f) -> vec3f {
  let cells = floor(p*6.0);
  let checker = select(0.0,1.0,fract((cells.x+cells.y)*0.5)>0.25);
  return mix(vec3f(0.16,0.19,0.24),vec3f(0.72,0.76,0.82),checker);
}
`;

export function volumeShader(shape: 'sphere' | 'box', marching = false) {
  const camera = shape==='sphere'
    ? '  let ro = vec3f(0.0,0.0,3.2);\n  let rd = normalize(vec3f(p,-2.4));'
    : '  let ro = toVolumeLocal(vec3f(0.0,0.0,3.2));\n  let rd = toVolumeLocal(normalize(vec3f(p,-2.4)));';
  return shader2d(camera+`
  let segment = volumeInterval(ro,rd);
  let volume = shadeVolume(ro,rd,segment);
  let background = volumeBackground(p);
  var color = volume.rgb+background*(1.0-volume.a);
  if (DISPLAY_MODE==1) { color = vec3f(volume.a); }
  if (DISPLAY_MODE==2) { color = vec3f(max(segment.y-segment.x,0.0)/2.0); }
  // 背景已在 Shader 内完成合成，画布输出 alpha 为 1。
  return vec4f(color,1.0);`,SETTINGS+(shape==='sphere'?SPHERE:BOX)+(marching?MARCHING:HOMOGENEOUS)+BACKGROUND);
}
export const VOLUME_CODES = {
  'volume-sphere': volumeShader('sphere'),
  'volume-box': volumeShader('box'),
  'volume-march': volumeShader('box',true)
};


import { shader2d, SEGMENT, POLYGON } from './tutorialGeometry.js';
const BOX3 = `fn sdBox3(p: vec3f, halfSize: vec3f) -> f32 {
  let q = abs(p) - halfSize;
  return length(max(q,vec3f(0.0))) + min(max(q.x,max(q.y,q.z)),0.0);
}`;
const TORUS = `fn sdTorus(p: vec3f, major: f32, minor: f32) -> f32 {
  return length(vec2f(length(p.xz)-major,p.y))-minor;
}`;
const CYLINDER = `fn sdCylinder(p: vec3f, radius: f32, halfHeight: f32) -> f32 {
  let q = vec2f(length(p.xz)-radius, abs(p.y)-halfHeight);
  return length(max(q,vec2f(0.0))) + min(max(q.x,q.y),0.0);
}`;
const EXTRUSION = `fn sdExtrusion(p: vec3f, halfDepth: f32) -> f32 {
  let d2 = sdPolygon(p.xy, 6, 0.34);
  let q = vec2f(d2, abs(p.z)-halfDepth);
  return length(max(q,vec2f(0.0))) + min(max(q.x,q.y),0.0);
}`;
export function sceneFunctions(level: number) {
  const helpers = [level >= 2 ? BOX3 : '', level >= 3 ? TORUS : '', level >= 4 ? CYLINDER : '',
    level >= 5 ? SEGMENT + '\n' + POLYGON + '\n' + EXTRUSION : ''].filter(Boolean).join('\n');
  let body = '  var d = length(p) - 0.65;';
  if (level >= 1) body = `  var d = min(length(p-vec3f(-0.62,-0.12,0.0))-0.53, p.y+0.7);
  d = min(d, length(p-vec3f(-0.8,0.58,0.0))-0.17);`;
  if (level >= 2) body += '\n  d = min(d, sdBox3(p-vec3f(0.55,-0.31,0.0),vec3f(0.35)));';
  if (level >= 3) body += '\n  d = min(d, sdTorus(p-vec3f(0.55,0.26,0.0),0.37,0.10));';
  if (level >= 4) body += '\n  d = min(d, sdCylinder(p-vec3f(0.0,-0.27,0.7),0.17,0.43));';
  if (level >= 5) body += '\n  d = min(d, sdExtrusion(p-vec3f(0.0,0.65,0.0),0.13));';
  return helpers + '\nfn sceneDistance(p: vec3f) -> f32 {\n' + body + '\n  return d;\n}';
}
const TRACE = `fn trace(ro: vec3f, rd: vec3f) -> vec2f {
  var t = 0.0;
  var queries = 0;
  for (var j = 0; j < 80; j++) {
    queries = j+1;
    let distance = sceneDistance(ro + rd*t);
    if (distance < 0.001) { return vec2f(t,f32(queries)); }
    t += distance;
    if (t > 20.0) { break; }
  }
  return vec2f(-1.0,f32(queries));
}`;
const NORMAL = `fn sceneNormal(p: vec3f) -> vec3f {
  let e = 0.001;
  return normalize(vec3f(
    sceneDistance(p+vec3f(e,0,0))-sceneDistance(p-vec3f(e,0,0)),
    sceneDistance(p+vec3f(0,e,0))-sceneDistance(p-vec3f(0,e,0)),
    sceneDistance(p+vec3f(0,0,e))-sceneDistance(p-vec3f(0,0,e))));
}`;
const SHADOW = `fn shadow(p: vec3f, light: vec3f) -> f32 {
  var t = 0.01; var visibility = 1.0;
  for (var j = 0; j < 32; j++) {
    let d = sceneDistance(p+light*t);
    if (d < 0.001) { return 0.0; }
    visibility = min(visibility,12.0*d/t);
    t += d;
    if (t > 8.0) { break; }
  }
  return clamp(visibility,0.0,1.0);
}`;
const AO = `fn ambientOcclusion(p: vec3f, n: vec3f) -> f32 {
  var amount = 0.0; var weight = 1.0;
  for (var j = 1; j <= 5; j++) {
    let h = f32(j)*0.06;
    amount += weight*max(0.0,h-sceneDistance(p+n*h));
    weight *= 0.65;
  }
  return clamp(1.0-3.0*amount,0.0,1.0);
}`;
const ENVIRONMENT = `fn environment(direction: vec3f) -> vec3f {
  let sky = mix(vec3f(0.035,0.055,0.085),vec3f(0.5,0.75,0.95),clamp(direction.y*0.5+0.5,0.0,1.0));
  let sun = pow(max(dot(direction,normalize(vec3f(-0.6,0.9,0.7))),0.0),64.0);
  return sky+vec3f(1.0,0.75,0.35)*sun*2.0;
}`;
export type RayStyle = 'flat' | 'normal' | 'lighting' | 'shadows' | 'occlusion' | 'reflection' | 'atmosphere' | 'glow' | 'scene' | 'performance';
export function rayShader(level: number, style: RayStyle) {
  const order: RayStyle[] = ['flat','normal','lighting','shadows','occlusion','reflection','atmosphere','glow','scene','performance'];
  const rank = order.indexOf(style);
  let helpers = sceneFunctions(level) + '\n' + TRACE;
  if (rank >= 1) helpers += '\n' + NORMAL;
  if (rank >= 3) helpers += '\n' + SHADOW;
  if (rank >= 4) helpers += '\n' + AO;
  if (rank >= 5) helpers += '\n' + ENVIRONMENT;
  let surface = 'color = vec3f(0.25,0.8,0.65) * (0.55 + 0.45*exp(-0.2*hitInfo.x));';
  if (rank >= 1) surface = 'let n = sceneNormal(hit);\n    color = n*0.5+0.5;';
  if (rank >= 2) surface = `let n = sceneNormal(hit);
    let light = normalize(vec3f(-0.6,0.9,0.7));
    let diffuse = max(dot(n,light),0.0);
    let halfway = normalize(light-rd);
    let specular = pow(max(dot(n,halfway),0.0),48.0);
    let base = select(vec3f(0.13,0.19,0.24),vec3f(0.18,0.65,0.53),hit.y>-0.69);
    var visibility = 1.0;`;
  if (rank >= 3) surface += '\n    visibility = shadow(hit+n*0.004,light);';
  if (rank >= 2) surface += '\n    color = base*(0.16+diffuse*visibility)+vec3f(specular*visibility*0.6);';
  if (rank >= 4) surface += '\n    color *= ambientOcclusion(hit+n*0.002,n);';
  if (rank >= 5) surface += `
    let direction = reflect(rd,n);
    let fresnel = 0.04 + 0.96*pow(1.0-clamp(dot(n,-rd),0.0,1.0),5.0);
    color = mix(color,environment(direction),fresnel);`;
  if (rank >= 6) surface += '\n    color = mix(color,vec3f(0.14,0.22,0.3),1.0-exp(-0.12*hitInfo.x));';
  if (rank >= 7) surface += `
    // 程序化自发光条带；不是多 Pass Bloom。
    let emission = pow(0.5+0.5*sin(hit.y*26.0+iTime),18.0);
    color += vec3f(0.12,1.8,1.2)*emission*select(0.0,1.0,hit.y>-0.65);
    color = color/(vec3f(1.0)+color);`;
  const debug = style === 'performance' ? `
    // 左半屏是完整效果，右半屏用颜色显示主射线的查询次数。
    let effort = hitInfo.y/80.0;
    if (p.x>0.0) { color = vec3f(effort,1.0-effort,0.2); }` : '';
  const camera = rank >= 8 ? `let angle = 0.25*sin(iTime*0.25);
  let ro = vec3f(4.0*sin(angle),0.9,4.0*cos(angle));
  let forward = normalize(vec3f(0.0,-0.05,0.0)-ro);
  let right = normalize(cross(forward,vec3f(0.0,1.0,0.0)));
  let up = cross(right,forward);
  let rd = normalize(forward*1.8+right*p.x+up*p.y);` :
    'let ro = vec3f(0.0,0.8,3.8);\n  let rd = normalize(vec3f(p.x,p.y-0.30,-1.8));';
  return shader2d(`  ${camera}
  let hitInfo = trace(ro,rd);
  var color = vec3f(0.025,0.045,0.075);
  if (hitInfo.x > 0.0) {
    let hit = ro+rd*hitInfo.x;
    ${surface}
  }
  ${debug}
  return vec4f(color,1.0);`,helpers);
}


import { createProject, passOf, type ShaderProject } from './model.js';
import { TUTORIAL_CHAPTERS } from './tutorialContent.js';
import { COVERAGE, CIRCLE, SEGMENT, BOX, ROUND_BOX, POLYGON, STAR, ELLIPSE, ARC, SMOOTH, shader2d, fieldShader } from './tutorialGeometry.js';
import { sceneFunctions, rayShader } from './tutorialRay.js';
import { INPUT_CODES, MOVEMENT_BUFFER } from './tutorialInput.js';
import { VOLUME_CODES } from './tutorialVolume.js';
import { NOISE_CODES } from './tutorialNoise.js';
import { VOXEL_CODES } from './tutorialVoxel.js';

const code: Record<string,string> = {};
code.pixels = `fn mainImage(fragCoord: vec2f) -> vec4f {
  // 第一步只指定一种颜色，不需要纹理、循环或辅助函数。
  return vec4f(0.12,0.55,0.82,1.0);
}`;
code.coordinates = shader2d(`  let uv = fragCoord/iResolution.xy;
  return vec4f(uv,0.25,1.0);`);
code.color = shader2d(`  let uv = fragCoord/iResolution.xy;
  let background = vec3f(0.025,0.055,0.14);
  let foreground = vec3f(0.3,0.9,0.7);
  let color = mix(background,foreground,uv.x);
  return vec4f(color,1.0);`);
code.functions = shader2d(`  let d = p.y-0.35*sin(p.x*4.0);
  let hard = 1.0-step(0.0,d);
  let soft = coverage(d);
  let mask = select(hard,soft,p.x>0.0);
  return vec4f(mix(vec3f(0.025,0.055,0.14),vec3f(0.3,0.9,0.7),mask),1.0);`,COVERAGE);
code.circle = shader2d(`  let d = length(p)-0.5;
  let fill = coverage(d);
  let ring = coverage(abs(d)-0.035);
  let color = mix(vec3f(0.025,0.055,0.14),vec3f(0.15,0.5,0.48),fill);
  return vec4f(mix(color,vec3f(0.9,1.0,0.55),ring),1.0);`,COVERAGE);
code.ellipse = shader2d(`  let axes = vec2f(0.75,0.35);
  let q = p/axes;
  let f = dot(q,q)-1.0;
  let fill = coverage(f);
  let outline = coverage(abs(f)-0.08);
  let color = mix(vec3f(0.025,0.055,0.14),vec3f(0.15,0.5,0.48),fill);
  return vec4f(mix(color,vec3f(0.9,1.0,0.55),outline),1.0);`,COVERAGE);
code.segments = shader2d(`  let a = vec2f(-0.65,-0.3); let b = vec2f(0.6,0.4);
  let d = segmentDistance(p,a,b);
  let line = coverage(d-0.015);
  let endpoints = coverage(min(length(p-a),length(p-b))-0.06);
  let color = mix(vec3f(0.025,0.055,0.14),vec3f(0.25,0.85,0.75),line);
  return vec4f(mix(color,vec3f(0.95,0.8,0.35),endpoints),1.0);`,COVERAGE+'\n'+SEGMENT);
code.curves = shader2d(`  let angle = atan2(p.y,p.x);
  let radial = length(p)-(0.46+0.12*cos(5.0*angle));
  let flower = coverage(radial);
  let line = coverage(abs(radial)-0.012);
  return vec4f(mix(vec3f(0.02,0.035,0.08),vec3f(0.5,0.25,0.75),flower)+vec3f(line*0.35),1.0);`,COVERAGE);
code.sdf = fieldShader('sdCircle(p,0.5)',CIRCLE);
code['circle-distance'] = code.sdf.replace('  return vec4f(color, 1.0);',`  // 查询点与最近点：黄色为查询点，白色为圆上最近点。
  let query = vec2f(0.88,0.38);
  let closest = normalize(query)*0.5;
  let connector = coverage(segmentDistance(p,query,closest)-0.004);
  let marker = coverage(length(p-query)-0.035);
  let nearestMarker = coverage(length(p-closest)-0.025);
  return vec4f(mix(color,vec3f(0.9,0.8,0.3),max(connector,marker))+vec3f(nearestMarker),1.0);`).replace(CIRCLE,CIRCLE+'\n'+SEGMENT);
code['plane-distance'] = fieldShader('dot(p,normal)-0.15','', '  let normal = normalize(vec2f(0.6,1.0));');
code.primitives = fieldShader('sdBox(p,vec2f(0.65,0.38))',BOX);
code['rounded-box'] = fieldShader('sdRoundBox(p,vec2f(0.65,0.38),0.15)',BOX+'\n'+ROUND_BOX);
code['capsule-distance'] = fieldShader('segmentDistance(p,vec2f(-0.55,-0.25),vec2f(0.55,0.25))-0.18',SEGMENT);
code['triangle-distance'] = fieldShader('sdPolygon(p,3,0.7)',SEGMENT+'\n'+POLYGON);
code['polygon-distance'] = fieldShader('sdPolygon(p,6,0.65)',SEGMENT+'\n'+POLYGON);
code['star-distance'] = fieldShader('sdStar(p)',SEGMENT+'\n'+STAR);
code['ellipse-distance'] = fieldShader('ellipseDistanceApprox(p,vec2f(0.75,0.32))',SEGMENT+'\n'+ELLIPSE);
code['arc-distance'] = fieldShader('sdArc(p,0.52,2.2,0.07)',ARC);
code.transforms = fieldShader('scale*sdRoundBox(local,vec2f(0.45,0.26),0.08)',BOX+'\n'+ROUND_BOX,`  let angle = 0.55;
  let inverseRotation = mat2x2f(cos(angle),-sin(angle),sin(angle),cos(angle));
  let scale = 1.25;
  let local = inverseRotation*(p-vec2f(0.2,0.05))/scale;`);
const composition = `  let a = sdRoundBox(p+vec2f(0.2,0.0),vec2f(0.45,0.36),0.08);
  let b = sdCircle(p-vec2f(0.25,0.0),0.4);`;
const compositionHelpers = CIRCLE+'\n'+BOX+'\n'+ROUND_BOX;
code.boolean = fieldShader('min(a,b)',compositionHelpers,composition);
code.intersection = fieldShader('max(a,b)',compositionHelpers,composition);
code.difference = fieldShader('max(a,-b)',compositionHelpers,composition);
code.smooth = fieldShader('smoothUnion(a,b,0.28)',compositionHelpers+'\n'+SMOOTH,composition);
code.patterns = fieldShader('sdRoundBox(local,vec2f(0.24,0.16),0.04)',BOX+'\n'+ROUND_BOX,`  let period = vec2f(0.62,0.44);
  let row = floor(p.y/period.y);
  let shifted = p+vec2f(0.5*period.x*fract(row*0.5)*2.0,0.0);
  let local = (fract(shifted/period)-0.5)*period;`);
code.rays = shader2d(`  let rayDirection = normalize(vec3f(p,-1.8));
  return vec4f(rayDirection*0.5+0.5,1.0);`);
code.sdf3d = fieldShader('sceneDistance(vec3f(p,0.25))',sceneFunctions(0));
code.march = rayShader(0,'flat');
code['sphere-distance'] = rayShader(1,'flat');
code['box-distance-3d'] = rayShader(2,'flat');
code['torus-distance'] = rayShader(3,'flat');
code['cylinder-distance'] = rayShader(4,'flat');
code['extrusion-distance'] = rayShader(5,'flat');
code.normals = rayShader(5,'normal');
code.lighting = rayShader(5,'lighting');
code.shadows = rayShader(5,'shadows');
code.occlusion = rayShader(5,'occlusion');
code.reflection = rayShader(5,'reflection');
code.animation = fieldShader('smoothUnion(a,b,0.28)',compositionHelpers+'\n'+SMOOTH,
  composition.replace('p-vec2f(0.25,0.0)','p-vec2f(0.25+0.3*sin(iTime*1.5),0.1*cos(iTime))'));
code.textures = shader2d(`  let center = vec2f(0.3*sin(iTime),0.0);
  let mask = coverage(length(p-center)-0.65);
  let uv = fragCoord/iResolution.xy;
  let picture = channel0(uv).rgb;
  return vec4f(mix(vec3f(0.02,0.035,0.065),picture,mask),1.0);`,COVERAGE);
const interaction = shader2d(`  var center = vec2f(0.3*sin(iTime),0.0);
  if (iMouse.z>0.0) { center = (2.0*iMouse.xy-iResolution.xy)/iResolution.y; }
  let mask = coverage(length(p-center)-0.65);
  let uv = fragCoord/iResolution.xy;
  var color = mix(vec3f(0.02,0.035,0.065),channel0(uv).rgb,mask);
  var key = 65u;
  for (var candidate = 65u; candidate <= 90u; candidate++) {
    if (channel1(vec2f((f32(candidate)+0.5)/256.0,0.5/3.0)).r>0.5) { key = candidate; }
  }
  let local = vec2f(p.x-center.x,center.y-p.y)+vec2f(0.5);
  let tile = vec2f(f32(key%16u),f32(key/16u));
  let atlas = (tile+clamp(local,vec2f(0.008),vec2f(0.992)))/16.0;
  let distance = textureSampleLevel(iChannel2,iSampler,atlas,0.0).a-0.5;
  let glyph = coverage(distance)*select(0.0,1.0,all(local>=vec2f(0.0)) && all(local<=vec2f(1.0)));
  return vec4f(mix(color,vec3f(0.8,1.0,0.3),glyph),1.0);`,COVERAGE);
code.interaction = interaction;
code.feedback = `fn mainImage(fragCoord: vec2f) -> vec4f {
  return vec4f(channel0(fragCoord/iResolution.xy).rgb,1.0);
}`;
const historyCode = interaction.replace(/\b(channel|iChannel)([0-2])\b/g,(_,name,index)=>name+(Number(index)+1))
 .replace('fn mainImage(', 'fn currentImage(') + `
fn mainImage(fragCoord: vec2f) -> vec4f {
  let old = channel0(fragCoord/iResolution.xy).rgb;
  let fresh = currentImage(fragCoord).rgb;
  let decay = exp(-1.4*iTimeDelta);
  return vec4f(max(old*decay,fresh),1.0);
}`;
code.atmosphere = rayShader(5,'atmosphere');
code.glow = rayShader(5,'glow');
code.scene = rayShader(5,'scene');
code.performance = rayShader(5,'performance');
Object.assign(code,INPUT_CODES,VOLUME_CODES,NOISE_CODES,VOXEL_CODES);
const branches: Record<string,string> = { animation:'smooth', atmosphere:'reflection', sdf:'circle', smooth:'boolean', transforms:'rounded-box', 'keyboard-held':'mouse-position', interaction:'keyboard-held', 'volume-sphere':'march', lighting:'normals', warp:'noise-fbm', 'voxel-height':'noise-heightmap' };
export const TUTORIAL_LABS = TUTORIAL_CHAPTERS.map((chapter,index) => {
  const source = code[chapter.id];
  if (!source) throw new Error('章节缺少独立练习：'+chapter.id);
  return { id:chapter.id, title:chapter.title, code:source,
    baseId:branches[chapter.id] ?? TUTORIAL_CHAPTERS[index-1]?.id };
});
export function tutorialProject(id: string): ShaderProject {
  const lab = TUTORIAL_LABS.find(item=>item.id===id);
  if (!lab) throw new Error('教程练习不存在。');
  const project = createProject('教程 · '+lab.title);
  if (id in VOXEL_CODES) project.preview.scale = 0.5;
  project.description = '逐章练习：'+lab.title+'。修改参数验证推导，点击保存才加入我的作品。';
  passOf(project,'image').code = lab.code;
  if (id==='textures' || id==='interaction' || id in INPUT_CODES) passOf(project,'image').channels[0] = {kind:'builtin',texture:'future-city'};
  if (id==='interaction') {
    passOf(project,'image').channels[1] = {kind:'keyboard'};
    passOf(project,'image').channels[2] = {kind:'builtin',texture:'msdf'};
  }
  if (id==='keyboard-held' || id==='keyboard-toggle') passOf(project,'image').channels[1] = {kind:'keyboard'};
  if (id==='keyboard-movement') {
    const buffer = passOf(project,'buffer-a'); buffer.enabled = true; buffer.code = MOVEMENT_BUFFER;
    buffer.channels[0] = {kind:'buffer',pass:'buffer-a'};
    buffer.channels[1] = {kind:'keyboard'};
    passOf(project,'image').channels[1] = {kind:'buffer',pass:'buffer-a'};
  }
  if (id==='feedback') {
    const buffer = passOf(project,'buffer-a');buffer.enabled = true;buffer.code = historyCode;
    buffer.channels = [{kind:'buffer',pass:'buffer-a'},{kind:'builtin',texture:'future-city'},{kind:'keyboard'},{kind:'builtin',texture:'msdf'}];
    passOf(project,'image').channels[0] = {kind:'buffer',pass:'buffer-a'};
  }
  return project;
}

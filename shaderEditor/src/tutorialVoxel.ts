import { shader2d } from './tutorialGeometry.js';
import { NOISE_2D, HASH3, NOISE3 } from './tutorialNoise.js';

export const VOXEL_FIELD = `const WORLD_MIN = vec3f(-24.0,0.0,-24.0);
const WORLD_MAX = vec3f(24.0,24.0,24.0);
const CAVE_THRESHOLD: f32 = 0.46;
fn terrainHeight(xz: vec2f) -> f32 {
  return 3.0+18.0*fbm2(xz*0.065);
}
fn occupied(cell: vec3i) -> bool {
  let p = vec3f(cell)+vec3f(0.5);
  if (any(p<WORLD_MIN) || any(p>=WORLD_MAX)) { return false; }
  if (p.y>=terrainHeight(p.xz)) { return false; }
  if (!ENABLE_CAVES || p.y<2.0) { return true; }
  // 三维场沿 x/y/z 都变化，能在同一竖列中产生实体—空洞—实体。
  return noise3(p*0.19+vec3f(5.2,1.3,8.7))>CAVE_THRESHOLD;
}
`;
export const VOXEL_TRACING = `struct VoxelBounds { enter: f32, exit: f32, normal: vec3f };
struct VoxelHit { distance: f32, normal: vec3f, cell: vec3i };
fn voxelBounds(ro: vec3f, rd: vec3f) -> VoxelBounds {
  var enter = 0.0; var exit = 1000000.0; var normal = -rd;
  for (var axis = 0; axis<3; axis++) {
    if (abs(rd[axis])<0.000001) {
      if (ro[axis]<WORLD_MIN[axis] || ro[axis]>=WORLD_MAX[axis]) {
        return VoxelBounds(-1.0,-1.0,normal);
      }
    } else {
      let a = (WORLD_MIN[axis]-ro[axis])/rd[axis];
      let b = (WORLD_MAX[axis]-ro[axis])/rd[axis];
      let near = min(a,b); let far = max(a,b);
      if (near>enter) { enter=near; normal=vec3f(0.0); normal[axis]=-sign(rd[axis]); }
      exit = min(exit,far);
      if (exit<=enter) { return VoxelBounds(-1.0,-1.0,normal); }
    }
  }
  return VoxelBounds(enter,exit,normal);
}
fn traceVoxels(ro: vec3f, rd: vec3f) -> VoxelHit {
  let bounds = voxelBounds(ro,rd);
  if (bounds.exit<=bounds.enter) { return VoxelHit(-1.0,vec3f(0.0),vec3i(0)); }
  var distance = bounds.enter;
  var cell = vec3i(floor(ro+rd*(distance+0.0001)));
  var normal = bounds.normal;
  let step = vec3i(sign(rd));
  var delta = vec3f(1000000.0);
  var next = vec3f(1000000.0);
  for (var axis = 0; axis<3; axis++) {
    if (abs(rd[axis])>=0.000001) {
      delta[axis] = abs(1.0/rd[axis]);
      let boundary = f32(cell[axis])+select(0.0,1.0,rd[axis]>0.0);
      next[axis] = (boundary-ro[axis])/rd[axis];
    }
  }
  // 48×24×48 的有限区域，单条射线跨越的网格面数量有界。
  for (var iteration = 0; iteration<160; iteration++) {
    if (occupied(cell)) { return VoxelHit(distance,normal,cell); }
    let crossing = min(next.x,min(next.y,next.z));
    if (crossing>=bounds.exit) { break; }
    normal = vec3f(0.0); var normalChosen = false;
    // 穿过棱/角时推进所有相同时间的轴，避免访问只接触边界的格子。
    for (var axis = 0; axis<3; axis++) {
      if (abs(next[axis]-crossing)<0.00001) {
        cell[axis] += step[axis];
        next[axis] += delta[axis];
        if (!normalChosen) { normal[axis]=-f32(step[axis]); normalChosen=true; }
      }
    }
    distance = crossing;
  }
  return VoxelHit(-1.0,vec3f(0.0),cell);
}
`;
function terrainShader(caves: boolean) {
  return shader2d(`  // 直接在 Canvas 内绘制体素世界；修改相机位置观察不同切面。
  let ro = vec3f(42.0,31.0,46.0);
  let forward = normalize(vec3f(0.0,7.0,0.0)-ro);
  let right = normalize(cross(forward,vec3f(0.0,1.0,0.0)));
  let up = cross(right,forward);
  let rd = normalize(forward*1.65+right*p.x+up*p.y);
  let hit = traceVoxels(ro,rd);
  let sky = mix(vec3f(0.68,0.82,0.94),vec3f(0.25,0.5,0.76),clamp(rd.y*0.7+0.4,0.0,1.0));
  var color = sky;
  if (hit.distance>=0.0) {
    let point = ro+rd*hit.distance;
    let height = terrainHeight(vec2f(f32(hit.cell.x)+0.5,f32(hit.cell.z)+0.5));
    let surface = f32(hit.cell.y)>height-2.0;
    var base = vec3f(0.37,0.39,0.42);
    if (surface) { base=select(vec3f(0.4,0.27,0.15),vec3f(0.3,0.57,0.17),hit.normal.y>0.5); }
    let light = max(dot(hit.normal,normalize(vec3f(-0.5,0.85,0.4))),0.0);
    let variation = 0.85+0.15*lattice2(hit.cell.xz);
    // 只用命中面内的两个坐标画网格线，不让法线轴恒落在边界。
    let face = select(select(point.xy,point.xz,abs(hit.normal.y)>0.5),point.yz,abs(hit.normal.x)>0.5);
    let edge = min(min(fract(face.x),1.0-fract(face.x)),min(fract(face.y),1.0-fract(face.y)));
    let grid = smoothstep(0.0,0.045,edge);
    color = base*(0.34+0.66*light)*variation*(0.7+0.3*grid);
    color = mix(color,sky,1.0-exp(-0.008*hit.distance));
  }
  return vec4f(color,1.0);`,NOISE_2D+HASH3+NOISE3+'const ENABLE_CAVES: bool = '+caves+';\n'+VOXEL_FIELD+VOXEL_TRACING);
}
export const VOXEL_CODES = {
  'voxel-height': terrainShader(false),
  'voxel-caves': terrainShader(true)
};

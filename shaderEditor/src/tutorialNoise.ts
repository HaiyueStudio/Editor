import { COVERAGE, shader2d } from './tutorialGeometry.js';

export const HASH_CORE = `const NOISE_SEED: u32 = 17u;
fn hashBits(input: u32) -> u32 {
  var h = input;
  h = (h^(h>>16u))*0x7feb352du;
  h = (h^(h>>15u))*0x846ca68bu;
  return h^(h>>16u);
}
fn hashUnit(input: u32) -> f32 {
  return f32(hashBits(input)&0x00ffffffu)/16777216.0;
}
`;
export const HASH1 = `fn lattice1(i: i32) -> f32 {
  return hashUnit(bitcast<u32>(i)^NOISE_SEED);
}
`;
export const HASH2 = `fn lattice2(i: vec2i) -> f32 {
  let k = bitcast<vec2u>(i);
  return hashUnit((k.x*73856093u)^(k.y*19349663u)^NOISE_SEED);
}
`;
export const HASH3 = `fn lattice3(i: vec3i) -> f32 {
  let k = bitcast<vec3u>(i);
  return hashUnit((k.x*73856093u)^(k.y*19349663u)^(k.z*83492791u)^NOISE_SEED);
}
`;
export const NOISE2 = `fn noise2(p: vec2f) -> f32 {
  let i = vec2i(floor(p)); let f = fract(p);
  let u = f*f*(3.0-2.0*f);
  let a = mix(lattice2(i),lattice2(i+vec2i(1,0)),u.x);
  let b = mix(lattice2(i+vec2i(0,1)),lattice2(i+vec2i(1,1)),u.x);
  return mix(a,b,u.y);
}
`;
export const NOISE3 = `fn noise3(p: vec3f) -> f32 {
  let i = vec3i(floor(p)); let f = fract(p);
  let u = f*f*(3.0-2.0*f);
  let z0 = mix(
    mix(lattice3(i),lattice3(i+vec3i(1,0,0)),u.x),
    mix(lattice3(i+vec3i(0,1,0)),lattice3(i+vec3i(1,1,0)),u.x),u.y);
  let z1 = mix(
    mix(lattice3(i+vec3i(0,0,1)),lattice3(i+vec3i(1,0,1)),u.x),
    mix(lattice3(i+vec3i(0,1,1)),lattice3(i+vec3i(1,1,1)),u.x),u.y);
  return mix(z0,z1,u.z);
}
`;
export const FBM2 = `fn fbm2(p: vec2f) -> f32 {
  var q = p; var sum = 0.0; var weight = 0.0; var amplitude = 0.5;
  for (var octave = 0; octave<4; octave++) {
    sum += amplitude*noise2(q); weight += amplitude;
    q = q*2.0+vec2f(7.3,2.9); amplitude *= 0.5;
  }
  return sum/weight;
}
`;
export const FBM3 = `fn fbm3(p: vec3f) -> f32 {
  var q = p; var sum = 0.0; var weight = 0.0; var amplitude = 0.5;
  for (var octave = 0; octave<4; octave++) {
    sum += amplitude*noise3(q); weight += amplitude;
    q = q*2.0+vec3f(7.3,2.9,5.1); amplitude *= 0.5;
  }
  return sum/weight;
}
`;
export const NOISE_2D = HASH_CORE+HASH2+NOISE2+FBM2;
export const NOISE_3D = HASH3+NOISE3+FBM3;

function curve(source: string, helpers: string) {
  return shader2d(`  let x = (p.x+2.0)*3.0;
  let value = ${source};
  let d = p.y-(value*1.4-0.7);
  let fill = coverage(d);
  let line = coverage(abs(d)-0.012);
  let grid = 1.0-smoothstep(0.0,0.025,min(fract(x),1.0-fract(x)));
  let background = vec3f(0.025,0.045,0.08)+grid*0.06;
  let color = mix(background,vec3f(0.05,0.25,0.24),fill);
  return vec4f(mix(color,vec3f(0.65,1.0,0.4),line),1.0);`,COVERAGE+'\n'+HASH_CORE+HASH1+helpers);
}
const linear = `fn noise1(x: f32) -> f32 {
  let i = i32(floor(x)); let f = fract(x);
  return mix(lattice1(i),lattice1(i+1),f);
}
`;
const smooth = linear.replace('lattice1(i+1),f','lattice1(i+1),f*f*(3.0-2.0*f)');
export const NOISE_CODES: Record<string,string> = {
  noise: curve('lattice1(i32(floor(x)))',''),
  'noise-1d-linear': curve('noise1(x)',linear),
  'noise-1d-smooth': curve('noise1(x)',smooth),
  'noise-2d': shader2d(`  let q = p*4.0;
  let cell = lattice2(vec2i(floor(q)));
  let value = select(cell,noise2(q),p.x>0.0);
  return vec4f(vec3f(value),1.0);`,HASH_CORE+HASH2+NOISE2),
  'noise-fbm': shader2d(`  let value = fbm2(p*3.0);
  return vec4f(vec3f(value),1.0);`,NOISE_2D),
  'noise-heightmap': shader2d(`  let h = fbm2(p*2.0);
  var color = mix(vec3f(0.04,0.16,0.32),vec3f(0.06,0.38,0.52),smoothstep(0.1,0.4,h));
  color = mix(color,vec3f(0.65,0.55,0.3),smoothstep(0.4,0.43,h));
  color = mix(color,vec3f(0.2,0.45,0.18),smoothstep(0.43,0.5,h));
  color = mix(color,vec3f(0.5,0.45,0.36),smoothstep(0.58,0.7,h));
  color = mix(color,vec3f(0.9,0.94,0.96),smoothstep(0.72,0.83,h));
  let contour = 1.0-smoothstep(0.0,max(fwidth(h*12.0),0.001),abs(fract(h*12.0)-0.5));
  return vec4f(color*(1.0-contour*0.35),1.0);`,NOISE_2D),
  'noise-3d': shader2d(`  // 移动 z 切片，不是平移一张二维纹理。
  let z = iTime*0.25;
  let value = noise3(vec3f(p*3.0,z));
  return vec4f(mix(vec3f(0.025,0.08,0.22),vec3f(1.0,0.75,0.25),value),1.0);`,HASH_CORE+HASH3+NOISE3),
  'noise-fbm3d': shader2d(`  let q = vec3f(p*3.0,iTime*0.25);
  let value = select(noise3(q),fbm3(q),p.x>0.0);
  return vec4f(vec3f(value),1.0);`,HASH_CORE+NOISE_3D),
  warp: shader2d(`  let field = vec2f(fbm2(p*2.0),fbm2(p*2.0+vec2f(4.1,9.2)));
  let q = p+0.5*(field-0.5);
  let bands = 0.5+0.5*sin(q.x*20.0);
  return vec4f(mix(vec3f(0.025,0.05,0.12),vec3f(0.3,0.9,0.7),bands),1.0);`,NOISE_2D)
};

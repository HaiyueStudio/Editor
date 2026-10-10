
/** Small original WGSL building blocks. Their definitions are included in each opened lesson. */
export const COORDINATES = '  let p = (2.0 * fragCoord - iResolution.xy) / iResolution.y;';
export const COVERAGE = `fn coverage(d: f32) -> f32 {
  let aa = max(fwidth(d), 0.0001);
  return 1.0 - smoothstep(-aa, aa, d);
}`;
export const CIRCLE = `fn sdCircle(p: vec2f, radius: f32) -> f32 {
  return length(p) - radius;
}`;
export const SEGMENT = `fn segmentDistance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = clamp(dot(p-a, ab) / max(dot(ab, ab), 0.000001), 0.0, 1.0);
  return length(p - (a + t * ab));
}`;
export const BOX = `fn sdBox(p: vec2f, halfSize: vec2f) -> f32 {
  let q = abs(p) - halfSize;
  let outside = length(max(q, vec2f(0.0)));
  let inside = min(max(q.x, q.y), 0.0);
  return outside + inside;
}`;
export const ROUND_BOX = `fn sdRoundBox(p: vec2f, halfSize: vec2f, radius: f32) -> f32 {
  return sdBox(p, halfSize - vec2f(radius)) - radius;
}`;
export const POLYGON = `// 凸正多边形：最近线段距离 + 每条有向边的内外测试。
fn sdPolygon(p: vec2f, sides: i32, radius: f32) -> f32 {
  var nearest = 100.0;
  var inside = true;
  for (var edge = 0; edge < sides; edge++) {
    let a0 = 1.5707963 + 6.2831853 * f32(edge) / f32(sides);
    let a1 = 1.5707963 + 6.2831853 * f32(edge + 1) / f32(sides);
    let a = radius * vec2f(cos(a0), sin(a0));
    let b = radius * vec2f(cos(a1), sin(a1));
    nearest = min(nearest, segmentDistance(p, a, b));
    let ab = b - a; let ap = p - a;
    inside = inside && (ab.x * ap.y - ab.y * ap.x >= 0.0);
  }
  return select(nearest, -nearest, inside);
}`;
export const STAR = `fn starVertex(index: i32) -> vec2f {
  let angle = 1.5707963 + f32(index) * 6.2831853 / 10.0;
  let radius = select(0.65, 0.29, index % 2 == 1);
  return radius * vec2f(cos(angle), sin(angle));
}
fn sdStar(p: vec2f) -> f32 {
  var nearest = 100.0; var inside = false;
  for (var edge = 0; edge < 10; edge++) {
    let a = starVertex(edge); let b = starVertex((edge + 1) % 10);
    nearest = min(nearest, segmentDistance(p, a, b));
    // 水平射线只在边跨过当前高度时求交，分母不会为零。
    if ((a.y > p.y) != (b.y > p.y)) {
      let crossing = a.x + (p.y-a.y) * (b.x-a.x) / (b.y-a.y);
      if (p.x < crossing) { inside = !inside; }
    }
  }
  return select(nearest, -nearest, inside);
}`;
export const ELLIPSE = `// 用 64 条弦近似边界，距离有离散误差；不是解析精确 SDF。
fn ellipseDistanceApprox(p: vec2f, axes: vec2f) -> f32 {
  var nearest = 100.0;
  for (var j = 0; j < 64; j++) {
    let t0 = 6.2831853 * f32(j) / 64.0;
    let t1 = 6.2831853 * f32(j+1) / 64.0;
    let a = axes * vec2f(cos(t0), sin(t0));
    let b = axes * vec2f(cos(t1), sin(t1));
    nearest = min(nearest, segmentDistance(p, a, b));
  }
  let q = p / axes;
  return select(nearest, -nearest, dot(q,q) < 1.0);
}`;
export const ARC = `fn sdArc(p: vec2f, radius: f32, halfAngle: f32, thickness: f32) -> f32 {
  let angle = clamp(atan2(p.y, p.x), -halfAngle, halfAngle);
  let closest = radius * vec2f(cos(angle), sin(angle));
  return length(p - closest) - thickness;
}`;
export const SMOOTH = `fn smoothUnion(a: f32, b: f32, width: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b-a) / width, 0.0, 1.0);
  return mix(b, a, h) - width * h * (1.0-h);
}`;
export const NOISE = `fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(113.7, 291.3))) * 43758.54);
}
fn noise(p: vec2f) -> f32 {
  let cell = floor(p); let f = fract(p);
  let u = f*f*(3.0-2.0*f);
  return mix(mix(hash(cell),hash(cell+vec2f(1.0,0.0)),u.x),
    mix(hash(cell+vec2f(0.0,1.0)),hash(cell+vec2f(1.0)),u.x),u.y);
}
fn fbm(p: vec2f) -> f32 {
  var q = p; var value = 0.0; var amplitude = 0.5;
  for (var octave = 0; octave < 4; octave++) {
    value += amplitude * noise(q);
    q = q * 2.03 + vec2f(2.7,5.1); amplitude *= 0.5;
  }
  return value;
}`;
export function shader2d(body: string, helpers = '') {
  return helpers + '\nfn mainImage(fragCoord: vec2f) -> vec4f {\n' + COORDINATES + '\n' + body + '\n}';
}
export function fieldShader(expression: string, helpers: string, setup = '') {
  return shader2d(setup + '\n  let d = ' + expression + `;
  let fill = coverage(d);
  let boundary = coverage(abs(d) - 0.006);
  let band = 0.5 + 0.5*cos(d * 62.83185);
  let base = mix(vec3f(0.035,0.075,0.12), vec3f(0.05,0.25,0.24), fill);
  let color = mix(base + 0.04*band, vec3f(0.85,1.0,0.48), boundary);
  return vec4f(color, 1.0);`, COVERAGE + '\n' + helpers);
}

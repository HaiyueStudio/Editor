import test from 'node:test';
import assert from 'node:assert/strict';
import { translateGlsl } from '../dist/glsl.js';

test('translates the standard Shadertoy entry, scalar/vector promotion and texture sampling', () => {
  const result = translateGlsl(`void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = 0.5 + 0.5*cos(iTime + uv.xyx + vec3(0,2,4));
    fragColor = vec4(col, 1.0) * texture(iChannel0, uv);
  }`);
  assert.equal(result.diagnostics.length, 0); assert.match(result.code, /fn mainImage\(hy_coord: vec2f\) -> vec4f/);
  assert.match(result.code, /vec3f\(0.5\)/); assert.match(result.code, /channel0\(uv\)/); assert.match(result.code, /return fragColor;/);
});
test('function parameters become mutable copies; loops, early returns and swizzle writes survive', () => {
  const result = translateGlsl(`float wave(float x) { x *= 2.0; return sin(x); }
  void mainImage(out vec4 c, in vec2 p) { vec2 uv = p / iResolution.xy;
    uv.xy = uv.yx; for(int i=0;i<3;i++) { uv += vec2(wave(float(i))); }
    if(iTime<1.0) { c = vec4(0.0); return; } c = vec4(uv,0.0,1.0);
  }`);
  assert.equal(result.diagnostics.length, 0); assert.match(result.code, /var x = hy_arg_x/); assert.match(result.code, /hy_swizzle_0/); assert.match(result.code, /for \(var i: i32/);
});
test('unsupported syntax is rejected with line and column; no misleading partial translation', () => {
  for (const body of ['#if 1', 'struct Light { sampler2D image; };', 
    'void mainImage(out vec4 c,in vec2 p){float a[];}', 'void mainImage(out vec4 c,in vec2 p){c=textureCube(iChannel0, vec4(p,1.0,1.0));}']) {
    const result = translateGlsl('\n' + body); assert.equal(result.code, null); assert.ok(result.diagnostics[0].line >= 2); assert.ok(result.diagnostics[0].column >= 1);
  }
});
test('comments, scientific notation, precision and constant definitions are parsed', () => {
  const result = translateGlsl('precision highp float;\nconst float PI=3.14159; // comment\nvoid mainImage(out vec4 c,in vec2 p){ /* + */ c=vec4(1.e-2 + PI); }');
  assert.equal(result.diagnostics.length, 0); assert.match(result.code, /1.0e-2/);
});
test('integer literals broadcast to vectors, mutable coordinates and vertical derivatives preserve GLSL conventions', () => {
  const result = translateGlsl('void mainImage(out vec4 c,in vec2 p){p *= 2.0; vec3 v=1+vec3(p,0.0); c=vec4(v*dFdy(p.y),1.0);}');
  assert.equal(result.diagnostics.length,0);assert.match(result.code,/vec3f\(1\)/);assert.match(result.code,/var p = hy_coord/);assert.match(result.code,/\(-dpdy\(p.y\)\)/);
});

test('Shadertoy constants, helper macros and texture aliases produce the same WGSL as expanded GLSL', () => {
  const macro = translateGlsl(`#define PI 3.14159
#define TAU (2.0 * PI)
#define STEPS 3
#define UV(p) ((p) / iResolution.xy)
#define COLOR(r,g,b) vec4(r,g,b,1.0)
#define SAMPLE texture
#define CHANNEL iChannel0
#define TWICE(x) ((x) + (x))
void mainImage(out vec4 c, in vec2 p) {
  vec2 uv = UV(p);
  float v = TWICE(TWICE(0.1));
  for (int i=0; i<STEPS; i++) { v += sin(TAU); }
  c = COLOR(v, 0.5, 0.75) * SAMPLE(CHANNEL, uv);
}`);
  const expanded = translateGlsl(`void mainImage(out vec4 c, in vec2 p) {
  vec2 uv = ((p) / iResolution.xy);
  float v = ((((0.1) + (0.1))) + (((0.1) + (0.1))));
  for (int i=0; i<3; i++) { v += sin((2.0 * 3.14159)); }
  c = vec4(v, 0.5, 0.75, 1.0) * texture(iChannel0, uv);
}`);
  assert.deepEqual(macro.diagnostics, []); assert.deepEqual(expanded.diagnostics, []);
  assert.equal(macro.code, expanded.code);
});

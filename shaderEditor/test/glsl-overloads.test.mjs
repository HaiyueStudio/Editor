import test from 'node:test';
import assert from 'node:assert/strict';
import { translateGlsl } from '../dist/glsl.js';

const main = body => `void mainImage(out vec4 c, in vec2 p) { ${body} }`;
const translated = source => {
  const result = translateGlsl(source);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code); return result.code;
};

test('scalar/vector overloads and macro-expanded nested calls receive stable distinct WGSL names', () => {
  const code = translated(`#define CALL(x) shade(x)
float shade(float x) { return x * 0.5; }
vec2 shade(vec2 x) { return vec2(shade(x.x), shade(x.y)); }
vec3 shade(vec3 x) { return vec3(shade(x.xy), shade(x.z)); }
${main('c = vec4(CALL(vec3(p, 1.0)), 1.0);')}`);
  for (const type of ['f32', 'vec2f', 'vec3f']) assert.match(code, new RegExp(`fn hy_fn_shade_1_${type}\\(`));
  assert.match(code, /hy_fn_shade_1_f32\(x.x\)/);
  assert.match(code, /hy_fn_shade_1_vec2f\(x.xy\)/);
  assert.match(code, /hy_fn_shade_1_vec3f\(vec3f\(p, 1.0\)\)/);
  assert.doesNotMatch(code, /\bshade\(/);
});

test('arity, void parameter lists and unnamed inputs are lowered without duplicate function names', () => {
  const code = translated(`float f(void) { return 0.25; }
float f(float) { return 0.5; }
float f(float x, float y) { return x+y; }
void touch() { return; }
void touch(float x) { x *= 2.0; }
${main('touch(); touch(1.0); c=vec4(f(), f(1.0), f(0.25, 0.5), 1.0);')}`);
  assert.match(code, /fn hy_fn_f_0\(\)/);
  assert.match(code, /fn hy_fn_f_1_f32\(hy_unused_0: f32\)/);
  assert.match(code, /hy_fn_f_2_f32_f32\(0.25, 0.5\)/);
  assert.match(code, /hy_fn_touch_0\(\);/); assert.match(code, /hy_fn_touch_1_f32\(1.0\);/);
});

test('integer literals, unsigned literals, booleans, swizzles and builtin results select exact signatures', () => {
  const code = translated(`float pick(int x) { return 0.1; }
float pick(uint x) { return 0.2; }
float pick(float x) { return 0.3; }
float pick(bool x) { return 0.4; }
float pick(ivec2 x) { return 0.5; }
float pick(vec2 x) { return 0.6; }
${main('float a=pick(1)+pick(-1)+pick(1u)+pick(1.0)+pick(true); float b=pick(min(1,2))+pick(abs(-2))+pick(p.x)+pick(p[0])+pick(length(p)); c=vec4(a+b+pick(p.xy)+pick(ivec2(1,2))+pick(float(1))+pick(iTime>0.0));')}`);
  assert.match(code, /hy_fn_pick_1_i32\(1\)/); assert.match(code, /hy_fn_pick_1_i32\(\(-1\)\)/);
  assert.match(code, /hy_fn_pick_1_u32\(1u\)/); assert.match(code, /hy_fn_pick_1_f32\(1.0\)/);
  assert.match(code, /hy_fn_pick_1_bool\(true\)/); assert.match(code, /hy_fn_pick_1_i32\(min\(1, 2\)\)/);
  assert.match(code, /hy_fn_pick_1_i32\(abs\(\(-2\)\)\)/);
  assert.match(code, /hy_fn_pick_1_f32\(p.x\)/); assert.match(code, /hy_fn_pick_1_f32\(p\[0\]\)/);
  assert.match(code, /hy_fn_pick_1_f32\(length\(p\)\)/); assert.match(code, /hy_fn_pick_1_vec2f\(p.xy\)/);
  assert.match(code, /hy_fn_pick_1_vec2i\(vec2i\(1, 2\)\)/); assert.match(code, /hy_fn_pick_1_f32\(f32\(1\)\)/);
});

test('prototypes make later definitions visible and parameter names do not distinguish overloads', () => {
  const code = translated(`float shade(const in float);
float shade(in const float value);
vec2 shade(vec2);
float unused(int);
${main('c=vec4(shade(p),shade(0.5),1.0);')}
vec2 shade(vec2 value) { return vec2(shade(value.x),shade(value.y)); }
float shade(const float x) { return x; }
float shade(const in float anotherName);`);
  assert.equal((code.match(/fn hy_fn_shade_1_f32/g) ?? []).length, 1);
  assert.match(code, /fn hy_fn_shade_1_f32\(x: f32\)/);
  assert.doesNotMatch(code, /unused|anotherName/);
  assert.match(code, /hy_fn_shade_1_vec2f\(p\)/);
});

test('GLSL ES does not select an overload by return context or implicit casts/broadcasts', () => {
  for (const [functions, call] of [
    ['float f(float x){return x;}', 'f(1)'],
    ['float f(int x){return 0.0;}', 'f(1.0)'],
    ['float f(vec2 x){return x.x;}', 'f(1.0)'],
    ['float f(vec2 x){return x.x;}', 'f(ivec2(1))'],
    ['float f(float x){return x;} float f(vec2 x){return x.x;}', 'f(true)'],
    ['float f(float x){return x;}', 'f(1.0, 2.0)'],
  ]) {
    const result = translateGlsl(functions + '\n' + main(`c=vec4(${call});`));
    assert.equal(result.code, null, call); assert.match(result.diagnostics[0].message, /没有匹配的重载/);
    assert.match(result.diagnostics[0].message, /显式转换/); assert.equal(result.diagnostics[0].line, 2);
  }
  translated('float f(float x){return x;}\n' + main('c=vec4(f(float(1)));'));
});

test('invalid declarations, missing definitions and recursion fail at original source positions', () => {
  for (const [source, message] of [
    ['float f(float x){return x;}\nfloat f(float y){return y;}', /重复定义/],
    ['float f(float);\nint f(float);', /返回类型/],
    ['float f(const float);\nfloat f(float);', /限定符/],
    ['float f(float x,float x){return x;}', /参数.*重复/],
    ['float sin(float x){return x;}', /内置函数/],
    ['float mainImage(float x){return x;}', /入口不能重载/],
    ['float f(float);\n' + main('c=vec4(f(0.5));'), /只有声明/],
    ['float f(float x){return f(x);}', /递归/],
    ['float f(float); float f(int);\nfloat f(float x){return f(int(x));}\nfloat f(int x){return f(float(x));}', /递归/],
    ['float f(float x){return x;}\n' + main('float f=1.0; c=vec4(f(0.5));'), /是变量/],
    [main('c=vec4(later(1.0));') + '\nfloat later(float x){return x;}', /未声明函数/],
  ]) {
    const result = translateGlsl('\n' + source + (source.includes('mainImage') ? '' : '\n' + main('c=vec4(1.0);')));
    assert.equal(result.code, null, source); assert.match(result.diagnostics[0].message, message);
    assert.ok(result.diagnostics[0].line >= 2); assert.ok(result.diagnostics[0].column >= 1);
  }
  const missing = translateGlsl('float f(float);\n' + main('\n  c=vec4(f(0.5));'));
  assert.equal(missing.diagnostics[0].line, 3); assert.equal(missing.diagnostics[0].column, 10);
});

test('generated names cannot collide with a user suffix or another overload', () => {
  const code = translated(`float shade(float x){return x;}
float shade(float x,int y){return x;}
float shade_1_f32(float x){return x;}
float shade_f32(int x){return 0.0;}
${main('c=vec4(shade(1.0)+shade(1.0,1)+shade_1_f32(1.0)+shade_f32(1));')}`);
  const names = Array.from(code.matchAll(/fn (\w+)\(/g), match => match[1]);
  assert.equal(new Set(names).size, 5);
});

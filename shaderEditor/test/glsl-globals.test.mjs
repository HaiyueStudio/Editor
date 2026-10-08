import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateGlsl } from '../dist/glsl.js';

const main = body => `void mainImage(out vec4 c, in vec2 p) { ${body} }`;
const translated = source => {
  const result = translateGlsl(source);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code); return result.code;
};

test('mutable globals become invocation-private variables shared by helper functions', () => {
  const code = translated(`float seed; int count; uint bits; bool ready; vec3 color; ivec2 tile; uvec4 mask;
void update() { seed += 0.25; count++; bits = 1u; ready = true; color.xy = vec2(seed); tile[0] = count; mask = uvec4(bits); }
${main('update(); c=vec4(color,float(count));')}`);
  for (const [name, type] of Object.entries({ seed: 'f32', count: 'i32', bits: 'u32', ready: 'bool', color: 'vec3f', tile: 'vec2i', mask: 'vec4u' })) {
    assert.ok(code.includes(`var<private> hy_global_${name}: ${type};`));
  }
  assert.match(code, /hy_global_seed \+= 0.25/);
  assert.match(code, /hy_global_count\+\+/);
  assert.match(code, /hy_global_color.x = hy_swizzle_0.x/);
  assert.match(code, /hy_global_tile\[0\] = hy_global_count/);
  assert.doesNotMatch(code, /hy_init_globals/); // WGSL supplies zero initialization.
});

test('declarator lists and macros preserve ordered runtime initialization after builtin setup', () => {
  const code = translated(`#define BASE 0.25
const float a=BASE, b=a*2.0;
highp float phase=iTime, next=phase+b, uninitialized;
vec2 resolution=iResolution.xy, uv=resolution/iResolution.xy;
bool active=iFrame>0;
${main('phase += 1.0; c=vec4(next,uv,1.0);')}`);
  assert.match(code, /const b: f32 = \(a \* 2.0\);/);
  assert.match(code, /fn mainImage\([^\n]+\n  hy_init_globals\(\);\n  var p/);
  assert.match(code, /hy_global_phase = iTime;\n  hy_global_next = \(hy_global_phase \+ b\);/);
  assert.match(code, /hy_global_resolution = iResolution.xy;\n  hy_global_uv = \(hy_global_resolution \/ iResolution.xy\);/);
  assert.match(code, /hy_global_active = \(iFrame > 0\);/);
  assert.doesNotMatch(code, /var<private>[^;]+=/);
});

test('global initializers can call overloaded helpers and prototypes defined after mainImage', () => {
  const code = translated(`float get(float); float get(int);
float first=get(1.0), second=get(1);
${main('c=vec4(first,second,0.0,1.0);')}
float last=first+second;
float get(float x){return x*0.25;} float get(int x){return float(x)*0.5;}`);
  assert.match(code, /hy_global_first = hy_fn_get_1_f32\(1.0\);/);
  assert.match(code, /hy_global_second = hy_fn_get_1_i32\(1\);/);
  assert.match(code, /hy_global_last = \(hy_global_first \+ hy_global_second\);/);
  assert.match(code, /fn mainImage[^]*?hy_init_globals\(\);/);
});

test('parameter and block shadowing leave global reads and writes bound to the right variable', () => {
  const code = translated(`float p=0.25, c=0.5, value=0.75;
float read(){return value;}
float local(float value){value+=1.0;return value;}
${main('{float value=1.0; value+=1.0;} value+=read(); c=vec4(p,value,1.0);')}`);
  assert.match(code, /return hy_global_value;/);
  assert.match(code, /var value = hy_arg_value;[^]*?value \+= 1.0;/);
  assert.match(code, /var value: f32 = 1.0;\n    value \+= 1.0;/);
  assert.match(code, /hy_global_value \+= hy_fn_read_0\(\);/);
  assert.match(code, /c = vec4f\(p, hy_global_value, 1.0\);/);
  assert.match(code, /hy_global_p = 0.25;\n  hy_global_c = 0.5;/);
});

test('invalid globals and nonconstant const initializers report their GLSL source locations', () => {
  for (const [source, message] of [
    ['float value; float value;', /重复声明/],
    ['float iTime;', /内置变量/],
    ['void value;', /void/],
    ['float values[2];', /数组/],
    ['const float value;', /必须提供/],
    ['float value=0.0; const float other=value;', /不能依赖运行时变量/],
    ['const float value=iTime;', /不能依赖运行时变量/],
    ['float value=missing;', /未知标识符/],
    ['float get(); float value=get();', /只有声明/],
    ['float get(){return 1.0;} const float value=get();', /const 初始化不能调用/],
    ['float get(){return get();} float value=get();', /递归/],
    ['float get(){return 1.0;} float get;', /与函数重名/],
    ['float value; float value(){return 1.0;}', /与全局变量重名/],
    ['float mainImage;', /保留名称/],
  ]) {
    const result = translateGlsl('\n' + source + '\n' + main('c=vec4(1.0);'));
    assert.equal(result.code, null, source); assert.match(result.diagnostics[0].message, message, source);
    assert.equal(result.diagnostics[0].line, 2); assert.ok(result.diagnostics[0].column >= 1);
  }
  const result = translateGlsl('float value=0.0;\nconst float other=value;\n' + main('c=vec4(1.0);'));
  assert.equal(result.diagnostics[0].column, 19);
});

test('the GPU fixture combines global initialization, mutation, overloads and per-frame inputs', () => {
  const code = translated(readFileSync(new URL('./fixtures/globals.glsl', import.meta.url), 'utf8'));
  assert.match(code, /hy_global_frameValue = f32\(iFrame\)/);
  assert.match(code, /hy_global_clock = iTime/);
  assert.match(code, /hy_global_ordered = hy_fn_next_0\(\)/);
  assert.match(code, /hy_global_adjusted = hy_fn_adjust_1_f32\(hy_global_base\)/);
});

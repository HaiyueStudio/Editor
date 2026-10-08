import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateGlsl } from '../dist/glsl.js';
const main=body=>`void mainImage(out vec4 c,in vec2 p){${body}}`;
const translated=source=>{const result=translateGlsl(source);assert.deepEqual(result.diagnostics,[],JSON.stringify(result.diagnostics));assert.ok(result.code);return result.code;};

test('out and inout use independent copies with copyback on normal and early returns',()=>{
  const code=translated('float f(out float a,inout float b){a=2.0;if(b>0.0){return b++;}b=3.0;return b;}'+main('float a,b=1.0;float r=f(a,b);c=vec4(a,b,r,1.0);'));
  assert.match(code,/struct hy_fn_f_2_f32_f32_result/);
  assert.match(code,/var hy_param_0: f32;/);
  assert.match(code,/var hy_param_1 = hy_arg_1;/);
  assert.match(code,/let hy_return_value = hy_update_post_inc_function_f32\(&hy_param_1\); return hy_fn_f_2_f32_f32_result\(hy_return_value, hy_param_0, hy_param_1\)/);
  assert.match(code,/hy_call_0\(&a, &b, b\)/);
  assert.match(code,/\(\*hy_root_0\) = hy_result.out_0;\n  \(\*hy_root_1\) = hy_result.out_1;\n  return hy_result.value;/);
  const early=translated('void f(out float x){x=1.0;return;}'+main('float x;f(x);c=vec4(x);'));
  assert.match(early,/return hy_fn_f_1_f32_result\(hy_param_0\)/);
});

test('output references share one root pointer and globals never alias a pointer parameter',()=>{
  const code=translated('float g;void f(inout float a,out float b){a=g;b=a;g=2.0;}'+main('vec2 v=vec2(1.0);f(v.x,v.y);f(g,g);c=vec4(v,g,1.0);'));
  assert.match(code,/hy_call_0\(&v, v.x\)/);
  assert.match(code,/fn hy_call_0\(hy_root_0: ptr<function, vec2f>, hy_arg_0: f32\)/);
  assert.match(code,/\(\*hy_root_0\).x = hy_result.out_0;\n  \(\*hy_root_0\).y = hy_result.out_1;/);
  assert.doesNotMatch(code,/ptr<private/);
  assert.match(code,/hy_global_g = hy_result.out_0;\n  hy_global_g = hy_result.out_1;/);
});

test('indexed input snapshots and destination indices evaluate once before later arguments',()=>{
  const code=translated('void f(inout float x,float ignored){x+=1.0;}'+main('vec2 v=vec2(1.0);int i=0;f(v[i++],v[0]++);c=vec4(v,0.0,1.0);'));
  assert.equal((code.match(/hy_update_post_inc_function_i32\(&i\)/g)??[]).length,1);
  assert.match(code,/hy_call_0\(&v, hy_call_0_capture_0\(&v, hy_update_post_inc_function_i32\(&i\)\), hy_update_post_inc_function_vec2f_index_i32\(&v, 0\)\)/);
  assert.match(code,/struct hy_call_0_capture_0_value/);
  assert.match(code,/return hy_call_0_capture_0_value\(\(\*hy_value\)\[index\], index\)/);
  assert.match(code,/\(\*hy_root_0\)\[hy_arg_0.index\] = hy_result.out_0;/);
});

test('swizzles and indexed matrix columns/elements copy back through the original root',()=>{
  const code=translated('void f(out vec2 x){x=vec2(2.0,3.0);}void g(inout float x){x++;}'+main('mat2 m=mat2(1.0);int i=0,j=1;f(m[i++].yx);g(m[0].yx[j--]);c=vec4(m[0],0.0,1.0);'));
  assert.match(code,/\(\*hy_root_0\)\[hy_arg_0_column\].y = hy_result.out_0.x;/);
  assert.match(code,/\(\*hy_root_0\)\[hy_arg_0_column\].x = hy_result.out_0.y;/);
  assert.match(code,/\[vec2u\(1u, 0u\)\[hy_arg_0.index\]\] = hy_result.out_0;/);
  assert.doesNotMatch(code,/&m\[/);
});

test('parameter shadows, unnamed arguments, prototypes and overloads retain the output binding',()=>{
  const code=translated('void f(out float);void f(out vec2 x){x=vec2(1.0);}void f(out float real){real=2.0;{float real=9.0;return;}}void keep(inout float){}'+main('float x;vec2 y;f(x);f(y);keep(x);c=vec4(x,y,1.0);'));
  assert.match(code,/var real: f32 = 9.0;\n\s+return hy_fn_f_1_f32_result\(hy_param_0\)/);
  assert.match(code,/fn hy_fn_f_1_vec2f\(\) -> hy_fn_f_1_vec2f_result/);
  assert.match(code,/fn hy_fn_keep_1_f32\(hy_arg_0: f32\)/);
});

test('calls remain at short-circuit and loop evaluation sites and nested helper dependencies are emitted',()=>{
  const code=translated('bool f(inout float x){x++;return x<2.0;}'+main('float x=0.0;bool a=false&&f(x);while(f(x)){continue;}for(;x<4.0;f(x)){}c=vec4(x);'));
  assert.match(code,/false && hy_call_0\(&x, x\)/);
  assert.match(code,/while \(hy_call_1\(&x, x\)\)/);
  assert.match(code,/for \(; \(x < 4.0\); _ = hy_call_2\(&x, x\)\)/);
  assert.match(code,/fn hy_call_2/);
});

test('output parameters reject readonly values, temporaries, duplicate components and incompatible types',()=>{
  for(const [declarations,body,pattern] of [
    ['void f(out float x){x=0.0;}','f(1.0);',/第 1 个 out 参数需要可写/],
    ['void f(inout float x){}','const float x=1.0;f(x);',/可写/],
    ['void f(out float x){}','f(iTime);',/可写/],
    ['void f(out vec2 x){}','f(gl_FragCoord.xy);',/可写/],
    ['void f(out vec2 x){}','vec2 v;f(v.xx);',/不重复/],
    ['void f(out float x){}','float v;f(v+1.0);',/可写/],
    ['void f(out float x){}','int v;f(v);',/没有匹配的重载/],
    ['void f(out sampler2D x){}','',/sampler2D.*参数只能/],
    ['void f(const out float x){}','',/const 不能/],
    ['void f(out float);void f(inout float x){}','',/限定符/],
    ['void f(out float);','float x;f(x);',/只有声明/],
    ['void f(inout float x){f(x);}','',/递归/],
  ]){
    const result=translateGlsl('\n'+declarations+'\n'+main(body));assert.equal(result.code,null,body);assert.match(result.diagnostics[0].message,pattern,body);assert.ok(result.diagnostics[0].line>=2);
  }
});

test('output return validation rejects bare returns from valued functions and values from void functions',()=>{
  for(const body of ['float f(out float x){return;}','void f(out float x){return 1.0;}']){
    const result=translateGlsl(body+main('c=vec4(1.0);'));assert.equal(result.code,null);assert.match(result.diagnostics[0].message,/return|返回值/);
  }
});

test('full copy-in/copy-out GPU fixture translates with nested calls, globals, matrices and sampler inputs',()=>{
  const code=translated(readFileSync(new URL('./fixtures/outputs.glsl',import.meta.url),'utf8'));
  assert.match(code,/hy_global_initialized = hy_call_0\(hy_global_globalValue\)/);
  assert.match(code,/hy_fn_paint_3_sampler2D_vec2f_vec4f/);
  assert.match(code,/texture_2d<f32>/);
  assert.doesNotMatch(code,/ptr<private/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {translateGlsl} from '../dist/glsl.js';
const main=body=>`void mainImage(out vec4 c,in vec2 p){${body}}`;
const translated=source=>{const result=translateGlsl(source);assert.deepEqual(result.diagnostics,[],JSON.stringify(result.diagnostics));assert.ok(result.code);return result.code;};

test('isnan and isinf classify float bit patterns instead of self-comparing expressions',()=>{
  const code=translated(main('bool n=isnan(iTime),i=isinf(iTime);c=n||i?vec4(0.0):vec4(1.0);'));
  assert.match(code,/bitcast<u32>\(iTime\) & 0x7fffffffu\) > 0x7f800000u/);
  assert.match(code,/bitcast<u32>\(iTime\) & 0x7fffffffu\) == 0x7f800000u/);
  assert.doesNotMatch(code,/isNan\(|isInf\(|iTime != iTime/);
});

test('vector predicates return native boolean vectors usable in any/all/not, swizzles and indexing',()=>{
  const code=translated(main('bvec2 a=isnan(p);bvec3 b=isinf(vec3(p,0.0));bvec4 d=isnan(vec4(p,p));bool n=any(a),f=all(not(b)),x=d.x,y=d.rg[1];c=vec4(n?1.0:0.0);'));
  assert.match(code,/var a: vec2<bool>/);assert.match(code,/var b: vec3<bool>/);assert.match(code,/var d: vec4<bool>/);
  assert.match(code,/bitcast<vec2u>\(p\) & vec2u\(0x7fffffffu\)/);
  assert.match(code,/bitcast<vec4u>/);assert.match(code,/all\(\(!b\)\)/);
  assert.match(code,/var x: bool = d.x/);assert.match(code,/var y: bool = d.xy\[1\]/);
});

test('bool vector parameters, overloads, outputs and ternaries preserve valid WGSL names and types',()=>{
  const code=translated('bool f(bool b){return b;}bool f(bvec2 b){return any(b);}void flip(inout bvec2 b){b=not(b);}'+main('bvec2 b=isnan(p);flip(b);bool a=f(b);b=iTime>0.0?b:not(b);c=vec4(f(a)?1.0:0.0);'));
  assert.match(code,/fn hy_fn_f_1_vec2_bool_\(/);assert.match(code,/fn hy_fn_f_1_bool\(/);
  assert.match(code,/out_0: vec2<bool>/);assert.match(code,/hy_root_0: ptr<function, vec2<bool>>/);
  assert.match(code,/fn hy_ternary_\d+\([^\n]*\) -> vec2<bool>/);
  assert.doesNotMatch(code,/fn [^(\n]*[<>]/);
});

test('constant/global predicates stay constant while side effects execute exactly once at the call site',()=>{
  const code=translated('#define BAD(x) isnan(x)\nconst bool FINITE=!isnan(1.0);const bvec2 FLAGS=isinf(vec2(0.0));bool current=isnan(iTime);float read(inout float x){return x++;}'+main('float v=1.0;bool a=BAD(v++),b=isinf(read(v));bool lazy=false&&isnan(v++);c=vec4(FINITE?1.0:0.0);'));
  assert.match(code,/const FINITE: bool = \(!\(\(bitcast<u32>\(1.0\)/);
  assert.match(code,/const FLAGS: vec2<bool>/);assert.match(code,/hy_global_current = \(\(bitcast<u32>\(iTime\)/);
  assert.equal((code.match(/bitcast<u32>\(hy_update_post_inc_function_f32\(&v\)\)/g)??[]).length,2);
  assert.equal((code.match(/bitcast<u32>\(hy_call_0\(&v, v\)\)/g)??[]).length,1);
  assert.match(code,/false && \(\(bitcast/);
});

test('invalid predicate arguments, arities, reductions and writes report GLSL positions',()=>{
  for(const [body,pattern]of[
    ['isnan();',/一个参数/],['isinf(1.0,2.0);',/一个参数/],['isnan(1);',/浮点参数/],
    ['isnan(true);',/浮点参数/],['isinf(ivec2(1));',/浮点参数/],['isnan(mat2(1.0));',/浮点参数/],
    ['isnan(iChannel0);',/浮点参数/],['isnan(isnan(iTime));',/浮点参数/],['any(isnan(iTime));',/布尔向量/],
    ['all(vec2(1.0));',/布尔向量/],['not(true);',/布尔向量/],['isnan(p).xy=bvec2(false);',/可写/],
    ['bvec2 b=bvec2(false);b++;',/仅支持整数或浮点/],
  ]){const result=translateGlsl('\n'+main(body));assert.equal(result.code,null,body);assert.match(result.diagnostics[0].message,pattern,body);assert.ok(result.diagnostics[0].line>=2);}
});

test('complete GPU fixture translates finite and special-value classification paths',()=>{
  const code=translated(readFileSync(new URL('./fixtures/predicates.glsl',import.meta.url),'utf8'));
  assert.match(code,/hy_fn_checkSpecial_3_f32_f32_f32/);assert.match(code,/bitcast<vec4u>/);
});

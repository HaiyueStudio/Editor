import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateGlsl } from '../dist/glsl.js';
const main=body=>`void mainImage(out vec4 c,in vec2 p){${body}}`;
const translated=source=>{const result=translateGlsl(source);assert.deepEqual(result.diagnostics,[],JSON.stringify(result.diagnostics));assert.ok(result.code);return result.code;};

test('ternaries bind below logical/comparison/arithmetic operators and associate to the right',()=>{
  const code=translated(main('float x=1+2*3==7 && iTime>0.0 ? 1.0 : iFrame>2 ? 2.0 : 3.0;c=vec4(x);'));
  assert.match(code,/hy_ternary_1\(\(\(\(1 \+ \(2 \* 3\)\) == 7\) && \(iTime > 0.0\)\)\)/);
  assert.match(code,/return hy_ternary_0\(\(iFrame > 2\)\);/);
  const grouped=translated(main('c=vec4((iFrame>2 ? 1.0 : 2.0)*3.0);'));
  assert.match(grouped,/\(hy_ternary_0\(\(iFrame > 2\)\)\) \* 3.0/);
});

test('only the selected branch runs and condition changes precede branch reads',()=>{
  const code=translated(main('float a=1.0,b=2.0;int i=0;float r=i++==0 ? a++ + float(i) : ++b;c=vec4(a,b,r,1.0);'));
  assert.match(code,/hy_ternary_0\(\(hy_update_post_inc_function_i32\(&i\) == 0\), &a, &i, &b\)/);
  assert.match(code,/if \(hy_condition\) \{\n\s+return \(hy_update_post_inc_function_f32\(&\(\*hy_capture_0\)\) \+ f32\(\(\*hy_capture_1\)\)\);/);
  assert.match(code,/else \{\n\s+return hy_update_pre_inc_function_f32\(&\(\*hy_capture_2\)\);/);
  assert.doesNotMatch(code,/select\(/);
});

test('captures distinguish swizzle fields, constructor names, scientific literals and comparisons from variables',()=>{
  const code=translated(main('vec2 v=vec2(1.0);float x=2.0,f32=3.0,e=4.0;bool r=iFrame>0 ? v.x+x<float(4) : f32+1.e-2>0.0;c=vec4(1.0);'));
  assert.match(code,/hy_capture_0: ptr<function, vec2f>/);
  assert.match(code,/\(\*hy_capture_0\).x/);
  assert.match(code,/\(\*hy_capture_1\)\) < f32\(4\)/);
  assert.match(code,/\(\*hy_capture_2\) \+ 1.0e-2/);
  assert.doesNotMatch(code,/&e\b/);
  assert.doesNotMatch(code,/\.\(\*/);
});

test('readonly values and sampler handles are captured by value; mutable globals stay direct',()=>{
  const code=translated('float globalValue=0.0;vec4 sample(sampler2D tex,vec2 uv){const float level=0.0;return iFrame>0 ? textureLod(tex,uv,level) : vec4(globalValue++);}'+main('c=sample(iChannel0,p);'));
  assert.match(code,/hy_capture_0: texture_2d<f32>/);
  assert.match(code,/hy_capture_1: ptr<function, vec2f>/);
  assert.match(code,/hy_capture_2: f32/);
  assert.match(code,/hy_update_post_inc_private_f32\(&hy_global_globalValue\)/);
  assert.doesNotMatch(code,/&tex\b|&level\b/);
});

test('out/inout, nested branches and void-returning calls preserve writes and helper dependencies',()=>{
  const code=translated('float change(inout float x){return x++;}void put(out float x){x=2.0;}'+main('float x=1.0;float r=iFrame>0 ? change(x) : iFrame>2 ? x++ : --x; (iTime>0.0 ? (put(x)) : (put(c.x)));c=vec4(x,r,0.0,1.0);'));
  assert.match(code,/fn hy_call_0/);
  assert.match(code,/hy_call_0\(&\(\*hy_capture_0\), \(\*hy_capture_0\)\)/);
  assert.match(code,/fn hy_ternary_2\([^\n]*\) \{/);
  assert.match(code,/hy_call_1\(&\(\*hy_capture_0\)\);/);
  assert.doesNotMatch(code,/\(hy_(?:ternary|call)_\d+\([^;\n]*\)\);/);
});

test('short circuits, returns, loop conditions/updates and dynamic indices keep their evaluation sites',()=>{
  const code=translated('int choose(bool x){return x?0:1;}'+main('float x=0.0;bool skipped=false && (iTime>0.0 ? x++>0.0 : ++x>0.0);while(iFrame>1?x++<2.0:x++<3.0){}for(int i=0;iTime>0.0?i<2:i<3;iTime>0.0?i++:++i){}vec2 v=vec2(1.0);c=vec4(v[iTime>0.0?0:1]);'));
  assert.match(code,/return hy_ternary_0\(x\)/);
  assert.match(code,/false && \(hy_ternary_/);
  assert.match(code,/while \(hy_ternary_/);
  assert.match(code,/for \(var i: i32 = 0; hy_ternary_\d+\([^]*?; _ = hy_ternary_\d+\(/);
  assert.match(code,/v\[hy_ternary_\d+\(/);
});

test('global constant scalar/vector/matrix ternaries remain constant expressions',()=>{
  const code=translated('const bool PICK=1<2;const int I=PICK?1:2;const vec2 V=PICK?vec2(1.0):vec2(2.0);const mat2 M=PICK?mat2(1.0):mat2(2.0);const float L=true?1.0:2.0;'+main('c=vec4(V,float(I),L);'));
  assert.match(code,/const I: i32 = select\(2, 1, PICK\)/);
  assert.match(code,/const V: vec2f = select\(vec2f\(2.0\), vec2f\(1.0\), PICK\)/);
  assert.match(code,/const M: mat2x2f = mat2x2f\(select\(/);
  assert.match(code,/const L: f32 = 1.0;/);
  assert.doesNotMatch(code,/hy_ternary_/);
});

test('runtime global initializers and macros use the same lazy lowering',()=>{
  const macro='#define PICK(c,a,b) ((c)?(a):(b))\n';
  const code=translated(macro+'float n=0.0;float v=PICK(iTime>0.0,n++,--n);'+main('c=vec4(v,n,0.0,1.0);'));
  assert.match(code,/hy_global_v = \(hy_ternary_0\(/);
  assert.match(code,/hy_update_post_inc_private_f32/);
  assert.match(code,/hy_update_pre_dec_private_f32/);
});

test('invalid conditions, branch types, opaque values, l-values and syntax report GLSL locations',()=>{
  for(const [body,pattern] of [
    ['float x=1.0?2.0:3.0;',/条件必须是 bool/],
    ['float x=true?1.0:2;',/类型必须一致/],
    ['vec2 x=true?vec2(1.0):vec3(1.0);',/类型必须一致/],
    ['mat2 x=true?mat2(1.0):mat3(1.0);',/类型必须一致/],
    ['texture(true?iChannel0:iChannel1,p);',/sampler2D/],
    ['float a,b;(true?a:b)=1.0;',/可写/],
    ['float a,b;++(true?a:b);',/可写/],
    ['float x=true?1.0;',/预期.*:/],
    ['float x=true?:1.0;',/标识符/],
  ]){
    const result=translateGlsl('\n'+main(body));assert.equal(result.code,null,body);assert.match(result.diagnostics[0].message,pattern,body);assert.ok(result.diagnostics[0].line>=2);
  }
});

test('complete ternary GPU fixture translates spatial branches, side effects, discard, captures and all value types',()=>{
  const code=translated(readFileSync(new URL('./fixtures/conditionals.glsl',import.meta.url),'utf8'));
  assert.match(code,/fn hy_ternary_/);assert.match(code,/hy_fn_kill_0/);assert.match(code,/hy_global_initial = hy_ternary_/);
});

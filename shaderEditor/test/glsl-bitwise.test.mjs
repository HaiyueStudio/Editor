import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateGlsl } from '../dist/glsl.js';
const main=body=>`void mainImage(out vec4 c,in vec2 p){${body}}`;
const translated=source=>{const result=translateGlsl(source);assert.deepEqual(result.diagnostics,[],JSON.stringify(result.diagnostics));assert.ok(result.code);return result.code;};

test('the supplied packed-coordinate expression converts shift counts and integer components',()=>{
  const code=translated(main('int sh=iFrame;vec2 o2=vec2((5493>>sh)&3,(10903>>sh)&3)*1.0-2.0;c=vec4(o2,0.0,1.0);'));
  assert.match(code,/i32\(5493\) >> u32\(sh\)/);assert.match(code,/i32\(10903\) >> u32\(sh\)/);
  assert.match(code,/vec2f\(f32\([^]*? & i32\(3\)\)\), f32\(/);
});

test('GLSL precedence and left associativity survive all bitwise operators and parentheses',()=>{
  const code=translated(main('int a=iFrame,b=1,cnt=2;int x=a|b^cnt&a+1<<b*2;int y=a>>b>>cnt;bool z=(a&b)==1 && a<b;'));
  assert.match(code,/\(a \| \(b \^ \(cnt & \(\(a \+ 1\) << u32\(\(b \* 2\)\)\)\)\)\)/);
  assert.match(code,/\(\(a >> u32\(b\)\) >> u32\(cnt\)\)/);
  assert.match(code,/\(a & b\)\) == 1/);
  // Equality binds more tightly than bitwise &, as in GLSL: this is ill-typed.
  const invalid=translateGlsl(main('int x=iFrame&1==1;'));assert.equal(invalid.code,null);assert.match(invalid.diagnostics[0].message,/整数向量/);
});

test('shift signedness follows the left operand, including overload selection with unsigned counts',()=>{
  const code=translated('float f(int x){return 1.0;}float f(uint x){return 2.0;}'+main('uint count=2u;int n=-16;uint u=2147483648u;float a=f(n>>count),b=f(u>>int(count)),d=f(1<<count);c=vec4(a,b,d,1.0);'));
  assert.match(code,/hy_fn_f_1_i32\(\(n >> count\)\)/);assert.match(code,/hy_fn_f_1_u32\(\(u >> u32\(i32\(count\)\)\)\)/);
  assert.match(code,/hy_fn_f_1_i32\(\(i32\(1\) << count\)\)/);
});

test('integer vectors support scalar and vector counts plus scalar broadcast masks',()=>{
  const code=translated(main('ivec2 v=ivec2(-8,12),s=ivec2(1,2);uvec2 u=uvec2(8u,16u);int n=2;ivec2 a=v>>n,b=v>>s,d=3|v,e=~v;uvec2 f=u<<s;'));
  assert.match(code,/v >> vec2u\(u32\(n\)\)/);assert.match(code,/v >> vec2u\(s\)/);
  assert.match(code,/vec2i\(i32\(3\)\) \| v/);assert.match(code,/\(~v\)/);assert.match(code,/u << vec2u\(s\)/);
});

test('bitwise constants fold as 32-bit values in globals and switch labels',()=>{
  const code=translated('const int SIGN=1<<31;const uint MASK=~0u;'+main('switch(iFrame){case (1<<3)|2:break;case ~0:break;case SIGN:break;}switch(uint(iFrame)){case MASK>>31:break;}'));
  assert.match(code,/const SIGN: i32 = i32\(-2147483648\);/);assert.match(code,/const MASK: u32 = 4294967295u;/);
  assert.match(code,/case 10: \{/);assert.match(code,/case -1: \{/);assert.match(code,/case -2147483648: \{/);assert.match(code,/case 1u: \{/);
  const duplicate=translateGlsl(main('switch(iFrame){case 1<<2:break;case 4:break;}'));assert.match(duplicate.diagnostics[0].message,/重复/);
});

test('compound shifts/masks preserve writable roots, swizzles and single-evaluation indices',()=>{
  const code=translated(main('ivec2 v=ivec2(16,32);int i=0,s=1;v[i++]>>=s++;v.yx<<=ivec2(1,2);int x=3;x&=1;x^=2;x|=4;for(int n=1;n<8;n<<=1){}'));
  assert.match(code,/hy_assign_0\(&v, hy_update_post_inc_function_i32\(&i\), hy_update_post_inc_function_i32\(&s\)\)/);
  assert.match(code,/hy_value\)\[hy_index\] >> u32\(hy_rhs\)/);
  assert.match(code,/\(\*hy_value\).y = hy_next.x;/);assert.match(code,/\(\*hy_value\).x = hy_next.y;/);
  assert.match(code,/for \(var n: i32 = 1; \(n < 8\); hy_assign_/);
  for(const operator of ['&','^','|'])assert.ok(code.includes(` ${operator} hy_rhs`));
});

test('runtime expression operands and constructor components are evaluated once',()=>{
  const code=translated(main('int a=4,n=0;vec2 v=vec2(a++>>++n,~a++);ivec2 u=ivec2(v);vec3 w=vec3(u,a);vec2 z=vec2(ivec3(1,2,3));c=vec4(v,w.z,z.x);'));
  assert.equal((code.match(/hy_update_post_inc_function_i32\(&a\)/g)??[]).length,2);
  assert.equal((code.match(/hy_update_pre_inc_function_i32\(&n\)/g)??[]).length,1);
  assert.match(code,/vec3f\(vec2f\(u\), f32\(a\)\)/);assert.match(code,/vec2f\(vec3i\(1, 2, 3\).xy\)/);
});

test('nonintegers, incompatible shapes/signs, invalid constant counts and readonly targets fail at source',()=>{
  for(const [body,pattern] of [
    ['float n=iTime>>1;',/仅支持/],['int n=1<<1.0;',/仅支持/],['int n=true&1;',/仅支持/],
    ['vec2 n=~vec2(1.0);',/仅支持/],['int n=~true;',/仅支持/],
    ['int n=1>>ivec2(1);',/向量维度/],['ivec2 n=ivec2(1)<<ivec3(1);',/向量维度/],
    ['uint n=1u&1;',/符号类型/],['ivec2 n=ivec2(1)|uvec2(1u);',/符号类型/],
    ['int n=1<<32;',/0–31/],['int n=1>>-1;',/0–31/],['int n=1;n<<=32;',/0–31/],
    ['const int n=1;n>>=1;',/可写/],['int n=1;n|=ivec2(2);',/结果类型/],
    ['ivec2 n=ivec2(1);n.xx&=1;',/可写/],
  ]){
    const result=translateGlsl('\n'+main(body));assert.equal(result.code,null,body);assert.match(result.diagnostics[0].message,pattern,body);assert.ok(result.diagnostics[0].line>=2);
  }
});

test('full GPU fixture translates packed coordinates, signs, vectors and bitwise control flow',()=>{
  const code=translated(readFileSync(new URL('./fixtures/bitwise.glsl',import.meta.url),'utf8'));
  assert.match(code,/i32\(5493\) >> u32\(sh\)/);assert.match(code,/fn hy_assign_/);
});

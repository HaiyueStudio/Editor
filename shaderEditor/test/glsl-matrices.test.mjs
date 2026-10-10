import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateGlsl } from '../dist/glsl.js';
const main=body=>`void mainImage(out vec4 c,in vec2 p){${body}}`;
const translated=source=>{const result=translateGlsl(source);assert.deepEqual(result.diagnostics,[],JSON.stringify(result.diagnostics));assert.ok(result.code);return result.code;};

test('square aliases and every rectangular matrix size support declarations and constructors',()=>{
  for(const columns of [2,3,4])for(const rows of [2,3,4]){
    const name=`mat${columns}x${rows}`, code=translated(main(`${name} m=${name}(1.0);c=vec4(m[0]${rows===2?',0.0,1.0':rows===3?',1.0':''});`));
    assert.ok(code.includes(`var m: ${name}f`));assert.ok(code.includes(`vec${rows}f`));
  }
  const code=translated('const mat2 m=mat2(1.0);const mat3 n=mat3(m);const mat4 p=mat4(n);'+main('mat2x2 copy=m;c=vec4(p[3]);'));
  assert.match(code,/const m: mat2x2f/);assert.match(code,/const n: mat3x3f/);assert.match(code,/const p: mat4x4f/);
  assert.doesNotMatch(code,/hy_matrix/,'constant constructors remain constant expressions without user helper calls');
});

test('scalar diagonals, column vectors, mixed components, resizing and matrix-to-vector conversions are lowered',()=>{
  const code=translated(main('mat2 m=mat2(2.0),n=mat2(vec3(1.0,2.0,3.0),4.0),v=mat2(vec2(1.0),vec2(2.0));mat4 big=mat4(m);vec4 parts=vec4(n);c=parts*float(big);'));
  assert.match(code,/vec2f\(f32\(hy_arg_0\), 0.0\), vec2f\(0.0, f32\(hy_arg_0\)\)/);
  assert.match(code,/mat2x2f\(vec2f\(1.0\), vec2f\(2.0\)\)/);
  assert.match(code,/vec4f\(0.0, 0.0, 1.0, 0.0\)/);
  assert.match(code,/vec4f\(f32\(hy_arg_0\[0\]\[0\]\), f32\(hy_arg_0\[0\]\[1\]\), f32\(hy_arg_0\[1\]\[0\]\), f32\(hy_arg_0\[1\]\[1\]\)\)/);
});

test('matrix products infer algebraic dimensions, preserve operand order and dispatch overloads',()=>{
  const code=translated('float f(vec2 v){return v.x;}float f(vec3 v){return v.y;}float g(mat2 m){return m[0][0];}float g(mat3 m){return m[0][0];}'+main('mat2x3 a=mat2x3(1.0);mat3x2 b=mat3x2(1.0);float x=f(a*vec2(1.0)),y=f(vec3(1.0)*a),z=g(a*b),w=g(b*a);c=vec4(x,y,z,w);'));
  assert.match(code,/hy_fn_f_1_vec3f\(\(a \* vec2f\(1.0\)\)\)/);
  assert.match(code,/hy_fn_f_1_vec2f\(\(vec3f\(1.0\) \* a\)\)/);
  assert.match(code,/hy_fn_g_1_mat3x3f\(\(a \* b\)\)/);assert.match(code,/hy_fn_g_1_mat2x2f\(\(b \* a\)\)/);
});

test('matrix scalar operations, equality, builtins and global initializers generate valid typed shapes',()=>{
  const code=translated('mat2 rotation(float a){return mat2(cos(a),sin(a),-sin(a),cos(a));}mat2 global=rotation(iTime);const mat2 inv=inverse(mat2(2.0));'+main('mat2 a=global+1.0,b=1.0-global,d=global/global;bool equal=a==b,different=a!=b;mat2 product=matrixCompMult(a,b);mat2x3 outer=outerProduct(vec3(1.0),vec2(1.0));mat3x2 transposed=transpose(outer);mat4 inverted=inverse(mat4(2.0));c=vec4(determinant(inverted));'));
  assert.match(code,/var<private> hy_global_global: mat2x2f/);assert.match(code,/hy_global_global = hy_fn_rotation_1_f32\(iTime\)/);
  assert.match(code,/const inv: mat2x2f =/);assert.match(code,/all\(hy_arg_0\[0\] == hy_arg_1\[0\]\)/);assert.match(code,/any\(hy_arg_0\[0\] != hy_arg_1\[0\]\)/);
  assert.match(code,/var transposed: mat3x2f = transpose\(outer\)/);assert.match(code,/fn hy_matrix_inverse_mat4x4f_mat4x4f/);
});

test('matrix compound writes and indexed updates preserve each index and source evaluation once',()=>{
  const code=translated(main('mat2 m=mat2(1.0);int i=0,j=0;vec2 v=vec2(1.0);v*=m;m[i++][j++]+=2.0;float f=m[0][1]++;vec2 old=m[1].yx++;float value=1.0;mat2 next=mat2(value++);c=vec4(f,old,1.0);'));
  assert.match(code,/hy_assign_\d+\(&v, m\)/);assert.match(code,/hy_assign_\d+\(&m, hy_update_post_inc_function_i32\(&i\), hy_update_post_inc_function_i32\(&j\), 2.0\)/);
  assert.match(code,/\(\*hy_value\)\[hy_column\]\[hy_index\] = hy_next/);
  assert.match(code,/\(\*hy_value\)\[hy_column\]\.y = hy_next.x/);
  assert.equal((code.match(/hy_update_post_inc_function_f32\(&value\)/g)??[]).length,1);
  assert.doesNotMatch(code,/&m\[/);
});

test('invalid matrix constructors, operators, indices, writes and overloads fail at the GLSL source',()=>{
  for(const [body,pattern] of [
    ['mat2 m=mat2();',/分量/],['mat3 m=mat3(vec4(1.0));',/分量/],['mat2 m=mat2(1.0,2.0,3.0,4.0,5.0);',/多余/],
    ['mat2 m=mat2(mat3(1.0),1.0);',/混入矩阵/],['mat2 m=mat3(1.0);',/矩阵类型不匹配/],
    ['mat2 m=mat2(1.0);vec3 v=m*vec3(1.0);',/维度不匹配/],['mat2 m=mat2(1.0)+vec2(1.0);',/维度不匹配/],
    ['mat2x3 m=mat2x3(1.0);m*=mat3x2(1.0);',/赋值.*维度/],['float x=determinant(mat2x3(1.0));',/维度不匹配/],
    ['mat2x3 m=inverse(mat2x3(1.0));',/维度不匹配/],['mat2 m=sin(mat2(1.0));',/不接受矩阵/],
    ['mat2 m=mat2(1.0);float x=m[0.5][0];',/整数标量/],['const mat2 m=mat2(1.0);m[0][0]=2.0;',/可写变量/],
    ['mat2 m=mat2(1.0);m[0].xx=vec2(1.0);',/可写变量/],['mat2 m=mat2(1.0);bool b=m<mat2(2.0);',/维度不匹配/],
  ]){
    const result=translateGlsl(main('\n'+body+'\nc=vec4(1.0);'));
    assert.equal(result.code,null,body);assert.match(result.diagnostics[0].message,pattern,body);assert.equal(result.diagnostics[0].line,2,body);
  }
  const duplicate=translateGlsl('float f(mat2 m){return 0.0;}float f(mat2x2 m){return 1.0;}'+main('c=vec4(1.0);'));
  assert.equal(duplicate.code,null);assert.match(duplicate.diagnostics[0].message,/重复定义/);
});

test('the matrix GPU fixture translates const/runtime constructors, rotations, inverse, non-square products and component mutations',()=>{
  translated(readFileSync(new URL('./fixtures/matrices.glsl',import.meta.url),'utf8'));
});

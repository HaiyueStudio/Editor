import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateGlsl } from '../dist/glsl.js';
const main = body => 'void mainImage(out vec4 c,in vec2 p){'+body+'}';
const ok = source => { const r=translateGlsl(source);assert.deepEqual(r.diagnostics,[]);assert.ok(r.code);return r.code; };
const bad = (source,pattern) => { const r=translateGlsl(source);assert.equal(r.code,null);assert.match(r.diagnostics[0].message,pattern);assert.ok(r.diagnostics[0].line>0); };

test('arrays support global/local consts, comma declarations, macros, inferred sizes and constructors',()=>{
 const code=ok('#define N 2\nconst int COUNT=N+1;const float table[COUNT]=float[](1.,2.,3.);float cache[2]=float[2](iTime,1.);'+main('float a[2],b[3]=table;vec2 points[]=vec2[](vec2(0.),vec2(1.));int[2] ids=int[2](0,1);a[ids[1]]=points[1].x;c=vec4(a[1]+cache[0]);'));
 assert.match(code,/const table: array<f32, 3>/);assert.match(code,/var<private> hy_global_cache: array<f32, 2>/);
 assert.match(code,/var points: array<vec2f, 2>/);assert.match(code,/var b: array<f32, 3> = table/);
 assert.match(code,/hy_init_globals/);
});
test('nested arrays, struct fields, braces and length retain element and dimension types',()=>{
 const code=ok('struct S{vec2 v[2];};'+main('float m[2][3]={{1.,2.,3.},{4.,5.,6.}}; S a[2];a[1].v[0].yx=vec2(2.,3.);const int N=m.length();float b[N];c=vec4(m[1][2]+a[1].v[0].x+float(b.length()));'));
 assert.match(code,/array<array<f32, 3>, 2>/);assert.match(code,/var b: array<f32, 2>/);
 assert.match(code,/\[hy_path_0\]\.v\[hy_path_2\]\.y/);
});
test('array parameters, prototypes, return values and overloads use exact shapes',()=>{
 const code=ok('float read(float[2]);float read(float v[2]){return v[0];}float read(float v[3]){return v[2];}float[2] make(){return float[2](1.,2.);}void edit(inout float a[2],out float b[2]){a[0]++;b=a;}'+main('float a[]=make(),b[2];edit(a,b);c=vec4(read(b)+read(float[3](0.,0.,1.)));'));
 assert.match(code,/-> array<f32, 2>/);assert.match(code,/out_0: array<f32, 2>/);assert.match(code,/ptr<function, array<f32, 2>>/);
 bad('void read(float a[]);'+main('c=vec4(1.);'),/长度/);
 bad('float read(float a[2]){return a[0];}'+main('float a[3];c=vec4(read(a));'),/没有匹配的重载/);
});
test('indexed mutation, swizzles, matrices and output copies preserve every index',()=>{
 const code=ok('struct S{mat2 m[2];vec2 v[2];};void bump(inout float x){x++;}'+main('S s[2];int i=0,j=0,k=0;float a=s[i++].m[j++][k++][0]++;i=0;j=0;bump(s[i++].v[j++].x);s[0].v[1].yx=vec2(2.,3.);c=vec4(a);'));
 assert.match(code,/\[hy_path_0\]\.m\[hy_path_2\]\[hy_column\]\[hy_index\]/);
 assert.match(code,/path_0: i32/);assert.match(code,/path_2: i32/);
 assert.match(code,/\(\*hy_root_0\)\[hy_arg_0.path_0\]\.v\[hy_arg_0.path_2\]\.x/);
});
test('whole array assignment, equality and ternaries lower to valid aggregate operations',()=>{
 const code=ok('const float A[2]=true?float[2](1.,2.):float[2](3.,4.);struct S{float a[2];};'+main('float a[2]=A,b[2];b=p.x>1.?a:float[2](3.,4.);bool eq=b==a;S s=S(a);bool same=s==S(b);c=vec4(eq&&same?1.:0.);'));
 assert.match(code,/fn hy_equal_array/);assert.match(code,/fn hy_ternary/);assert.match(code,/-> array<f32, 2>/);
});
test('invalid lengths, constructors, writes and array operations fail with GLSL diagnostics',()=>{
 for(const [body,pattern] of [
 ['float a[0];',/长度/],['float a[-1];',/长度/],['float a[1.5];',/长度/],['float a[int(p.x)];',/长度/],
 ['float a[];',/长度/],['float a[65537];',/长度/],['float a[256][257];',/65536/],
 ['float a[2]=float[2](1.);',/构造需要/],['vec2 a[2]=vec2[2](1.,2.);',/数组元素/],
 ['float a[2]=float[3](1.,2.,3.);',/数组类型/],['const float a[2]=float[2](1.,2.);a[0]++;',/不能修改常量/],
 ['float a[2];float b=a[2];',/下标超出/],['float a[2];a+=a;',/复合赋值/],
 ['float a[2];float b=sin(a);',/不接受数组/],['float a[2];float b=float(a);',/数组不能转换/],
 ['sampler2D a[2];',/sampler2D/],
 ]) bad(main(body+'c=vec4(1.);'),pattern);
});
test('large runtime array comparisons use loops instead of expanding every element',()=>{
 const code=ok(main('float a[1024],b[1024];c=vec4(a==b?1.:0.);'));
 assert.ok(code.length<2500);assert.match(code,/hy_i < 1024u/);
});
test('length is a compile-time size for pure receivers and preserves call/index side effects',()=>{
 const code=ok('float a[2];const int N=a.length();int visits=0;float[2] make(){visits++;return float[2](0.,0.);}'+main('float b[2][3];int i=0;int n=b[i++].length(),m=make().length();float c0[N];c=vec4(float(n+m+i+visits));'));
 assert.match(code,/const N: i32 = 2/);assert.match(code,/fn hy_array_length/);
 assert.match(code,/hy_array_length_\d+\(hy_update_post_inc_function_i32\(&i\)\)/);
 assert.match(code,/hy_array_length_\d+\(hy_fn_make_0\(\)\)/);
});
test('array GPU fixture translates through the shared importer',()=>{
 ok(readFileSync(new URL('./fixtures/arrays.glsl',import.meta.url),'utf8'));
});

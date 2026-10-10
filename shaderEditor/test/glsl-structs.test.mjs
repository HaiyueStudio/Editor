import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateGlsl } from '../dist/glsl.js';
const main = body => 'void mainImage(out vec4 c,in vec2 p){' + body + '}';
const success = source => {
  const result = translateGlsl(source);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code); return result.code;
};
const failure = (source, message) => {
  const result = translateGlsl(source);
  assert.equal(result.code, null); assert.match(result.diagnostics[0].message, message);
  assert.ok(result.diagnostics[0].line >= 1); assert.ok(result.diagnostics[0].column >= 1);
};

test('named structures, nested members, precision and comma field/variable declarations translate', () => {
  const code = success('struct M { highp vec3 color; float ref, other; }; struct H { M material; mat2 basis; } hit;' +
    main('M m = M(vec3(1.0), 1.0, 2.0), n = m; hit.material = n; hit.material.ref = 3.0; c=vec4(hit.material.color,1.0);'));
  assert.match(code, /struct hy_struct_0_M/); assert.match(code, /hy_user_ref: f32/);
  assert.match(code, /material: hy_struct_0_M/); assert.match(code, /var<private> hy_global_hit: hy_struct_1_H/);
  assert.match(code, /var n: hy_struct_0_M = m/); assert.match(code, /\(\*hy_value\)\.material\.hy_user_ref/);
});

test('constructors preserve field order, nested types and integer-to-float initialization', () => {
  const code = success('struct M { float v; }; struct H { M m; bool active; };' +
    main('H h=H(M(1),true); c=vec4(h.m.v);'));
  assert.match(code, /hy_struct_1_H\(hy_struct_0_M\(f32\(1\)\), true\)/);
  failure('struct M { vec2 v; };' + main('M m=M(1.0);'), /成员.*需要/);
  failure('struct M { float v; };' + main('M m=M();'), /需要 1 个参数/);
  failure('struct M { float v; };' + main('M m=M(1.0,2.0);'), /实际为 2 个/);
});

test('local structure types have distinct identities and do not leak outside blocks, loops or functions', () => {
  const code = success('struct M { float v; };' + main('M outer=M(1.0); {struct M {vec2 v;}; M inner=M(vec2(2.0));} M again=outer;c=vec4(again.v);'));
  assert.match(code, /struct hy_struct_0_M/);
  // Include the inner type only when actually used by an emitted local.
  assert.match(code, /struct hy_struct_1_M/);
  failure('void helper(){struct Local {float v;};}' + main('Local v;'), /预期|暂不支持|未知/);
  failure(main('{struct Local {float v;};} Local v;'), /预期|暂不支持|未知/);
  failure(main('for(struct Cursor {int i;} v=Cursor(0);v.i<1;v.i++){} Cursor v;'), /预期|暂不支持|未知/);
});

test('struct returns, prototypes, exact overloads and output copies retain their type', () => {
  const code = success('struct M { float ref; }; M make(float ref); float get(M ref){return ref.ref;} float get(float ref){return ref;} void change(inout M ref,out M target){ref.ref++;target=ref;} M make(float ref){return M(ref);}' +
    main('M m=make(1.0), n;change(m,n);c=vec4(get(n)+get(1.0));'));
  assert.match(code, /hy_fn_get_1_hy_struct_0_M/);
  assert.match(code, /hy_fn_get_1_f32/);
  assert.match(code, /out_0: hy_struct_0_M/);
  assert.match(code, /hy_root_0: ptr<function, hy_struct_0_M>/);
});

test('member l-values preserve root identity, nested paths, swizzles, matrix indices and update helper uniqueness', () => {
  const code = success('struct M {vec2 a,b;mat2 m;}; void pair(out float a,out float b){a=1.0;b=2.0;}' +
    main('M v;float a=v.a.x++,b=v.b.x++;v.a.yx=vec2(1.0);int i=0;v.m[i++][0]+=1.0;pair(v.a.x,v.b.y);c=vec4(a+b);'));
  const names = [...code.matchAll(/fn (hy_update_post_inc_function_hy_struct_0_M\w*)\(/g)].map(m=>m[1]);
  assert.equal(new Set(names).size, 2);
  assert.match(code, /\(\*hy_root_0\)\.a\.x/);assert.match(code, /\(\*hy_root_0\)\.b\.y/);
  assert.doesNotMatch(code, /hy_root_1: ptr<function, hy_struct_0_M>/);
  assert.match(code, /\(\*hy_value\)\.m\[hy_column\]\[hy_index\]/);
});

test('struct ternaries stay lazy and global constant ternaries/equality use legal WGSL expressions', () => {
  const code = success('struct M{vec2 v;mat2 m;};const M C=1<2?M(vec2(1.0),mat2(1.0)):M(vec2(2.0),mat2(2.0));const bool EQ=C==C;M get(){return C;}' +
    main('M m=p.x>0.0?get():C;bool same=m==get();c=vec4(same?m.v.x:0.0);'));
  assert.match(code, /fn hy_ternary_0.*-> hy_struct_0_M/);
  assert.match(code, /fn hy_equal_hy_struct_0_M/);
  assert.doesNotMatch(code, /select\(C, C/);
  assert.match(code, /all\(a\.v == b\.v\)/);
});

test('invalid struct definitions, fields, assignments and writes fail atomically at the source', () => {
  for (const [source, message] of [
    ['struct Empty {};', /至少需要一个成员/],
    ['struct M{float a;float a;};', /成员.*重复/],
    ['struct M{float a;};struct M{float b;};', /作用域重复/],
    ['struct M{void a;};', /值类型/],
    ['struct M{sampler2D a;};', /sampler2D.*成员/],
    ['struct M{float a=1.0;};', /不能.*初始化/],
    ['struct M{M self;};', /暂不支持类型/],
    ['struct {float a;} m;', /结构体需要名称/],
    ['struct M{struct N{float a;} n;};', /先单独定义/],
    ['struct M{float a;};'+main('M m; c=vec4(m.missing);'), /没有成员/],
    ['struct M{float a;};'+main('M m; m=1.0;'), /结构体类型必须一致/],
    ['struct M{float a;};struct N{float a;};'+main('M m;N n;m=n;'), /结构体类型必须一致/],
    ['struct M{float a;};'+main('M m;m+=m;'), /复合赋值/],
    ['struct M{float a;};'+main('M m;c=vec4(m+m);'), /算术/],
    ['struct M{float a;};'+main('M m;c=vec4(m);'), /不能转换/],
    ['struct M{float a;};'+main('const M m=M(1.0);m.a++;'), /不能修改常量/],
    ['struct M{vec2 a;};'+main('M m;m.a.xx=vec2(1.0);'), /可写变量/],
    ['struct M{float a;};'+main('M(1.0).a=2.0;'), /预期|赋值|标识符/],
  ]) failure(source + (source.includes('mainImage') ? '' : main('c=vec4(1.0);')),message);
});

test('WGSL reserved words are renamed in globals, consts, parameters, locals and the entry signature', () => {
  const code = success('const float ref=0.25;float filter=ref;float fn(const float let,float override){float ref=let+override;return ref+filter;}' +
    'void mainImage(out vec4 ref,in vec2 var){float let=fn(0.0,0.0),reference=1.0;ref=vec4(let*reference);}');
  assert.match(code, /const hy_user_ref: f32/);assert.match(code, /var<private> hy_global_filter/);
  assert.match(code, /hy_user_let: f32/);assert.match(code, /var hy_user_override = hy_arg_override/);
  assert.match(code, /var hy_user_var = hy_coord/);assert.match(code, /return hy_user_ref/);
  assert.match(code, /var reference: f32/);assert.doesNotMatch(code, /\b(?:var|let|const) (?:ref|let|override|var|filter)\b/);
  failure('const float ref=1.0;'+main('ref++;'), /不能修改常量/);
});

test('reserved struct/type/member names, macros, shadowing, outputs and lazy captures use the same bindings', () => {
  const code = success('#define FIELD ref\nstruct ref {float ref;}; void update(inout ref ref){ref.FIELD++;}' +
    main('ref value=ref(1.0); update(value); {float ref=2.0; ref++;} float let=1.0;float x=p.x>0.0?let++:value.FIELD;c=vec4(x);'));
  assert.match(code,/struct hy_struct_0_ref/);assert.match(code,/hy_user_ref: f32/);
  assert.match(code,/hy_param_0\.hy_user_ref/);assert.match(code,/&hy_user_let/);
  assert.match(code,/var hy_user_ref: f32/);
});

test('representative current WGSL keywords/reserved words and invalid WGSL identifiers are escaped', () => {
  for(const name of ['ref','alias','fn','let','var','loop','override','continuing','requires','diagnostic','filter','active','target','type','self','Self','NULL','wgsl','template','__value','_','f32','vec2f','select']) {
    const code=success(main('float '+name+'=1.0; '+name+'++; c=vec4('+name+');'));
    assert.match(code,new RegExp('var hy_user_'+name+': f32'));
  }
});

test('full struct/reserved-name GPU fixture translates through the shared importer', () => {
  const code=success(readFileSync(new URL('./fixtures/structs.glsl',import.meta.url),'utf8'));
  assert.match(code,/hy_struct_0_Material/);assert.match(code,/hy_struct_1_Hit/);
  assert.match(code,/hy_user_ref/);assert.match(code,/hy_equal_/);
});

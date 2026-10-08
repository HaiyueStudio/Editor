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

test('prefix and postfix statements use integer updates or typed floating/vector arithmetic', () => {
  const code = translated(main(`int i=0; uint u=2u; float f=0.5; vec2 v=vec2(0.5);
    ++i; i--; --u; u++; ++f; f++; --f; f--; ++v; v--; ++v.x; c=vec4(v,f,1.0);`));
  assert.match(code, /i\+\+;\n  i--;/);
  assert.match(code, /u--;\n  u\+\+;/);
  assert.match(code, /f \+= 1.0;\n  f \+= 1.0;\n  f -= 1.0;\n  f -= 1.0;/);
  assert.match(code, /v \+= vec2f\(1.0\);\n  v -= vec2f\(1.0\);\n  v.x \+= 1.0;/);
  assert.doesNotMatch(code, /hy_update/);
});

test('expression values preserve prefix/postfix distinction, short circuit and loop evaluation sites', () => {
  const code = translated(main(`float f=0.0;
    float old=f++, next=++f;
    bool skip=false && ++f>0.0;
    while(f++<4.0) { continue; }
    for(;--f>0.0;f--) { if(f<1.0) { break; } }
    c=vec4(old,next,f,1.0);`));
  assert.match(code, /var old: f32 = hy_update_post_inc_function_f32\(&f\);/);
  assert.match(code, /var next: f32 = hy_update_pre_inc_function_f32\(&f\);/);
  assert.match(code, /false && \(hy_update_pre_inc_function_f32\(&f\) > 0.0\)/);
  assert.match(code, /while \(\(hy_update_post_inc_function_f32\(&f\) < 4.0\)\)/);
  assert.match(code, /for \(; \(hy_update_pre_dec_function_f32\(&f\) > 0.0\); f -= 1.0\)/);
  assert.match(code, /fn hy_update_post_inc_function_f32[^]*?return hy_old;/);
  assert.match(code, /fn hy_update_pre_inc_function_f32[^]*?return hy_next;/);
});

test('global, swizzle and indexed updates pass the root variable and evaluate indices once', () => {
  const code = translated(`float counter=0.0, old=counter++;
${main('vec3 v=vec3(1.0); int i=0; float a=v[i++]++; vec2 b=++v.yx; float d=v.zyx[i]--; counter++; c=vec4(a,b,d);')}`);
  assert.match(code, /hy_global_old = hy_update_post_inc_private_f32\(&hy_global_counter\);/);
  assert.match(code, /hy_update_post_inc_function_vec3f_index_i32\(&v, hy_update_post_inc_function_i32\(&i\)\)/);
  assert.match(code, /hy_update_pre_inc_function_vec3f_yx\(&v\)/);
  assert.match(code, /\(\*hy_value\).y = hy_next.x;\n  \(\*hy_value\).x = hy_next.y;/);
  assert.match(code, /vec3u\(2u, 1u, 0u\)\[hy_index\]/);
  assert.doesNotMatch(code, /&v[.\[]/);
});

test('rewritten builtins evaluate incrementing operands once', () => {
  const code = translated(main('float f=1.0; vec2 uv=vec2(0.25); float a=mod(f++,2.0); c=textureLod(iChannel0,uv++,0.0)*a;'));
  assert.match(code, /hy_mod_f32\(hy_update_post_inc_function_f32\(&f\), 2.0\)/);
  assert.match(code, /hy_texture_lod_0\(hy_update_post_inc_function_vec2f\(&uv\), 0.0\)/);
  assert.equal((code.match(/hy_update_post_inc_function_f32\(&f\)/g) ?? []).length,1);
  assert.equal((code.match(/hy_update_post_inc_function_vec2f\(&uv\)/g) ?? []).length,1);
});

test('comma-separated local declarations split in order without splitting commas inside calls', () => {
  const code = translated(main(`vec2 n=vec2(0.25,0.75);
    vec2 b=floor(n), f=smoothstep(vec2(0.0),vec2(1.0),fract(n)), next=b+f;
    const float x=0.25, y=x*2.0;
    highp float missing, initialized=y;
    c=vec4(next,initialized,1.0);`));
  assert.match(code, /var b: vec2f = floor\(n\);\n  var f: vec2f = smoothstep\(vec2f\(0.0\), vec2f\(1.0\), fract\(n\)\);\n  var next: vec2f = \(b \+ f\);/);
  assert.match(code, /let x: f32 = 0.25;\n  let y: f32 = \(x \* 2.0\);/);
  assert.match(code, /var missing: f32 = f32\(\);\n  var initialized: f32 = y;/);
});

test('multiple for declarations retain loop scope and continue executes floating updates', () => {
  const code = translated(main('float sum=0.0; for(float i=0.0,j=i+1.0;i<3.0;++i){if(i==1.0){continue;} sum+=j;} c=vec4(sum);'));
  assert.match(code, /var i: f32 = 0.0;\n  var j: f32 = \(i \+ 1.0\);\n  for \(; \(i < 3.0\); i \+= 1.0\)/);
  assert.match(code, /continue;/);
  const result = translateGlsl(main('for(int i=0,j=1;i<j;++i){} c=vec4(float(j));'));
  assert.equal(result.code,null); assert.match(result.diagnostics[0].message,/未知标识符 “j”/);
});

test('invalid increment targets and malformed declarators fail at the original source', () => {
  for (const [body, pattern] of [
    ['const float f=0.0; ++f;', /可写变量/],
    ['++iTime;', /可写变量/],
    ['++1.0;', /可写变量/],
    ['vec2 v=vec2(0.0); ++v.xx;', /可写变量/],
    ['float f=0.0; ++(f+1.0);', /可写变量/],
    ['bool b=true; b++;', /整数或浮点/],
    ['float a=0.0,a=1.0;', /变量.*重复/],
    ['float a=0.0,b[2];', /数组/],
    ['const float a=0.0,b;', /初始值/],
    ['float a=0.0,;', /标识符/],
  ]) {
    const result=translateGlsl(main('\n'+body+'\nc=vec4(1.0);'));
    assert.equal(result.code,null,body); assert.match(result.diagnostics[0].message,pattern,body);
    assert.equal(result.diagnostics[0].line,2);
  }
  const constantParameter=translateGlsl('float f(const float v){return ++v;}\n'+main('c=vec4(f(1.0));'));
  assert.equal(constantParameter.code,null); assert.match(constantParameter.diagnostics[0].message,/可写变量/);
  const shadow=translated(main('const float f=1.0; {float f=0.0; ++f;} c=vec4(f);'));
  assert.match(shadow,/f \+= 1.0;/);
});

test('the GPU fixture combines prefix/postfix values, lazy conditions, vector updates and declaration lists', () => {
  translated(readFileSync(new URL('./fixtures/expressions.glsl',import.meta.url),'utf8'));
});

test('redundant semicolons disappear without losing empty branches or for separators', () => {
  const plain='float g=1.0;\n'+main('float x=0.0; ++x; c=vec4(x+g);');
  const redundant=';;;float g=1.0;;\n'+main(';float x=0.0;;; ++x; /* empty */ ; c=vec4(x+g);;;')+';;';
  assert.equal(translated(redundant),translated(plain));
  const code=translated(main('float x=0.0; for(;x<2.0;++x);; if(x==2.0);else x=0.0; while(x++<3.0); for(;;){break;} c=vec4(x);'));
  assert.match(code,/for \(; \(x < 2.0\); x \+= 1.0\) \{\}/);
  assert.match(code,/if \(\(x == 2.0\)\) \{\} else \{ x = 0.0; \}/);
  assert.match(code,/while \(\(hy_update_post_inc_function_f32\(&x\) < 3.0\)\) \{\}/);
  assert.match(code,/for \(; true; \)/);
  const error=translateGlsl(main('\n;;\n++unknown;'));
  assert.equal(error.code,null); assert.equal(error.diagnostics[0].line,3); assert.equal(error.diagnostics[0].column,3);
});

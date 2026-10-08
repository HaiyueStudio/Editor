import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { translateGlsl } from '../dist/glsl.js';
const main = body => 'void mainImage(out vec4 color,in vec2 p){'+body+'}';
const convert = source => {
  const result=translateGlsl(source);assert.deepEqual(result.diagnostics,[]);
  assert.ok(result.code);return result.code;
};

test('the supplied unbraced if keeps both assignments inside the conditional block', () => {
  const code=convert('struct Hit{int id;};'+main('Hit h=Hit(2);vec3 c;float sp;if(h.id==2)\n c=vec3(.2),sp=3.;color=vec4(c,sp);'));
  assert.match(code,/if \(\(h.id == 2\)\) \{ c = vec3f\(\.2\);\s+sp = 3\.0; \}/);
  assert.match(code,/\}\s+color = vec4f\(c, sp\);/);
});

test('else and nested dangling else retain the same branch boundaries for complete comma sequences', () => {
  const code=convert(main('float a,b;if(p.x<1.0) if(p.y<1.0) a=1.0,b=2.0;else a=3.0,b=4.0;color=vec4(a+b);'));
  assert.match(code,/if \(\(p.x < 1\.0\)\) \{ if \(\(p.y < 1\.0\)\) \{ a = 1\.0;\s+b = 2\.0; \} else \{ a = 3\.0;\s+b = 4\.0; \} \}/);
});

test('assignment, increment, call and lazy expression statements execute in source order', () => {
  const code=convert('void add(inout float x,float n){x+=n;}'+main('float a=0.0,b=0.0;a=1.0,b=a+2.0,add(a,b),a++,true?add(a,1.0):add(a,2.0),b=a;color=vec4(b);'));
  assert.match(code,/a = 1\.0;\s+b = \(a \+ 2\.0\);\s+hy_call_0\(&a, a, b\);\s+a \+= 1\.0;\s+hy_ternary_0\(/);
  assert.match(code,/hy_ternary_0\([^;]+;\s+b = a;/);
});

test('for comma initialization and updating preserve scope, left-to-right order and continue', () => {
  const code=convert(main('int i,j,total=0;for(i=0,j=6;i<3;i++,j-=2,total+=i){if(i==1)continue;}for(int a=0,b=2;a<2;a++,b--){total+=b;}color=vec4(float(total));'));
  assert.match(code,/i = 0;\s+j = 6;\s+loop \{/);
  assert.match(code,/continue;/);
  assert.match(code,/continuing \{\s+i\+\+;\s+j -= 2;\s+total \+= i;/);
  assert.match(code,/var a: i32 = 0;\s+var b: i32 = 2;\s+loop \{/);
  assert.match(code,/continuing \{\s+a\+\+;\s+b--;/);
});

test('call and constructor argument commas and declaration commas remain separate syntactic contexts', () => {
  const code=convert('float sum(float a,float b){return a+b;}'+main('vec2 a=vec2(1.0,2.0),b=vec2(sum(3.0,4.0));float x=0.0;a=vec2(sum(x,1.0),2.0),b=a;x=2.0;color=vec4(a,b);'));
  assert.match(code,/var a: vec2f = vec2f\(1\.0, 2\.0\);\s+var b: vec2f = vec2f\(hy_fn_sum_2_f32_f32\(3\.0, 4\.0\)\);/);
  assert.match(code,/a = vec2f\(hy_fn_sum_2_f32_f32\(x, 1\.0\), 2\.0\);\s+b = a;/);
  assert.match(code,/color = vec4f\(a, b\);/);
});

test('comma statements reuse all lowered assignments and remain within while and switch bodies', () => {
  const code=convert('#define SET(x,y) x=1.0,y=2.0\n'+main('float a,b;vec2 v;mat2 m;int i=0;while(i<2) i++,v.yx=vec2(float(i)),m[0][1]+=1.0;switch(i){case 2: SET(a,b);break;default:a=0.0,b=0.0;break;}color=vec4(a+b);'));
  assert.match(code,/while \(\(i < 2\)\) \{ i\+\+;\s+let hy_swizzle_/);
  assert.match(code,/v.y = hy_swizzle_\d+\.x;\s+v.x = hy_swizzle_\d+\.y;\s+hy_assign_/);
  assert.match(code,/a = 1\.0;\s+b = 2\.0;/);
  assert.match(code,/a = 0\.0;\s+b = 0\.0;/);
});

test('empty comma operands or writes to readonly targets fail atomically with source positions', () => {
  for(const body of ['float a;a=1.0,;', 'float a;a=1.0,,a=2.0;',
    'float a;const float b=1.0;a=2.0,b=3.0;',
    'float a;a=1.0,float b=2.0;', 'float a;a=1.0,iTime=2.0;']) {
    const result=translateGlsl(main('\n'+body));
    assert.equal(result.code,null);assert.ok(result.diagnostics[0].line>=2);
    assert.ok(result.diagnostics[0].column>=1);
  }
});

test('complete comma statement GPU fixture translates the original example and ordered effects', () => {
  const code=convert(readFileSync(new URL('./fixtures/comma-statements.glsl',import.meta.url),'utf8'));
  assert.match(code,/sp = 3\.0;/);assert.match(code,/continuing \{/);
  assert.match(code,/hy_fn_mark_1_f32\(1\.0\);\s+hy_fn_mark_1_f32\(2\.0\);/);
});

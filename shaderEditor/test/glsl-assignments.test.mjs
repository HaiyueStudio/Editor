import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {translateGlsl} from '../dist/glsl.js';
const source=readFileSync(new URL('./fixtures/assignments.glsl',import.meta.url),'utf8');
const wrap=body=>'void mainImage(out vec4 c,in vec2 p){'+body+'c=vec4(1.);}';
test('the supplied repeated component assignment and unbraced if/else translate',()=>{
 const r=translateGlsl(wrap('vec2 q=vec2(20.);if(q.x>13)q.x=q.x=26-q.x;else q.x=2.;'));
 assert.deepEqual(r.diagnostics,[]);assert.match(r.code,/q.x = hy_assign_\d+\(&q,/);
 assert.match(r.code,/-> f32 \{[^]*?return hy_next;/);
});
test('chained expressions associate rightward and return each converted stored value',()=>{
 const r=translateGlsl(wrap('float a=0.,b=0.,d=0.;a=b=d=0.5;'));
 assert.deepEqual(r.diagnostics,[]);assert.match(r.code,/a = hy_assign_1\(&b, hy_assign_0\(&d, 0.5\)\)/);
 const mixed=translateGlsl(wrap('float a=0.;int b=0;float d=(a=b=2);'));
 assert.deepEqual(mixed.diagnostics,[]);assert.match(mixed.code,/f32\(hy_rhs\)/);
});
test('assignment expressions work in arguments, return, conditions, globals and macros',()=>{
 for(const [entryPoint,code] of [
 ['image','float a=0.;float b=(a=.2);float twice(float x){return x*2.;}float f(){float x;return x=.3;}void mainImage(out vec4 c,in vec2 p){float x=0.,y=0.;while((x=y=y+.1)<.2){}c=vec4(twice(x=y=f()));}'],
 ['sound','#define STORE(a,b,x) a=b=x\nvec2 mainSound(float t){float a=0.,b=0.;STORE(a,b,.2);return vec2(a,b);}'],
 ['common','float x=0.;float f(){return x=.5;}']
 ]){
  const r=translateGlsl(code,{entryPoint});assert.deepEqual(r.diagnostics,[]);
 }
});
test('assignment side effects remain lazy and are not lowered to eager select',()=>{
 const r=translateGlsl(wrap('float a=0.,b=0.;float v=p.x>1.?(a=b=.2):(a=b=.3);bool hit=false&&((a=b=.4)>0.);'));
 assert.deepEqual(r.diagnostics,[]);assert.match(r.code,/fn hy_ternary_/);assert.doesNotMatch(r.code,/select\(/);
 assert.match(r.code,/false &&/);
});
test('invalid writable targets and aggregate compound assignments report GLSL diagnostics',()=>{
 for(const body of [
 'const float b=0.;float a=0.;a=b=1.;',
 'vec2 q=vec2(0.);q=q.xx=vec2(1.);',
 'float a=0.,b=0.;(a=b)=1.;',
 'float a=0.;a=iTime=1.;',
 'float a[2],b[2];a=b+=float[2](1.,2.);',
 'struct S{float x;};S a,b;a=b+=S(1.);',
 'float a=0.,b=0.;a=b=;',
 'float a=0.,b=0.;true?a:b=1.;'
 ]){
  const r=translateGlsl(wrap(body));assert.equal(r.code,null,body);assert.ok(r.diagnostics[0].column>0);
 }
 assert.equal(translateGlsl('float x=0.;const float y=(x=1.);'+wrap('')).code,null);
});
test('GPU assignment fixture translates all scalar, aggregate, lazy and indexed cases',()=>{
 const r=translateGlsl(source);assert.deepEqual(r.diagnostics,[]);assert.ok(r.code);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {translateGlsl} from '../dist/glsl.js';
const main=body=>'void mainImage(out vec4 color,in vec2 q){'+body+'}';
test('the supplied negative texture bias converts with a clear single-mip notice',()=>{
 const r=translateGlsl(main('float c=texture(iChannel0,(q+0.5)/iResolution.xy,-100.0).x;color=vec4(c);'));
 assert.deepEqual(r.diagnostics,[]);assert.match(r.code,/hy_texture_bias_2d\(iChannel0,/);
 assert.match(r.code,/bias: f32/);assert.match(r.code,/textureSampleLevel\(tex, iSampler, vec2f\(uv.x, 1.0 - uv.y\), 0.0\)/);
 assert.ok(r.warnings.some(w=>w.includes('bias')&&w.includes('第 0 层')));
 assert.doesNotMatch(r.code,/textureSampleBias|textureSampleLevel[^]*-100/);
 assert.ok(!translateGlsl(main('color=texture(iChannel0,q);')).warnings.some(w=>w.includes('bias')));
});
test('optional bias supports aliases, sampler parameters and cubemap inference',()=>{
 for(const name of ['texture','texture2D','textureCube']){
  const cube=name==='textureCube',uv=cube?'vec3(1.)':'q';
  const r=translateGlsl(main('color='+name+'(iChannel0,'+uv+',100.0);'));
  assert.deepEqual(r.diagnostics,[]);assert.equal(r.channelTypes[0],cube?'cube':'2d');
  assert.match(r.code,new RegExp('hy_texture_bias_'+(cube?'cube':'2d')));
 }
 const r=translateGlsl('vec4 read(samplerCube iChannel0,vec3 uv,float b){return texture(iChannel0,uv,b);}'+main('color=read(iChannel3,vec3(q,1.),-100.);'));
 assert.deepEqual(r.diagnostics,[]);assert.match(r.code,/hy_texture_bias_cube\(iChannel0, uv, b\)/);
 assert.equal(r.channelTypes[3],'cube');assert.match(r.code,/textureSampleLevel\(tex, iSampler, uv, 0.0\)/);
});
test('coordinates and bias are evaluated once, even when their values contain writes',()=>{
 const r=translateGlsl(main('float bias=-100.;vec2 uv=q; color=texture(iChannel0,uv++,bias++);'));
 assert.deepEqual(r.diagnostics,[]);assert.equal((r.code.match(/&uv/g)||[]).length,1);assert.equal((r.code.match(/&bias/g)||[]).length,1);
 assert.match(r.code,/hy_texture_bias_2d\(iChannel0, hy_update_post_inc_function_vec2f\(&uv\), hy_update_post_inc_function_f32\(&bias\)\)/);
});
test('Common and Sound share bias conversion, including lazy nonuniform branches',()=>{
 for(const [entryPoint,source] of [
 ['common','vec4 read(sampler2D t,vec2 uv){return texture(t,uv,-100.);}'],
 ['sound','vec2 mainSound(float t){return texture(iChannel0,vec2(t),-100.).xy;}'],
 ['image',main('color=q.x>2.?texture(iChannel0,q,-100.):texture2D(iChannel0,q,100.);')]
 ]){
  const r=translateGlsl(source,{entryPoint});assert.deepEqual(r.diagnostics,[]);assert.ok(r.warnings.some(w=>w.includes('bias')));
 }
});
test('bad bias signatures fail at their GLSL call without changing explicit-LOD arities',()=>{
 for(const [expr,pattern] of [
 ['texture(iChannel0,q,vec2(0.))',/bias.*float/],['texture(iChannel0,q,true)',/bias.*float/],
 ['textureCube(iChannel0,vec3(1.),ivec2(0))',/bias.*float/],
 ['texture(iChannel0)',/2 或 3/],['texture2D(iChannel0,q,1.,2.)',/2 或 3/],
 ['textureLod(iChannel0,q)',/3 个/],['textureSize(iChannel0,0,0)',/2 个/]
 ]){
  const r=translateGlsl('\n'+main('color=vec4('+expr+');'));assert.equal(r.code,null,expr);assert.match(r.diagnostics[0].message,pattern);assert.equal(r.diagnostics[0].line,2);
 }
});

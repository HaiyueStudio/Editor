import test from 'node:test';
import assert from 'node:assert/strict';
import {translateWgsl} from '../dist/wgsl.js';
import {exportShadertoy,exportShadertoyPass,translateProjectWgsl} from '../dist/shadertoyExport.js';
import {examples} from '../dist/examples.js';
import {TUTORIAL_LABS,tutorialProject} from '../dist/tutorialLabs.js';
import {createProject,passOf,emptyChannels} from '../dist/model.js';
import {ShaderWorkspace} from '../dist/workspace.js';
import {translateGlsl} from '../dist/glsl.js';

test('all Gallery and tutorial WGSL modules compile to Shadertoy entries',async()=>{
 for(const p of [...examples().map(e=>e.project),...TUTORIAL_LABS.map(l=>tutorialProject(l.id))]){
  const original=JSON.stringify(p), r=await exportShadertoy(p);
  assert.ok(r.passes.length);
  for(const pass of r.passes){assert.ok(pass.code,JSON.stringify({name:p.name,pass:pass.pass,diagnostics:pass.diagnostics}));assert.match(pass.code,/void mainImage\(out vec4/);assert.doesNotMatch(pass.code,/#version|layout\(|uniform |\bfn\b|\bvoid main\(/);}
  assert.equal(JSON.stringify(p),original,'export never mutates drafts');
 }
});
test('Gallery exports can be imported again, including vector comparisons and ties-to-even rounding',async()=>{
 for(const e of examples())for(const pass of (await exportShadertoy(e.project)).passes){
  const r=translateGlsl(pass.code);assert.ok(r.code,JSON.stringify({example:e.id,pass:pass.pass,diagnostics:r.diagnostics}));
 }
 const r=translateGlsl('void mainImage(out vec4 c,in vec2 p){uvec2 bits=floatBitsToUint(p);vec2 v=uintBitsToFloat(bits);ivec2 b=floatBitsToInt(v);v=intBitsToFloat(b);bvec2 eq=equal(bvec2(true),bvec2(true));c=vec4(roundEven(v),any(eq)?1.:0.,1.);}');
 assert.ok(r.code,JSON.stringify(r.diagnostics));assert.match(r.code,/bitcast<vec2u>/);assert.match(r.code,/bitcast<vec2i>/);assert.match(r.code,/bitcast<vec2f>/);assert.match(r.code,/round\(/);
 assert.ok(translateGlsl('void mainImage(out vec4 c,in vec2 p){c=vec4(intBitsToFloat(1065353216));}').code);
 for(const body of ['lessThan(vec2(1.),vec3(1.));','greaterThan(bvec2(true),bvec2(false));','equal(vec2(1.),ivec2(1));','floatBitsToUint(1);','intBitsToFloat(uvec2(1u));','roundEven(1,2);'])assert.equal(translateGlsl('void mainImage(out vec4 c,in vec2 p){'+body+'}').code,null,body);
});
test('Sound, arrays, structs, matrices, loop continuing and bitcasts use the compiler type system',async()=>{
 const r=await translateWgsl(`struct Data { color: vec3f, weight:f32 }
 fn mainSound(s:i32,t:f32)->vec2f {
   var a:array<f32,3>; var d:Data; var m=mat2x2f(1.,2.,3.,4.);
   var j=0; loop { if(j>=3){break;} a[j]=f32(j); continuing {j++;} }
   d.color=vec3f(a[1],m[0].x,1.); d.weight=bitcast<f32>(1065353216u);
   return vec2f(sin(t)*d.weight, d.color.x*f32(s%2));
 }`,{entryPoint:'sound'});
 assert.ok(r.code,JSON.stringify(r.diagnostics));assert.match(r.code,/vec2 mainSound\(int/);assert.match(r.code,/uintBitsToFloat/);assert.doesNotMatch(r.code,/\bhy_/);
});
test('current GLSL originals and Common are exported without a lossy roundtrip',async()=>{
 const p=createProject();p.commonGlsl='#define GAIN 0.5';p.editorLanguages={common:'glsl',image:'glsl'};
 passOf(p,'image').glsl='void mainImage(out vec4 c,in vec2 p){c=vec4(GAIN);}';
 const r=await exportShadertoyPass(p,'image');assert.equal(r.code,p.commonGlsl+'\n'+passOf(p,'image').glsl);
 p.editorLanguages.image='wgsl';p.commonGlsl='float gain(float x) { return x * .5; }';passOf(p,'image').code='fn mainImage(p:vec2f)->vec4f { return vec4f(hy_common_fn_gain_1_f32(1.)); }';
 assert.ok((await exportShadertoyPass(p,'image')).code);
 p.commonGlsl='float gain(float x) { return x * .75; }';p.common='this stale WGSL must never be used';
 const fresh=await translateProjectWgsl(p,passOf(p,'image').code);assert.ok(fresh.code,JSON.stringify(fresh.diagnostics));assert.match(fresh.code,/0.75/);
 p.commonGlsl='float gain(';const invalid=await translateProjectWgsl(p,passOf(p,'image').code);assert.equal(invalid.code,null);assert.equal(invalid.diagnostics[0].source,'common');
});
test('source diagnostics identify Common and unsupported WebGPU bindings fail explicitly',async()=>{
 const r=await translateWgsl('fn mainImage(p:vec2f)->vec4f {\n return missing;\n}');
 assert.equal(r.code,null);assert.equal(r.diagnostics[0].line,2);assert.equal(r.diagnostics[0].source,'pass');
 const common=await translateWgsl('fn mainImage(p:vec2f)->vec4f{return vec4f(1.);}',{common:'fn bad()->f32 {\n return nope;\n}'});
 assert.equal(common.code,null);assert.equal(common.diagnostics[0].source,'common');assert.equal(common.diagnostics[0].line,2);
 const storage=await translateWgsl('@group(3) @binding(0) var<storage> data:array<f32>;');assert.equal(storage.code,null);assert.match(storage.diagnostics[0].message,/绑定/);
 const cube=await translateWgsl('// @haiyue-channel iChannel0 cube\nfn mainImage(p:vec2f)->vec4f { return channel0(vec3f(1.,0.,0.)); }');assert.ok(cube.code);assert.match(cube.code,/samplerCube/);
 const bad=await translateWgsl('// @haiyue-channel iChannel0 cube\nfn mainImage(p:vec2f)->vec4f{return channel0(vec3f(1.));}',{channels:[{kind:'keyboard'},...emptyChannels().slice(1)]});assert.equal(bad.code,null);
 const comments=await translateWgsl('/* outer /* @group(1) */ @fragment */\nfn mainImage(p:vec2f)->vec4f{return vec4f(1.);}');assert.ok(comments.code,JSON.stringify(comments.diagnostics));
});
test('read-only WGSL translation and project export share API/IPC and preserve revisions',async()=>{
 const w=new ShaderWorkspace();await w.start();
 try{
  const revision=w.document.revision,source=JSON.stringify(w.document.serialize());
  const call=(operation,params={})=>w.api.execute({apiVersion:'1',requestId:crypto.randomUUID(),documentId:w.document.identity.id,expectedRevision:revision,operation,params});
  const r=await call('shader.wgsl.translate',{code:'fn mainImage(p:vec2f)->vec4f{return vec4f(p/iResolution.xy,0.,1.);}'});assert.equal(r.status,'completed');assert.ok(r.value.code,JSON.stringify(r));
  const full=await call('shader.shadertoy.export');assert.equal(full.status,'completed');assert.equal(full.value.passes.length,1);
  const pass=await call('shader.shadertoy.export',{pass:'image'});assert.equal(pass.status,'completed');assert.ok(pass.value.code);
  assert.equal(w.document.revision,revision);assert.equal(JSON.stringify(w.document.serialize()),source);
 }finally{await w.dispose();}
});

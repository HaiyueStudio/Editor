import test from 'node:test';
import assert from 'node:assert/strict';
import {translateGlsl} from '../dist/glsl.js';
import {createProject,passOf,parseProject,validateProject} from '../dist/model.js';
import {ShaderWorkspace} from '../dist/workspace.js';
import {refreshProjectGlsl} from '../dist/glslProject.js';
import {wrapShader} from '../dist/shaders.js';
import {resolveChannelBindings} from '../dist/channelBindings.js';

const common=`#define GAIN .2
struct Hit { vec3 color; };
float gain(float x){return x*GAIN;}
vec3 gain(vec3 x){return x*GAIN;}
const float notes[2]=float[](1.,2.);
float phase=iTime;
Hit shade(){return Hit(gain(vec3(notes[1])));}
`;
const image='void mainImage(out vec4 c,in vec2 p){c=vec4(shade().color+vec3(gain(phase)),1.);}';

test('Common accepts definitions without an entry and isolates generated helpers',()=>{
 for(const source of ['', '#define SCALE 2.0',common,'float y=gl_FragCoord.y;float coord(){return y;}']){
  const r=translateGlsl(source,{entryPoint:'common'});assert.deepEqual(r.diagnostics,[]);
  assert.match(r.code,/fn hy_common_library_init/);assert.doesNotMatch(r.code,/\bhy_(?!common_)\w+/);
  assert.doesNotMatch(r.code,/fn mainImage|fn mainSound/);
 }
 assert.match(translateGlsl(common,{entryPoint:'common'}).code,/hy_common_init_globals\(\)/);
 assert.match(translateGlsl('struct PublicType {vec3 normal;};',{entryPoint:'common'}).code,/struct hy_common_struct_0_PublicType/);
 for(const code of [image,'vec2 mainSound(float t){return vec2(t);}']){
  const r=translateGlsl(code,{entryPoint:'common'});assert.equal(r.code,null);assert.match(r.diagnostics[0].message,/Common/);
 }
 assert.equal(translateGlsl(common).code,null,'image still requires its entry');
});

test('Common macros, overloads, structs, arrays and global initializers link into Image and Sound',()=>{
 for(const [entryPoint,source] of [['image',image],['sound','vec2 mainSound(float t){return vec2(gain(t)+notes[0]+phase);}']]){
  const r=translateGlsl(source,{entryPoint,common});assert.deepEqual(r.diagnostics,[]);
  assert.match(r.code,/@haiyue-common-included/);assert.match(r.code,/hy_init_globals\(\)/);
  assert.doesNotMatch(r.code,/hy_common_/);
  const p=passOf(createProject(),entryPoint);p.code=r.code;
  const wrapped=wrapShader(p,translateGlsl(common,{entryPoint:'common'}).code);
  assert.doesNotMatch(wrapped.code,/hy_common_library_init/);
  assert.equal((wrapped.code.match(/struct hy_struct_\w*Hit/g)||[]).length,1);
 }
});

test('standalone Common initializes native WGSL calls after builtins and supports fragment coordinates',()=>{
 const c=translateGlsl('float y=gl_FragCoord.y;float t=iTime;',{entryPoint:'common'});
 const p=createProject(),w=wrapShader(passOf(p,'image'),c.code);
 assert.match(w.code,/hy_common_library_init\(vec2f\(position.x, iResolution.y - position.y\)\);/);
 assert.ok(w.code.lastIndexOf('hy_common_library_init(')>w.code.lastIndexOf('iTime = hy_uniforms'));
 assert.match(wrapShader(p.sound,translateGlsl(common,{entryPoint:'common'}).code).code,/hy_common_library_init\(vec2f\(0.0\)\);/);
});

test('shared and local GLSL errors keep original source ownership and line numbers',()=>{
 const shared=translateGlsl(image,{common:'// header\nfloat broken=unknown;'});
 assert.equal(shared.code,null);assert.equal(shared.diagnostics[0].source,'common');assert.equal(shared.diagnostics[0].line,2);
 const local=translateGlsl('// header\nvoid mainImage(out vec4 c,in vec2 p){c=vec4(unknown);}',{common});
 assert.equal(local.code,null);assert.equal(local.diagnostics[0].source,'pass');assert.equal(local.diagnostics[0].line,2);
});

test('linked GLSL specializes Common sampler overloads per Pass without stale Common ABI hints',()=>{
 const shared='float sizeOf(sampler2D s){return float(textureSize(s,0).x);}float sizeOf(samplerCube s){return float(textureSize(s,0).x);}';
 for(const dimension of ['2d','cube']){
  const r=translateGlsl('void mainImage(out vec4 c,in vec2 p){c=vec4(sizeOf(iChannel0));}',{common:shared,channelTypes:[dimension,null,null,null]});
  assert.deepEqual(r.diagnostics,[]);const p=passOf(createProject(),'image');p.code=r.code;
  const bindings=resolveChannelBindings(p,'// @haiyue-channel iChannel0 '+(dimension==='2d'?'cube':'2d'));
  assert.equal(bindings.dimensions[0],dimension);assert.ok(!bindings.diagnostics.some(d=>d.severity==='error'));
 }
});

test('stored originals relink after Common edits and preserve explicit native WGSL edits',async()=>{
 const w=new ShaderWorkspace();
 w.applyGlsl('common',common);w.applyGlsl('image',image);w.applyGlsl('sound','vec2 mainSound(float t){return vec2(gain(t));}');
 const before=passOf(w.document.state,'image').code;
 w.applyGlsl('common',common.replace('GAIN .2','GAIN .6'));
 assert.notEqual(passOf(w.document.state,'image').code,before);
 assert.equal(passOf(w.document.state,'image').glsl,image);
 assert.deepEqual(parseProject(JSON.stringify(w.document.state)),w.document.state);
 for(const pass of ['image','sound','common']){
  const source=pass==='common'?w.document.state.common:passOf(w.document.state,pass).code;
  w.document.setCode(pass,source);
  assert.ok(pass==='common'?w.document.state.commonGlsl:passOf(w.document.state,pass).glsl);
  w.document.setCode(pass,source+'\n// edited WGSL');
  assert.equal(pass==='common'?w.document.state.commonGlsl:passOf(w.document.state,pass).glsl,undefined);
 }
 await w.dispose();
});

test('failed linking identifies enabled Passes and invalid source metadata is rejected',()=>{
 const p=createProject();p.commonGlsl='#define N 2';passOf(p,'image').glsl='void mainImage(out vec4 c,in vec2 p){c=vec4(MISSING);}';
 p.sound.glsl='broken';assert.deepEqual(refreshProjectGlsl(p).map(d=>d.pass),['image']);
 p.sound.enabled=true;assert.deepEqual(refreshProjectGlsl(p).map(d=>d.pass),['image','sound']);
 for(const change of [p=>p.commonGlsl=17,p=>p.sound.glsl=null,p=>p.passes[0].glsl='x'.repeat(100001)]){
  const invalid=createProject();change(invalid);assert.throws(()=>validateProject(invalid));
 }
});

test('Common conversion API previews without mutation, applies with revisions and round-trips source',async()=>{
 const w=new ShaderWorkspace();await w.start();
 try{
  const call=(operation,params={},revision=w.document.revision)=>w.api.execute({apiVersion:'1',requestId:crypto.randomUUID(),documentId:w.document.identity.id,expectedRevision:revision,operation,params});
  const before=w.document.revision;
  const preview=await call('shader.glsl.translate',{pass:'common',code:common});
  assert.equal(preview.status,'completed');assert.ok(preview.value.code);assert.equal(w.document.revision,before);
  assert.equal((await call('shader.glsl.apply',{pass:'common',code:common})).status,'completed');
  assert.equal(w.document.revision,before+1);
  assert.equal((await call('shader.glsl.apply',{pass:'image',code:image},before)).error.code,'REVISION_CONFLICT');
  assert.equal((await call('shader.glsl.apply',{pass:'image',code:image})).status,'completed');
  const beforeFailure=w.document.serialize(),rev=w.document.revision;
  assert.equal((await call('shader.glsl.apply',{pass:'common',code:'float x=missing;'})).status,'failed');
  assert.deepEqual(w.document.serialize(),beforeFailure);assert.equal(w.document.revision,rev);
  const saved=(await call('shader.project.export')).value;
  await call('shader.code.set',{pass:'common',code:''});
  await call('shader.project.open',{resourceId:saved.resourceId});
  assert.equal(w.document.state.commonGlsl,common);assert.equal(passOf(w.document.state,'image').glsl,image);
  w.api.releaseResource(saved.resourceId);
 }finally{await w.dispose();}
});

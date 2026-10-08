import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createSound,parseProject,validateProject,passOf,codeOf} from '../dist/model.js';
import {translateGlsl} from '../dist/glsl.js';
import {wrapShader} from '../dist/shaders.js';
import {encodeWave,cleanSample} from '../dist/sound.js';
import {ShaderWorkspace} from '../dist/workspace.js';

test('Sound is optional in legacy files, disabled by default, and round-trips settings/channels',()=>{
 const p=createProject();assert.equal(p.sound.enabled,false);assert.equal(p.sound.channels.length,4);
 p.sound.enabled=true;p.sound.duration=30;p.sound.volume=.1;
 assert.deepEqual(parseProject(JSON.stringify(p)),p);
 const legacy=structuredClone(p);delete legacy.sound;assert.deepEqual(validateProject(legacy).sound,createSound());
 assert.equal(passOf(p,'sound'),p.sound);assert.equal(codeOf(p,'sound'),p.sound.code);
 for(const sound of [null,{...p.sound,duration:0},{...p.sound,duration:121},{...p.sound,duration:NaN},{...p.sound,volume:-1},{...p.sound,enabled:'yes'}])
   assert.throws(()=>validateProject({...p,sound}));
 for(const kind of ['keyboard','video','buffer']){
   const invalid=structuredClone(p);invalid.sound.channels[0]=kind==='buffer'?{kind,pass:'buffer-a'}:kind==='video'?{kind,assetId:'missing'}:{kind};
   assert.throws(()=>validateProject(invalid),/Sound/);
 }
});
test('mainSound overload forms translate with normal macros, globals, sample rate and safe naming',()=>{
 for(const source of [
 '#define TAU 6.2831853\nfloat gain=.2;vec2 mainSound(int samp,float time){return vec2(gain*sin(TAU*440.*time),float(samp%8)/8.);}',
 'float phase=iTime;vec2 mainSound(float ref){return vec2(phase+ref,iSampleRate/44100.);}',
 'vec2 mainSound(int index,float time);vec2 mainSound(int index,float time){return vec2(float(index)/iSampleRate-time);}'
 ]){
   const r=translateGlsl(source,{entryPoint:'sound'});assert.deepEqual(r.diagnostics,[]);assert.ok(r.code);
   assert.match(r.code,/fn mainSound\(sampleIndex: i32, sampleTime: f32\) -> vec2f/);
   assert.doesNotMatch(r.code,/fn mainImage/);
 }
 const overloads=['vec2 mainSound(float t){return vec2(t);}','vec2 mainSound(int i,float t){return vec2(float(i),t);}'];
 for(const source of [overloads.join('\n'),overloads.toReversed().join('\n')]){
   const converted=translateGlsl(source,{entryPoint:'sound'});
   assert.deepEqual(converted.diagnostics,[]);
   assert.match(converted.code,/fn mainSound[^]*?return \w+\(sampleIndex, sampleTime\);/);
 }
 const r=translateGlsl('float g=iTime;vec2 mainSound(float t){return vec2(g);}',{entryPoint:'sound'});
 assert.match(r.code,/fn mainSound[^]*?hy_init_globals\(\);/);
 for(const source of ['void mainImage(out vec4 c,in vec2 p){c=vec4(1.);}','float mainSound(float t){return t;}','vec2 mainSound(out float t){return vec2(t);}','vec2 mainSound(float t){return gl_FragCoord.xy;}']){
   assert.equal(translateGlsl(source,{entryPoint:'sound'}).code,null,source);
 }
 assert.equal(translateGlsl('vec2 mainSound(float t){return vec2(t);}').code,null,'image conversion still requires mainImage');
});
test('Sound wrapper keeps sample index exact across chunks and maps Common/Sound source lines',()=>{
 const p=createProject();p.common='const GAIN=0.25;';p.sound.code='fn mainSound(i:i32,t:f32)->vec2f {\n return vec2f(GAIN);\n}';
 const w=wrapShader(p.sound,p.common);
 assert.match(w.code,/let base = bitcast<u32>\(hy_uniforms.timing.x\)/);
 assert.match(w.code,/mainSound\(i32\(index\), iTime\)/);
 assert.deepEqual(w.sourceLocation(w.lineOffset),{pass:'common',line:1});
 assert.deepEqual(w.sourceLocation(w.lineOffset+2),{pass:'sound',line:2});
});
test('WAV exports interleaved stereo PCM16 with clipping and nonfinite sanitization',()=>{
 const data={left:new Float32Array([-2,0,.5,Infinity]),right:new Float32Array([2,-.5,NaN,-1]),sampleRate:44100};
 const bytes=encodeWave(data),view=new DataView(bytes.buffer),text=(a,b)=>new TextDecoder().decode(bytes.slice(a,b));
 assert.equal(text(0,4),'RIFF');assert.equal(text(8,12),'WAVE');assert.equal(text(36,40),'data');
 assert.equal(view.getUint32(4,true),bytes.length-8);assert.equal(view.getUint32(40,true),16);
 assert.equal(view.getUint16(22,true),2);assert.equal(view.getUint32(24,true),44100);
 assert.equal(view.getUint32(28,true),176400);assert.equal(view.getUint16(34,true),16);
 assert.deepEqual(Array.from({length:8},(_,i)=>view.getInt16(44+i*2,true)),[-32768,32767,0,-16384,16384,0,0,-32768]);
 assert.equal(cleanSample(NaN),0);assert.equal(cleanSample(-Infinity),0);
});
test('Sound API config/code/translation/export schema preserves revisions and old project compatibility',async()=>{
 const w=new ShaderWorkspace();await w.start();
 try{
   const call=(operation,params={},revision=w.document.revision)=>w.api.execute({apiVersion:'1',requestId:crypto.randomUUID(),documentId:w.document.identity.id,expectedRevision:revision,operation,params});
   const previous=w.document.revision;
   assert.equal((await call('shader.code.set',{pass:'sound',code:'fn mainSound(i:i32,t:f32)->vec2f{return vec2f(0.0);}'})).status,'completed');
   assert.equal((await call('shader.code.set',{pass:'sound',code:''},previous)).status,'failed');
   await call('shader.pass.enable',{pass:'sound',enabled:true});await call('shader.sound.configure',{duration:4,volume:.5});
   assert.equal(w.document.state.sound.enabled,true);assert.equal((await call('shader.query')).value.sound.duration,4);
   assert.equal((await call('shader.sound.configure',{duration:999})).status,'failed');assert.equal(w.document.state.sound.duration,4);
   assert.equal((await call('shader.glsl.translate',{pass:'sound',code:'vec2 mainSound(float t){return vec2(t);}'})).value.diagnostics.length,0);
   const exported=(await call('shader.project.export')).value;await call('shader.code.set',{pass:'sound',code:''});await call('shader.project.open',{resourceId:exported.resourceId});
   assert.ok(w.document.state.sound.code.includes('mainSound'));w.api.releaseResource(exported.resourceId);
 }finally{await w.dispose();}
});

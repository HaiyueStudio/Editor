import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,codeTabs,passOf,parseProject,validateProject} from '../dist/model.js';
import {ShaderWorkspace} from '../dist/workspace.js';

test('fresh projects expose only Image; added empty/disabled tabs survive export and reopen',async()=>{
 const w=new ShaderWorkspace();
 try{
  assert.deepEqual(codeTabs(w.document.state),['image']);
  w.addPass('common');w.addPass('buffer-a');w.addPass('sound');
  assert.equal(w.document.state.sound.enabled,true);assert.equal(passOf(w.document.state,'buffer-a').enabled,true);
  const revision=w.document.revision;w.addPass('common');w.addPass('sound');assert.equal(w.document.revision,revision);
  w.setEnabled('buffer-a',false);w.setEnabled('sound',false);
  assert.deepEqual(codeTabs(parseProject(JSON.stringify(w.document.state))),['image','common','buffer-a','sound']);
 }finally{await w.dispose();}
});
test('legacy, imported, and externally edited projects reveal every authored or enabled module',()=>{
 const p=createProject();delete p.tabs;
 p.common='const GAIN=.5;';p.passes[0].enabled=true;p.passes[1].code+='\\n// unfinished';p.sound.glsl='vec2 mainSound(float t){return vec2(0.);}';
 assert.deepEqual(codeTabs(validateProject(p)),['image','common','buffer-a','buffer-b','sound']);
 const fresh=createProject();for(const tabs of [null,[],['image','image'],['image','other'],'image'])assert.throws(()=>validateProject({...fresh,tabs}));
});
test('API additions preserve revisions and Buffer channel binding reveals its tab',async()=>{
 const w=new ShaderWorkspace();await w.start();
 try{
  const call=(params,revision=w.document.revision)=>w.api.execute({apiVersion:'1',requestId:crypto.randomUUID(),documentId:w.document.identity.id,expectedRevision:revision,operation:'shader.pass.add',params});
  const revision=w.document.revision;
  assert.equal((await call({pass:'sound'})).status,'completed');assert.equal(w.document.state.sound.enabled,true);
  assert.equal((await call({pass:'common'},revision)).error.code,'REVISION_CONFLICT');
  assert.equal((await call({pass:'other'})).status,'failed');
  w.setChannel('image',0,{kind:'buffer',pass:'buffer-c'});assert.ok(codeTabs(w.document.state).includes('buffer-c'));
  w.document.setCode('common','const X=1;');w.document.setCode('common','');assert.ok(codeTabs(w.document.state).includes('common'));
 }finally{await w.dispose();}
});

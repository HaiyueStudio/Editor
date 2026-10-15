import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {largePsd} from './large-fixture.mjs';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';

const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'imageEditor/artifacts/interaction-p0');
mkdirSync(out,{recursive:true});
const file=resolve(out,'background.psd');writeFileSync(file,largePsd(9001,65));
const ready=`Boolean(globalThis.haiyueEditor&&document.querySelector('#app')?.getAttribute('aria-busy')==='false')`;
const report=await runEditorBrowserScenario({root,route:'imageEditor/app-dist/index.html',readinessExpression:ready,downloadDirectory:out,failureScreenshotPath:resolve(out,'failure.png'),timeoutMs:120000,scenario:async driver=>{
 const {evaluate,waitFor,click,cdp}=driver;
 // Hold completion, not the physical operation. A foreground frame must remain
 // independent even when a background promise never settles until the test releases it.
 await cdp.call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
  globalThis.gpuErrors=[];globalThis.holdWrites=true;globalThis.heldWrites=[];
  globalThis.holdMaps=false;globalThis.heldMaps=[];globalThis.holdCompression=false;globalThis.heldCompression=[];globalThis.terminatedCompression=0;
  const request=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(...args){const d=await request.apply(this,args);d.addEventListener('uncapturederror',e=>gpuErrors.push(e.error.message));return d;};
  const transaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(stores,...args){const tx=transaction.call(this,stores,...args);if(this.name!=='haiyue.image-preview.v1'||!Array.isArray(stores)||!stores.includes('meta'))return tx;
   return new Proxy(tx,{get(t,k){const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;},set(t,k,v){if(k==='oncomplete'&&typeof v==='function'){t.oncomplete=e=>{if(holdWrites)heldWrites.push(()=>v.call(t,e));else v.call(t,e);};return true;}return Reflect.set(t,k,v,t);}});
  };
  const map=GPUBuffer.prototype.mapAsync;GPUBuffer.prototype.mapAsync=function(...args){const pending=map.apply(this,args);return holdMaps?pending.then(()=>new Promise(resolve=>heldMaps.push(resolve))):pending;};
  const post=Worker.prototype.postMessage,terminate=Worker.prototype.terminate,compressors=new WeakSet();
  Worker.prototype.postMessage=function(value,...args){if(value?.kind==='preview-compress'){compressors.add(this);if(holdCompression){heldCompression.push(this);return;}}return post.call(this,value,...args);};
  Worker.prototype.terminate=function(){if(compressors.has(this)){terminatedCompression++;compressors.delete(this);}return terminate.call(this);};
 })();`});
 const timeOrigin=await evaluate('performance.timeOrigin');await cdp.call('Page.reload');await waitFor(()=>evaluate(`performance.timeOrigin!==${timeOrigin}&&${ready}`),'instrumented page');
 const metrics=()=>evaluate(`JSON.parse(document.querySelector('#image-canvas').dataset.renderer||'{}')`);
 const paint=()=>waitFor(()=>evaluate(`document.querySelector('#image-canvas').dataset.painting==='false'`),'paint');
 async function foreground(action){const before=(await metrics()).frame,start=await evaluate('performance.now()');await click(`document.querySelector('[data-action=${action}]')`);await waitFor(async()=>(await metrics()).frame>before,'foreground preempts background',2000);await paint();const frame=await metrics(),elapsedMs=await evaluate(`performance.now()-${start}`);assert.equal(frame.architecture,'gpu-resident');assert.equal(frame.frameWork.duplicateComposedTiles,0);assert.equal(frame.frameWork.readbacksBeforePresent,0);assert(elapsedMs<2000);return {elapsedMs,frame};}
 async function opacity(value){await evaluate(`(async()=>{const a=haiyueEditor.listDocuments(),d=a.documents.find(d=>d.identity.id===a.activeId),q=await haiyueEditor.execute({apiVersion:'1',requestId:crypto.randomUUID(),operation:'image.document.query',documentId:d.identity.id,params:{}});if(q.status!=='completed')throw Error(JSON.stringify(q));const r=await haiyueEditor.execute({apiVersion:'1',requestId:crypto.randomUUID(),operation:'image.layer.update',documentId:d.identity.id,expectedRevision:d.revision,params:{layerId:q.value.layers[0].id,patch:{opacity:${value}}}});if(r.status!=='completed')throw Error(JSON.stringify(r));})()`);await paint();}

 await driver.setFileInputFiles('#open-input',[file]);await waitFor(()=>evaluate(`document.querySelector('#psd-import-dialog').open`),'PSD dialog');await click(`document.querySelector('#psd-import-layers')`);await paint();
 await waitFor(()=>evaluate('heldWrites.length>0'),'held persistent write');
 const persistence=await foreground('actual');assert(await evaluate('heldWrites.length>0'),'write must still be unresolved');
 await evaluate('holdWrites=false;heldWrites.splice(0).forEach(release=>release());');

 await evaluate('holdMaps=true;');await opacity(.8);await waitFor(()=>evaluate('heldMaps.length>0'),'held GPU readback');
 await evaluate('holdMaps=false;');const mapping=await foreground('fit');assert(await evaluate('heldMaps.length>0'));
 await evaluate('heldMaps.splice(0).forEach(release=>release());');

 await evaluate('holdCompression=true;');await opacity(.6);await waitFor(()=>evaluate('heldCompression.length>0'),'held compression Worker');
 const terminated=await evaluate('terminatedCompression');await evaluate('holdCompression=false;');const compression=await foreground('actual');
 assert((await evaluate('terminatedCompression'))>terminated,'cancelled compression must terminate its Worker');
 await foreground('fit');await waitFor(async()=>(await metrics()).postPresent?.compressionBatches>0,'real Worker compression and persistence');
 const completed=await metrics();assert(completed.postPresent.stagingBytes<=2*1024*1024);assert(completed.postPresent.gpu.bytes<=48*1024*1024);
 assert.deepEqual(await evaluate('gpuErrors'),[]);driver.assertNoBrowserErrors();
 return {status:'passed',persistence,mapping,compression,completed,runner:{chrome:driver.chrome,angleBackend:driver.angleBackend},evidenceKind:'local-diagnostic'};
}});
writeFileSync(resolve(out,'browser.json'),JSON.stringify({...report,buildHash:JSON.parse(readFileSync(resolve(root,'imageEditor/app-dist/app-manifest.json'))).buildHash},null,2));
console.log(JSON.stringify(report,null,2));

import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'imageEditor/artifacts/gpu-preview');mkdirSync(out,{recursive:true});
const baseline=process.argv.includes('--baseline'),noGpu=process.argv.includes('--no-gpu'),benchmarkOnly=process.argv.includes('--benchmark-only');
const result=await runEditorBrowserScenario({root,route:'imageEditor/app-dist/index.html',downloadDirectory:out,timeoutMs:180000,readinessExpression:'!!globalThis.haiyueEditor && document.querySelector("#app").getAttribute("aria-busy")==="false"',scenario:async({evaluate,click,waitFor,setFileInputFiles,cdp,assertNoBrowserErrors})=>{
 if(noGpu)await evaluate('Object.defineProperty(navigator.gpu,"requestAdapter",{value:async()=>null})');
 await evaluate(`globalThis.visibleTileWrites=0;const put=CanvasRenderingContext2D.prototype.putImageData;CanvasRenderingContext2D.prototype.putImageData=function(...args){if(this.canvas.id==='image-canvas')visibleTileWrites++;return put.apply(this,args);};if(globalThis.GPUAdapter){const request=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(...a){globalThis.testDevice=await request.apply(this,a);return testDevice;};}globalThis.seq=0;globalThis.call=async(operation,params={})=>{const list=haiyueEditor.listDocuments(),d=list.documents.find(d=>d.identity.id===list.activeId);const r=await haiyueEditor.execute({apiVersion:'1',requestId:'gpu-'+(++seq),operation:'image.'+operation,params,documentId:d.identity.id,expectedRevision:d.revision});if(r.status!=='completed')throw Error(JSON.stringify(r));return r.value;};globalThis.frames=[];document.querySelector('#viewport').addEventListener('image-painted',()=>frames.push({time:performance.now(),status:document.querySelector('#image-canvas').dataset.renderer}));`);
 await setFileInputFiles('#open-input',['/Users/qingque/Desktop/psd/3d-preview-mockup.psd']);await waitFor(()=>evaluate('document.querySelector("#psd-import-dialog").open'),'import',60000);await click('document.querySelector("#psd-import-layers")');await waitFor(()=>evaluate('haiyueEditor.listDocuments().documents.length===1 && document.querySelector("#image-canvas").dataset.painting==="false"'),'paint',60000);
 const q=await evaluate('call("document.query")');const layer=q.layers.find(l=>l.content?.type==='smart');
 await evaluate('globalThis.testDevice?.queue.onSubmittedWorkDone()');
 const samples=[];for(let i=0;i<4;i++)samples.push(await evaluate(`(async()=>{frames.length=0;const start=performance.now();await call('layer.update',{layerId:${JSON.stringify(layer.id)},patch:{opacity:${i%2?.85:.7}}});while(document.querySelector('#image-canvas').dataset.painting==='true')await new Promise(r=>setTimeout(r,5));if(globalThis.testDevice)await testDevice.queue.onSubmittedWorkDone();return {ms:performance.now()-start,frames:[...frames],renderer:document.querySelector('#image-canvas').dataset.renderer};})()`));
 if(!baseline&&!noGpu)for(const s of samples){assert.equal(JSON.parse(s.renderer).backend,'haiyue-webgpu');assert.equal(JSON.parse(s.renderer).composition,'gpu');assert.equal(JSON.parse(s.renderer).uploadedBytes,0);assert.equal(s.frames.length,1);}
 const checks=[];
 if(!baseline&&!noGpu&&!benchmarkOnly){
  await evaluate(`globalThis.captureFrame=false;globalThis.lastPixels=null;document.querySelector('#viewport').addEventListener('image-painted',()=>{if(!captureFrame)return;const source=document.querySelector('#gpu-image-canvas'),c=document.createElement('canvas');c.width=source.width;c.height=source.height;const ctx=c.getContext('2d');ctx.drawImage(source,0,0);lastPixels=ctx.getImageData(0,0,c.width,c.height).data;c.width=c.height=1;});globalThis.compareReference=async()=>{const r=await call('document.export',{format:'png',embedProfile:false});const bitmap=await createImageBitmap(new Blob([haiyueEditor.readResource(r.resourceId)],{type:'image/png'}));haiyueEditor.releaseResource(r.resourceId);const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const p=ctx.getImageData(0,0,c.width,c.height).data;if(!lastPixels||p.length!==lastPixels.length)throw Error("Preview dimensions differ from export: "+lastPixels?.length+" / "+p.length);let sum=0,max=0;for(let i=0;i<p.length;i++){const diff=Math.abs(p[i]-lastPixels[i]);sum+=diff;max=Math.max(max,diff);}c.width=c.height=1;return {mean:sum/p.length,max};};captureFrame=true;`);
  const paint=()=>waitFor(()=>evaluate('document.querySelector("#image-canvas").dataset.painting==="false"'),'complete frame',60000);
  await evaluate(`call('layer.update',{layerId:${JSON.stringify(layer.id)},patch:{x:${layer.x+9},opacity:.65}})`);await paint();
  checks.push({kind:'move and opacity',difference:await evaluate('compareReference()')});
  for(const blend of ['multiply','screen','overlay','darken','lighten','hard-light','difference','exclusion']){
   await evaluate(`call('layer.update',{layerId:${JSON.stringify(layer.id)},patch:{blend:${JSON.stringify(blend)}}})`);await paint();checks.push({kind:blend,difference:await evaluate('compareReference()')});
  }
  for(const c of checks){assert(c.difference.mean<.3,JSON.stringify(c));assert(c.difference.max<=3,JSON.stringify(c));}
  await evaluate(`call('layer.update',{layerId:${JSON.stringify(layer.id)},patch:{blend:'normal'}})`);await paint();
  // An effect uses the reference compositor but still presents exactly one GPU frame.
  await evaluate(`call('layer.styles',{layerId:${JSON.stringify(layer.id)},styles:{enabled:true,overlay:{color:'#cc3355',opacity:.5}}})`);await paint();
  assert.equal(await evaluate('JSON.parse(document.querySelector("#image-canvas").dataset.renderer).composition'),'reference');
  checks.push({kind:'reference effect',difference:await evaluate('compareReference()')});assert.equal(checks.at(-1).difference.max,0);
  await evaluate(`call('history.undo')`);await paint();
  // Interrupt an awaited reference render with a newer document revision; stale work must not publish.
  await evaluate(`(async()=>{await call('layer.styles',{layerId:${JSON.stringify(layer.id)},styles:{enabled:true,overlay:{color:'#cc3355',opacity:.5}}});await call('history.undo');await call('layer.update',{layerId:${JSON.stringify(layer.id)},patch:{x:${layer.x+12}}});})()`);await paint();
  checks.push({kind:'superseded reference render',difference:await evaluate('compareReference()')});assert(checks.at(-1).difference.max<=3);
  const dimensions=await evaluate('({width:document.querySelector("#gpu-image-canvas").width,height:document.querySelector("#gpu-image-canvas").height})');
  const resizeFrame=await evaluate('JSON.parse(document.querySelector("#image-canvas").dataset.renderer).frame');
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1200,height:850,deviceScaleFactor:1,mobile:false});await waitFor(()=>evaluate(`document.querySelector('#image-canvas').dataset.painting==='false' && JSON.parse(document.querySelector('#image-canvas').dataset.renderer).frame>${resizeFrame}`),'resized GPU surface');
  assert.deepEqual(await evaluate('({width:document.querySelector("#gpu-image-canvas").width,height:document.querySelector("#gpu-image-canvas").height})'),dimensions);
  // Losing the device must recreate through HaiyueEngine and redraw the current document.
  const frame=await evaluate('JSON.parse(document.querySelector("#image-canvas").dataset.renderer).frame');
  await evaluate('testDevice.destroy()');await waitFor(()=>evaluate(`document.querySelector('#image-canvas').dataset.painting==='false' && JSON.parse(document.querySelector('#image-canvas').dataset.renderer).frame>${frame}`),'device recovery',60000);
  checks.push({kind:'device recovery',difference:await evaluate('compareReference()')});
  assert(checks.at(-1).difference.max<=3);
 }
 if(!baseline)assert.equal(await evaluate('visibleTileWrites'),0,'no visible tile writes');
 if(noGpu)for(const s of samples){assert.equal(JSON.parse(s.renderer).backend,'canvas2d');assert.equal(s.frames.length,1);}
 const screenshot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,baseline?'baseline.png':noGpu?'fallback.png':'gpu.png'),Buffer.from(screenshot.result.data,'base64'));assertNoBrowserErrors();return {samples,checks};}});
result.generatedAt=new Date().toISOString();result.buildHash=JSON.parse(readFileSync(resolve(root,'imageEditor/app-dist/app-manifest.json'))).buildHash;
writeFileSync(resolve(out,baseline?'baseline.json':noGpu?'fallback.json':benchmarkOnly?'benchmark.json':'gpu.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));

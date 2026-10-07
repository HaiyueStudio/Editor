import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEditorBrowserScenario } from '../../scripts/editor-e2e/browserDriver.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=resolve(root,'imageEditor/artifacts/p4');mkdirSync(out,{recursive:true});
const report=await runEditorBrowserScenario({root,route:'imageEditor/app-dist/index.html',downloadDirectory:out,timeoutMs:30000,readinessExpression:'document.querySelector("#app")?.getAttribute("aria-busy")==="false"',scenario:async driver=>{
 const cases=await driver.evaluate(`(async()=>{
  const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports:{'@haiyue/editor-platform':'/editor-platform/dist/index.js','@haiyue/editor-plugin-sdk':'/editor-plugin-sdk/dist/index.js'}});document.head.append(map);
  const {CanvasView,bitmapCanvas,bitmapCacheStats,clearBitmapCache}=await import('/imageEditor/dist/canvasView.js');
  const cases=[];const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:#222;z-index:99999;overflow:hidden';document.body.append(host);
  const artboard=document.createElement('div');artboard.style.cssText='position:absolute;top:50%;left:50%;transform-origin:center';host.append(artboard);
  const canvas=document.createElement('canvas');artboard.append(canvas);
  const make=(id,width,height,color)=>({id,name:id,kind:'pixel',visible:true,locked:false,opacity:1,blend:'normal',x:0,y:0,children:[],bitmap:{width,height,data:new Uint8ClampedArray(width*height*4).fill(color)}});
  for(const [size,count] of [[2048,20],[4096,50]]){
   const layers=[make('base',size,size,255),...Array.from({length:count-1},(_,i)=>({...make('sprite-'+i,64,64,i+1),x:i*30,y:i*25}))];
   const state={id:'canvas-'+size,name:'benchmark',width:size,height:size,layers,selectedId:'base',revision:1};
   const view=new CanvasView(host,artboard,canvas,()=>{});const start=performance.now();view.setDocument(state);const renderMs=performance.now()-start;
   const selectionStart=performance.now();view.setDocument({...state,revision:2,selection:{x:0,y:0,width:20,height:20}});const selectionMs=performance.now()-selectionStart;
   const intervals=[];let previous=await new Promise(requestAnimationFrame);
   for(let i=0;i<30;i++){view.zoom(.15+i*.005);const now=await new Promise(requestAnimationFrame);intervals.push(now-previous);previous=now;}
   const pixel=Array.from(canvas.getContext('2d').getImageData(size-1,size-1,1,1).data),cache=bitmapCacheStats();view.dispose();
   cases.push({canvas:[size,size],layers:count,layout:'one full canvas plus 64x64 sprites',initialRenderMs:renderMs,selectionRefreshMs:selectionMs,zoom:{frames:30,meanFrameMs:intervals.reduce((a,b)=>a+b,0)/30,maxFrameMs:Math.max(...intervals)},pixel,cache,residual:bitmapCacheStats(),disposedCanvas:[canvas.width,canvas.height]});
  }
  clearBitmapCache();let first;
  for(let i=0;i<6;i++){const source=bitmapCanvas(make('cache-'+i,2048,2048,255).bitmap);if(i===0)first=source;}
  const eviction={stats:bitmapCacheStats(),evictedCanvas:[first.width,first.height]};clearBitmapCache();eviction.residual=bitmapCacheStats();host.remove();
  return {cases,eviction};
 })()`);
 for(const c of cases.cases){assert.deepEqual(c.pixel,[255,255,255,255]);assert(c.cache.bytes<=c.cache.budget);assert.equal(c.residual.bytes,0);assert.deepEqual(c.disposedCanvas,[1,1]);}
 assert(cases.eviction.stats.bytes<=cases.eviction.stats.budget);assert.deepEqual(cases.eviction.evictedCanvas,[1,1]);assert.equal(cases.eviction.residual.bytes,0);driver.assertNoBrowserErrors();
 const files=['imageEditor/src/canvasView.ts','imageEditor/dist/canvasView.js','imageEditor/test/p4-canvas-browser.mjs'];
 return {schemaVersion:1,status:'passed',classification:'isolated compiled renderer contract and local frame diagnostic; not a cross-device FPS gate',generatedAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:true,buildHash:JSON.parse(readFileSync(resolve(root,'imageEditor/app-dist/app-manifest.json'))).buildHash,runner:{chrome:driver.chrome,platform:process.platform,arch:process.arch},browser:await driver.evaluate('navigator.userAgent'),...cases,sourceFingerprints:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(resolve(root,f))).digest('hex')]))};
}});writeFileSync(resolve(out,'canvas.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases.length}));

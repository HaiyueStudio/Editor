import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runEditorBrowserScenario} from '../../scripts/editor-e2e/browserDriver.mjs';
import {clockExample} from '../dist/clockExample.js';
const root=resolve(import.meta.dirname,'../..'),out=resolve(root,'shaderEditor/artifacts/clock');mkdirSync(out,{recursive:true});
const report=await runEditorBrowserScenario({root,route:'shaderEditor/app-dist/index.html#editor',downloadDirectory:out,failureScreenshotPath:resolve(out,'failure.png'),timeoutMs:60000,
readinessExpression:'shaderEditor.getStatus()?.ready && !document.getElementById("compile").disabled',
scenario:async({evaluate,click,waitFor,cdp,nextPaint})=>{
 const call=async(operation,params={})=>{const r=await evaluate('(async()=>{const d=haiyueEditor.listDocuments().documents[0];return haiyueEditor.execute({apiVersion:"1",requestId:crypto.randomUUID(),documentId:d.identity.id,expectedRevision:d.revision,operation:'+JSON.stringify(operation)+',params:'+JSON.stringify(params)+'});})()');assert.equal(r.status,'completed',JSON.stringify(r));return r.value;};
 const open=async(p)=>{await evaluate('shaderEditor.open('+JSON.stringify(p)+')');await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'clock compiles');assert.deepEqual((await call('shader.query')).diagnostics.filter(d=>d.severity==='error'),[]);await call('shader.playback.set',{playing:false});await call('shader.playback.step');};
 const read=async()=>{const r=await call('shader.image.read');return evaluate('(()=>{const b=Array.from(haiyueEditor.readResource('+JSON.stringify(r.resourceId)+'));haiyueEditor.releaseResource('+JSON.stringify(r.resourceId)+');return {width:'+r.width+',height:'+r.height+',pixels:b};})()');};
 const at=(r,x,y)=>{const side=Math.min(r.width,r.height),ix=Math.round((x*side+r.width)/2-.5),iy=Math.round((r.height-y*side)/2-.5);return r.pixels.slice((iy*r.width+ix)*4,(iy*r.width+ix)*4+4);};
 const hands=(r,seconds)=>{
  const sec=seconds%60,min=Math.floor(seconds/60)%60+sec/60,hour=Math.floor(seconds/3600)%12+min/60;
  for(const [angle,extent,accept,name]of[[hour/12*Math.PI*2,.25,c=>c[0]>170&&c[1]>170&&c[2]>140,'hour'],[min/60*Math.PI*2,.43,c=>c[1]>160&&c[1]>c[0]*1.5,'minute'],[sec/60*Math.PI*2,.60,c=>c[0]>170&&c[0]>c[1]*1.8,'second']]){
   const x=Math.sin(angle)*extent,y=Math.cos(angle)*extent+.035,side=Math.min(r.width,r.height);let found=false;
   for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++)if(accept(at(r,x+dx*2/side,y+dy*2/side)))found=true;
   assert.ok(found,JSON.stringify({name,seconds,point:[x,y],color:at(r,x,y)}));
  }
 };
 const digits=r=>{
  const masks=[63,6,91,79,102,109,125,7,127,111],positions=[[0,.7],[.42,.35],[.42,-.35],[0,-.7],[-.42,-.35],[-.42,.35],[0,0]],result=[];
  for(const pair of [-.17,0,.17])for(const offset of [-.62,.62]){
   let mask=0;positions.forEach(([x,y],i)=>{const c=at(r,pair+(offset+x)*.04,-.32+y*.04);if(c[1]>45&&c[1]>c[0]*1.3)mask|=1<<i;});result.push(masks.indexOf(mask));
  }return result;
 };
 const fixed=10*3600+8*60+30.5;await open(clockExample(fixed));let frame=await read();hands(frame,fixed);assert.deepEqual(digits(frame),[1,0,0,8,3,0]);
 const rendered=await call('shader.image.read');
 const png=await evaluate('(()=>{const bytes=haiyueEditor.readResource('+JSON.stringify(rendered.resourceId)+');const c=document.createElement("canvas");c.width='+rendered.width+';c.height='+rendered.height+';c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(bytes),c.width,c.height),0,0);haiyueEditor.releaseResource('+JSON.stringify(rendered.resourceId)+');return c.toDataURL("image/png").split(",")[1];})()');
 writeFileSync(resolve(out,'clock-preview.png'),Buffer.from(png,'base64'));
 await nextPaint();let shot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(out,'clock.png'),Buffer.from(shot.result.data,'base64'));
 const midnight=clockExample(23*3600+59*60+59.5);midnight.common=midnight.common.replace('CLOCK_OFFSET_HOURS: f32 = 0.0','CLOCK_OFFSET_HOURS: f32 = 2.0');await open(midnight);assert.deepEqual(digits(await read()),[0,1,5,9,5,9]);
 const twelve=clockExample(13*3600+8*60+30.5);twelve.common=twelve.common.replace('CLOCK_24_HOUR: bool = true','CLOCK_24_HOUR: bool = false');await open(twelve);assert.deepEqual(digits(await read()),[0,1,0,8,3,0]);
 const midnight12=clockExample(0);midnight12.common=midnight12.common.replace('CLOCK_24_HOUR: bool = true','CLOCK_24_HOUR: bool = false');await open(midnight12);assert.deepEqual(digits(await read()),[1,2,0,0,0,0]);
 const stepped=clockExample(fixed);stepped.common=stepped.common.replace('CLOCK_STEPPED_SECONDS: bool = false','CLOCK_STEPPED_SECONDS: bool = true');await open(stepped);hands(await read(),Math.floor(fixed));
 // Supply a deterministic browser-local wall clock. Only the test changes Date.
 await evaluate('window.__clockDate=Date;window.__clockNow=new Date(2026,9,16,10,8,30,500).getTime();window.Date=class extends window.__clockDate{constructor(...a){super(...(a.length?a:[window.__clockNow]));}static now(){return window.__clockNow;}};');
 try{
  await open(clockExample());hands(await read(),fixed);assert.deepEqual(digits(await read()),[1,0,0,8,3,0]);
  await evaluate('window.__clockNow+=15000');await call('shader.playback.step');assert.deepEqual(digits(await read()),[1,0,0,8,4,5]);
 }finally{await evaluate('window.Date=window.__clockDate;delete window.__clockDate;delete window.__clockNow;');}
 await click('document.getElementById("nav-gallery")');await waitFor(()=>evaluate('document.querySelectorAll("#examples .card-art img").length===8'),'all eight thumbnails');
 assert.ok(await evaluate('document.querySelector("#examples [data-project=example-clock] .card-art img")?.src.startsWith("data:image/png")'));
 await click('document.querySelector("#examples [data-project=example-clock]")');await waitFor(()=>evaluate('!document.getElementById("compile").disabled'),'Gallery clock opens');
 assert.match(await evaluate('shaderEditor.getProject().common'),/CLOCK_DEMO_SECONDS: f32 = -1\.000/,'Gallery opens the live clock, not its fixed thumbnail');
 assert.equal(await evaluate('document.querySelectorAll("#saved-projects .shader-card").length'),0);
 return {status:'passed',checks:['Clock WGSL renders three hands at independently calculated angles','Digital HH:MM:SS reads correctly at fixed time, midnight and across timezone/12-hour settings','Jump seconds and real iDate local wall-clock updates work','Gallery has eight real GPU thumbnails and opens the unsaved live clock']};
}});console.log(JSON.stringify(report,null,2));

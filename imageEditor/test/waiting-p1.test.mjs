import test from 'node:test';
import assert from 'node:assert/strict';
import {workerTask} from '../dist/workerTask.js';
import {RasterPreviewBuilder,rasterPreview,previewLevels,rasterPreviewStats,collectRasterPreviews,adoptRasterPreviews,makePreviewLevels} from '../dist/rasterPreviews.js';
import {DiskRasterWriter} from '../dist/rasterSource.js';
import {diskPager} from '../dist/diskPager.js';
import {filterRegion,tiledFilter} from '../dist/tiledFilters.js';
import {filterLayer} from '../dist/filters.js';
import {filterState} from '../dist/filterJobs.js';
import {bitmapRegionAsync} from '../dist/diskCompositor.js';
import {makeLayer} from '../dist/document.js';
import {bitmapRegion,hydratePixels} from '../dist/pagedPixels.js';
class Worker {onmessage=null;onerror=null;terminated=0;posted=0;postMessage(){this.posted++;}terminate(){this.terminated++;}send(data){this.onmessage?.({data});}}
const pages=new Map();diskPager.store.read=async k=>pages.get(k);diskPager.store.write=async(k,b)=>pages.set(k,b.slice());
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('worker deadline tracks inactivity, progress is forwarded, completion and abort release handlers',async()=>{
 const w=new Worker(),progress=[];const p=workerTask(w,{}, {idleMs:120,report:p=>progress.push(p)});const timer=setInterval(()=>w.send({kind:'heartbeat'}),25);
 try{w.send({kind:'progress',progress:{current:2,total:5,message:'decode'}});await delay(280);w.send({ok:true,value:42});assert.equal(await p,42);assert.equal(progress.length,1);assert.equal(w.terminated,1);assert.equal(w.onmessage,null);}finally{clearInterval(timer);}
 const stalled=new Worker();await assert.rejects(workerTask(stalled,{}, {idleMs:25}),/长时间无响应/);assert.equal(stalled.terminated,1);
 const controller=new AbortController(),cancelled=new Worker(),pending=workerTask(cancelled,{}, {signal:controller.signal});const late=cancelled.onmessage;controller.abort();await assert.rejects(pending,{name:'AbortError'});late({data:{result:9}});assert.equal(cancelled.terminated,1);
 const bad=new Worker(),failure=workerTask(bad,{}, {report:()=>{throw Error('consumer');}});bad.send({kind:'progress',progress:{current:0}});await assert.rejects(failure,/consumer/);assert.equal(bad.terminated,1);
 const before=new Worker(),aborted=new AbortController();aborted.abort();await assert.rejects(workerTask(before,{}, {signal:aborted.signal}),{name:'AbortError'});assert.equal(before.posted,0);
});
test('decode-time multi-level previews keep native HDR/ink values, clone sidecars and bounded cache',async()=>{
 const writer=new DiskRasterWriter(1025,65,32),progress=[];for(let y=0;y<65;y+=32){const h=Math.min(32,65-y),b={width:1025,height:h,depth:32,data:Float32Array.from({length:1025*h*4},(_,i)=>[512.25,y+Math.floor(i/4/1025),30,255][i%4])};await writer.write(b);}
 const b=writer.finish(),levels=previewLevels(b);assert.deepEqual(levels.map(b=>b.width),[512,256,128,64]);assert.equal(levels[0].data[0],512.25);assert.equal(levels[0].depth,32);assert.equal((await bitmapRegionAsync(b,{x:1024,y:64,width:1,height:1})).data[0],512.25);
 const envelope=hydratePixels(structuredClone({value:b,previews:collectRasterPreviews({b})}));adoptRasterPreviews(envelope.previews);assert.equal(rasterPreview(envelope.value,62).width,64);
 const builder=new RasterPreviewBuilder(600,2),ink=new Float32Array(600*2*4).fill(63.5);builder.add(0,0,{width:600,height:2,depth:16,data:new Float32Array(600*2*4).fill(255),cmyk:ink});const source={width:600,height:2,depth:16,data:new Float32Array(0)};builder.finish(source);assert.equal(rasterPreview(source).cmyk[0],63.5);const square={width:1025,height:1025,depth:16,data:new Float32Array(0)},native=new RasterPreviewBuilder(1025,1025);native.add(0,0,{width:1,height:1,depth:16,data:new Float32Array([1,2,3,255]),cmyk:new Float32Array([1,2,3,4])});native.finish(square);assert.equal(rasterPreview(square).width,256);assert.equal(previewLevels(square).length,3);
 const alpha=makePreviewLevels({width:128,height:1,data:Uint8ClampedArray.from({length:512},(_,i)=>[255,0,0,Math.floor(i/4)%2?0:255][i%4])})[1];assert.equal(alpha.data[0],255);assert.equal(alpha.data[3],128);
 for(let n=0;n<30;n++){const b={width:1025,height:1025,depth:32,data:new Float32Array(0)},builder=new RasterPreviewBuilder(b.width,b.height);builder.add(0,0,{width:1,height:1,depth:32,data:new Float32Array([1,2,3,255])});builder.finish(b);}assert(rasterPreviewStats().bytes<=rasterPreviewStats().budget);
});
test('local filter preview matches exact filtering at edges and through selection; makes no writes',async()=>{
 for(const depth of [8,16,32]){const w=513,h=17,data=(depth===8?Uint8ClampedArray:Float32Array).from({length:w*h*4},(_,i)=>i%4===3?120+Math.floor(i/4)%136:(i*13)%255+(depth===32?300:.25)),bitmap={width:w,height:h,depth,data},layer={...makeLayer('pixels',bitmap),x:11,y:5},state={id:'preview',name:'preview',width:600,height:40,bitDepth:depth,layers:[layer],selectedId:layer.id,revision:1,selection:{x:20,y:7,width:260,height:12}};
  for(const settings of [{kind:'invert',amount:100},{kind:'gaussian',amount:2},{kind:'pixelate',amount:7},{kind:'usm',amount:60,radius:1.3,threshold:5}]){const rect={x:0,y:0,width:260,height:17},expected=bitmapRegion(filterLayer(state,layer.id,settings).bitmap,0,0,260,17),original=diskPager.write;let writes=0;diskPager.write=async(...a)=>{writes++;return original.apply(diskPager,a);};try{const actual=await filterRegion(state,layer.id,settings,rect);if(depth===16)for(let i=0;i<expected.data.length;i++)expected.data[i]=Math.min(255,Math.max(0,expected.data[i]));assert.equal(writes,0);for(let i=0;i<expected.data.length;i++)assert(Math.abs(actual.filtered.data[i]-expected.data[i])<.001,`${depth}/${settings.kind}/${i}`);}finally{diskPager.write=original;}}
 }
});
test('disk filter previews read bounded pixels, exact apply reports tiles and cancellation stops output',async()=>{
 const w=9001,h=33,writer=new DiskRasterWriter(w,h,8);for(let y=0;y<h;y+=32)await writer.write({width:w,height:Math.min(32,h-y),data:Uint8ClampedArray.from({length:w*Math.min(32,h-y)*4},(_,i)=>[40,90,150,255][i%4])});
 const bitmap=writer.finish(),l=makeLayer('large',bitmap),state={id:'large',name:'large',width:w,height:h,layers:[l],selectedId:l.id,revision:1,paging:{enabled:true}},settings={kind:'invert',amount:100},rect={x:8000,y:0,width:512,height:33};Object.defineProperty(state,'psdArchive',{get(){throw Error('must not read archive');}});const snapshot=filterState(state,l.id);assert(!Object.hasOwn(snapshot,'psdArchive'));
 const out=await filterRegion(snapshot,l.id,settings,rect);assert.deepEqual(Array.from(out.filtered.data.slice(0,4)),[215,165,105,255]);assert.equal(out.filtered.width,512);
 const abort=new AbortController(),progress=[];await assert.rejects(tiledFilter(snapshot,l.id,settings,abort.signal,p=>{progress.push(p);abort.abort();}),{name:'AbortError'});assert.equal(progress.length,1);assert.equal(progress[0].total,36);assert.deepEqual(Array.from((await bitmapRegionAsync(bitmap,{x:8000,y:0,width:1,height:1})).data),[40,90,150,255]);
});
test('merged previews seek bounded Raw/RLE rows in PSD and PSB without changing native precision',async()=>{
 const {mergedPsdPreview}=await import('../dist/mergedPsdPreview.js');
 for(const depth of [8,16,32]){const width=1025,height=700,row=width*depth/8,bytes=new Uint8Array(2+row*height*3),v=new DataView(bytes.buffer);for(let c=0;c<3;c++)for(let i=0;i<width*height;i++){const p=2+(c*width*height+i)*depth/8;if(depth===8)bytes[p]=40+c*50;else if(depth===16)v.setUint16(p,(40+c*50)*257+64);else v.setFloat32(p,2.125+c);}
  let read=0;const source={size:bytes.length,async read(at,n,signal){signal?.throwIfAborted();read+=n;return bytes.slice(at,at+n);}},b=await mergedPsdPreview(source,0,width,height,3,depth,false,false);assert.equal(b.width,512);assert(read<bytes.length*.6);assert(Math.abs(b.data[0]-(depth===32?2.125*255:depth===16?40+64/257:40))<.001);assert.equal(b.depth??8,depth);assert.equal(await mergedPsdPreview(source,0,width,height,4,depth,false,false),undefined);}
 for(const large of [false,true]){const width=1025,height=7,unit=large?4:2,row=[];for(let x=0;x<width;x+=128)row.push(257-Math.min(128,width-x),77);const bytes=new Uint8Array(2+3*height*unit+3*height*row.length),v=new DataView(bytes.buffer);v.setUint16(0,1);for(let i=0;i<height*3;i++){if(large)v.setUint32(2+i*unit,row.length);else v.setUint16(2+i*unit,row.length);bytes.set(row,2+3*height*unit+i*row.length);}const source={size:bytes.length,async read(at,n){return bytes.slice(at,at+n);}},b=await mergedPsdPreview(source,0,width,height,3,8,false,large);assert.deepEqual(Array.from(b.data.slice(-4)),[77,77,77,255]);}
});

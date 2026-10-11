import test from 'node:test';
import assert from 'node:assert/strict';
import {GpuDisplayPyramid,gpuFrameWorkingSet} from '../dist/gpuDisplayPyramid.js';
import {GpuTileResources} from '../dist/gpuTileResources.js';
import {RenderWorkQueue,abortable,backgroundTurn} from '../dist/renderWork.js';
import {PreviewCompression} from '../dist/previewCompression.js';
import {makeLayer} from '../dist/document.js';
import {planView} from '../dist/largeImageTiles.js';

globalThis.GPUTextureUsage={TEXTURE_BINDING:1,RENDER_ATTACHMENT:2,COPY_SRC:4,COPY_DST:8};
globalThis.GPUBufferUsage={COPY_DST:1,MAP_READ:2};globalThis.GPUMapMode={READ:1};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function device(){
 const pass={setPipeline(){},setBindGroup(){},draw(){},end(){}};
 return {queue:{submit(){},writeTexture(){}},createTexture(){return {createView(){return {};},destroy(){}};},createShaderModule(){return {};},createRenderPipelineAsync:async()=>({getBindGroupLayout(){return {};}}),createBindGroup(){return {};},createCommandEncoder(){return {beginRenderPass:()=>pass,copyTextureToTexture(){},copyTextureToBuffer(){},finish(){return {};}};}};
}
function pyramid(width=20000,height=12000,cache){
 const layer=makeLayer('pixels',{width,height,data:new Uint8ClampedArray(0)}),state={id:'p0',name:'P0',width,height,revision:1,selectedId:layer.id,layers:[layer]};
 return new GpuDisplayPyramid(device(),state,{async compose(){}},cache);
}
const rectangle=(x,y,w,h,level=0)=>Array.from({length:w*h},(_,i)=>({level,x:x+i%w,y:y+Math.floor(i/w)}));
async function frame(p,visible){p.beginFrame(visible);const leases=[];try{for(const a of visible)leases.push(await p.bordered(a,new AbortController().signal));return p.stats();}finally{leases.forEach(l=>l.release());}}

test('viewport priority re-ranks cached entries; former viewport becomes evictable',()=>{
 const pool=new GpuTileResources(device(),3*64*64*4,k=>k==='coarse'?100:0);
 for(const k of ['coarse','left','right'])pool.acquire(64,64,k).release();
 pool.prioritize(k=>k==='left'?200:0);pool.acquire(64,64,'new').release();
 assert(pool.has('left'));assert(!pool.has('coarse'));
 pool.prioritize(k=>k==='right'||k==='new'?200:0);pool.acquire(64,64,'next').release();
 assert(!pool.has('left'));assert.equal(pool.stats().allocations,3);pool.clear();
});

test('cold mip traversal and 1:1 neighboring gutters compose every leaf at most once',async()=>{
 const p=pyramid();try{
  const fit=planView(20000,12000,{x:0,y:0,width:1082,height:827,scale:1082/20000});
  const cold=await frame(p,fit.tiles);assert.equal(cold.uniqueComposedTiles,79*47);assert.equal(cold.duplicateComposedTiles,0);
  const zoom=await frame(p,rectangle(30,20,7,5));assert(zoom.uniqueComposedTiles<=9*7);assert.equal(zoom.duplicateComposedTiles,0);
  const pan=await frame(p,rectangle(31,21,7,6));assert(pan.uniqueComposedTiles<=24,'overlapping viewport cores should survive for the next pan');assert.equal(pan.duplicateComposedTiles,0);
  const warm=await frame(p,rectangle(31,21,7,6));assert.equal(warm.uniqueComposedTiles,0);
  for(const m of [cold,zoom,pan,warm])assert(m.gpu.bytes<=48*1024*1024);
 }finally{p.dispose();}
});

test('large viewport admission budgets gutter cores and scratch, including clipped document edges',async()=>{
 const p=pyramid(30000,30000),budget=48*1024*1024;
 try{for(const view of [{x:10000,y:11000,width:2048,height:2048,scale:1},{x:29800,y:29800,width:2048,height:2048,scale:.5}]){
  let plan=planView(30000,30000,view);while(gpuFrameWorkingSet(30000,30000,plan.tiles).bytes>budget)plan=planView(30000,30000,view,plan.level+1);
  assert.equal(plan.level,Math.max(0,Math.floor(Math.log2(1/view.scale))),'shared gutters must not unnecessarily lower viewport resolution');
  assert(gpuFrameWorkingSet(30000,30000,plan.tiles).bytes<=budget);
  const m=await frame(p,plan.tiles);assert.equal(m.duplicateComposedTiles,0);assert(m.gpu.bytes<=budget);
 }}finally{p.dispose();}
});

test('a pending cache write does not hold the GPU lane and cancellation cannot mark a new generation saved',async()=>{
 const write=deferred(),entered=deferred(),c=new AbortController(),queue=new RenderWorkQueue();
 const p=pyramid(256,256,{writeMany:()=>{entered.resolve();return write.promise;}});
 p.readTiles=async()=>new Map([['0/0/0',{width:1,height:1,data:new Uint8ClampedArray([1,2,3,255])}]]);
 p.prefetch=async()=>{};p.compression={encode:async entries=>entries,dispose(){}};
 const pending=p.finishFrame([],c.signal,(read,s)=>queue.run(read,s));await entered.promise;
 const failure=assert.rejects(pending,{name:'AbortError'});c.abort();
 let drew=false;await queue.run(async()=>{drew=true;p.saved.clear();},new AbortController().signal);
 assert(drew);await failure;write.resolve(true);await Promise.resolve();assert.equal(p.saved.size,0);p.dispose();
});

test('cancelled GPU mapping unmaps and releases textures before the next foreground job',async()=>{
 const p=pyramid(256,256),mapped=deferred(),started=deferred(),queue=new RenderWorkQueue(),c=new AbortController();let released=0,unmapped=0;
 p.tile=async()=>({texture:{},width:1,height:1,release(){released++;}});
 p.device.createBuffer=()=>({mapAsync(){started.resolve();return mapped.promise;},unmap(){unmapped++;mapped.reject(new Error('cancelled mapping'));},destroy(){}});
 const read=queue.run(()=>p.readTiles([{level:0,x:0,y:0}],c.signal),c.signal);await started.promise;
 const failure=assert.rejects(read,{name:'AbortError'});c.abort();
 await queue.run(async()=>{assert.equal(unmapped,1);assert.equal(released,1);},new AbortController().signal);await failure;p.dispose();
});

test('CPU-heavy background mip traversal yields to input even when every pixel read is already resolved',async()=>{
 const p=pyramid(1024,1024),c=new AbortController();let composed=0;
 p.compositor.compose=async()=>{if(++composed===1)setTimeout(()=>c.abort(),0);const start=performance.now();while(performance.now()-start<2){/* Model synchronous cached-pixel work. */}};
 p.readTiles=async()=>{const lease=await p.tile({level:p.overviewLevel,x:0,y:0},c.signal);lease.release();return new Map();};
 try{await assert.rejects(p.finishFrame([],c.signal),{name:'AbortError'});assert(composed>0&&composed<16);for(const entry of p.resources.entries)assert.equal(entry.pins,0);}
 finally{p.dispose();}
});

test('aborted queued jobs and delayed background turns never begin; failures do not poison the lane',async()=>{
 const queue=new RenderWorkQueue(),gate=deferred(),c=new AbortController();let ran=false;
 const first=queue.run(()=>gate.promise,new AbortController().signal),next=queue.run(async()=>{ran=true;},c.signal);
 const rejected=assert.rejects(next,{name:'AbortError'});c.abort();gate.reject(Error('old frame'));
 await assert.rejects(first,/old frame/);await rejected;assert(!ran);
 assert.equal(await queue.run(async()=>42,new AbortController().signal),42);
 await assert.rejects(backgroundTurn(c.signal,10000),{name:'AbortError'});
 const late=deferred(),result=abortable(late.promise,c.signal);await assert.rejects(result,{name:'AbortError'});late.reject(Error('late I/O failure'));await Promise.resolve();
});

test('compression cancellation terminates its Worker and a later frame gets a fresh Worker',async()=>{
 const previous=globalThis.Worker,workers=[];
 globalThis.Worker=class {constructor(){workers.push(this);}postMessage(message,transfer){this.message=message;this.transfer=transfer;}terminate(){this.stopped=true;}};
 const compression=new PreviewCompression(),c=new AbortController();
 try{
  const bytes=new Uint8Array([1,2,3]),pending=compression.encode([['tile',bytes]],c.signal),failure=assert.rejects(pending,{name:'AbortError'});
  assert.equal(workers[0].message.kind,'preview-compress');assert.equal(workers[0].transfer[0],bytes.buffer);c.abort();await failure;assert(workers[0].stopped);
  const fresh=compression.encode([['next',new Uint8Array([4])]],new AbortController().signal);assert.equal(workers.length,2);
  workers[1].onmessage({data:{ok:true,value:[['next',new Uint8Array([5])]]}});assert.equal((await fresh)[0][1][0],5);assert.equal(compression.completedBatches,1);
  compression.dispose();assert(workers[1].stopped);
 }finally{compression.dispose();globalThis.Worker=previous;}
});

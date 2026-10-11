import {abortable,backgroundTurn} from './renderWork.js';
import {PreviewCompression} from './previewCompression.js';
import type {Bitmap,ImageState} from './document.js';
import type {CompositeRect} from './compositor.js';
import type {PreviewCache} from './previewCache.js';
import {inflateBounded} from './pagedPixels.js';
import {DISPLAY_TILE,type TileAddress} from './largeImageTiles.js';
import {GpuRegionCompositor,residentGpuPlan} from './gpuRegionCompositor.js';
import {GpuTileResources,type TextureLease} from './gpuTileResources.js';
import {vertex} from './gpuImageRenderer.js';
const downsampleShader=vertex+`
@group(0) @binding(0) var a:texture_2d<f32>;
@group(0) @binding(1) var b:texture_2d<f32>;
@group(0) @binding(2) var c:texture_2d<f32>;
@group(0) @binding(3) var d:texture_2d<f32>;
fn reduce(t:texture_2d<f32>,p:vec2i)->vec4f {
 var rgb=vec3f(0);var alpha=0.;var n=0.;let size=vec2i(textureDimensions(t));
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){let at=p+vec2i(x,y);if(all(at<size)){let v=textureLoad(t,at,0);rgb+=v.rgb*v.a;alpha+=v.a;n+=1.;}}}
 return vec4f(select(vec3f(0),rgb/max(alpha,.000001),alpha>0),alpha/max(n,1.));
}
@fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f {
 let p=vec2i(pos.xy);let at=(p%128)*2;
 if(p.y<128){if(p.x<128){return reduce(a,at);}return reduce(b,at);}if(p.x<128){return reduce(c,at);}return reduce(d,at);
}`;
const premultiplyShader=vertex+`
@group(0) @binding(0) var source:texture_2d<f32>;
@fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f {let p=textureLoad(source,vec2i(pos.xy),0);return vec4f(p.rgb*p.a,p.a);}`;
const key=(a:TileAddress)=>`${a.level}/${a.x}/${a.y}`;
/** Account for shared gutter cores, displayed borders and recursive reduction scratch.
 * Admission uses this working set, not only the final presentation textures. */
export function gpuFrameWorkingSet(width:number,height:number,visible:readonly TileAddress[]){
 const cores=new Map<string,number>(),borders=new Set<string>(),requests=new Map<string,Set<string>>(),remaining=new Map<string,number>();
 const dimensions=(a:TileAddress)=>({width:Math.min(256,Math.ceil(width/2**a.level)-a.x*256),height:Math.min(256,Math.ceil(height/2**a.level)-a.y*256)});
 const borderBytes=new Map<string,number>();let level=0;
 for(const a of visible){
  level=Math.max(level,a.level);const k='border/'+key(a),d=dimensions(a);if(borders.has(k))continue;
  borders.add(k);borderBytes.set(k,(d.width+2)*(d.height+2)*4);const needed=new Set<string>();requests.set(k,needed);
  for(let y=Math.max(0,a.y-1);y<=a.y+1;y++)for(let x=Math.max(0,a.x-1);x<=a.x+1;x++){
   const b={level:a.level,x,y},d=dimensions(b);if(d.width<=0||d.height<=0)continue;
   const id='core/'+key(b);cores.set(id,d.width*d.height*4);needed.add(id);remaining.set(id,(remaining.get(id)??0)+1);
  }
 }
 // A core's last gutter consumer releases its priority. Count only simultaneous
 // dependencies, preserving full resolution even when their total exceeds RAM.
 const uses=new Map(remaining),live=new Set<string>();let peak=0,activeBytes=0,presentedBytes=0;
 for(const [border,needed] of requests){
  presentedBytes+=borderBytes.get(border)!;
  for(const id of needed)if(!live.has(id)){live.add(id);activeBytes+=cores.get(id)!;}
  peak=Math.max(peak,presentedBytes+activeBytes);
  for(const id of needed){const n=uses.get(id)!-1;uses.set(id,n);if(!n){live.delete(id);activeBytes-=cores.get(id)!;}}
 }
 return {cores:new Set(cores.keys()),borders,requests,remaining,bytes:peak+(3*level+2)*258*258*4};
}
/** Current viewport cores survive neighboring gutter reads; coarse intermediate
 * mips retain priority over offscreen leaves during a cold reduction traversal. */
export class GpuDisplayPyramid {
 readonly overviewLevel:number;readonly resources:GpuTileResources;
 private pipelines:Promise<GPURenderPipeline[]>|undefined;private empty:GPUTexture;
 private plan:ReturnType<typeof residentGpuPlan>;private persistentHits=0;private readbacks=0;private readbackBytes=0;private downsampled=0;private uploadedBytes=0;
 private frameSet:ReturnType<typeof gpuFrameWorkingSet>|undefined;private pendingBorders=new Set<string>();
 private backgroundSignal:AbortSignal|undefined;private backgroundYield=0;
 private compression=new PreviewCompression();private composed=new Set<string>();private duplicateCompositions=0;
 private overviewBitmap:Bitmap|undefined;private staging:GPUBuffer|undefined;private stagingBytes=0;private stagingAllocations=0;private saved=new Set<string>();
 constructor(private device:GPUDevice,private state:ImageState,private compositor:GpuRegionCompositor,private persistent?:PreviewCache){
  this.overviewLevel=Math.max(0,Math.ceil(Math.log2(Math.max(state.width,state.height)/DISPLAY_TILE)));this.plan=residentGpuPlan(state);if(!this.plan)throw Error('GPU 金字塔不支持此文档。');this.resources=new GpuTileResources(device,48*1024*1024,k=>{const [kind,level]=k.split('/');return Number(level)+(kind==='border'?1:0);});this.empty=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING});
 }
 beginFrame(visible:readonly TileAddress[]){
  this.frameSet=gpuFrameWorkingSet(this.state.width,this.state.height,visible);this.pendingBorders=new Set(this.frameSet.borders);
  this.composed.clear();this.duplicateCompositions=0;this.prioritize();
 }
 private prioritize(){
  const wanted=this.frameSet;
  this.resources.prioritize(k=>wanted?.borders.has(k)?2000:wanted?.cores.has(k)?(!this.pendingBorders.size||wanted.remaining.get(k)!>0?1000:500):Number(k.split('/')[1])+(k.startsWith('border/')?1:0));
 }
 private completeBorder(k:string){
  if(!this.pendingBorders.delete(k))return;
  for(const id of this.frameSet!.requests.get(k)!)this.frameSet!.remaining.set(id,this.frameSet!.remaining.get(id)!-1);
  this.prioritize();
 }
 stats(){return {uniqueComposedTiles:this.composed.size,duplicateComposedTiles:this.duplicateCompositions,compressionBatches:this.compression.completedBatches,residentBytes:0,budget:8*1024*1024,diskTiles:0,persistentHits:this.persistentHits,gpu:this.resources.stats(),readbacks:this.readbacks,readbackBytes:this.readbackBytes,stagingBytes:this.stagingBytes,overviewBytes:this.overviewBitmap?.data.byteLength??0,stagingAllocations:this.stagingAllocations,downsampled:this.downsampled,uploadedBytes:this.uploadedBytes};}
 private dimensions(a:TileAddress){const step=2**a.level,width=Math.min(256,Math.ceil(this.state.width/step)-a.x*256),height=Math.min(256,Math.ceil(this.state.height/step)-a.y*256);if(width<1||height<1)throw Error('GPU 预览瓦片超出文档。');return {width,height};}
 private setup(){return this.pipelines??=Promise.all([downsampleShader,premultiplyShader].map(code=>{const module=this.device.createShaderModule({code});return this.device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});}));}
 update(state:ImageState,damage:readonly CompositeRect[]|undefined,persistent?:PreviewCache){
  this.state=state;this.plan=residentGpuPlan(state);this.persistent=persistent;this.saved.clear();this.overviewBitmap=undefined;
  this.resources.invalidate(k=>{if(!damage)return true;const [kind,level,x,y]=k.split('/'),size=256*2**Number(level),border=kind==='border'?2**Number(level):0;return damage.some(r=>Number(x)*size-border<r.x+r.width&&Number(y)*size-border<r.y+r.height&&(Number(x)+1)*size+border>r.x&&(Number(y)+1)*size+border>r.y);});
 }
 /** Only displayed mip requests are batched; never read a persistent entry per leaf. */
 async prefetch(addresses:readonly TileAddress[],signal:AbortSignal){
  if(!this.persistent)return;const needed=new Map<string,TileAddress>();for(const a of addresses)if(a.level>0)for(let y=Math.max(0,a.y-1);y<=a.y+1;y++)for(let x=Math.max(0,a.x-1);x<=a.x+1;x++){const b={level:a.level,x,y};if(x*256>=Math.ceil(this.state.width/2**a.level)||y*256>=Math.ceil(this.state.height/2**a.level)||this.resources.has('core/'+key(b)))continue;needed.set(key(b),b);}
  const list=[...needed];for(let start=0;start<list.length;start+=16){signal.throwIfAborted();const chunk=list.slice(start,start+16),keys=chunk.map(([k])=>k),values=await abortable(this.persistent.readMany?this.persistent.readMany(keys):Promise.all(keys.map(async k=>[k,await this.persistent!.read(k)] as const)).then(entries=>new Map(entries)),signal);signal.throwIfAborted();for(const [k,a] of chunk){const bytes=values.get(k);if(!bytes)continue;let raw:Uint8Array;const {width,height}=this.dimensions(a);try{raw=inflateBounded(bytes,width*height*4);}catch{continue;}const t=this.resources.acquire(width,height,'core/'+k);try{this.device.queue.writeTexture({texture:t.texture},raw as Uint8Array<ArrayBuffer>,{bytesPerRow:width*4},[width,height]);this.uploadedBytes+=raw.byteLength;this.persistentHits++;this.saved.add(k);}catch(error){this.resources.discard('core/'+k);throw error;}finally{t.release();}}}
 }
 async tile(a:TileAddress,signal:AbortSignal):Promise<TextureLease>{
  if(signal===this.backgroundSignal&&performance.now()-this.backgroundYield>=8){await backgroundTurn(signal);this.backgroundYield=performance.now();}
  signal.throwIfAborted();const k='core/'+key(a),cached=this.resources.get(k);if(cached)return cached;const {width,height}=this.dimensions(a),children:TextureLease[]=[];let target:TextureLease|undefined,complete=false;
  try{
   if(a.level===0){target=this.resources.acquire(width,height,k);await this.compositor.compose(this.state,{x:a.x*256,y:a.y*256,width,height},target.texture,signal,this.plan);if(this.composed.has(k))this.duplicateCompositions++;this.composed.add(k);}
   else{const views:GPUTextureView[]=[];for(let y=0;y<2;y++)for(let x=0;x<2;x++){const child={level:a.level-1,x:a.x*2+x,y:a.y*2+y};if(child.x*256>=Math.ceil(this.state.width/2**child.level)||child.y*256>=Math.ceil(this.state.height/2**child.level)){views.push(this.empty.createView());continue;}const t=await this.tile(child,signal);children.push(t);views.push(t.texture.createView());}
    const [pipeline]=await this.setup();signal.throwIfAborted();target=this.resources.acquire(width,height,k);const encoder=this.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:target.texture.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});pass.setPipeline(pipeline!);pass.setBindGroup(0,this.device.createBindGroup({layout:pipeline!.getBindGroupLayout(0),entries:views.map((resource,binding)=>({binding,resource}))}));pass.draw(3);pass.end();this.device.queue.submit([encoder.finish()]);this.downsampled++;
   }signal.throwIfAborted();complete=true;return target!;
  }finally{for(const c of children)c.release();if(!complete){this.resources.discard(k);target?.release();}}
 }
 async bordered(a:TileAddress,signal:AbortSignal):Promise<TextureLease>{
  const k='border/'+key(a),cached=this.resources.get(k);if(cached){this.completeBorder(k);return cached;}const center=this.dimensions(a),width=center.width+2,height=center.height+2,mw=Math.ceil(this.state.width/2**a.level),mh=Math.ceil(this.state.height/2**a.level),parts=new Map<string,TextureLease>();let raw:TextureLease|undefined,target:TextureLease|undefined,complete=false;
  try{
   // Nine rectangular copies cover the center and neighbor gutters, including clamped edges.
   const spans=(start:number,count:number,limit:number)=>{const result:{out:number;at:number;count:number}[]=[];for(let out=0;out<count;){const at=Math.max(0,Math.min(limit-1,start+out-1));let n=1;while(out+n<count&&Math.max(0,Math.min(limit-1,start+out+n-1))===at+n&&Math.floor((at+n)/256)===Math.floor(at/256))n++;result.push({out,at,count:n});out+=n;}return result;},xs=spans(a.x*256,width,mw),ys=spans(a.y*256,height,mh);
   for(const y of ys)for(const x of xs){const address={level:a.level,x:Math.floor(x.at/256),y:Math.floor(y.at/256)},id=key(address);if(!parts.has(id))parts.set(id,await this.tile(address,signal));}
   const [,pipeline]=await this.setup();signal.throwIfAborted();raw=this.resources.acquire(width,height);target=this.resources.acquire(width,height,k);const encoder=this.device.createCommandEncoder();for(const y of ys)for(const x of xs){const t=parts.get(key({level:a.level,x:Math.floor(x.at/256),y:Math.floor(y.at/256)}))!;encoder.copyTextureToTexture({texture:t.texture,origin:[x.at%256,y.at%256]},{texture:raw.texture,origin:[x.out,y.out]},[x.count,y.count]);}
   const pass=encoder.beginRenderPass({colorAttachments:[{view:target.texture.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});pass.setPipeline(pipeline!);pass.setBindGroup(0,this.device.createBindGroup({layout:pipeline!.getBindGroupLayout(0),entries:[{binding:0,resource:raw.texture.createView()}]}));pass.draw(3);pass.end();this.device.queue.submit([encoder.finish()]);complete=true;return target;
  }finally{for(const t of parts.values())t.release();raw?.release();if(complete)this.completeBorder(k);else{this.resources.discard(k);target?.release();}}
 }
 /** One map per bounded batch, only after presentation for navigator/cache consumers. */
 async readTiles(addresses:readonly TileAddress[],signal:AbortSignal){
  const result=new Map<string,Bitmap>();for(let start=0;start<addresses.length;start+=16){const leases:TextureLease[]=[];try{let size=0;const records=[];for(const a of addresses.slice(start,start+16)){const t=await this.tile(a,signal);leases.push(t);const stride=Math.ceil(t.width*4/256)*256;records.push({a,t,stride,offset:size});size+=stride*t.height;}if(!size)continue;if(!this.staging||this.stagingBytes<size){this.staging?.destroy();this.staging=this.device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});this.stagingBytes=size;this.stagingAllocations++;}const buffer=this.staging,encoder=this.device.createCommandEncoder();for(const {t,stride,offset} of records)encoder.copyTextureToBuffer({texture:t.texture},{buffer,offset,bytesPerRow:stride},[t.width,t.height]);signal.throwIfAborted();this.device.queue.submit([encoder.finish()]);this.readbacks++;this.readbackBytes+=size;try{await abortable(buffer.mapAsync(GPUMapMode.READ),signal);signal.throwIfAborted();const bytes=new Uint8Array(buffer.getMappedRange());for(const {a,t,stride,offset} of records){const data=new Uint8ClampedArray(t.width*t.height*4);for(let y=0;y<t.height;y++)data.set(bytes.subarray(offset+y*stride,offset+y*stride+t.width*4),y*t.width*4);result.set(key(a),{width:t.width,height:t.height,data});}}finally{buffer.unmap();}}finally{for(const t of leases)t.release();}}
  return result;
 }
 async finishFrame(visible:readonly TileAddress[],signal:AbortSignal,runGpu:<T>(read:()=>Promise<T>,signal:AbortSignal)=>Promise<T>=(read)=>read()){
  const persistent=this.persistent,overview={level:this.overviewLevel,x:0,y:0};
  const addresses=[...new Map([...visible.filter(a=>a.level>0&&!this.saved.has(key(a))),...(!this.overviewBitmap?[overview]:[])].map(a=>[key(a),a])).values()];
  try{for(let start=0;start<addresses.length;start+=8){
   await backgroundTurn(signal);const batch=addresses.slice(start,start+8);
   const bitmaps=await runGpu(async()=>{
    this.backgroundSignal=signal;this.backgroundYield=performance.now();
    try{if(batch.some(a=>a.level===overview.level))await this.prefetch([overview],signal);return await this.readTiles(batch,signal);}
    finally{this.backgroundSignal=undefined;}
   },signal);
   signal.throwIfAborted();this.overviewBitmap??=bitmaps.get(key(overview));
   if(!persistent)continue;
   const entries=[...bitmaps].filter(([k])=>!this.saved.has(k)).map(([k,b])=>[k,b===this.overviewBitmap?new Uint8Array(b.data):new Uint8Array(b.data.buffer,b.data.byteOffset,b.data.byteLength)] as const);
   const compressed=await this.compression.encode(entries,signal);signal.throwIfAborted();
   if(compressed){
    // Persistence is outside the GPU lane. An already submitted transaction may
    // finish after cancellation, but cannot mark or display a newer generation.
    if(persistent.writeMany){const saved=await abortable(persistent.writeMany(compressed),signal);signal.throwIfAborted();if(saved)for(const [k] of compressed)this.saved.add(k);}
    else for(const [k,b] of compressed){const saved=await abortable(persistent.write(k,b),signal);signal.throwIfAborted();if(saved)this.saved.add(k);}
   }
  }
  signal.throwIfAborted();return this.overviewBitmap!;
  }finally{this.compression.dispose();}
 }
 dispose(){this.compression.dispose();this.overviewBitmap=undefined;this.resources.clear();this.empty.destroy();this.staging?.destroy();this.staging=undefined;this.stagingBytes=0;}
}

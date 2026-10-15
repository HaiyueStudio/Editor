/** Bounded texture ownership for cached tiles and temporary render targets. A lease
 * pins a resource until its commands have been submitted; reuse then follows queue order. */
export interface TextureLease {texture:GPUTexture;width:number;height:number;bytes:number;release():void}
interface Entry {texture:GPUTexture;width:number;height:number;bytes:number;pins:number;used:number;key:string|undefined;rank:number}
export class GpuTileResources {
 private entries=new Set<Entry>();private keys=new Map<string,Entry>();private bytes=0;private clock=0;private allocations=0;private hits=0;private reuses=0;private evictions=0;
 constructor(private device:GPUDevice,readonly budget:number,private retention:(key:string)=>number=()=>0){}
 stats(){return {bytes:this.bytes,budget:this.budget,textures:this.entries.size,allocations:this.allocations,hits:this.hits,reuses:this.reuses,evictions:this.evictions};}
 has(key:string){return this.keys.has(key);}
 /** Re-rank existing entries as well as future allocations when the viewport changes. */
 prioritize(retention:(key:string)=>number){this.retention=retention;for(const e of this.entries)e.rank=e.key?retention(e.key):0;}
 get(key:string){const e=this.keys.get(key);if(e){this.hits++;return this.lease(e);}}
 private lease(e:Entry):TextureLease{e.pins++;e.used=++this.clock;let released=false;return {texture:e.texture,width:e.width,height:e.height,bytes:e.bytes,release:()=>{if(!released){released=true;e.pins--;e.used=++this.clock;}}};}
 acquire(width:number,height:number,key?:string):TextureLease {
  if(key){const hit=this.get(key);if(hit)return hit;}
  const bytes=width*height*4;if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>258||height>258||bytes>this.budget)throw Error('GPU 瓦片尺寸／预算无效。');
  let e=[...this.entries].find(e=>!e.pins&&!e.key&&e.width===width&&e.height===height);
  if(e)this.reuses++;else{
   while(this.bytes+bytes>this.budget){const candidate=[...this.entries].filter(e=>!e.pins).sort((a,b)=>a.rank-b.rank||a.used-b.used)[0];if(!candidate)throw Error('GPU 瓦片工作集超过预算。');this.evictions++;if(candidate.width===width&&candidate.height===height){if(candidate.key)this.discard(candidate.key);e=candidate;this.reuses++;break;}this.remove(candidate);}
   if(!e){const texture=this.device.createTexture({label:'image-tile',size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});e={texture,width,height,bytes,pins:0,used:0,key:undefined,rank:0};this.entries.add(e);this.bytes+=bytes;this.allocations++;}
  }
  if(key){e.key=key;e.rank=this.retention(key);this.keys.set(key,e);}return this.lease(e);
 }
 discard(key:string){const e=this.keys.get(key);if(e){this.keys.delete(key);e.key=undefined;e.rank=0;}}
 invalidate(test:(key:string)=>boolean){for(const key of this.keys.keys())if(test(key))this.discard(key);}
 private remove(e:Entry){e.texture.destroy();this.entries.delete(e);if(e.key)this.keys.delete(e.key);this.bytes-=e.bytes;}
 clear(){for(const e of [...this.entries])this.remove(e);}
}
/** Uniform buffers are recycled only after submit; every encoded pass retains its own values. */
export class GpuUniformPool {
 private free=new Map<number,GPUBuffer[]>();private all=new Set<GPUBuffer>();private allocations=0;private bytes=0;
 constructor(private device:GPUDevice){}
 acquire(values:Float32Array){const size=Math.ceil(values.byteLength/16)*16;let buffer=this.free.get(size)?.pop();if(!buffer){if(this.bytes+size>65536)throw Error('GPU 参数工作集超过预算。');buffer=this.device.createBuffer({size,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.all.add(buffer);this.allocations++;this.bytes+=size;}this.device.queue.writeBuffer(buffer,0,values as Float32Array<ArrayBuffer>);let released=false;return {buffer,release:()=>{if(released)return;released=true;if(!this.all.has(buffer!))return;const list=this.free.get(size)??[];list.push(buffer!);this.free.set(size,list);}};}
 stats(){return {buffers:this.all.size,bytes:this.bytes,allocations:this.allocations,budget:65536};}
 clear(){for(const b of this.all)b.destroy();this.all.clear();this.free.clear();this.bytes=0;}
}

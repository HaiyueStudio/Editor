import {compositeShader,displayShader,vertex} from './gpuImageRenderer.js';
import {gpuDisplayProfile,GPU_BLEND_MODES,GPU_POINT_FILTERS,type GpuImageLayer} from './gpuImagePlan.js';
import {bitmapRegionAsync,liveBitmapRegionAsync,compositeRegionAsync} from './diskCompositor.js';
import {colorDisplay} from './iccEngine.js';
import {regionalMaskWeight} from './maskEffects.js';
import {readDiskPixels} from './diskPager.js';
import {residentGpuPlan,residentTilePlan,gpuFilters} from './residentGpuPlan.js';
export {residentGpuPlan} from './residentGpuPlan.js';
import {GpuTileResources,GpuUniformPool,type TextureLease} from './gpuTileResources.js';
import type {ImageState,Bitmap} from './document.js';
import type {CompositeRect} from './compositor.js';
const filterShader=vertex+`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var<uniform> props:vec4f;
@fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f {
 let p=textureLoad(source,vec2i(pos.xy),0);if(p.a==0){return p;}
 let a=props.y;let lum=dot(p.rgb,vec3f(.2126,.7152,.0722));var c=p.rgb;
 switch u32(props.x){case 0u:{c+=a/100;} case 1u:{c=(c-.5)*select(1+a/100,1+a/25,a>=0)+.5;}
 case 2u:{c=lum+(c-lum)*(1+a/100);} case 3u:{c+=(lum-c)*a/100;} case 4u:{c+=(1-2*c)*a/100;} default:{} }
 c=round(clamp(c,vec3f(0),vec3f(1))*255)/255;return vec4f(mix(p.rgb,c,props.z),p.a);
}`;
const maskedShader=vertex+`
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var mask:texture_2d<f32>;
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {let at=vec2i(p.xy);let c=textureLoad(source,at,0);let m=textureLoad(mask,at,0);let weight=m.r+m.g/255.;return vec4f(c.rgb,round(c.a*weight*255)/255);}`;
const atopShader=compositeShader.replace('let a=sa+b.a*(1-sa);','let a=b.a;').replace('((1-sa)*b.a*b.rgb+(1-b.a)*sa*s.rgb+sa*b.a*blend(b.rgb,s.rgb,u32(props.w)))/a','b.rgb*(1-sa)+blend(b.rgb,s.rgb,u32(props.w))*sa');
/** Bounded batches pin only overlapping inputs. Outputs and clipping accumulators
 * stay on the GPU across submissions; resource reuse follows queue ordering. */
export class GpuRegionCompositor {
 private pipelines:Promise<GPURenderPipeline[]>|undefined;private ids=new WeakMap<object,number>();private nextId=0;
 readonly surfaces:GpuTileResources;private uniforms:GpuUniformPool;
 private curves:GPUBuffer;private profileSettings:GPUBuffer;private profile:ReturnType<typeof gpuDisplayProfile>;
 private uploadedBytes=0;private tiles=0;private submits=0;private referenceTiles=0;private referenceSources=0;private maskUploads=0;private layerPasses=0;private maxBatchLayers=0;
 constructor(private device:GPUDevice,private reference?:(state:ImageState,rect:CompositeRect,signal?:AbortSignal)=>Promise<Bitmap>){this.surfaces=new GpuTileResources(device,8*1024*1024);this.uniforms=new GpuUniformPool(device);this.curves=device.createBuffer({size:4096,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});this.profileSettings=device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});}
 stats(){return {tiles:this.tiles,uploadedBytes:this.uploadedBytes,submits:this.submits,referenceTiles:this.referenceTiles,referenceSources:this.referenceSources,maskUploads:this.maskUploads,layerPasses:this.layerPasses,maxBatchLayers:this.maxBatchLayers,sources:this.surfaces.stats(),uniforms:this.uniforms.stats()};}
 private sourceKey(b:object,r:CompositeRect){let id=this.ids.get(b);if(id===undefined){id=++this.nextId;this.ids.set(b,id);}return `${id}/${r.x}/${r.y}/${r.width}/${r.height}`;}
 private async source(identity:object,r:CompositeRect,read:()=>Promise<Bitmap>,signal?:AbortSignal){const key=this.sourceKey(identity,r),cached=this.surfaces.get(key);if(cached)return cached;const part=await read();signal?.throwIfAborted();const t=this.surfaces.acquire(r.width,r.height,key);try{this.device.queue.writeTexture({texture:t.texture},part.data as Uint8ClampedArray<ArrayBuffer>,{bytesPerRow:r.width*4},[r.width,r.height]);this.uploadedBytes+=r.width*r.height*4;return t;}catch(error){this.surfaces.discard(key);t.release();throw error;}}
 async compose(state:ImageState,r:CompositeRect,target:GPUTexture,signal?:AbortSignal,plan=residentGpuPlan(state)){
  if(!plan)throw Error('此文档需要精确参考合成。');signal?.throwIfAborted();
  const d=this.device,tile=residentTilePlan(plan,r);
  if(tile.reference){const b=this.reference?await this.reference(state,r,signal):colorDisplay(await compositeRegionAsync(state,r,signal),state);signal?.throwIfAborted();d.queue.writeTexture({texture:target},b.data as Uint8ClampedArray<ArrayBuffer>,{bytesPerRow:r.width*4},[r.width,r.height]);this.uploadedBytes+=b.data.byteLength;this.referenceTiles++;this.tiles++;return;}
  const [composite,filter,display,masked,atop]=await(this.pipelines??=Promise.all([compositeShader,filterShader,displayShader.replace('return vec4f(rgb*c.a,c.a);','return vec4f(rgb,c.a);'),maskedShader,atopShader].map(code=>{const module=d.createShaderModule({code});return d.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});})));signal?.throwIfAborted();
  const retained:TextureLease[]=[],leases:TextureLease[]=[],buffers:ReturnType<GpuUniformPool['acquire']>[]=[];
  const make=(w=r.width,h=r.height,keep=false)=>{const t=this.surfaces.acquire(w,h);(keep?retained:leases).push(t);return t.texture;},uniform=(v:number[])=>{const b=this.uniforms.acquire(new Float32Array(v));buffers.push(b);return {buffer:b.buffer};};
  let encoder=d.createCommandEncoder(),batch=0;
  const release=()=>{for(const b of buffers.splice(0))b.release();for(const t of leases.splice(0))t.release();};
  const submit=()=>{signal?.throwIfAborted();d.queue.submit([encoder.finish()]);this.submits++;this.maxBatchLayers=Math.max(this.maxBatchLayers,batch);release();encoder=d.createCommandEncoder();batch=0;};
  const pass=(to:GPUTexture,pipeline?:GPURenderPipeline,entries?:GPUBindGroupEntry[])=>{const p=encoder.beginRenderPass({colorAttachments:[{view:to.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});if(pipeline){p.setPipeline(pipeline);p.setBindGroup(0,d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:entries!}));p.draw(3);}p.end();};
  const blend=(to:GPUTexture,below:GPUTexture,source:GPUTexture,x:number,y:number,opacity:number,mode:number,isAtop=false)=>pass(to,isAtop?atop:composite,[{binding:0,resource:below.createView()},{binding:1,resource:source.createView()},{binding:2,resource:uniform([x,y,opacity,mode])}]);
  try{
   const targets=[make(r.width,r.height,true),make(r.width,r.height,true)];let output=targets[0]!;pass(output);
   // A batch holds at most four sources, masks and two scratch surfaces per layer.
   // Clipping accumulators are retained separately, independent of run length.
   const paint=async(entry:GpuImageLayer,below:GPUTexture,to:GPUTexture,opacity=entry.layer.opacity,mode=GPU_BLEND_MODES.indexOf(entry.layer.blend),isAtop=false)=>{
    if(batch===4)submit();const {layer,x,y}=entry,b=layer.bitmap!,sx=Math.max(0,r.x-x),sy=Math.max(0,r.y-y),width=Math.min(b.width-sx,r.x+r.width-x-sx),height=Math.min(b.height-sy,r.y+r.height-y-sy),rect={x:sx,y:sy,width,height},fast=gpuFilters(layer);
    const src=await this.source(fast?b:layer,rect,async()=>{if(fast)return bitmapRegionAsync(b,rect,signal);this.referenceSources++;return liveBitmapRegionAsync(layer,rect,signal);},signal);leases.push(src);let source=src.texture;
    const filters=fast?layer.smartFilters?.filter(f=>f.enabled&&f.opacity)??[]:[],mask=layer.mask&&!layer.mask.disabled?layer.mask:undefined;
    const scratch=filters.length||mask?[make(width,height),make(width,height)]:[];let step=0;
    for(const f of filters){const to=scratch[step++%2]!;pass(to,filter,[{binding:0,resource:source.createView()},{binding:1,resource:uniform([GPU_POINT_FILTERS.indexOf(f.settings.kind as typeof GPU_POINT_FILTERS[number]),f.settings.amount,f.opacity,0])}]);source=to;}
    if(mask){const m=await this.source(mask,rect,()=>readDiskPixels(()=>{const data=new Uint8ClampedArray(width*height*4);for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){const value=regionalMaskWeight(mask,sx+xx,sy+yy)*255,index=(yy*width+xx)*4;data[index]=Math.floor(value);data[index+1]=Math.round((value-Math.floor(value))*255);}this.maskUploads++;return {width,height,data};},signal),signal);leases.push(m);const to=scratch[step++%2]!;pass(to,masked,[{binding:0,resource:source.createView()},{binding:1,resource:m.texture.createView()}]);source=to;}
    blend(to,below,source,x+sx-r.x,y+sy-r.y,opacity,mode,isAtop);batch++;this.layerPasses++;
   };
   let clipTargets:GPUTexture[]|undefined;
   for(const run of tile.runs){signal?.throwIfAborted();const next=targets[output===targets[0]?1:0]!;
    if(!run.clips.length)await paint(run.base,output,next);
    else{
     clipTargets??=[make(r.width,r.height,true),make(r.width,r.height,true)];let clip=clipTargets[0]!;pass(clip);
     await paint(run.base,clip,clipTargets[1]!,1,0);clip=clipTargets[1]!;
     for(const entry of run.clips){const nextClip=clipTargets[clip===clipTargets[0]?1:0]!;await paint(entry,clip,nextClip,entry.layer.opacity,GPU_BLEND_MODES.indexOf(entry.layer.blend),true);clip=nextClip;}
     blend(next,output,clip,0,0,run.base.layer.opacity,GPU_BLEND_MODES.indexOf(run.base.layer.blend));
    }output=next;
   }
   if(plan.profile.curves.length){if(this.profile!==plan.profile){const settings=new Float32Array(16);settings.set(plan.profile.matrix);settings[12]=1;d.queue.writeBuffer(this.curves,0,plan.profile.curves as Float32Array<ArrayBuffer>);d.queue.writeBuffer(this.profileSettings,0,settings);this.profile=plan.profile;}pass(target,display,[{binding:0,resource:output.createView()},{binding:1,resource:{buffer:this.curves}},{binding:2,resource:{buffer:this.profileSettings}}]);}
   else encoder.copyTextureToTexture({texture:output},{texture:target},[r.width,r.height]);
   submit();this.tiles++;
  }finally{release();for(const t of retained)t.release();}
 }
 reset(){this.surfaces.clear();this.ids=new WeakMap();this.profile=undefined;}
 dispose(){this.reset();this.uniforms.clear();this.curves.destroy();this.profileSettings.destroy();}
}

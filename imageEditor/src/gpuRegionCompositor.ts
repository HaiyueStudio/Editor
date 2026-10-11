import {compositeShader,displayShader,vertex} from './gpuImageRenderer.js';
import {gpuImageLayers,gpuDisplayProfile,GPU_BLEND_MODES,GPU_POINT_FILTERS,type GpuImageLayer} from './gpuImagePlan.js';
import {bitmapRegionAsync} from './diskCompositor.js';
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
export function residentGpuPlan(state:ImageState){
 const layers=gpuImageLayers(state,true),profile=gpuDisplayProfile(state);
 if(!layers||!profile||layers.length>8||layers.some(l=>l.layer.mask&&!l.layer.mask.disabled))return;
 return {layers,profile};
}
/** Compose directly into a resident tile on Haiyue's device. No CPU readback.
 * Source cache survives metadata edits; temporary surfaces/uniforms follow queue submission. */
export class GpuRegionCompositor {
 private pipelines:Promise<GPURenderPipeline[]>|undefined;private ids=new WeakMap<Bitmap,number>();private nextId=0;
 readonly surfaces:GpuTileResources;private uniforms:GpuUniformPool;
 private curves:GPUBuffer;private profileSettings:GPUBuffer;private profile:ReturnType<typeof gpuDisplayProfile>;
 private uploadedBytes=0;private tiles=0;private submits=0;
 constructor(private device:GPUDevice){this.surfaces=new GpuTileResources(device,8*1024*1024);this.uniforms=new GpuUniformPool(device);this.curves=device.createBuffer({size:4096,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});this.profileSettings=device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});}
 stats(){return {tiles:this.tiles,uploadedBytes:this.uploadedBytes,submits:this.submits,sources:this.surfaces.stats(),uniforms:this.uniforms.stats()};}
 private sourceKey(b:Bitmap,r:CompositeRect){let id=this.ids.get(b);if(id===undefined){id=++this.nextId;this.ids.set(b,id);}return `${id}/${r.x}/${r.y}/${r.width}/${r.height}`;}
 private async source(b:Bitmap,r:CompositeRect,signal?:AbortSignal){const key=this.sourceKey(b,r),cached=this.surfaces.get(key);if(cached)return cached;const part=await bitmapRegionAsync(b,r,signal);signal?.throwIfAborted();const t=this.surfaces.acquire(r.width,r.height,key);try{this.device.queue.writeTexture({texture:t.texture},part.data as Uint8ClampedArray<ArrayBuffer>,{bytesPerRow:r.width*4},[r.width,r.height]);this.uploadedBytes+=r.width*r.height*4;return t;}catch(error){this.surfaces.discard(key);t.release();throw error;}}
 async compose(state:ImageState,r:CompositeRect,target:GPUTexture,signal?:AbortSignal,plan=residentGpuPlan(state)){
 if(!plan)throw Error('此文档需要精确参考合成。');
  const d=this.device,[composite,filter,display]=await(this.pipelines??=Promise.all([compositeShader,filterShader,displayShader.replace('return vec4f(rgb*c.a,c.a);','return vec4f(rgb,c.a);')].map(code=>{const module=d.createShaderModule({code});return d.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});})));signal?.throwIfAborted();
  const layers=plan.layers.filter(l=>l.x<r.x+r.width&&l.y<r.y+r.height&&l.x+l.layer.bitmap!.width>r.x&&l.y+l.layer.bitmap!.height>r.y),leases:TextureLease[]=[],buffers:ReturnType<GpuUniformPool['acquire']>[]=[];
  const make=(w=r.width,h=r.height)=>{const t=this.surfaces.acquire(w,h);leases.push(t);return t.texture;},uniform=(v:number[])=>{const b=this.uniforms.acquire(new Float32Array(v));buffers.push(b);return {buffer:b.buffer};};
  try{
   // Source uploads precede encoding. Each pass's inputs remain pinned until submit.
   const inputs:{entry:GpuImageLayer;source:GPUTexture;sx:number;sy:number;width:number;height:number}[]=[];
   for(const entry of layers){const {layer,x,y}=entry,sx=Math.max(0,r.x-x),sy=Math.max(0,r.y-y),width=Math.min(layer.bitmap!.width-sx,r.x+r.width-x-sx),height=Math.min(layer.bitmap!.height-sy,r.y+r.height-y-sy),s=await this.source(layer.bitmap!,{x:sx,y:sy,width,height},signal);leases.push(s);inputs.push({entry,source:s.texture,sx,sy,width,height});}
   const encoder=d.createCommandEncoder(),pass=(target:GPUTexture,pipeline?:GPURenderPipeline,entries?:GPUBindGroupEntry[])=>{const p=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});if(pipeline){p.setPipeline(pipeline);p.setBindGroup(0,d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:entries!}));p.draw(3);}p.end();},targets=[make(),make()];let output=targets[0]!;pass(output);
   for(const input of inputs){signal?.throwIfAborted();const {entry:{layer,x,y},sx,sy,width,height}=input;let source=input.source;const filters=layer.smartFilters?.filter(f=>f.enabled&&f.opacity)??[],filterTargets=filters.length?[make(width,height),make(width,height)]:[];
    for(let i=0;i<filters.length;i++){const f=filters[i]!,t=filterTargets[i%2]!;pass(t,filter,[{binding:0,resource:source.createView()},{binding:1,resource:uniform([GPU_POINT_FILTERS.indexOf(f.settings.kind as typeof GPU_POINT_FILTERS[number]),f.settings.amount,f.opacity,0])}]);source=t;}
    const next=targets[output===targets[0]?1:0]!;pass(next,composite,[{binding:0,resource:output.createView()},{binding:1,resource:source.createView()},{binding:2,resource:uniform([x+sx-r.x,y+sy-r.y,layer.opacity,GPU_BLEND_MODES.indexOf(layer.blend)])}]);output=next;
   }
   if(plan.profile.curves.length){if(this.profile!==plan.profile){const settings=new Float32Array(16);settings.set(plan.profile.matrix);settings[12]=1;d.queue.writeBuffer(this.curves,0,plan.profile.curves as Float32Array<ArrayBuffer>);d.queue.writeBuffer(this.profileSettings,0,settings);this.profile=plan.profile;}pass(target,display,[{binding:0,resource:output.createView()},{binding:1,resource:{buffer:this.curves}},{binding:2,resource:{buffer:this.profileSettings}}]);}
   else encoder.copyTextureToTexture({texture:output},{texture:target},[r.width,r.height]);
   signal?.throwIfAborted();d.queue.submit([encoder.finish()]);this.tiles++;this.submits++;
  }finally{for(const b of buffers)b.release();for(const t of leases)t.release();}
 }
 reset(){this.surfaces.clear();this.ids=new WeakMap();this.profile=undefined;}
 dispose(){this.reset();this.uniforms.clear();this.curves.destroy();this.profileSettings.destroy();}
}

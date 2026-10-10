import type { HaiyueEngine } from '@haiyue/engine/core';
import type { Bitmap, ImageState, ImageLayer } from './document.js';
import type { CompositeRect } from './compositor.js';
import { bitmapRegionAsync, forEachCompositeTileAsync } from './diskCompositor.js';
import { colorDisplay } from './iccEngine.js';
import { maskWeight } from './layerFeatures.js';
import { GPU_BLEND_MODES, GPU_IMAGE_BUDGET, gpuImageLayers, gpuDisplayProfile } from './gpuImagePlan.js';

const vertex=`@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}`;
const compositeShader=vertex+`
@group(0) @binding(0) var below:texture_2d<f32>;
@group(0) @binding(1) var source:texture_2d<f32>;
@group(0) @binding(2) var<uniform> props:vec4f;
fn blend(b:vec3f,s:vec3f,m:u32)->vec3f {
 switch m {case 1u:{return b*s;} case 2u:{return b+s-b*s;}
 case 3u:{return select(2*b*s,1-2*(1-b)*(1-s),b>=vec3f(.5));}
 case 4u:{return min(b,s);} case 5u:{return max(b,s);}
 case 6u:{return select(2*b*s,1-2*(1-b)*(1-s),s>=vec3f(.5));}
 case 7u:{return abs(b-s);} case 8u:{return b+s-2*b*s;} default:{return s;}}
}
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {
 let pos=vec2i(p.xy);let b=textureLoad(below,pos,0);let at=pos-vec2i(props.xy);
 if(any(at<vec2i(0))||any(at>=vec2i(textureDimensions(source)))){return b;}
 let s=textureLoad(source,at,0);let sa=s.a*props.z;let a=sa+b.a*(1-sa);
 if(sa==0||a==0){return b;}
 return vec4f(((1-sa)*b.a*b.rgb+(1-b.a)*sa*s.rgb+sa*b.a*blend(b.rgb,s.rgb,u32(props.w)))/a,a);
}`;
const displayShader=vertex+`
@group(0) @binding(0) var pixels:texture_2d<f32>;
@group(0) @binding(1) var<storage,read> curves:array<vec4f>;
struct Settings {matrix:mat3x3f,enabled:vec4f}
@group(0) @binding(2) var<uniform> settings:Settings;
fn encode(v:vec3f)->vec3f {return select(1.055*pow(max(v,vec3f(0)),vec3f(1.0/2.4))-.055,12.92*v,v<=vec3f(.0031308));}
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {
 let c=textureLoad(pixels,vec2i(p.xy),0);var rgb=c.rgb;
 if(settings.enabled.x>0){let idx=vec3i(round(rgb*255));let v=vec3f(curves[idx.r].r,curves[idx.g].g,curves[idx.b].b);rgb=clamp(encode(settings.matrix*v),vec3f(0),vec3f(1));}
 return vec4f(rgb*c.a,c.a);
}`;
interface Entry {bitmap:Bitmap;mask:ImageLayer['mask'];texture:GPUTexture;bytes:number}
function sameMask(a:ImageLayer['mask'],b:ImageLayer['mask']){return a===b||!!a&&!!b&&a.data===b.data&&a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height&&a.disabled===b.disabled&&a.defaultColor===b.defaultColor&&a.density===b.density&&a.feather===b.feather;}
/** On-demand image render system on Haiyue's device/context. No continuous engine frame loop.
 * Texture uploads never touch the swapchain; each completed frame has exactly one presentation. */
export class GpuImageRenderer {
 readonly canvas=document.createElement('canvas');
 private engine:HaiyueEngine|undefined;private initializing:Promise<void>|undefined;private unavailable=false;private disposed=false;
 private composite:GPURenderPipeline|undefined;private display:GPURenderPipeline|undefined;private curves:GPUBuffer|undefined;private settings:GPUBuffer|undefined;
 private entries=new Map<string,Entry>();private targets:GPUTexture[]=[];private size='';private documentId='';
 private profileOrigin:ImageState['psdOrigin'];private profileIcc:ImageState['icc'];private profile:ReturnType<typeof gpuDisplayProfile>;private profileSet=false;
 private serial:Promise<unknown>=Promise.resolve();private frame=0;
 constructor(private fallback:HTMLCanvasElement,private repaint:()=>void){this.canvas.id='gpu-image-canvas';this.canvas.hidden=true;Object.assign(this.canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});fallback.after(this.canvas);}
 private async initialize(){
  if(this.initializing)return this.initializing;
  this.initializing=(async()=>{
   if(!navigator.gpu)throw Error('WebGPU 不可用');
   const {HaiyueEngine}=await import('@haiyue/engine/core');if(this.disposed)return;
   const engine=new HaiyueEngine({canvas:this.canvas,renderProfile:'simple',alphaMode:'premultiplied',devicePixelRatio:()=>this.canvas.width/(this.canvas.getBoundingClientRect().width||this.canvas.width),timestampQuery:false,recoverDeviceLost:true});this.engine=engine;
   engine.on('device-lost',()=>{
    if(this.disposed||this.unavailable)return;this.release();this.composite=undefined;this.display=undefined;this.hide();
    this.fallback.dataset.renderer=JSON.stringify({backend:'canvas2d',reason:'GPU 设备丢失，正在重建'});
    this.initializing=engine.waitForRecovery().then(async()=>{if(this.disposed)return;await this.setup();this.repaint();}).catch(error=>{if(this.disposed)return;this.unavailable=true;this.fallback.dataset.renderer=JSON.stringify({backend:'canvas2d',reason:String(error)});this.repaint();});
    this.repaint();
   });
   await engine.init();if(this.disposed){engine.destroy();return;}await this.setup();engine.on('resize',()=>{if(!this.disposed)this.repaint();});
  })().catch(e=>{this.unavailable=true;this.engine?.destroy();this.engine=undefined;this.fallback.dataset.renderer=JSON.stringify({backend:'canvas2d',reason:String(e)});});
  await this.initializing;
 }
 private async setup(){
  const d=this.engine!.device;
  d.addEventListener('uncapturederror',event=>{event.preventDefault();if(this.disposed||this.unavailable||this.engine?.state!=='ready'||this.engine.device!==d)return;this.unavailable=true;this.release();this.hide();this.fallback.dataset.renderer=JSON.stringify({backend:'canvas2d',reason:event.error.message});this.repaint();});
  const make=(code:string,format:GPUTextureFormat)=>{const module=d.createShaderModule({code});return d.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});};
  [this.composite,this.display]=await Promise.all([make(compositeShader,'rgba8unorm'),make(displayShader,this.engine!.format)]);
  this.curves=d.createBuffer({size:256*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.STORAGE});this.settings=d.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 }
 render(state:ImageState,dirty:CompositeRect|undefined,signal:AbortSignal,mutable=false):Promise<boolean>{
  const job=this.serial.catch(()=>{}).then(()=>this.draw(state,dirty,signal,mutable)).catch(error=>{if(signal.aborted)throw error;this.unavailable=true;this.release();this.hide();this.fallback.dataset.renderer=JSON.stringify({backend:'canvas2d',reason:String(error)});return false;});this.serial=job;return job;
 }
 private async draw(state:ImageState,dirty:CompositeRect|undefined,signal:AbortSignal,mutable:boolean){
  signal.throwIfAborted();if(this.disposed||this.unavailable)return false;await this.initialize();signal.throwIfAborted();if(!this.engine||!this.display||!this.composite)return false;
  const d=this.engine.device,started=performance.now(),pixels=state.width*state.height;
  if(state.width>d.limits.maxTextureDimension2D||state.height>d.limits.maxTextureDimension2D||pixels*20>GPU_IMAGE_BUDGET){this.reset();this.fallback.dataset.renderer=JSON.stringify({backend:'canvas2d',reason:'GPU 显示尺寸／预算限制'});return false;}
  if(this.documentId!==state.id){this.releaseImages();this.documentId=state.id;this.profileSet=false;}
  const key=state.width+'x'+state.height;if(this.size!==key){this.releaseImages();this.canvas.width=state.width;this.canvas.height=state.height;this.size=key;for(let i=0;i<2;i++)this.targets.push(d.createTexture({size:[state.width,state.height],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}));}
  // Engine resize events use CSS bounds (including the editor zoom). The document render
  // surface always keeps exact pixel dimensions, independent of viewport size and DPR.
  if(this.canvas.width!==state.width)this.canvas.width=state.width;if(this.canvas.height!==state.height)this.canvas.height=state.height;
  if(!this.profileSet||this.profileOrigin!==state.psdOrigin||this.profileIcc!==state.icc){this.profile=gpuDisplayProfile(state);this.profileOrigin=state.psdOrigin;this.profileIcc=state.icc;this.profileSet=true;}
  let layers=gpuImageLayers(state);if(!this.profile)layers=undefined;
  if(layers&&(layers.some(l=>l.layer.bitmap!.width>d.limits.maxTextureDimension2D||l.layer.bitmap!.height>d.limits.maxTextureDimension2D)||layers.reduce((n,l)=>n+l.layer.bitmap!.width*l.layer.bitmap!.height*4,pixels*20)>GPU_IMAGE_BUDGET))layers=undefined;
  let uploadedBytes=0,output=this.targets[0]!,composition='reference';const buffers:GPUBuffer[]=[];
  try{
   if(layers){
    composition='gpu';const active=new Set(layers.map(l=>l.layer.id));for(const [id,e] of this.entries)if(!active.has(id)){e.texture.destroy();this.entries.delete(id);}
    // Finish all awaited uploads before encoding the frame. Superseded uploads are never presented.
    for(const {layer,x:layerX,y:layerY} of layers){signal.throwIfAborted();const b=layer.bitmap!,old=this.entries.get(layer.id),mutated=mutable&&layer.id===state.selectedId;
     if(old&&old.bitmap===b&&sameMask(old.mask,layer.mask)&&!mutated)continue;
     const partial=old&&old.bitmap.width===b.width&&old.bitmap.height===b.height&&sameMask(old.mask,layer.mask)&&dirty;
     const left=partial?Math.max(0,dirty.x-layerX):0,top=partial?Math.max(0,dirty.y-layerY):0,right=partial?Math.min(b.width,dirty.x+dirty.width-layerX):b.width,bottom=partial?Math.min(b.height,dirty.y+dirty.height-layerY):b.height;
     if(partial&&(right<=left||bottom<=top))continue;
     if(!partial)old?.texture.destroy();this.entries.delete(layer.id);
     const texture=partial?old.texture:d.createTexture({size:[b.width,b.height],format:'rgba8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
     try{for(let y=top;y<bottom;y+=256)for(let x=left;x<right;x+=256){const part=await bitmapRegionAsync(b,{x,y,width:Math.min(256,right-x),height:Math.min(256,bottom-y)},signal);signal.throwIfAborted();const data=new Uint8Array(part.data);if(layer.mask&&!layer.mask.disabled)for(let yy=0;yy<part.height;yy++)for(let xx=0;xx<part.width;xx++){const at=(yy*part.width+xx)*4+3;data[at]=Math.round(data[at]!*maskWeight(layer.mask,x+xx,y+yy));}d.queue.writeTexture({texture,origin:[x,y]},data,{bytesPerRow:part.width*4},[part.width,part.height]);uploadedBytes+=data.byteLength;}
      this.entries.set(layer.id,{texture,bitmap:b,mask:layer.mask,bytes:b.width*b.height*4});
     }catch(e){texture.destroy();throw e;}
    }
    const encoder=d.createCommandEncoder();const clear=encoder.beginRenderPass({colorAttachments:[{view:output.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});clear.end();
    for(const {layer,x,y} of layers){const target=this.targets[output===this.targets[0]?1:0]!;
     const uniform=d.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});buffers.push(uniform);d.queue.writeBuffer(uniform,0,new Float32Array([x,y,layer.opacity,GPU_BLEND_MODES.indexOf(layer.blend)]));
     const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});pass.setPipeline(this.composite);pass.setBindGroup(0,d.createBindGroup({layout:this.composite.getBindGroupLayout(0),entries:[{binding:0,resource:output.createView()},{binding:1,resource:this.entries.get(layer.id)!.texture.createView()},{binding:2,resource:{buffer:uniform}}]}));pass.draw(3);pass.end();output=target;
    }d.queue.submit([encoder.finish()]);
   }else{
    for(const e of this.entries.values())e.texture.destroy();this.entries.clear();
    // Reference effects/ICC retain their exact implementation; only presentation uses WebGPU.
    await forEachCompositeTileAsync(state,(b,r)=>{const display=colorDisplay(b,state);d.queue.writeTexture({texture:output,origin:[r.x,r.y]},display.data as Uint8ClampedArray<ArrayBuffer>,{bytesPerRow:r.width*4},[r.width,r.height]);uploadedBytes+=r.width*r.height*4;},signal,256);
   }
   signal.throwIfAborted();const settings=new Float32Array(16),profile=layers?this.profile:undefined;if(profile?.curves.length){settings.set(profile.matrix);settings[12]=1;d.queue.writeBuffer(this.curves!,0,profile.curves as Float32Array<ArrayBuffer>);}d.queue.writeBuffer(this.settings!,0,settings);
   const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.engine.context!.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});pass.setPipeline(this.display);pass.setBindGroup(0,d.createBindGroup({layout:this.display.getBindGroupLayout(0),entries:[{binding:0,resource:output.createView()},{binding:1,resource:{buffer:this.curves!}},{binding:2,resource:{buffer:this.settings!}}]}));pass.draw(3);pass.end();d.queue.submit([encoder.finish()]);
   // Do not await GPU completion here: navigator snapshots must happen in the same task as presentation.
   this.canvas.hidden=false;this.fallback.style.visibility='hidden';if(this.fallback.width!==state.width)this.fallback.width=state.width;if(this.fallback.height!==state.height)this.fallback.height=state.height;
   // Stable snapshot for merged-color selection and readback consumers. This is a GPU canvas copy,
   // not a second CPU layer composite; the visible surface remains the engine's WebGPU canvas.
   const snapshot=this.fallback.getContext('2d')!;snapshot.save();snapshot.setTransform(1,0,0,1,0,0);snapshot.globalAlpha=1;snapshot.globalCompositeOperation='copy';snapshot.drawImage(this.canvas,0,0);snapshot.restore();
   this.fallback.dataset.renderer=JSON.stringify({backend:'haiyue-webgpu',composition,documentId:state.id,revision:state.revision,frame:++this.frame,uploadedBytes,textureBytes:pixels*20+[...this.entries.values()].reduce((n,e)=>n+e.bytes,0),budget:GPU_IMAGE_BUDGET,ms:performance.now()-started});return true;
  }finally{for(const b of buffers)b.destroy();}
 }
 reset(){this.releaseImages();this.documentId='';this.profileSet=false;this.hide();}
 hide(){this.canvas.hidden=true;this.fallback.style.visibility='';}
 private releaseImages(){for(const e of this.entries.values())e.texture.destroy();this.entries.clear();for(const t of this.targets)t.destroy();this.targets=[];this.size='';}
 private release(){this.releaseImages();this.curves?.destroy();this.settings?.destroy();this.curves=undefined;this.settings=undefined;}
 dispose(){this.disposed=true;this.release();this.engine?.destroy();this.hide();this.canvas.remove();}
}

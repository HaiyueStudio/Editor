import type { ImageState } from './document.js';
import { forEachCompositeTileAsync } from './diskCompositor.js';
import { embeddedProfile } from './colorManagement.js';
import { linearSrgbProfile, transformBitmapIcc } from './iccEngine.js';
export interface HdrStatus { requested:'auto'|'sdr'|'hdr'; active:boolean; dynamicRange:'high'|'standard'; backend:'webgpu-extended'|'haiyue-webgpu'|'canvas2d'; reason:string;phase:'idle'|'initializing'|'ready'|'fallback';document:{id:string;revision:number;width:number;height:number}|null;configuration:{format:string;colorSpace:string;toneMapping:string}|null;adapter:{vendor:string;architecture:string;device:string;description:string}|null }
export function hdrAdmission(state:ImageState,high:boolean,gpu:boolean):string {
 if((state.display?.output??'sdr')==='sdr')return 'SDR 预览';
 if(state.bitDepth!==32)return '系统 HDR 需要 32 位线性文档';
 if(!high)return '系统当前未报告 HDR／EDR 显示能力，使用 SDR 映射';
 if(!gpu)return '当前环境没有 WebGPU，使用 SDR 映射';
 if(state.icc?.proofProfile&&state.icc.proofEnabled!==false||state.icc?.monitorProfile)return '软打样／自定义显示器配置使用 SDR 预览；HDR 显示由系统管理';
 if(state.width*state.height*8>128*1024*1024)return 'HDR 显示纹理超过 128 MiB';
 return '';
}
/** IEEE binary16, rounded to nearest; display samples are finite, positive and bounded. */
export function float16(value:number):number {
 const f=new Float32Array([Math.max(0,Math.min(65504,value))]),u=new Uint32Array(f.buffer)[0]!,exp=((u>>>23)&255)-127+15,mant=u&0x7fffff;
 if(exp<=0){if(exp< -10)return 0;const m=mant|0x800000,shift=14-exp,base=m>>>shift,rest=m&((1<<shift)-1),half=1<<(shift-1);return base+(rest>half||rest===half&&(base&1)?1:0);}
 const base=(exp<<10)|(mant>>>13),rest=mant&8191;return Math.min(0x7bff,base+(rest>4096||rest===4096&&(base&1)?1:0));
}
export class HdrDisplay {
 readonly canvas:HTMLCanvasElement;private device:GPUDevice|undefined;private context:GPUCanvasContext|undefined;private pipeline:GPURenderPipeline|undefined;private texture:GPUTexture|undefined;private pending:Promise<void>|undefined;private generation=0;private disposed=false;private dimensions='';private current:ImageState|undefined;
 private adapter:HdrStatus['adapter']=null;
 private media=matchMedia('(dynamic-range: high)');private status:HdrStatus={requested:'sdr',active:false,dynamicRange:'standard',backend:'canvas2d',reason:'SDR 预览',phase:'idle',document:null,configuration:null,adapter:null};
 constructor(private fallback:HTMLCanvasElement){this.canvas=document.createElement('canvas');this.canvas.id='hdr-canvas';this.canvas.hidden=true;Object.assign(this.canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});fallback.after(this.canvas);this.media.addEventListener('change',this.changed);}
 private changed=()=>{if(this.current)this.render(this.current);};
 private publish(active:boolean,reason:string,phase:HdrStatus['phase']=active?'ready':this.current?'fallback':'idle'){
 const config=this.context?.getConfiguration();
 this.status={requested:this.current?.display?.output??'sdr',active,dynamicRange:this.media.matches?'high':'standard',backend:active?'webgpu-extended':this.fallback.dataset.renderer?.includes('haiyue-webgpu')?'haiyue-webgpu':'canvas2d',reason,phase,document:this.current?{id:this.current.id,revision:this.current.revision,width:this.current.width,height:this.current.height}:null,configuration:config?{format:config.format,colorSpace:config.colorSpace??'srgb',toneMapping:config.toneMapping?.mode??'standard'}:null,adapter:this.adapter};
 this.canvas.hidden=!active;this.fallback.style.opacity=active?'0':'';this.fallback.dataset.hdrStatus=JSON.stringify(this.status);window.dispatchEvent(new CustomEvent('haiyue-hdr-status',{detail:this.status}));}
 private async initialize(){if(this.pending)return this.pending;if(this.device&&this.pipeline)return;this.pending=(async()=>{const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('没有可用的 WebGPU 适配器');this.adapter={vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description};const device=await adapter.requestDevice();if(this.disposed){device.destroy();return;}this.device=device;device.addEventListener('uncapturederror',e=>{e.preventDefault();if(this.disposed||this.device!==device)return;++this.generation;this.publish(false,'GPU 显示失败：'+e.error.message);});void device.lost.then(info=>{if(this.disposed||this.device!==device)return;++this.generation;this.dimensions='';this.texture=undefined;this.device=undefined;this.context=undefined;this.pipeline=undefined;this.pending=undefined;this.publish(false,'GPU 设备丢失：'+info.message);});
 const context=this.canvas.getContext('webgpu');if(!context)throw Error('无法创建 WebGPU 画布');context.configure({device,format:'rgba16float',alphaMode:'premultiplied',colorSpace:'srgb',toneMapping:{mode:'extended'}});if(context.getConfiguration()?.toneMapping?.mode!=='extended')throw Error('浏览器没有启用扩展动态范围');this.context=context;
 const module=device.createShaderModule({code:`@group(0) @binding(0) var pixels:texture_2d<f32>;
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {let positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(positions[i],0,1);}
 fn encode(v:vec3f)->vec3f{return select(1.055*pow(v,vec3f(1.0/2.4))-0.055,12.92*v,v<=vec3f(0.0031308));}
 @fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {let v=textureLoad(pixels,vec2i(p.xy),0);return vec4f(encode(max(v.rgb,vec3f(0)))*v.a,v.a);}`});
 this.pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
 })().catch(e=>{const device=this.device;this.device=undefined;this.pipeline=undefined;this.context?.unconfigure();this.context=undefined;this.pending=undefined;device?.destroy();throw e;});return this.pending;}
 render(state:ImageState){this.current=state;const generation=++this.generation,reason=hdrAdmission(state,this.media.matches,!!navigator.gpu);if(reason){this.texture?.destroy();this.texture=undefined;this.dimensions='';this.publish(false,reason);return;}this.publish(false,'正在初始化系统 HDR 显示','initializing');void this.initialize().then(async()=>{if(this.disposed||generation!==this.generation)return;const d=this.device!,ctx=this.context!;if(state.width>d.limits.maxTextureDimension2D||state.height>d.limits.maxTextureDimension2D)throw Error('画布超过 GPU 纹理尺寸');const key=state.width+'x'+state.height;if(key!==this.dimensions){this.texture?.destroy();this.canvas.width=state.width;this.canvas.height=state.height;this.texture=d.createTexture({size:[state.width,state.height],format:'rgba16float',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});this.dimensions=key;}
 const profile=embeddedProfile(state),target=linearSrgbProfile(),gain=2**(state.display?.exposure??0);
 await forEachCompositeTileAsync(state,(bitmap,rect)=>{if(this.disposed||generation!==this.generation)throw Error('HDR 画面已更新。');const b=profile?transformBitmapIcc(bitmap,profile,target,{intent:state.icc?.intent??1,bpc:state.icc?.bpc??true}):bitmap,data=Uint16Array.from(b.data,(n,i)=>float16(n/255*(i%4===3?1:gain)));d.queue.writeTexture({texture:this.texture!,origin:[rect.x,rect.y]},data,{bytesPerRow:b.width*8},[b.width,b.height]);});
 if(this.disposed||generation!==this.generation)return;const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});pass.setPipeline(this.pipeline!);pass.setBindGroup(0,d.createBindGroup({layout:this.pipeline!.getBindGroupLayout(0),entries:[{binding:0,resource:this.texture!.createView()}]}));pass.draw(3);pass.end();d.queue.submit([encoder.finish()]);await d.queue.onSubmittedWorkDone();if(this.disposed||generation!==this.generation)return;this.publish(true,'系统 HDR／EDR · rgba16float · extended');}).catch(e=>{if(generation===this.generation)this.publish(false,e instanceof Error?e.message:String(e));});}
 hide(){this.current=undefined;++this.generation;this.texture?.destroy();this.texture=undefined;this.dimensions='';this.publish(false,'没有文档');}
 dispose(){this.disposed=true;++this.generation;this.media.removeEventListener('change',this.changed);this.texture?.destroy();this.context?.unconfigure();this.device?.destroy();this.canvas.remove();this.fallback.style.opacity='';}
}

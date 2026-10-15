import { validateResampling, type Resampling } from './resampling.js';
import { makeLayer, type Bitmap, type ImageState } from './document.js';
import { compositeState } from './compositor.js';
import { validateFilterSettings, filterBitmap, type FilterSettings } from './filters.js';
import { transformBitmap } from './pixelTools.js';
import { pixelJob } from './pixelJobs.js';
import { deserializeProject, serializeProject } from './projectFile.js';
import { embeddedProfile } from './colorManagement.js';
export type BatchStep=({type:'filter'}&FilterSettings)|{type:'fit';width:number;height:number;resampling?:Resampling};
export interface BatchInput {name:string;format:'project'|'psd'|'png'|'jpeg';bytes:Uint8Array}
export interface BatchOutput {name:string;bytes?:Uint8Array;error?:string}
export function validateBatchSteps(steps:readonly BatchStep[]){if(!Array.isArray(steps)||!steps.length||steps.length>32)throw new Error('批处理需要 1–32 个步骤。');for(const s of steps as readonly BatchStep[]){if(s.type==='fit'){if(Object.keys(s).some(k=>!['type','width','height','resampling'].includes(k))||![s.width,s.height].every(n=>Number.isInteger(n)&&n>=1&&n<=8192))throw new Error('适配尺寸步骤无效。');if(s.resampling!==undefined)validateResampling(s.resampling);}else if(s.type==='filter'){if(Object.keys(s).some(k=>!['type','kind','amount','radius','threshold'].includes(k)))throw new Error('滤镜步骤无效。');validateFilterSettings(s);}else throw new Error('未知批处理步骤。');}}
export function batchBitmap(state:ImageState,steps:readonly BatchStep[]):Bitmap {
 if(embeddedProfile(state)&&!state.colorManagement)throw new Error('源文件含未转换的 ICC；请先转换到 sRGB 并保存工程。');
 validateBatchSteps(steps);let bitmap=compositeState(state);
 for(const step of steps){if(step.type==='filter')bitmap=filterBitmap(bitmap,step);else if(step.type==='fit'){const ratio=Math.min(1,step.width/bitmap.width,step.height/bitmap.height);if(ratio<1)bitmap=transformBitmap(bitmap,Math.max(1,Math.round(bitmap.width*ratio)),Math.max(1,Math.round(bitmap.height*ratio)),0,false,false,step.resampling);}else throw new Error('未知批处理步骤。');}return bitmap;
}
const abort=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('已取消','AbortError');};
export async function runBatch(inputs:readonly BatchInput[],steps:readonly BatchStep[],format:'png'|'jpeg'|'project',signal?:AbortSignal,progress?:(current:number,total:number,message:string)=>void):Promise<BatchOutput[]> {
 validateBatchSteps(steps);
 if(!inputs.length||inputs.length>16||inputs.reduce((n,i)=>n+i.bytes.length,0)>128*1024*1024)throw new Error('每批 1–16 个文件，源文件合计不超过 128 MiB。');
 const results:BatchOutput[]=[],names=new Set<string>();let total=0;
 for(const [index,input] of inputs.entries()){abort(signal);progress?.(index,inputs.length,input.name);let name=input.name.replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120)||'image';const base=name;for(let n=2;names.has(name);n++)name=base+'-'+n;names.add(name);name+='.'+(format==='project'?'hyimage':format);
  try {let state:ImageState;
   if(input.format==='project')state=deserializeProject(new TextDecoder('utf-8',{fatal:true}).decode(input.bytes),true);
   else if(input.format==='psd'){let result;if(typeof Worker==='undefined')result=(await import('./psdAdapter.js')).importPsd(input.bytes,input.name);else {const {PsdJobs}=await import('./psdJobs.js'),jobs=new PsdJobs(()=>{}),cancel=()=>jobs.cancel();signal?.addEventListener('abort',cancel,{once:true});try{abort(signal);result=await jobs.import(input.bytes,input.name);}finally{signal?.removeEventListener('abort',cancel);}}if(!result.layered||result.blockers.length)throw new Error(result.blockers.join(' ')||'PSD 无法安全分层读取。');state=result.layered;}
   else {const {decodeImage,imageDocument}=await import('./imageImport.js'),doc=imageDocument(input.name.slice(0,160),await decodeImage(new File([input.bytes.slice().buffer],input.name)));state=doc.state;doc.dispose();}
   abort(signal);const bitmap=typeof Worker==='undefined'?batchBitmap(state,steps):await pixelJob<Bitmap>({kind:'batch',state,steps},signal);abort(signal);
   const layer=makeLayer('批处理合成',bitmap),output:ImageState={id:crypto.randomUUID(),name:name.slice(0,160),width:bitmap.width,height:bitmap.height,...(bitmap.depth?{bitDepth:bitmap.depth}:{}),...(state.display?{display:state.display}:{}),layers:[layer],selectedId:layer.id,revision:0};
   const bytes=format==='project'?new TextEncoder().encode(serializeProject(output)):await (await import('./rasterExport.js')).exportRaster(output,format,.92);abort(signal);total+=bytes.length;if(total>128*1024*1024)throw new Error('批处理输出超过 128 MiB，请减小批次。');results.push({name,bytes});
  }catch(error){abort(signal);results.push({name,error:error instanceof Error?error.message:String(error)});}
  progress?.(index+1,inputs.length,input.name);await new Promise<void>(resolve=>setTimeout(resolve,0));
 }abort(signal);return results;
}

import type { EditorDisposable, EditorJsonValue } from '@haiyue/editor-plugin-sdk';
import type { ImageWorkspace } from './workspace.js';
import { findLayer } from './document.js';
import { deserializeProject, serializeProject } from './projectFile.js';
import { openSmartSource, prepareSmartSource, applySmartSource, readSmartSource } from './smartSource.js';
import { precisionConvert, type PrecisionJob } from './precisionColor.js';
import { builtinProfile, parseRgbProfile, type ColorPreset } from './colorManagement.js';
import { pixelJob } from './pixelJobs.js';
const str={type:'string',minLength:1,maxLength:160} as const;
type Params={readonly[key:string]:EditorJsonValue};
export function registerFoundationOperations(workspace:ImageWorkspace):EditorDisposable {
 const platform=workspace.platform,owned:EditorDisposable[]=[];
 for(const mode of ['read','replace'] as const)owned.push(platform.operations.register({ownerId:'image.operations',descriptor:{id:'image.smart.source.'+mode,version:1,title:'Smart source '+mode,target:'document',documentKinds:['haiyue.image'],access:mode==='read'?'read':'write',input:{type:'object',properties:{layerId:str,...(mode==='replace'?{resourceId:str,format:{type:'string',enum:['project','psd']} as const}:{})},required:mode==='read'?['layerId']:['layerId','resourceId','format']},output:{type:'json'}},async prepare(p:Params,c){
  const d=workspace.documents.find(d=>d.identity.id===c.document?.id),content=d&&findLayer(d.state.layers,p.layerId as string)?.content;if(!d||content?.type!=='smart')throw new Error('智能对象不存在。');
  if(mode==='read')return {d,id:p.layerId as string,bytes:typeof Worker==='undefined'?new TextEncoder().encode(serializeProject(openSmartSource(content))):await pixelJob<Uint8Array>({kind:'smart-read',content},c.signal),created:[] as string[]};
  const bytes=platform.resources.read(p.resourceId as string),next=typeof Worker==='undefined'?prepareSmartSource(content,p.format==='psd'?readSmartSource(bytes,content.name).state:deserializeProject(new TextDecoder().decode(bytes))):await pixelJob<import('./layerFeatures.js').SmartContent>({kind:'smart-prepare',bytes,format:p.format,content},c.signal);return {d,id:p.layerId as string,content:next,created:[] as string[]};
 },commit(p){if(p.bytes){const r=platform.resources.put(p.bytes);p.created.push(r.resourceId);return {...r,format:'project'};}p.d.runAtomic(()=>applySmartSource(p.d,p.id,p.content!));return {applied:true};},rollback(p){for(const id of p?.created??[])platform.resources.release(id);}}));
 owned.push(platform.operations.register({ownerId:'image.operations',descriptor:{id:'image.color.precision',version:1,title:'Convert bounded SDR RGBA16 / float32 resources',target:'workspace',access:'write',input:{type:'object',properties:{resourceId:str,width:{type:'integer',minimum:1,maximum:8192},height:{type:'integer',minimum:1,maximum:8192},input:{type:'string',enum:['rgba16le','rgba32fle']},output:{type:'string',enum:['rgba8','rgba16le','rgba32fle']},source:{type:'string',enum:['srgb','display-p3','adobe-rgb','resource']},target:{type:'string',enum:['srgb','display-p3','adobe-rgb','resource']},sourceProfile:str,targetProfile:str,exposure:{type:'number',minimum:-20,maximum:20}},required:['resourceId','width','height','input','output','source','target']},output:{type:'json'}},async prepare(p:Params,c){
  const profile=(key:'source'|'target')=>{if(p[key]==='resource'){if(!p[key+'Profile'])throw new Error('缺少 ICC 资源。');return parseRgbProfile(platform.resources.read(p[key+'Profile'] as string),4097);}if(p[key+'Profile'])throw new Error('ICC 资源仅适用于 resource。');return builtinProfile(p[key] as ColorPreset,4097);};
  const job:PrecisionJob={bytes:platform.resources.read(p.resourceId as string),width:p.width as number,height:p.height as number,input:p.input as PrecisionJob['input'],output:p.output as PrecisionJob['output'],source:profile('source'),target:profile('target'),exposure:(p.exposure??0) as number};
  const result=typeof Worker==='undefined'?precisionConvert(job):await pixelJob<ReturnType<typeof precisionConvert>>({kind:'precision',job},c.signal);return {result,created:[] as string[]};
 },commit(p){const r=platform.resources.put(p.result.bytes);p.created.push(r.resourceId);return {...r,width:p.result.width,height:p.result.height,format:p.result.format,clippedPixels:p.result.clippedPixels,intent:'relative-colorimetric',range:'SDR 0..1',alpha:'straight'};},rollback(p){for(const id of p?.created??[])platform.resources.release(id);}}));
 return {async dispose(){await Promise.all(owned.map(x=>x.dispose()));}};
}

import { FILTERS } from './filters.js';
import { RESAMPLING } from './resampling.js';
import type { EditorDisposable, EditorJsonValue, EditorOperationContext, EditorOperationSchema } from '@haiyue/editor-plugin-sdk';
import type { ImageWorkspace } from './workspace.js';
import type { ImageDocument, ImageLayer } from './document.js';
import { PixelStroke, type BrushPoint } from './pixelTools.js';
import { retouchSampler } from './retouch.js';
import { refineSelection, type RefineSettings } from './refineSelection.js';
import { sampleBitmap } from './dailyEditing.js';
import type { Selection } from './selection.js';
import { builtinProfile, parseRgbProfile, embeddedProfile, convertedLayers, profileResource, srgbProfileBytes, type ColorPreset } from './colorManagement.js';
import { concatBytes, resourceBlocks } from './psdResources.js';
import { pixelJob } from './pixelJobs.js';
import { runBatch, type BatchInput, type BatchStep } from './production.js';
type Params={readonly[key:string]:EditorJsonValue};
const str={type:'string',minLength:1,maxLength:160} as const,n=(minimum:number,maximum:number)=>({type:'number',minimum,maximum} as const),integer=(minimum:number,maximum:number)=>({type:'integer',minimum,maximum} as const);
export const refineSchema={radius:integer(1,32),contrast:n(0,100),shift:integer(-32,32),edgeAware:{type:'boolean'}} as const;
export function registerProfessionalOperations(workspace:ImageWorkspace):EditorDisposable {
 const owned:EditorDisposable[]=[],platform=workspace.platform;
 function register(id:string,properties:Record<string,EditorOperationSchema>,required:string[],prepare:(p:Params,d:ImageDocument,c:EditorOperationContext)=>Promise<()=>EditorJsonValue>|(()=>EditorJsonValue),access:'read'|'write'='write'){
  owned.push(platform.operations.register({ownerId:'image.operations',descriptor:{id:'image.'+id,version:1,title:id,target:'document',documentKinds:['haiyue.image'],access,input:{type:'object',properties,required},output:{type:'json'}},async prepare(p:Params,c){const d=workspace.documents.find(d=>d.identity.id===c.document?.id);if(!d)throw new Error('文档已关闭。');return {d,apply:await prepare(p,d,c)};},commit:({d,apply})=>access==='write'?d.runAtomic(apply):apply(),rollback(){}}));
 }
 register('retouch.stroke',{layerId:str,sourceLayerId:str,kind:{type:'string',enum:['clone','heal']},offset:{type:'object',properties:{x:n(-32768,32768),y:n(-32768,32768)},required:['x','y']},points:{type:'array',maxItems:8192,items:{type:'object',properties:{x:n(-32768,32768),y:n(-32768,32768),pressure:n(0,1)},required:['x','y']}},size:n(1,512),opacity:n(.01,1),hardness:n(0,1),pressure:{type:'string',enum:['none','size','opacity','both']},radius:integer(1,32)},['layerId','sourceLayerId','kind','offset','points','size'],(p,d)=>{
  const points=p.points as unknown as BrushPoint[];if(!points.length)throw new Error('笔画至少需要一个点。');const id=p.layerId as string,sample=retouchSampler(d.state,id,p.sourceLayerId as string,p.offset as unknown as {x:number;y:number},p.kind as 'clone'|'heal',(p.radius??12) as number),stroke=new PixelStroke(d.state,id,p.size as number,(p.opacity??1) as number,[0,0,0],false,{hardness:(p.hardness??.5) as number,pressure:(p.pressure??'none') as 'none',sample});for(const point of points)stroke.point(point);return ()=>{d.replaceLayerPixels(id,stroke.layer,'API: '+p.kind);return {applied:true};};
 });
 register('selection.refine',refineSchema,['radius','contrast','shift','edgeAware'],async(p,d,c)=>{
  if(!d.state.selection)throw new Error('请先创建选区。');const bitmap=sampleBitmap(d.state),settings=p as unknown as RefineSettings;const selection=typeof Worker==='undefined'?refineSelection(bitmap,d.state.selection,settings):await pixelJob<Selection>({kind:'refine',bitmap,selection:d.state.selection,refine:settings},c.signal);return ()=>{d.setSelection(selection);return {applied:true};};
 });
 register('color.query',{},[],(_,d)=>()=>({workingSpace:d.state.colorMode==='cmyk'?'cmyk':embeddedProfile(d.state)?'embedded-rgb':d.state.bitDepth===32?'linear-srgb':'srgb',convertedFrom:d.state.colorManagement?.convertedFrom??null,embeddedProfile:!!embeddedProfile(d.state),presets:['srgb','display-p3','adobe-rgb'],icc:'Little CMS v2/v4 matrix/LUT; iccDEV v2/v4/v5 reference command'}),'read');
 register('color.convert',{source:{type:'string',enum:['srgb','display-p3','adobe-rgb','embedded','resource']},resourceId:str},['source'],async(p,d,c)=>{
  if(d.state.colorMode==='cmyk')throw Error('CMYK 转 RGB 请使用 image.cmyk.mode。');if((d.state.bitDepth??8)!==8)throw Error('高位深文档请使用 image.icc.convert。');
  const bytes=p.source==='embedded'?embeddedProfile(d.state):p.source==='resource'?platform.resources.read(p.resourceId as string):undefined;if(['embedded','resource'].includes(p.source as string)&&!bytes)throw new Error('没有可用的 ICC 配置。');if(p.source!=='resource'&&p.resourceId)throw new Error('resourceId 仅用于 resource 来源。');
  const profile=bytes?parseRgbProfile(bytes):builtinProfile(p.source as ColorPreset),layers=typeof Worker==='undefined'?convertedLayers(d.state,profile):await pixelJob<readonly ImageLayer[]>({kind:'color',state:d.state,profile},c.signal),resources=concatBytes([...resourceBlocks(d.state.psdOrigin?.resources??new Uint8Array()).filter(b=>b.id!==1039).map(b=>b.bytes),profileResource(srgbProfileBytes())]);
  return ()=>{d.commitColor(layers,resources,profile.name);return {applied:true,space:'srgb'};};
 });
 owned.push(platform.operations.register({ownerId:'image.operations',descriptor:{id:'image.batch.run',version:1,title:'Run recipe on isolated flattened copies',target:'workspace',access:'write',input:{type:'object',properties:{inputs:{type:'array',maxItems:16,items:{type:'object',properties:{resourceId:str,name:str,format:{type:'string',enum:['project','psd','png','jpeg']}},required:['resourceId','name','format']}},steps:{type:'array',maxItems:32,items:{type:'object',properties:{type:{type:'string',enum:['filter','fit']},kind:{type:'string',enum:Object.keys(FILTERS)},amount:n(-180,500),radius:n(.1,32),threshold:integer(0,255),resampling:{type:'string',enum:Object.keys(RESAMPLING)},width:integer(1,8192),height:integer(1,8192)},required:['type']}},format:{type:'string',enum:['project','png','jpeg']}},required:['inputs','steps','format']},output:{type:'json'}},async prepare(p:Params,c){
  const inputs=p.inputs as unknown as {resourceId:string;name:string;format:BatchInput['format']}[];
  if(inputs.reduce((n,i)=>n+platform.resources.size(i.resourceId),0)>128*1024*1024)throw new Error('批处理输入超过 128 MiB。');
  const results=await runBatch(inputs.map(i=>({...i,bytes:platform.resources.read(i.resourceId)})),p.steps as unknown as BatchStep[],p.format as 'project'|'png'|'jpeg',c.signal,(current,total,message)=>c.report({current,total,message}));return {results,created:[] as string[]};
 },commit(p){return p.results.map(result=>{if(!result.bytes)return {name:result.name,error:result.error!};const resource=platform.resources.put(result.bytes);p.created.push(resource.resourceId);return {name:result.name,...resource};});},rollback(p){for(const id of p?.created??[])platform.resources.release(id);}}));
 return {async dispose(){await Promise.all(owned.map(d=>d.dispose()));}};
}

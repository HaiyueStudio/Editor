import type { EditorJsonValue } from '@haiyue/editor-plugin-sdk';
import { ImageDocument, findLayer, layerLocked, makeLayer, type ImageState, type ImageLayer, type Bitmap } from './document.js';
import { validateAction, type ImageAction } from './productivityModel.js';
import { fillPixels, hexColor } from './pixelTools.js';
import { filterLayer, type FilterSettings } from './filters.js';
import { filterStackBitmap, primeFilterStack, type SmartFilter } from './liveEffects.js';
import { transformedLayer, commitTransform, type TransformValues } from './freeTransform.js';
import { pixelJob } from './pixelJobs.js';
import { serializeProject } from './projectFile.js';
import { compositeState } from './compositor.js';
import { resizeBitmap } from './resampling.js';
import { embeddedProfile } from './colorManagement.js';
export const checkAbort=(signal?:AbortSignal)=>{if(signal?.aborted)throw new DOMException('已取消','AbortError');};
export function resolveAction(action:ImageAction,values:Record<string,EditorJsonValue>){
 validateAction(action);if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('动作参数必须为对象。');const resolved:Record<string,EditorJsonValue>=Object.create(null);for(const key of Object.keys(values))if(!action.parameters.some(p=>p.name===key))throw new Error('未声明的动作参数：'+key);
 for(const p of action.parameters){const v=Object.hasOwn(values,p.name)?values[p.name]:p.default;if(v===undefined||typeof v!==p.type||typeof v==='number'&&!Number.isFinite(v)||typeof v==='string'&&v.length>8192)throw new Error('动作参数缺失或类型错误：'+p.name);resolved[p.name]=v;}
 const visit=(v:EditorJsonValue):EditorJsonValue=>{if(Array.isArray(v))return v.map(visit);if(v&&typeof v==='object'){if(Object.hasOwn(v,'param'))return resolved[(v as {param:string}).param]!;return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)]));}return v;};return action.steps.map(s=>({...s,params:visit(s.params) as Record<string,EditorJsonValue>}));
}
const fields:Record<string,string[]>={'layer.update':['layerId','patch'],'pixels.fill':['layerId','color','opacity','erase'],'filter.apply':['layerId','kind','amount','radius','threshold'],'text.replace':['layerId','text'],'smart.filters':['layerId','filters'],'layer.transform':['layerId','width','height','angle','dx','dy','flipX','flipY','resampling']};
export async function prepareAction(state:ImageState,action:ImageAction,values:Record<string,EditorJsonValue>={},signal?:AbortSignal,progress?:(current:number,total:number)=>void):Promise<{layers:readonly ImageLayer[];affectedIds:string[]}>{
 const steps=resolveAction(action,values),doc=new ImageDocument(state),ids=new Set<string>();try{for(const [index,s] of steps.entries()){
  checkAbort(signal);const p=s.params;if(Object.keys(p).some(k=>!fields[s.operation]!.includes(k))||typeof p.layerId!=='string')throw new Error('动作步骤字段无效：'+s.operation);const id=p.layerId==='$selected'?state.selectedId:p.layerId,layer=findLayer(doc.state.layers,id??null);if(!layer||layerLocked(doc.state.layers,layer.id))throw new Error('动作目标图层不存在或已锁定。');ids.add(layer.id);progress?.(index,steps.length);
  if(s.operation==='layer.update'){const patch=p.patch;if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['name','visible','opacity','blend','x','y'].includes(k)))throw new Error('图层修改动作的 patch 字段无效。');doc.updateLayer(layer.id,patch as Parameters<ImageDocument['updateLayer']>[1]);}
  else if(s.operation==='pixels.fill'){if(p.erase!==undefined&&typeof p.erase!=='boolean'||p.opacity!==undefined&&typeof p.opacity!=='number'||p.color!==undefined&&typeof p.color!=='string')throw new Error('填充动作参数无效。');doc.replaceLayerPixels(layer.id,fillPixels(doc.state,layer.id,p.erase?null:hexColor((p.color??'#000000') as string),(p.opacity??1) as number),'动作填充');}
  else if(s.operation==='filter.apply'){const {layerId,...settings}=p;const result=typeof Worker==='undefined'?filterLayer(doc.state,layer.id,settings as unknown as FilterSettings):await pixelJob<ImageLayer>({kind:'filter',state:doc.state,id:layer.id,settings},signal);doc.replaceLayerPixels(layer.id,result,'动作滤镜');}
  else if(s.operation==='text.replace'){if(layer.content?.type!=='text'||typeof p.text!=='string')throw new Error('替换文字需要文字图层和字符串。');if(layer.content.runs?.length)throw new Error('富文本替换需要先统一样式，避免错配字符区间。');const content={...layer.content,text:p.text},bitmap=(await import('./contentRaster.js')).rasterContent(content);doc.setContent(layer.id,content,bitmap);}
  else if(s.operation==='smart.filters'){if(layer.content?.type!=='smart'||!layer.bitmap)throw new Error('滤镜动作需要智能对象。');const filters=p.filters as unknown as SmartFilter[],output=typeof Worker==='undefined'?filterStackBitmap(layer.bitmap,filters):await pixelJob<Bitmap>({kind:'stack',bitmap:layer.bitmap,filters},signal);primeFilterStack(layer.bitmap,filters,output);doc.setLiveEffects(layer.id,{smartFilters:filters});}
  else {if(['flipX','flipY'].some(k=>p[k]!==undefined&&typeof p[k]!=='boolean'))throw new Error('翻转参数须为布尔值。');const value={width:layer.bitmap?.width,height:layer.bitmap?.height,angle:0,dx:0,dy:0,...p};commitTransform(doc,transformedLayer(doc.state,layer.id,value as unknown as TransformValues));}
  doc.history.clear();checkAbort(signal);progress?.(index+1,steps.length);await new Promise<void>(resolve=>setTimeout(resolve,0));
 }return {layers:doc.state.layers,affectedIds:[...ids]};}finally{doc.dispose();}
}
export interface TemplateRow {name:string;values:Record<string,EditorJsonValue>;width?:number;height?:number}
export async function exportTemplate(state:ImageState,action:ImageAction,rows:readonly TemplateRow[],format:'project'|'png'|'jpeg'|'psd',allowRasterize=false,signal?:AbortSignal,progress?:(current:number,total:number,message:string)=>void){
 if(!Array.isArray(rows)||!rows.length||rows.length>16||!['project','png','jpeg','psd'].includes(format)||JSON.stringify(rows).length>262144)throw new Error('模板每批 1–16 行，数据不超过 256 KiB。');validateAction(action);
 const names=new Set<string>();for(const r of rows){if(!r||typeof r.name!=='string'||!r.name.trim()||r.name.length>120||Object.keys(r).some(k=>!['name','values','width','height'].includes(k)))throw new Error('模板输出名称或字段无效。');resolveAction(action,r.values);if(r.width!==undefined||r.height!==undefined){if(!['png','jpeg'].includes(format)||![r.width,r.height].every(n=>Number.isInteger(n)&&n!>=1&&n!<=8192)||r.width!*r.height!>16777216)throw new Error('输出尺寸仅支持 PNG／JPEG，且须在画布尺寸限制内。');}}
 if(embeddedProfile(state)&&!state.colorManagement&&['png','jpeg'].includes(format))throw new Error('请先将模板 ICC 转换至 sRGB。');
 const results:{name:string;bytes?:Uint8Array;error?:string}[]=[];let total=0;
 for(const [i,row] of rows.entries()){checkAbort(signal);progress?.(i,rows.length,row.name);let base=row.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.+$/,'')||'output',name=base;for(let n=2;names.has(name);n++)name=base+'-'+n;names.add(name);name+='.'+(format==='project'?'hyimage':format);
  try{const result=await prepareAction(state,action,row.values,signal);let output:ImageState={...state,layers:result.layers,name:row.name,id:crypto.randomUUID(),revision:1};
   if(row.width&&row.height){const source=typeof Worker==='undefined'?compositeState(output):await pixelJob<Bitmap>({kind:'composite',state:output},signal),ratio=Math.min(row.width/source.width,row.height/source.height),b=resizeBitmap(source,Math.max(1,Math.round(source.width*ratio)),Math.max(1,Math.round(source.height*ratio)),'bicubic'),layer={...makeLayer('模板输出',b),x:Math.floor((row.width-b.width)/2),y:Math.floor((row.height-b.height)/2)};output={id:output.id,name:output.name,width:row.width,height:row.height,layers:[layer],selectedId:layer.id,revision:1};}
   const bytes=format==='project'?new TextEncoder().encode(serializeProject(output)):format==='psd'?(await import('./psdAdapter.js')).exportPsd(output,allowRasterize).bytes:await(await import('./rasterExport.js')).exportRaster(output,format,.92);checkAbort(signal);if(total+bytes.length>128*1024*1024)throw new Error('模板输出合计超过 128 MiB。');total+=bytes.length;results.push({name,bytes});
  }catch(e){checkAbort(signal);results.push({name,error:e instanceof Error?e.message:String(e)});}progress?.(i+1,rows.length,row.name);await new Promise<void>(resolve=>setTimeout(resolve,0));
 }checkAbort(signal);return results;
}

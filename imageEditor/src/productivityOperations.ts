import type { EditorDisposable, EditorJsonValue, EditorOperationContext, EditorOperationSchema } from '@haiyue/editor-plugin-sdk';
import type { ImageWorkspace } from './workspace.js';
import { uid, type ImageDocument, type Bitmap } from './document.js';
import { validateAction, type AlphaChannel, type ImageAction, type Layout } from './productivityModel.js';
import { prepareAction, exportTemplate, type TemplateRow } from './imageActions.js';
import { maskSelection, combineSelection, selectionWeight, type SelectionMode } from './selection.js';
import { compositeState } from './compositor.js';
import { pixelJob } from './pixelJobs.js';
const str={type:'string',minLength:1,maxLength:160} as const,json={type:'json'} as const;
type Params={readonly[key:string]:EditorJsonValue};
export function registerProductivityOperations(workspace:ImageWorkspace):EditorDisposable{
 const platform=workspace.platform,owned:EditorDisposable[]=[];
 const doc=(c:EditorOperationContext)=>{const d=workspace.documents.find(d=>d.identity.id===c.document?.id);if(!d)throw new Error('文档已关闭。');return d;};
 function register(id:string,properties:Record<string,EditorOperationSchema>,required:string[],prepare:(p:Params,d:ImageDocument,c:EditorOperationContext)=>Promise<()=>EditorJsonValue>|(()=>EditorJsonValue),access:'read'|'write'='write'){
  owned.push(workspace.registerOperation({ownerId:'image.operations',descriptor:{id:'image.'+id,version:1,title:id,target:'document',documentKinds:['haiyue.image'],access,input:{type:'object',properties,required},output:json},async prepare(p:Params,c){const d=doc(c);return {d,apply:await prepare(p,d,c)};},commit:({d,apply})=>access==='write'?d.runAtomic(apply):apply(),rollback(){}}));
 }
 const compId={type:'integer',minimum:1,maximum:2147483647} as const;
 register('comp.list',{},[],(_p,d)=>()=>JSON.parse(JSON.stringify(d.state.layerComps??{list:[]})),'read');
 register('comp.apply',{id:compId},['id'],(p,d)=>()=>{d.applyComp(p.id as number);return {applied:true};});
 register('comp.capture',{id:compId,name:str,comment:{type:'string',maxLength:2000}},['name'],(p,d)=>()=>{d.captureComp(p.name as string,p.id as number|undefined,(p.comment??'') as string);return {id:d.state.layerComps!.lastApplied!};});
 register('comp.delete',{id:compId},['id'],(p,d)=>()=>{d.deleteComp(p.id as number);return {applied:true};});
 const channel=(d:ImageDocument,id:EditorJsonValue|undefined)=>{const c=d.state.channels?.find(c=>c.id===id);if(!c)throw new Error('Alpha 通道不存在。');return c;};
 register('channel.save',{id:str,name:str,source:{type:'string',enum:['selection','red','green','blue','alpha','resource']},resourceId:str},['name','source'],async(p,d,c)=>{
  const s=d.state;if(p.id)channel(d,p.id);if(!p.id&&(s.channels?.length??0)>=32)throw new Error('最多保存 32 个 Alpha 通道。');const id=(p.id??uid()) as string;let data:Uint8Array;
  if(p.source==='selection'){if(!s.selection)throw new Error('请先创建选区。');data=Uint8Array.from({length:s.width*s.height},(_,i)=>Math.round(255*selectionWeight(s.selection,i%s.width,Math.floor(i/s.width))));}
  else if(p.source==='resource'){data=platform.resources.read(p.resourceId as string);if(data.length!==s.width*s.height)throw new Error('灰度资源长度必须等于画布像素数。');}
  else{const b=typeof Worker==='undefined'?compositeState(s):await pixelJob<Bitmap>({kind:'composite',state:s},c.signal),index=['red','green','blue','alpha'].indexOf(p.source as string);data=Uint8Array.from({length:s.width*s.height},(_,i)=>b.data[i*4+index]!);}
  const item:AlphaChannel={id,name:p.name as string,data};return ()=>{d.setProductivity({channels:p.id?s.channels!.map(c=>c.id===id?item:c):[...(s.channels??[]),item]},'保存 Alpha 通道');return {channelId:id};};
 });
 register('channel.update',{id:str,name:str,invert:{type:'boolean'}},['id'],(p,d)=>{const target=channel(d,p.id);return ()=>{d.setProductivity({channels:d.state.channels!.map(c=>c.id===target.id?{...c,name:(p.name??c.name) as string,data:p.invert?c.data.map(v=>255-v):c.data}:c)},'编辑 Alpha 通道');return {applied:true};};});
 register('channel.delete',{id:str},['id'],(p,d)=>{channel(d,p.id);return ()=>{d.setProductivity({channels:d.state.channels!.filter(c=>c.id!==p.id)},'删除 Alpha 通道');return {applied:true};};});
 register('channel.load',{id:str,mode:{type:'string',enum:['replace','add','subtract','intersect']},invert:{type:'boolean'}},['id'],(p,d)=>{const item=channel(d,p.id),s=d.state,mask=p.invert?item.data.map(v=>255-v):item.data,next=combineSelection(s.selection,maskSelection(mask,s.width,s.height),(p.mode??'replace') as SelectionMode,s.width,s.height);return ()=>{d.setSelection(next);return {applied:true};};});
 register('channel.read',{id:str},['id'],(p,d)=>{const c=channel(d,p.id);return ()=>({...platform.resources.put(c.data),format:'gray8',width:d.state.width,height:d.state.height,name:c.name});},'read');
 register('layout.set',{layout:json},['layout'],(p,d)=>()=>{d.setProductivity({layout:p.layout as unknown as Layout},'参考线与吸附');return {applied:true};});
 register('action.save',{action:json},['action'],(p,d)=>{const a=p.action as unknown as ImageAction;validateAction(a);return ()=>{d.setProductivity({actions:[...(d.state.actions??[]).filter(x=>x.id!==a.id),a]},'保存参数化动作');return {actionId:a.id};};});
 register('action.delete',{id:str},['id'],(p,d)=>{if(!d.state.actions?.some(a=>a.id===p.id))throw new Error('动作不存在。');return ()=>{d.setProductivity({actions:d.state.actions!.filter(a=>a.id!==p.id)},'删除动作');return {applied:true};};});
 // prepareAction enforces locks on every step in an isolated ImageDocument; commit that validated result once, without reapplying alpha to transformed pixels.
 register('action.run',{id:str,values:json},['id'],async(p,d,c)=>{const a=d.state.actions?.find(a=>a.id===p.id);if(!a)throw new Error('动作不存在。');const before=d.state,result=await prepareAction(before,a,(p.values??{}) as Record<string,EditorJsonValue>,c.signal,(current,total)=>c.report({current,total,message:a.name}));return ()=>{d.commitLayers('动作：'+a.name,result.layers,result.affectedIds,d.selectedIds,before.revision,'validated');return {applied:true,steps:a.steps.length};};});
 owned.push(workspace.registerOperation({ownerId:'image.operations',descriptor:{id:'image.template.export',version:1,title:'Export parameterized template copies',target:'document',documentKinds:['haiyue.image'],access:'write',input:{type:'object',properties:{actionId:str,rows:json,format:{type:'string',enum:['project','png','jpeg','psd']},allowRasterize:{type:'boolean'}},required:['actionId','rows','format']},output:json},async prepare(p:Params,c){const d=doc(c),a=d.state.actions?.find(a=>a.id===p.actionId);if(!a)throw new Error('动作不存在。');const results=await exportTemplate(d.state,a,p.rows as unknown as TemplateRow[],p.format as 'project'|'png'|'jpeg'|'psd',p.allowRasterize===true,c.signal,(current,total,message)=>c.report({current,total,message}));return {results,created:[] as string[]};},commit(p){return p.results.map(r=>{if(!r.bytes)return {name:r.name,error:r.error!};const resource=platform.resources.put(r.bytes);p.created.push(resource.resourceId);return {name:r.name,...resource};});},rollback(p){for(const id of p?.created??[])platform.resources.release(id);}}));
 return {async dispose(){await Promise.all(owned.map(o=>o.dispose()));}};
}

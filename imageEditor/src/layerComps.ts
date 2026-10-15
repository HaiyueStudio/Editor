import type { Layer, Psd } from 'ag-psd';
import { allLayers, type ImageLayer, type ImageState } from './document.js';
export interface LayerCompState { layerId:string; visible?:boolean; x?:number; y?:number }
export interface LayerComp { id:number; name:string; comment?:string; capturedInfo:number; layers:readonly LayerCompState[] }
export interface LayerComps { list:readonly LayerComp[]; lastApplied?:number }
export function validateLayerComps(comps:LayerComps|undefined){
 if(!comps)return;if(!Array.isArray(comps.list)||comps.list.length>256)throw Error('图层复合最多 256 项。');const ids=new Set<number>();
 for(const c of comps.list){if(!Number.isInteger(c.id)||c.id<=0||c.id>2147483647||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>160||c.comment!==undefined&&(typeof c.comment!=='string'||c.comment.length>2000)||!Number.isInteger(c.capturedInfo)||c.capturedInfo<0||c.capturedInfo>7||!Array.isArray(c.layers)||c.layers.length>128)throw Error('图层复合无效。');ids.add(c.id);const seen=new Set<string>();for(const l of c.layers){if(typeof l.layerId!=='string'||!l.layerId||seen.has(l.layerId)||l.visible!==undefined&&typeof l.visible!=='boolean'||[l.x,l.y].some(v=>v!==undefined&&(!Number.isInteger(v)||Math.abs(v)>32768)))throw Error('图层复合状态无效。');seen.add(l.layerId);}}
 if(comps.lastApplied!==undefined&&!ids.has(comps.lastApplied))throw Error('当前图层复合不存在。');
}
export function freezeLayerComps(comps:LayerComps){return Object.freeze({...comps,list:Object.freeze(comps.list.map(c=>Object.freeze({...c,layers:Object.freeze(c.layers.map(l=>Object.freeze({...l})))})))});}
/** cmls settings are sparse: absent properties carry forward through the stored settings sequence. */
function settings(layer:Layer){
 const result=new Map<number,{visible:boolean;x:number;y:number}>();let visible=!layer.hidden,x=0,y=0;
 for(const s of layer.comps?.settings??[]){if(s.enabled!==undefined)visible=s.enabled;if(s.offset){x=s.offset.x;y=s.offset.y;}for(const id of s.compList)result.set(id,{visible,x,y});}return result;
}
export function importLayerComps(psd:Psd,layers:readonly ImageLayer[],rawIds:Map<Layer,number>):LayerComps|undefined {
 const input=psd.imageResources?.layerComps;if(!input?.list.length)return;
 const raw=new Map<number,Layer>();for(const [l,id] of rawIds)raw.set(id,l);
 const list=input.list.map(c=>({...c,layers:allLayers(layers).flatMap(l=>{const r=raw.get(l.nativePsd?.id??-1);if(!r)return [];const states=settings(r),v=states.get(c.id);if(!v)return [];const current=states.get(0)??states.get(input.lastApplied??-1)??{x:0,y:0};return [{layerId:l.id,...(c.capturedInfo&1?{visible:v.visible}:{}),...(c.capturedInfo&2?{x:l.x+Math.round(v.x-current.x),y:l.y+Math.round(v.y-current.y)}:{})}];})}));
 return {list,...(list.some(c=>c.id===input.lastApplied)?{lastApplied:input.lastApplied!}:{})};
}
export function applyLayerComp(state:ImageState,id:number):ImageState {
 const comp=state.layerComps?.list.find(c=>c.id===id);if(!comp)throw Error('图层复合不存在。');const values=new Map(comp.layers.map(l=>[l.layerId,l]));
 const visit=(ls:readonly ImageLayer[]):ImageLayer[]=>ls.map(l=>{const v=values.get(l.id);return {...l,...(v?.visible!==undefined&&comp.capturedInfo&1?{visible:v.visible}:{}),...(comp.capturedInfo&2?{x:v?.x??l.x,y:v?.y??l.y}:{}),children:visit(l.children)};});
 return {...state,layers:visit(state.layers),layerComps:{...state.layerComps!,lastApplied:id}};
}
export function captureLayerComp(state:ImageState,name:string,id?:number,comment=''):LayerComps {
 const previous=state.layerComps?.list??[];if(id!==undefined&&!previous.some(c=>c.id===id))throw Error('图层复合不存在。');
 const nextId=id??Math.max(0,...previous.map(c=>c.id))+1;
 const comp:LayerComp={id:nextId,name,comment,capturedInfo:3,layers:allLayers(state.layers).map(l=>({layerId:l.id,visible:l.visible,x:l.x,y:l.y}))};
 const result={list:id===undefined?[...previous,comp]:previous.map(c=>c.id===id?comp:c),lastApplied:nextId};validateLayerComps(result);return result;
}
/** Explicit values avoid stale sparse deltas after editing, deleting or switching a comp. */
export function exportLayerComps(state:ImageState,children:Layer[]){
 if(!state.layerComps)return;
 const visit=(ls:readonly ImageLayer[],out:Layer[],parentX=0,parentY=0)=>ls.forEach((l,i)=>{const target=out[i]!,original=target.comps;
  target.comps={...(original?.originalEffectsReferencePoint?{originalEffectsReferencePoint:original.originalEffectsReferencePoint}:{}),settings:state.layerComps!.list.map(c=>{const v=c.layers.find(v=>v.layerId===l.id),old=original?.settings.find(s=>s.compList.includes(c.id));return {...old,compList:[c.id],...(c.capturedInfo&1?{enabled:v?.visible??l.visible}:{}),...(c.capturedInfo&2?{offset:{x:(v?.x??l.x)-l.x,y:(v?.y??l.y)-l.y}}:{})};})};
  target.comps.settings.push({compList:[0],enabled:l.visible,offset:{x:0,y:0}});visit(l.children,target.children??[],parentX+l.x,parentY+l.y);
 });visit(state.layers,children);
 return {list:state.layerComps.list.map(({layers,...c})=>c),...(state.layerComps.lastApplied!==undefined?{lastApplied:state.layerComps.lastApplied}:{})};
}

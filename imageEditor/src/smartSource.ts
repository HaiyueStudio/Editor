import { readPsd, type Layer } from 'ag-psd';
import { importPsd, exportPsd } from './psdAdapter.js';
import { allLayers, checkSize, findLayer, ImageDocument, makeLayer, uid, validateState, type ImageState } from './document.js';
import { compositeState } from './compositor.js';
import { smartBitmap } from './smartObject.js';
import type { SmartContent } from './layerFeatures.js';
/** Embedded PSDs are bounded and may contain groups/native content, but never recursive/external objects. */
export function readSmartSource(bytes:Uint8Array,name:string){
 if(bytes.length>32*1024*1024)throw new Error('多层智能源不能超过 32 MiB。');
 const raw=readPsd(bytes,{useRawData:true,skipThumbnail:true,skipLinkedFilesData:true,totalMemoryLimit:64*1024*1024});checkSize(raw.width,raw.height);
 let count=0,total=raw.width*raw.height*4;
 const visit=(layers:Layer[],depth:number)=>{if(depth>16)throw new Error('智能源嵌套过深。');for(const l of layers){if(++count>128||l.placedLayer)throw new Error('智能源最多 128 层，暂不允许嵌套智能对象。');for(const r of [l,l.mask,l.realMask])if(r){const w=(r.right??0)-(r.left??0),h=(r.bottom??0)-(r.top??0);if(w<0||h<0)throw new Error('智能源范围无效。');if(w&&h)checkSize(w,h);total+=w*h*4;if(total>64*1024*1024)throw new Error('智能源解码超过 64 MiB。');}visit(l.children??[],depth+1);}};visit(raw.children??[],0);
 const result=importPsd(bytes,name);if(!result.layered)throw new Error('智能源无法无损编辑：'+result.blockers.join('；'));
 const state=result.layered,only=state.layers.length===1?state.layers[0]:undefined;
 const simple=Boolean(only?.bitmap&&!only.content&&!only.mask&&!only.styles&&!only.blendIf&&!only.clipping&&only.kind==='pixel'&&only.visible&&only.opacity===1&&only.blend==='normal'&&only.x===0&&only.y===0&&only.bitmap.width===state.width&&only.bitmap.height===state.height);
 return {state,bitmap:simple?only!.bitmap!:compositeState(state),simple};
}
export function openSmartSource(content:SmartContent):ImageState {
 if(content.sourcePsd)return readSmartSource(content.sourcePsd,content.name).state;
 const layer=makeLayer(content.name,{...content.source,data:content.source.data.slice()});return {id:uid(),name:content.name,width:content.source.width,height:content.source.height,layers:[layer],selectedId:layer.id,revision:1};
}
export function prepareSmartSource(content:SmartContent,state:ImageState):SmartContent {
 validateState(state);if(allLayers(state.layers).some(l=>l.content?.type==='smart'))throw new Error('多层智能源暂不允许嵌套智能对象。');
 const bytes=exportPsd(state).bytes,{bitmap}=readSmartSource(bytes,state.name);
 return {...content,sourceId:uid(),name:state.name,source:bitmap,sourcePsd:bytes};
}
export function applySmartSource(doc:ImageDocument,id:string,content:SmartContent){
 if(findLayer(doc.state.layers,id)?.content?.type!=='smart')throw new Error('请选择智能对象。');
 doc.setContent(id,content,smartBitmap(content));
}

import { allLayers, findLayer, layerLocked, uid, type ImageState, type ImageLayer, type ImageDocument } from './document.js';
import type { SmartContent } from './layerFeatures.js';
import { validateContent } from './layerFeatures.js';
import { smartBitmap } from './smartObject.js';
import { smartGeometryAsync } from './smartGeometry.js';
import { tiledEditing } from './tiledEditing.js';
import { replacePixel } from './pixelTools.js';
export function smartInstances(state:ImageState,id:string){const c=findLayer(state.layers,id)?.content;if(c?.type!=='smart')throw Error('请选择智能对象。');return allLayers(state.layers).filter(l=>l.content?.type==='smart'&&l.content.sourceId===c.sourceId);}
export async function prepareSharedSource(state:ImageState,id:string,next:SmartContent,scope:'shared'|'instance'='shared',signal?:AbortSignal):Promise<ImageLayer[]> {
 const target=findLayer(state.layers,id);if(target?.content?.type!=='smart')throw Error('请选择智能对象。');const targets=scope==='shared'?smartInstances(state,id):[target],sourceId=uid();
 for(const l of targets)if(layerLocked(state.layers,l.id))throw Error('共享实例已锁定：'+l.name);
 const updates:ImageLayer[]=[];for(const l of targets){signal?.throwIfAborted();const old=l.content as SmartContent,content:SmartContent={...next,sourceId,transform:old.transform};validateContent(content);const bitmap=tiledEditing(state)?await smartGeometryAsync(content,signal):smartBitmap(content);updates.push({...l,content,bitmap});}return updates;
}
export function commitSmartUpdates(doc:ImageDocument,updates:readonly ImageLayer[],revision=doc.revision,label='更新共享智能源',mode:'edit'|'transform'='edit'){let layers=doc.state.layers;for(const l of updates)layers=replacePixel(layers,l.id,l);doc.commitLayers(label,layers,updates.map(l=>l.id),doc.selectedIds,revision,mode);}
export function sharedSourceUpdates(state:ImageState,id:string,next:SmartContent,scope:'shared'|'instance'='shared'):ImageLayer[]{const target=findLayer(state.layers,id);if(target?.content?.type!=='smart')throw Error('请选择智能对象。');const sourceId=uid(),targets=scope==='shared'?smartInstances(state,id):[target];return targets.map(l=>{if(layerLocked(state.layers,l.id))throw Error('共享实例已锁定：'+l.name);const content={...next,sourceId,transform:(l.content as SmartContent).transform};return {...l,content,bitmap:smartBitmap(content)};});}

import { makePreviewLevels,rasterPreview } from './rasterPreviews.js';
import type { Bitmap, ImageState } from './document.js';
const previews=new Map<string,{levels:Bitmap[];bytes:number;resources:Uint8Array|undefined}>();
/** Transient import preview only; never used as editable document pixels. */
export function seedImagePreview(state:ImageState,bitmap?:Bitmap){
 if(!bitmap)return;const levels=makePreviewLevels(bitmap),size=(levels:Bitmap[])=>levels.reduce((n,b)=>n+b.data.byteLength+(b.cmyk?.byteLength??0),0),budget=8*1024*1024;
 while(levels.length>1&&size(levels)>budget)levels.shift();const bytes=size(levels);if(bytes>budget)return;previews.delete(state.id);previews.set(state.id,{levels,bytes,resources:state.psdOrigin?.resources});
 while(previews.size>8||[...previews.values()].reduce((n,p)=>n+p.bytes,0)>budget)previews.delete(previews.keys().next().value!);
}
export function imagePreview(state:ImageState,edge=512){const p=previews.get(state.id);return p?.resources===state.psdOrigin?.resources?p?.levels.slice().reverse().find(b=>Math.max(b.width,b.height)>=edge)??p?.levels[0]:undefined;}
export function forgetImagePreview(id:string){previews.delete(id);}

export function seedRasterDocumentPreview(state:ImageState){
 const l=state.layers.length===1?state.layers[0]:undefined,b=l?.bitmap;
 if(b&&l?.kind==='pixel'&&l.visible&&l.opacity===1&&l.blend==='normal'&&l.x===0&&l.y===0&&b.width===state.width&&b.height===state.height&&!l.mask&&!l.styles&&!l.smartFilters?.length&&!l.blendIf&&!l.clipping&&!l.advancedBlend&&l.fillOpacity===undefined)seedImagePreview(state,rasterPreview(b));
}

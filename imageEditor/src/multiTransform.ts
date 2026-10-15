import { allLayers, layerLocked, uid, type ImageLayer, type ImageState } from './document.js';
import { selectedRoots } from './dailyEditing.js';
import { parentOffset } from './pixelTools.js';
import { placementQuad, smartGeometryAsync, smartGeometryBitmap } from './smartGeometry.js';
import { tiledEditing } from './tiledEditing.js';
import type { SmartContent } from './layerFeatures.js';
import type { TransformValues } from './freeTransform.js';
export function transformTargets(state:ImageState,ids:readonly string[]){
 const roots=selectedRoots(state,ids),targets=roots.flatMap(l=>l.kind==='group'?allLayers(l.children).filter(c=>c.kind!=='group'):[l]);
 if(!targets.length||state.colorMode==='cmyk')throw Error('多层自由变换需要 RGB 像素或智能对象图层。');
 for(const l of targets)if(!l.bitmap||l.kind!=='pixel'||layerLocked(state.layers,l.id,'position')||l.mask||l.filterMask||l.content&&l.content.type!=='smart')throw Error('多层变换包含锁定、调整、文字／路径或蒙版图层：'+l.name+'。请先解锁、栅格化或应用蒙版。');
 return targets;
}
export function transformBounds(state:ImageState,ids:readonly string[]){const layers=transformTargets(state,ids),rects=layers.map(l=>{const p=parentOffset(state.layers,l.id)!;return {x:p.x+l.x,y:p.y+l.y,width:l.bitmap!.width,height:l.bitmap!.height};}),x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y));return {x,y,width:Math.max(...rects.map(r=>r.x+r.width))-x,height:Math.max(...rects.map(r=>r.y+r.height))-y};}
export async function transformMany(state:ImageState,ids:readonly string[],v:TransformValues,signal?:AbortSignal):Promise<ImageLayer[]> {
 const targets=transformTargets(state,ids),box=transformBounds(state,ids);if(![v.width,v.height].every(n=>Number.isInteger(n)&&n>0&&n<=30000)||!Number.isFinite(v.angle)||Math.abs(v.angle)>360||![v.dx,v.dy].every(n=>Number.isInteger(n)&&Math.abs(n)<=32768))throw Error('多层变换参数无效。');
 const a=v.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),cx=box.x+box.width/2,cy=box.y+box.height/2,map=(x:number,y:number)=>{const dx=(x-cx)*v.width/box.width*(v.flipX?-1:1),dy=(y-cy)*v.height/box.height*(v.flipY?-1:1);return [cx+v.dx+dx*c-dy*s,cy+v.dy+dx*s+dy*c];};
 const updates:ImageLayer[]=[];for(const layer of targets){signal?.throwIfAborted();const old=layer.bitmap!,parent=parentOffset(state.layers,layer.id)!,x=parent.x+layer.x,y=parent.y+layer.y,source:SmartContent=layer.content?.type==='smart'?layer.content:{type:'smart',sourceId:uid(),name:layer.name,source:old,transform:{width:old.width,height:old.height,angle:0,flipX:false,flipY:false}},q=placementQuad(source,old.width,old.height),quad=q.flatMap((_,i)=>i%2?[]:map(x+q[i]!,y+q[i+1]!)),bounds=[[0,0],[old.width,0],[old.width,old.height],[0,old.height]].map(p=>map(x+p[0]!,y+p[1]!)),left=Math.floor(Math.min(...bounds.map(p=>p[0]!))+1e-8),top=Math.floor(Math.min(...bounds.map(p=>p[1]!))+1e-8),width=Math.ceil(Math.max(...bounds.map(p=>p[0]!))-1e-8)-left,height=Math.ceil(Math.max(...bounds.map(p=>p[1]!))-1e-8)-top;
 const content:SmartContent={...source,transform:{...(source.transform.mesh?{mesh:source.transform.mesh}:{}),width,height,angle:0,flipX:false,flipY:false,quad:quad.map((v,i)=>v-(i%2?top:left)),resampling:'bilinear'}};
 const bitmap=tiledEditing(state)?await smartGeometryAsync(content,signal):smartGeometryBitmap(content);updates.push({...layer,...(layer.content?{content}:{}),bitmap,x:left-parent.x,y:top-parent.y});}
 return updates;
}

import type { ImageState } from './document.js';
import { findLayer, layerLocked } from './document.js';
import type { LayerMask } from './layerFeatures.js';
import { rawMaskWeight } from './maskEffects.js';
import { PixelStroke, fillPixels, parentOffset, type BrushPoint, type BrushDynamics, type Color } from './pixelTools.js';
import { combineSelection, selectionWeight } from './selection.js';
import { runSelection, selectionRow, combineRows } from './selectionRuns.js';
import { intersect } from './tiledEditing.js';
export function invertMask(mask:LayerMask):LayerMask {
 if(mask.samples)return {...mask,samples:{...mask.samples,inverted:!mask.samples.inverted},defaultColor:255-mask.defaultColor};
 if(!mask.coverage)return {...mask,data:mask.data.map(v=>255-v),defaultColor:255-mask.defaultColor};
 return {...mask,coverage:runSelection(mask.width,mask.height,y=>combineRows([0,mask.width,255],selectionRow(mask.coverage,y),'subtract')),defaultColor:255-mask.defaultColor};
}
/** Mask edits preserve raw values, exterior, density and feather. Work buffers never exceed 256². */
export async function editTiledMask(state:ImageState,id:string,target:'layer'|'filter',color:Color,opacity:number,stroke?:{points:readonly BrushPoint[];size:number;dynamics:BrushDynamics},signal?:AbortSignal):Promise<LayerMask>{
 const layer=findLayer(state.layers,id),mask=target==='filter'?layer?.filterMask:layer?.mask;if(!layer||!mask||mask.disabled)throw Error('请先添加并启用蒙版。');if(layerLocked(state.layers,id))throw Error('图层已锁定。');
 const parent=parentOffset(state.layers,id)!,ox=parent.x+layer.x,oy=parent.y+layer.y;
 if(stroke&&(!stroke.points.length||stroke.points.length>8192))throw Error('笔画点数量无效。');
 let region=state.selection??{x:0,y:0,width:state.width,height:state.height};
 if(stroke){const r=stroke.size*(1+(stroke.dynamics.scatter??0))/2+1,x=Math.floor(Math.min(...stroke.points.map(p=>p.x))-r),y=Math.floor(Math.min(...stroke.points.map(p=>p.y))-r),right=Math.ceil(Math.max(...stroke.points.map(p=>p.x))+r),bottom=Math.ceil(Math.max(...stroke.points.map(p=>p.y))+r);const hit=intersect(region,{x,y,width:right-x,height:bottom-y});if(!hit)return mask;region=hit;}
 region=intersect(region,{x:0,y:0,width:state.width,height:state.height})!;if(!region)return mask;
 if(mask.samples||mask.data instanceof Float32Array||(state.bitDepth??8)!==8)return editFloatMask(state,id,mask,ox,oy,region,color,opacity,stroke,signal);
 // The coverage uses document coordinates; retain any off-canvas mask pixels in the new bounds.
 const left=Math.min(ox+mask.x,region.x),top=Math.min(oy+mask.y,region.y),right=Math.max(ox+mask.x+mask.width,region.x+region.width),bottom=Math.max(oy+mask.y+mask.height,region.y+region.height),width=right-left,height=bottom-top;
 if(width>30000||height>30000)throw Error('蒙版尺寸超过 30000。');
 const rows=new Map<number,number[]>();let bytes=0;
 for(let y=region.y;y<region.y+region.height;y+=256){signal?.throwIfAborted();for(let x=region.x;x<region.x+region.width;x+=256){const w=Math.min(256,region.x+region.width-x),h=Math.min(256,region.y+region.height-y),data=new Uint8ClampedArray(w*h*4);for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){const i=(yy*w+xx)*4,v=rawMaskWeight(mask,x+xx-ox,y+yy-oy)*255;data.set([v,v,v,255],i);}
 const {content,locks,...base}=layer;const synthetic={...base,kind:'pixel' as const,locked:false,children:[],x,y,bitmap:{width:w,height:h,data}},selection=combineSelection(state.selection,{x,y,width:w,height:h},'intersect',state.width,state.height),local={...state,bitDepth:8 as const,colorMode:'rgb' as const,layers:[synthetic],selection};
 let pixels:Uint8ClampedArray;if(stroke){const brush=new PixelStroke(local,id,stroke.size,opacity,color,false,stroke.dynamics);for(const p of stroke.points)brush.point(p);pixels=brush.layer.bitmap!.data as Uint8ClampedArray;}else pixels=fillPixels(local,id,color,opacity).bitmap!.data as Uint8ClampedArray;
 for(let yy=0;yy<h;yy++){const row=rows.get(y+yy)??[];let a=0,v=pixels[yy*w*4]!;for(let xx=1;xx<=w;xx++){const next=xx<w?pixels[(yy*w+xx)*4]!:0;if(next!==v||xx===w){if(v){row.push(x+a-left,x+xx-left,v);bytes+=6;}a=xx;v=next;}}rows.set(y+yy,row);}if(bytes>32*1024*1024)throw Error('蒙版复杂度超过 32 MiB。');
 }await new Promise<void>(r=>setTimeout(r,0));}
 const coverage=runSelection(width,height,yy=>{const gy=yy+top,changed=rows.get(gy),my=gy-oy-mask.y,mx=ox+mask.x-left;let base:number[];
 if(my<0||my>=mask.height)base=mask.defaultColor?[0,width,mask.defaultColor]:[];
 else{base=[];if(mask.defaultColor&&mx>0)base.push(0,mx,mask.defaultColor);const selection=mask.coverage??{x:0,y:0,width:mask.width,height:mask.height,mask:mask.data instanceof Uint8Array?mask.data:Uint8Array.from(mask.data)};const raw=selectionRow(selection,my);for(let i=0;i<raw.length;i+=3)base.push(raw[i]!+mx,raw[i+1]!+mx,raw[i+2]!);if(mask.defaultColor&&mx+mask.width<width)base.push(mx+mask.width,width,mask.defaultColor);}
 return changed?combineRows(combineRows(base,[region.x-left,region.x+region.width-left,255],'subtract'),changed,'add'):base;
 });
 const {vector,precision,...base}=mask;return {...base,x:left-ox,y:top-oy,width,height,data:new Uint8Array(),coverage};
}

async function editFloatMask(state:ImageState,id:string,mask:LayerMask,ox:number,oy:number,region:{x:number;y:number;width:number;height:number},color:Color,opacity:number,stroke:{points:readonly BrushPoint[];size:number;dynamics:BrushDynamics}|undefined,signal?:AbortSignal):Promise<LayerMask>{
 const {maskRegion,storeMaskTile}=await import('./diskMasks.js'),left=Math.min(ox+mask.x,region.x),top=Math.min(oy+mask.y,region.y),right=Math.max(ox+mask.x+mask.width,region.x+region.width),bottom=Math.max(oy+mask.y+mask.height,region.y+region.height),width=right-left,height=bottom-top;if(width>30000||height>30000)throw Error('蒙版尺寸超过 30000。');const tiles:import('./diskPager.js').DiskBlob[]=[];
 for(let y=0;y<height;y+=256)for(let x=0;x<width;x+=256){signal?.throwIfAborted();const w=Math.min(256,width-x),h=Math.min(256,height-y),hit=intersect(region,{x:x+left,y:y+top,width:w,height:h});if(!hit&&mask.samples&&!mask.samples.inverted&&left===ox+mask.x&&top===oy+mask.y&&width===mask.width&&height===mask.height){tiles.push(mask.samples.tiles[(y/256)*Math.ceil(width/256)+x/256]!);continue;}const raw=await maskRegion(mask,x+left-ox,y+top-oy,w,h,signal);let out=raw;
 if(hit){const data=new Float32Array(w*h*4);for(let i=0;i<raw.length;i++)data.set([raw[i]!,raw[i]!,raw[i]!,255],i*4);const {content,locks,mask:oldMask,filterMask,...base}=findLayer(state.layers,id)!,{psdOrigin,...plain}=state;const l={...base,kind:'pixel' as const,locked:false,children:[],x:x+left,y:y+top,bitmap:{width:w,height:h,depth:16 as const,data}},local={...plain,bitDepth:16 as const,colorMode:'rgb' as const,layers:[l],selection:combineSelection(state.selection,hit,'intersect',state.width,state.height)};let pixels:import('./document.js').Bitmap;
 if(stroke){const brush=new PixelStroke(local,id,stroke.size,opacity,color,false,stroke.dynamics);for(const point of stroke.points)brush.point(point);pixels=brush.layer.bitmap!;}else pixels=fillPixels(local,id,color,opacity).bitmap!;out=Float32Array.from({length:w*h},(_,i)=>pixels.data[i*4]!);}
 tiles.push(await storeMaskTile(out,signal));}
 const {vector,coverage,...base}=mask;return {...base,x:left-ox,y:top-oy,width,height,precision:'float32',data:new Float32Array(),samples:{tiles}};
}

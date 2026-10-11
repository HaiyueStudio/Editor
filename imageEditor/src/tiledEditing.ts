import { pixelArray, pixelBytesView, depthOf, withPixels } from './pixelFormat.js';
import { synchronizeCmyk } from './cmyk.js';
import { CmykStroke, fillCmyk, type InkPaint } from './cmykEditing.js';
import { tiledAlphaSources, tiledChanges } from './tiledProvenance.js';
import { deflate } from 'pako';
import { diskPager, type DiskBlob } from './diskPager.js';
import { bitmapRegionAsync, compositeRegionAsync } from './diskCompositor.js';
import { PAGE_SIZE, pagedBitmap } from './pagedPixels.js';
import { checkDenseAllocation, needsTiledView } from './imageLimits.js';
import { checkSize, findLayer, layerLocked, type Bitmap, type ImageLayer, type ImageState } from './document.js';
import { PixelStroke, fillPixels, editablePixel, parentOffset, type Rect, type BrushPoint, type BrushDynamics, type Color, type Point } from './pixelTools.js';
import { gradientPixels } from './dailyEditing.js';
import { combineSelection } from './selection.js';
export function tiledEditing(state:ImageState){return needsTiledView(state)||state.layers.some(function has(l):boolean{return !!l.bitmap?.pages||!!l.mask?.samples||!!l.filterMask?.samples||l.children.some(has);});}
export function intersect(a:Rect,b:Rect):Rect|undefined {const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);return right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:undefined;}
function union(a:Rect,b:Rect):Rect {const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);return {x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y};}
/** Immutable COW: untouched disk pages are shared with history. Only one decoded tile is writable. */
export async function editTiledLayer(state:ImageState,id:string,region:Rect,edit:(state:ImageState)=>ImageLayer|Promise<ImageLayer>,signal?:AbortSignal):Promise<ImageLayer>{
 const layer=editablePixel(state,id),parent=parentOffset(state.layers,id)!,origin={x:layer.x+parent.x,y:layer.y+parent.y};
 let affected=intersect(region,{x:0,y:0,width:state.width,height:state.height});if(affected&&state.selection)affected=intersect(affected,state.selection);if(!affected)return layer;
 const old=layer.bitmap,oldBounds={...origin,width:old?.width??0,height:old?.height??0},alphaLock=layerLocked(state.layers,id,'transparency');
 if(alphaLock){affected=intersect(affected,oldBounds);if(!affected)return layer;}
 const bounds=old?union(oldBounds,affected):affected;checkSize(bounds.width,bounds.height);
 const sameGrid=!!old&&bounds.x===origin.x&&bounds.y===origin.y&&bounds.width===old.width&&bounds.height===old.height,tiles:DiskBlob[]=[],inks:DiskBlob[]=[];
 const pages=sameGrid&&old.pages?.kind==='disk'?old.pages:undefined;
 for(let y=0,index=0;y<bounds.height;y+=PAGE_SIZE)for(let x=0;x<bounds.width;x+=PAGE_SIZE,index++){
  signal?.throwIfAborted();const r={x:bounds.x+x,y:bounds.y+y,width:Math.min(PAGE_SIZE,bounds.width-x),height:Math.min(PAGE_SIZE,bounds.height-y)},damage=intersect(r,affected);
  if(!damage&&pages){tiles.push(pages.tiles[index]!);if(pages.inks)inks.push(pages.inks[index]!);continue;}
  const data=pixelArray(r.width*r.height*4,state.bitDepth??8),cmyk=state.colorMode==='cmyk'?new Float32Array(data.length):undefined,overlap=old&&intersect(r,oldBounds);
  if(overlap){const b=await bitmapRegionAsync(old!,{...overlap,x:overlap.x-origin.x,y:overlap.y-origin.y},signal);for(let yy=0;yy<b.height;yy++){const at=((yy+overlap.y-r.y)*r.width+overlap.x-r.x)*4;data.set(b.data.subarray(yy*b.width*4,(yy+1)*b.width*4),at);if(cmyk&&b.cmyk)cmyk.set(b.cmyk.subarray(yy*b.width*4,(yy+1)*b.width*4),at);}}
  let output:Bitmap={...withPixels(r.width,r.height,data,state.bitDepth??8),...(cmyk?{cmyk}:{})};
  if(damage){const synthetic:ImageLayer={...layer,x:r.x,y:r.y,children:[],bitmap:output,...(alphaLock?{locks:{...layer.locks,transparency:true}}:{})};
   const local:ImageState={...state,layers:[synthetic],selection:combineSelection(state.selection,damage,'intersect',state.width,state.height)};
   const edited=await edit(local);output=synchronizeCmyk({...local,layers:[edited]},local).layers[0]!.bitmap!;
   if(output.width!==r.width||output.height!==r.height)throw Error('局部编辑改变了分块尺寸。');
  }
  tiles.push(await diskPager.write(deflate(pixelBytesView(output)),signal));if(output.cmyk)inks.push(await diskPager.write(deflate(pixelBytesView(withPixels(output.width,output.height,output.cmyk,16))),signal));
 }
 signal?.throwIfAborted();const bitmap=pagedBitmap(bounds.width,bounds.height,{kind:'disk',tiles,...(inks.length?{inks}:{})},state.bitDepth??8);
 if(old){tiledChanges.set(bitmap,{source:new WeakRef(old),rect:{...affected,x:affected.x-bounds.x,y:affected.y-bounds.y}});if(alphaLock)tiledAlphaSources.set(bitmap,new WeakRef(old));}
 return {...layer,x:bounds.x-parent.x,y:bounds.y-parent.y,bitmap};
}
export async function tiledFill(state:ImageState,id:string,color:Color|null,opacity=1,signal?:AbortSignal){if(!color&&state.colorMode==='cmyk')return tiledCmykFill(state,id,{ink:[0,0,0,0],erase:true,opacity},signal);return editTiledLayer(state,id,state.selection??{x:0,y:0,width:state.width,height:state.height},s=>fillPixels(s,id,color,opacity),signal);}
export async function tiledGradient(state:ImageState,id:string,start:Point,end:Point,from:Color,to:Color,kind:'linear'|'radial',opacity=1,signal?:AbortSignal){return editTiledLayer(state,id,state.selection??{x:0,y:0,width:state.width,height:state.height},s=>gradientPixels(s,id,start,end,from,to,kind,opacity),signal);}
export async function tiledStroke(state:ImageState,id:string,points:readonly BrushPoint[],size:number,opacity:number,color:Color,erase=false,dynamics:BrushDynamics={},signal?:AbortSignal){
 if(erase&&state.colorMode==='cmyk')return tiledCmykStroke(state,id,points,size,{ink:[0,0,0,0],erase:true,opacity},dynamics,signal);
 if(!points.length||points.length>8192||points.some(p=>![p.x,p.y,p.pressure??1].every(Number.isFinite)||(p.pressure??1)<0||(p.pressure??1)>1))throw Error('笔画坐标或笔压无效。');
 const x=Math.floor(Math.min(...points.map(p=>p.x))-size*(1+(dynamics.scatter??0))/2-1),y=Math.floor(Math.min(...points.map(p=>p.y))-size*(1+(dynamics.scatter??0))/2-1),right=Math.ceil(Math.max(...points.map(p=>p.x))+size*(1+(dynamics.scatter??0))/2+1),bottom=Math.ceil(Math.max(...points.map(p=>p.y))+size*(1+(dynamics.scatter??0))/2+1);
 return editTiledLayer(state,id,{x,y,width:right-x,height:bottom-y},s=>{const stroke=new PixelStroke(s,id,size,opacity,color,erase,dynamics);for(const p of points)stroke.point(p);return stroke.layer;},signal);
}
export async function sampleRegion(state:ImageState,rect:Rect,id?:string,signal?:AbortSignal):Promise<Bitmap>{
 if(![rect.x,rect.y,rect.width,rect.height].every(Number.isInteger)||rect.x<0||rect.y<0||rect.width<1||rect.height<1||rect.x+rect.width>state.width||rect.y+rect.height>state.height||rect.width*rect.height>16777216)throw Error('取样范围无效或超过工作集。');
 checkDenseAllocation(rect.width,rect.height,((state.bitDepth??8)===8?4:16)+(state.colorMode==='cmyk'?16:0));if(!id)return compositeRegionAsync(state,rect,signal);const layer=findLayer(state.layers,id);if(!layer||layer.kind!=='pixel')throw Error('请选择像素图层。');const parent=parentOffset(state.layers,id)!,b=layer.bitmap,data=pixelArray(rect.width*rect.height*4,state.bitDepth??8),cmyk=state.colorMode==='cmyk'?new Float32Array(data.length):undefined;
 const hit=b&&intersect(rect,{x:parent.x+layer.x,y:parent.y+layer.y,width:b.width,height:b.height});if(hit){const part=await bitmapRegionAsync(b!,{...hit,x:hit.x-parent.x-layer.x,y:hit.y-parent.y-layer.y},signal);for(let y=0;y<hit.height;y++){const at=((y+hit.y-rect.y)*rect.width+hit.x-rect.x)*4;data.set(part.data.subarray(y*hit.width*4,(y+1)*hit.width*4),at);if(cmyk&&part.cmyk)cmyk.set(part.cmyk.subarray(y*hit.width*4,(y+1)*hit.width*4),at);}}return {...withPixels(rect.width,rect.height,data,state.bitDepth??8),...(cmyk?{cmyk}:{})};
}
export async function tiledCopy(state:ImageState,id?:string,signal?:AbortSignal){
 const r=state.selection??{x:0,y:0,width:state.width,height:state.height};if(r.width*r.height>16777216)throw Error('剪贴板选区超过 1600 万像素，请缩小选区或使用流式导出。');const bitmap=await sampleRegion(state,r,id,signal);let visible=false;const {selectionWeight}=await import('./selection.js');for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){const i=(y*r.width+x)*4+3;bitmap.data[i]=bitmap.data[i]!*selectionWeight(state.selection,x+r.x,y+r.y);visible ||= bitmap.data[i]!>0;}if(!visible)throw Error('复制范围内没有可见像素。');return {bitmap,x:r.x,y:r.y,profile:(await import('./iccEngine.js')).workingProfile(state)};
}
export async function tiledApplyMask(state:ImageState,id:string,signal?:AbortSignal){
 const layer=editablePixel(state,id),b=layer.bitmap,m=layer.mask;if(!b||!m)throw Error('请选择带蒙版的像素图层。');if(layerLocked(state.layers,id,'transparency'))throw Error('应用蒙版前请解除透明像素锁定。');const {effectiveMaskWeight}=await import('./maskEffects.js'),tiles:DiskBlob[]=[],inks:DiskBlob[]=[];
 for(let y=0;y<b.height;y+=256)for(let x=0;x<b.width;x+=256){signal?.throwIfAborted();const r={x,y,width:Math.min(256,b.width-x),height:Math.min(256,b.height-y)},part=await bitmapRegionAsync(b,r,signal);const weights=await (await import('./diskPager.js')).readDiskPixels(()=>Float32Array.from({length:r.width*r.height},(_,i)=>effectiveMaskWeight(m,x+i%r.width,y+Math.floor(i/r.width))),signal);for(let i=0;i<weights.length;i++)part.data[i*4+3]=part.data[i*4+3]!*weights[i]!;tiles.push(await diskPager.write(deflate(pixelBytesView(part)),signal));if(part.cmyk)inks.push(await diskPager.write(deflate(pixelBytesView(withPixels(part.width,part.height,part.cmyk,16))),signal));}
 const {mask,...rest}=layer;return {...rest,bitmap:pagedBitmap(b.width,b.height,{kind:'disk',tiles,...(inks.length?{inks}:{})},depthOf(b))};
}

export async function tiledCmykFill(state:ImageState,id:string,settings:InkPaint,signal?:AbortSignal){return editTiledLayer(state,id,state.selection??{x:0,y:0,width:state.width,height:state.height},s=>fillCmyk(s,id,settings),signal);}
export async function tiledCmykStroke(state:ImageState,id:string,points:readonly BrushPoint[],size:number,settings:InkPaint,dynamics:BrushDynamics={},signal?:AbortSignal){
 if(!points.length||points.length>8192||points.some(p=>![p.x,p.y,p.pressure??1].every(Number.isFinite)))throw Error('笔画坐标或笔压无效。');
 const x=Math.floor(Math.min(...points.map(p=>p.x))-size*(1+(dynamics.scatter??0))/2-1),y=Math.floor(Math.min(...points.map(p=>p.y))-size*(1+(dynamics.scatter??0))/2-1),right=Math.ceil(Math.max(...points.map(p=>p.x))+size*(1+(dynamics.scatter??0))/2+1),bottom=Math.ceil(Math.max(...points.map(p=>p.y))+size*(1+(dynamics.scatter??0))/2+1);
 return editTiledLayer(state,id,{x,y,width:right-x,height:bottom-y},s=>{const stroke=new CmykStroke(s,id,size,settings,dynamics);for(const p of points)stroke.point(p);return stroke.layer;},signal);
}

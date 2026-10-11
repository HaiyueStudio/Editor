import { deflate } from 'pako';
import { diskPager, type DiskBlob } from './diskPager.js';
import { bitmapRegionAsync } from './diskCompositor.js';
import { pagedBitmap, inflateBounded } from './pagedPixels.js';
import { pixelArray, pixelBytesView, withPixels } from './pixelFormat.js';
import { synchronizeCmyk } from './cmyk.js';
import { CmykStroke, type InkPaint } from './cmykEditing.js';
import { BrushPath, PixelStroke, editablePixel, parentOffset, type BrushPoint, type BrushDynamics, type Color, type Rect } from './pixelTools.js';
import { selectionWeight, type Selection } from './selection.js';
import { intersect } from './tiledEditing.js';
import { checkSize, layerLocked, type Bitmap, type ImageLayer, type ImageState } from './document.js';
import { tiledChanges, tiledAlphaSources } from './tiledProvenance.js';

export function incrementalStrokeFits(state:ImageState,id:string){const layer=editablePixel(state,id),p=parentOffset(state.layers,id)!,b=layer.bitmap,r=state.selection??{x:0,y:0,width:state.width,height:state.height},x=p.x+layer.x,y=p.y+layer.y;return layerLocked(state.layers,id,'transparency')||Math.max(x+(b?.width??0),r.x+r.width)-Math.min(x,r.x)<=30000&&Math.max(y+(b?.height??0),r.y+r.height)-Math.min(y,r.y)<=30000;}
export interface StrokeSettings extends BrushDynamics {size:number;opacity:number;color:Color;erase:boolean;ink?:InkPaint}
/** One stroke, immutable base pixels, disk-backed coverage checkpoints. Each segment is
 * generated once; only intersected tiles are read/written. Snapshots share all other pages. */
export class TiledStrokeSession {
 private readonly base:ImageLayer;private readonly bounds:Rect;private readonly origin:{x:number;y:number};
 private readonly path:BrushPath;private readonly controller=new AbortController();
 private tiles:DiskBlob[]|undefined;private inks:DiskBlob[]=[];private coverage=new Map<number,DiskBlob>();
 private output:ImageLayer;private processed=0;private tail:Promise<void>=Promise.resolve();
 private counts={points:0,segments:0,tileEdits:0,checkpointBytes:0};
 constructor(private state:ImageState,private id:string,private settings:StrokeSettings){
  this.base=editablePixel(state,id);this.output=this.base;const p=parentOffset(state.layers,id)!;
  this.origin={x:p.x+this.base.x,y:p.y+this.base.y};const b=this.base.bitmap,s=state.selection??{x:0,y:0,width:state.width,height:state.height};
  const x=Math.min(this.origin.x,s.x),y=Math.min(this.origin.y,s.y);this.bounds={x,y,width:Math.max(this.origin.x+(b?.width??0),s.x+s.width)-x,height:Math.max(this.origin.y+(b?.height??0),s.y+s.height)-y};if(b&&layerLocked(state.layers,id,'transparency'))this.bounds={...this.origin,width:b.width,height:b.height};checkSize(this.bounds.width,this.bounds.height);
  this.path=new BrushPath(settings.size,settings);
 }
 stats(){return {...this.counts,checkpointTiles:this.coverage.size,workingTilePixels:256*256};}
 cancel(){this.controller.abort();this.coverage.clear();}
 /** Input is the growing pointer history; queued work keeps only its new suffix. */
 update(points:readonly BrushPoint[]){
  if(points.length>8192||points.length<this.processed)throw Error('笔画点数量无效。');
  const next=points.slice(this.processed);this.processed=points.length;
  this.tail=this.tail.then(()=>this.apply(next));return this.tail.then(()=>this.output);
 }
 private rect(index:number){const cols=Math.ceil(this.bounds.width/256),x=index%cols*256,y=Math.floor(index/cols)*256;return {x:x+this.bounds.x,y:y+this.bounds.y,width:Math.min(256,this.bounds.width-x),height:Math.min(256,this.bounds.height-y)};}
 private async original(r:Rect){
  const b=this.base.bitmap,data=pixelArray(r.width*r.height*4,this.state.bitDepth??8),cmyk=this.state.colorMode==='cmyk'?new Float32Array(data.length):undefined;
  const hit=b&&intersect(r,{...this.origin,width:b.width,height:b.height});if(hit){const part=await bitmapRegionAsync(b!,{...hit,x:hit.x-this.origin.x,y:hit.y-this.origin.y},this.controller.signal);for(let y=0;y<hit.height;y++){const at=((y+hit.y-r.y)*r.width+hit.x-r.x)*4;data.set(part.data.subarray(y*hit.width*4,(y+1)*hit.width*4),at);if(cmyk&&part.cmyk)cmyk.set(part.cmyk.subarray(y*hit.width*4,(y+1)*hit.width*4),at);}}
  return {...withPixels(r.width,r.height,data,this.state.bitDepth??8),...(cmyk?{cmyk}:{})};
 }
 private async store(b:Bitmap,index:number){this.tiles![index]=await diskPager.write(deflate(pixelBytesView(b)),this.controller.signal);if(b.cmyk)this.inks[index]=await diskPager.write(deflate(new Uint8Array(b.cmyk.buffer,b.cmyk.byteOffset,b.cmyk.byteLength)),this.controller.signal);}
 private async initialize(){
  if(this.tiles)return;const b=this.base.bitmap;
  if(b?.pages?.kind==='disk'&&this.bounds.x===this.origin.x&&this.bounds.y===this.origin.y&&this.bounds.width===b.width&&this.bounds.height===b.height){this.tiles=[...b.pages.tiles];this.inks=b.pages.inks?[...b.pages.inks]:[];return;}
  this.tiles=[];const count=Math.ceil(this.bounds.width/256)*Math.ceil(this.bounds.height/256),empty=new Map<string,{tile:DiskBlob;ink?:DiskBlob}>();let until=performance.now()+8;
  for(let i=0;i<count;i++){
   this.controller.signal.throwIfAborted();const r=this.rect(i),hit=b&&intersect(r,{...this.origin,width:b.width,height:b.height}),x=r.x-this.origin.x,y=r.y-this.origin.y;
   if(hit&&b.pages?.kind==='disk'&&x>=0&&y>=0&&x%256===0&&y%256===0&&r.width===Math.min(256,b.width-x)&&r.height===Math.min(256,b.height-y)){const index=y/256*Math.ceil(b.width/256)+x/256;this.tiles[i]=b.pages.tiles[index]!;if(b.pages.inks)this.inks[i]=b.pages.inks[index]!;}
   else {const key=r.width+'x'+r.height,cached=!hit&&empty.get(key);if(cached){this.tiles[i]=cached.tile;if(cached.ink)this.inks[i]=cached.ink;}else{await this.store(await this.original(r),i);if(!hit)empty.set(key,{tile:this.tiles[i]!,...(this.inks[i]?{ink:this.inks[i]!}:{})});}}
   if(performance.now()>=until){await new Promise<void>(r=>setTimeout(r,0));until=performance.now()+8;}
  }
 }
 private selection(r:Rect):Selection|undefined {
  let bounds=intersect(r,{x:0,y:0,width:this.state.width,height:this.state.height});if(bounds&&this.state.selection)bounds=intersect(bounds,this.state.selection);if(!bounds)return;
  if(!this.state.selection?.mask&&!this.state.selection?.runs)return bounds;
  const mask=new Uint8Array(bounds.width*bounds.height);let any=false;for(let y=0;y<bounds.height;y++)for(let x=0;x<bounds.width;x++){const weight=Math.round(selectionWeight(this.state.selection,x+bounds.x,y+bounds.y)*255);mask[y*bounds.width+x]=weight;any ||= weight>0;}return any?{...bounds,mask}:undefined;
 }
 private async apply(points:readonly BrushPoint[]){
  const signal=this.controller.signal;signal.throwIfAborted();if(!points.length)return;
  const edits=new Map<number,[BrushPoint,BrushPoint][]>(),cols=Math.ceil(this.bounds.width/256),margin=this.settings.size/2+1;
  for(const p of points){this.path.point(p,(a,b)=>{this.counts.segments++;let r=intersect({x:Math.floor(Math.min(a.x,b.x)-margin),y:Math.floor(Math.min(a.y,b.y)-margin),width:Math.ceil(Math.max(a.x,b.x)+margin)-Math.floor(Math.min(a.x,b.x)-margin),height:Math.ceil(Math.max(a.y,b.y)+margin)-Math.floor(Math.min(a.y,b.y)-margin)},this.state.selection??{x:0,y:0,width:this.state.width,height:this.state.height});if(r)r=intersect(r,{x:0,y:0,width:this.state.width,height:this.state.height});if(r&&layerLocked(this.state.layers,this.id,'transparency'))r=this.base.bitmap?intersect(r,{...this.origin,width:this.base.bitmap.width,height:this.base.bitmap.height}):undefined;if(!r)return;
   for(let y=Math.floor((r.y-this.bounds.y)/256);y<=Math.floor((r.y+r.height-1-this.bounds.y)/256);y++)for(let x=Math.floor((r.x-this.bounds.x)/256);x<=Math.floor((r.x+r.width-1-this.bounds.x)/256);x++){const key=y*cols+x,list=edits.get(key)??[];list.push([a,b]);edits.set(key,list);}
  });this.counts.points++;}
  if(!edits.size)return;await this.initialize();let damage:Rect|undefined;
  for(const [index,segments] of edits){
   signal.throwIfAborted();const r=this.rect(index),selection=this.selection(r);if(!selection)continue;const original=await this.original(r),base={...this.base,x:r.x,y:r.y,children:[],bitmap:original,...(layerLocked(this.state.layers,this.id,'transparency')?{locks:{...this.base.locks,transparency:true}}:{})},local={...this.state,layers:[base],selection},v=this.settings;
   const brush=v.ink?new CmykStroke(local,this.id,v.size,v.ink,v):new PixelStroke(local,this.id,v.size,v.opacity,v.color,v.erase,v),saved=this.coverage.get(index);
   if(saved){const current=await bitmapRegionAsync(this.output.bitmap!,{x:r.x-this.bounds.x,y:r.y-this.bounds.y,width:r.width,height:r.height},signal);brush.restore(current,inflateBounded(await diskPager.blob(saved,signal),r.width*r.height));}
   for(const [a,b] of segments)brush.segment(a,b);
   const output=synchronizeCmyk({...local,layers:[brush.layer]},local).layers[0]!.bitmap!;await this.store(output,index);
   const checkpoint=deflate(brush.checkpoint());this.counts.checkpointBytes+=checkpoint.byteLength;this.coverage.set(index,await diskPager.write(checkpoint,signal));this.counts.tileEdits++;
   const x=Math.min(damage?.x??r.x,r.x),y=Math.min(damage?.y??r.y,r.y);damage={x,y,width:Math.max(damage?damage.x+damage.width:0,r.x+r.width)-x,height:Math.max(damage?damage.y+damage.height:0,r.y+r.height)-y};
   await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  signal.throwIfAborted();if(!damage)return;const previous=this.output.bitmap,b= pagedBitmap(this.bounds.width,this.bounds.height,{kind:'disk',tiles:[...this.tiles!],...(this.inks.length?{inks:[...this.inks]}:{})},this.state.bitDepth??8),parent=parentOffset(this.state.layers,this.id)!;
  if(previous&&damage&&previous.width===b.width&&previous.height===b.height){tiledChanges.set(b,{source:new WeakRef(previous),rect:{...damage,x:damage.x-this.bounds.x,y:damage.y-this.bounds.y}});if(layerLocked(this.state.layers,this.id,'transparency')&&this.base.bitmap)tiledAlphaSources.set(b,new WeakRef(this.base.bitmap));}
  this.output={...this.base,x:this.bounds.x-parent.x,y:this.bounds.y-parent.y,bitmap:b};
 }
}
